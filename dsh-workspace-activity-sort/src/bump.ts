/**
 * 上浮规划：把「注册表当前顺序 + 工作区归属 + 待落位的新会话」算成上浮请求与
 * 移动动作，不碰任何服务，因此可以脱离宿主单独测试。
 *
 * 三条纯函数对应三件事：
 *   - {@link owningWorkspaceId}：这个会话属于哪个工作区（归属的唯一真源是注册表
 *     实体的 `sessionIds`，也就是侧边栏分组用的那份账）；
 *   - {@link frontMove}：把它提到最前需要注册表的哪一次 `insertBefore`
 *     （DOM insertBefore 语义：移到锚点之前；已经在最前就一次写盘都不做）；
 *   - {@link planPendingFronts}：新会话还没有归属时先登记，等归属出现再认领。
 */

/** 规划只读到的工作区字段。 */
export interface WorkspaceRow {
  /** 注册表记录 id 的字符串形态（比较与查找都用它）。 */
  readonly id: string
  /** 该工作区账下的会话 id（注册表实体 `sessionIds` 的字符串形态）。 */
  readonly sessionIds: readonly string[]
}

/** 已登记、还没认领工作区的新会话。 */
export interface PendingSession {
  /** 会话 id 的字符串形态。 */
  readonly sessionId: string
  /** 登记时刻（epoch ms）；只用来判定「等太久仍无归属」而放弃。 */
  readonly since: number
}

/** 一次上浮请求；`reason` 只用于日志与测试断言，不参与判定。 */
export interface FrontRequest {
  /** 要提到最前的工作区。 */
  readonly workspaceId: string
  /** 为什么上浮：会话活动，还是新会话落位。 */
  readonly reason: 'activity' | 'new-session'
}

/** 一次移动：把 `id` 移到 `beforeId` 之前。 */
export interface FrontMove {
  readonly id: string
  readonly beforeId: string
}

/** 待落位的新会话最长等多久；还没有归属就放弃（它可能压根不属于任何工作区）。 */
export const PENDING_TTL_MS = 60_000

/**
 * 这个会话属于哪个工作区。
 * @param workspaces - 当前工作区投影（入参顺序无关）。
 * @param sessionId - 会话 id 的字符串形态。
 * @returns 拥有它的工作区 id；不属于任何工作区时 undefined。
 */
export function owningWorkspaceId(
  workspaces: readonly WorkspaceRow[],
  sessionId: string,
): string | undefined {
  for (const workspace of workspaces) {
    if (workspace.sessionIds.includes(sessionId)) return workspace.id
  }
  return undefined
}

/**
 * 把 `workspaceId` 提到最前所需的那一次移动。
 * @param order - 注册表当前顺序。
 * @param workspaceId - 想提到最前的工作区。
 * @returns 需要的移动；注册表为空、它已经在最前、或它不在注册表里时 undefined（无需写盘）。
 */
export function frontMove(order: readonly string[], workspaceId: string): FrontMove | undefined {
  const first = order[0]
  if (first === undefined || first === workspaceId) return undefined
  if (!order.includes(workspaceId)) return undefined
  return { id: workspaceId, beforeId: first }
}

/**
 * 把一串「刚有会话活动」的会话解析成上浮请求，顺序与到达顺序一致。
 * 认不出归属（不属于任何工作区、或已从工作区账下移除）的会话被丢掉：侧边栏的
 * 「Ungrouped」桶不是工作区，没有可上浮的分组。
 * @param workspaces - 当前工作区投影。
 * @param sessionIds - 活动会话 id，按事件到达顺序。
 * @returns 逐个对应的上浮请求。
 */
export function planActivityFronts(
  workspaces: readonly WorkspaceRow[],
  sessionIds: readonly string[],
): FrontRequest[] {
  const fronts: FrontRequest[] = []
  for (const sessionId of sessionIds) {
    const workspaceId = owningWorkspaceId(workspaces, sessionId)
    if (workspaceId !== undefined) fronts.push({ workspaceId, reason: 'activity' })
  }
  return fronts
}

/** 一轮里待落位新会话的三种归宿。 */
export interface PendingPlan {
  /**
   * 按登记先后给出的上浮请求：越晚登记的越靠后，因此最终停在最前的是最新的那个
   * 新会话所属的工作区。
   */
  readonly fronts: readonly FrontRequest[]
  /** 已经认领到工作区、可以从待落位表里删掉的会话。 */
  readonly settled: readonly string[]
  /** 等太久仍无归属、应当放弃的会话。 */
  readonly expired: readonly string[]
}

/**
 * 让待落位的新会话认领工作区。
 *
 * 新会话在 `session/created` 时还没有工作区归属（注册表的 attach 写在那之后），
 * 所以插件先登记、等归属出现（工作区表的持久写入）时再上浮一次。多个新会话落在
 * 同一个工作区时各自给出一次请求，重复的请求会被 {@link frontMove} 的「已在最前」
 * 判定吃掉，不会多写盘。
 * @param input - 当前工作区投影、待落位登记、当前时刻与等待上限。
 * @returns 上浮请求与两种清理结果；两者都为空表示这一批还在等归属。
 */
export function planPendingFronts(input: {
  readonly workspaces: readonly WorkspaceRow[]
  readonly pending: readonly PendingSession[]
  readonly now: number
  readonly ttl: number
}): PendingPlan {
  const entries = [...input.pending].sort(
    (left, right) =>
      left.since - right.since || (left.sessionId < right.sessionId ? -1 : left.sessionId > right.sessionId ? 1 : 0),
  )
  const fronts: FrontRequest[] = []
  const settled: string[] = []
  const expired: string[] = []
  for (const entry of entries) {
    const workspaceId = owningWorkspaceId(input.workspaces, entry.sessionId)
    if (workspaceId !== undefined) {
      settled.push(entry.sessionId)
      fronts.push({ workspaceId, reason: 'new-session' })
      continue
    }
    if (input.now - entry.since >= input.ttl) expired.push(entry.sessionId)
  }
  return { fronts, settled, expired }
}
