/**
 * 上浮规划：把注册表当前顺序、工作区归属与待落位的新会话算成上浮请求与移动动作，不碰任何服务。
 *
 *   - `owningWorkspaceId`：这个会话属于哪个工作区（依据注册表实体的 `sessionIds`）；
 *   - `frontMove`：把它提到最前需要注册表的哪一次 `insertBefore`（DOM insertBefore 语义）；
 *   - `planPendingFronts`：新会话还没有归属时先登记，等归属出现再认领。
 */

/** 规划只读到的工作区字段。 */
export interface WorkspaceRow {
  /** 注册表记录 id 的字符串形态。 */
  readonly id: string
  /** 该工作区账下的会话 id（注册表实体 `sessionIds` 的字符串形态）。 */
  readonly sessionIds: readonly string[]
}

/** 已登记、还没认领工作区的新会话。 */
export interface PendingSession {
  /** 会话 id 的字符串形态。 */
  readonly sessionId: string
  /** 登记时刻（epoch ms），用于判定等待超时。 */
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

/** 待落位的新会话最长等待时间；超时仍无归属就放弃。 */
export const PENDING_TTL_MS = 60_000

/** 返回拥有该会话的工作区 id；不属于任何工作区时为 undefined。 */
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
 * 返回把 `workspaceId` 提到最前所需的那一次移动。
 * 注册表为空、它已经在最前、或它不在注册表里时返回 undefined（无需写盘）。
 */
export function frontMove(order: readonly string[], workspaceId: string): FrontMove | undefined {
  const first = order[0]
  if (first === undefined || first === workspaceId) return undefined
  if (!order.includes(workspaceId)) return undefined
  return { id: workspaceId, beforeId: first }
}

/**
 * 把一串刚有会话活动的会话按到达顺序解析成上浮请求。
 * 认不出归属的会话（不属于任何工作区，或已从工作区账下移除）被丢掉。
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
  /** 按登记先后给出的上浮请求；越晚登记的越靠后。 */
  readonly fronts: readonly FrontRequest[]
  /** 已经认领到工作区、可以从待落位表里删掉的会话。 */
  readonly settled: readonly string[]
  /** 等太久仍无归属、应当放弃的会话。 */
  readonly expired: readonly string[]
}

/**
 * 让待落位的新会话认领工作区：有归属的给出上浮请求并计入 `settled`，超时的计入 `expired`。
 * 多个新会话落在同一工作区时各自给出一次请求，重复的请求会被 {@link frontMove} 判定为已在最前。
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
