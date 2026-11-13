/**
 * 上浮规划：把注册表当前顺序、工作区归属、待落位的新会话与回合终态算成上浮请求与移动动作，
 * 不碰任何服务。
 *
 *   - `owningWorkspaceId`：这个会话属于哪个工作区（依据注册表实体的 `sessionIds`）；
 *   - `frontMove`：把它提到最前需要注册表的哪一次 `insertBefore`（DOM insertBefore 语义）；
 *   - `planPendingFronts`：新会话还没有归属时先登记，等归属出现再认领；
 *   - `taskOutcome`：一次回合结束算不算任务终点（完成，或模型请求重试耗尽后的报错）。
 *
 * 本文件的 interface 大多是插件私有的规划中间事实（上游没有对应公开类型）：上游 `Workspace`
 * 带品牌 id、方法与持久化语义，这里只保留纯规划要比较的字符串投影；`RequestRetry` 与
 * `TurnEndFacts` 的字段则从上游事件类型投影。
 */
import type { LlmRetryEventData } from '@deepseek-ai/dsh-llm-retry'
import type { TurnEndReason } from '@deepseek-ai/dsh-session'

/**
 * 规划只读到的工作区字段：上游 `Workspace` 实体的字符串投影。
 *
 * 规划按字符串比较 id 与会话归属，不引入品牌 id 与方法，因此不直接用上游 `Workspace`。
 */
export interface WorkspaceRow {
  /** 注册表记录 id 的字符串形态。 */
  readonly id: string
  /** 该工作区账下的会话 id（注册表实体 `sessionIds` 的字符串形态）。 */
  readonly sessionIds: readonly string[]
}

/** 已登记、还没认领工作区的新会话（插件私有的登记事实）。 */
export interface PendingSession {
  /** 会话 id 的字符串形态。 */
  readonly sessionId: string
  /** 登记时刻（epoch ms），用于判定等待超时。 */
  readonly since: number
}

/** 一次上浮请求（插件私有的规划动作）；`reason` 只用于测试断言，不参与判定，也不进日志。 */
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

/**
 * 非模型请求失败的合成错误码：工具激活失败与未知错误。
 * 带上它们的回合错误不是「大模型请求失败」，不参与报错上浮。
 */
export const SYNTHETIC_FAILURE_CODES: readonly string[] = ['UNKNOWN', 'TOOL_ACTIVATION_FAILED']

/**
 * 一次 `llm/retry` 事件里规划关心的字段：直接由上游 `LlmRetryEventData` 投影。
 *
 * `mode` / `turn` / `retry` 是两种模式共有的字段；`maxRetries` 只在上游 `normal` 分支出现，
 * 这里放宽为可选——事件还要经过 `index.ts` 的运行时校验（缺字段的一律不判定），
 * 校验通过后才进入规划。
 */
export type RequestRetry = Pick<LlmRetryEventData, 'mode' | 'turn' | 'retry'> &
  Partial<Pick<Extract<LlmRetryEventData, { mode: 'normal' }>, 'maxRetries'>>

/** 出错时的错误码类型：上游 `TurnEndReason` 错误变体里的 `LlmFailure['code']`。 */
type TurnEndFailureCode = Extract<TurnEndReason, { kind: 'error' }>['error']['code']

/** 一次回合结束里规划关心的字段；`kind` 与 `failureCode` 直接投影上游 `TurnEndReason`。 */
export interface TurnEndFacts {
  /** 结束的回合号。 */
  readonly turn: number
  /** `turn/end.reason.kind`（上游 `TurnEndReason` 的判别字段）。 */
  readonly kind: TurnEndReason['kind']
  /** 本会话当前 step 最近一次 `llm/retry`；没有重试时为 undefined。 */
  readonly retry: RequestRetry | undefined
  /** 出错时的错误码（`kind === 'error'` 时有意义）。 */
  readonly failureCode?: TurnEndFailureCode
  /** 这个回合是否真的跑过至少一个 step（即模型产出了内容）。 */
  readonly hadStep: boolean
}

/**
 * 回合算不算一次任务终点，是则返回 `'completed'` 或 `'error'`，否则 undefined。
 *
 *   - 完成：`completed` 且跑过 step——有最终回复；
 *   - 报错：只认「模型请求重试耗尽」——当前 step 的重试已到上限，且失败不是
 *     {@link SYNTHETIC_FAILURE_CODES} 里的合成码；其余终止（用户取消、策略阻断、
 *     token 上限、崩溃补记）都不算。
 */
export function taskOutcome(facts: TurnEndFacts): 'completed' | 'error' | undefined {
  if (facts.kind === 'completed') return facts.hadStep ? 'completed' : undefined
  if (facts.kind !== 'error' || !facts.hadStep) return undefined
  const retry = facts.retry
  if (retry === undefined || retry.mode !== 'normal' || retry.maxRetries === undefined) return undefined
  if (retry.turn !== facts.turn) return undefined
  if (retry.retry < retry.maxRetries) return undefined
  if (SYNTHETIC_FAILURE_CODES.includes(facts.failureCode ?? '')) return undefined
  return 'error'
}

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

/** 一轮里待落位新会话的三种归宿（插件私有的规划结果）。 */
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
