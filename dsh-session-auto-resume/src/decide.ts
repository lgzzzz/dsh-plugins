/**
 * 纯判定：一个会话的「最后一轮」是不是被打断，以及启动时该扫描哪些会话。
 *
 * 这里不碰任何 DSH 运行时，只吃 `session/event` 的形状，因此可以用假的会话日志
 * 直接单测。规则的前因后果见 docs/DETAIL.md：
 *
 *   - 只有 `interrupted`（崩溃 / 被杀后由读方配平出来的终态，含未闭合的原始尾部）
 *     和非用户原因 `aborted`（disposed / parent / hook）算「没跑完就被打断」；
 *   - `aborted` 但原因是 `user`（用户点了停止）或 `legacy`（旧格式里没记下原因）
 *     一律不动 —— 前者是明确要求，后者无法证明不是用户停的；
 *   - `completed` / `error` / `max-tokens` / `blocked` / `forked` 都不是本插件的事。
 */

/** 可识别的最后一轮结局；`unknown` 留给将来可合并扩展的新原因。 */
export type TurnOutcomeKind =
  | 'none'
  | 'open'
  | 'completed'
  | 'interrupted'
  | 'aborted'
  | 'error'
  | 'max-tokens'
  | 'blocked'
  | 'forked'
  | 'unknown'

/** `turn/end` 的 `data.reason` 里本插件关心的字段。 */
export interface TurnEndReasonLike {
  readonly kind: string
  /** 仅 `kind: 'aborted'` 存在：取消原因。 */
  readonly reason?: { readonly kind: string }
}

/** 本模块需要的事件轮廓：只读类型、序号、时间与事件载荷。 */
export interface EventLike {
  readonly type: string
  readonly seq: number
  readonly time: number
  /** 事件载荷；本模块只从中窄化读取 `turn/end` 的 `reason`。 */
  readonly data?: unknown
}

/** 一个会话最后一轮的结局。 */
export interface TurnOutcome {
  /** 最后一轮为什么结束；没有轮次时为 `none`，有轮次没结束（原始日志尾部）时为 `open`。 */
  readonly kind: TurnOutcomeKind
  /** `aborted` 的取消原因：user / parent / hook / disposed / legacy；其它结局没有。 */
  readonly cancelCause?: string
  /** 最后一轮结束事件的时间（毫秒）；没有轮次时为 0。 */
  readonly at: number
}

/** 从完整（或读方已配平的）会话日志里读出最后一轮的结局。 */
export function inspectTurn(events: readonly EventLike[]): TurnOutcome {
  let start: EventLike | undefined
  let end: EventLike | undefined
  for (const event of events) {
    if (event.type === 'turn/start') {
      if (start === undefined || event.seq > start.seq) start = event
    } else if (event.type === 'turn/end') {
      if (end === undefined || event.seq > end.seq) end = event
    }
  }
  if (end !== undefined && (start === undefined || end.seq > start.seq)) {
    return endedBy(end)
  }
  // 有 `turn/start` 却没有闭合它的 `turn/end`：真实日志尾部就是崩溃留下的开放轮次。
  // sessionQuery 的冷读通常会先配平成 interrupted，这里保留原始形状，由判定层兜底。
  if (start !== undefined) return { kind: 'open', at: start.time }
  return { kind: 'none', at: 0 }
}

/** 把一条 `turn/end` 折叠成结局。 */
function endedBy(end: EventLike): TurnOutcome {
  const reason = turnEndReason(end.data)
  if (reason === undefined) return { kind: 'unknown', at: end.time }
  const kind = outcomeKind(reason.kind)
  if (kind !== 'aborted') return { kind, at: end.time }
  const cause = reason.reason?.kind
  return cause === undefined ? { kind, at: end.time } : { kind, cancelCause: cause, at: end.time }
}

/** 从任意事件载荷里窄化出 `turn/end` 的 `data.reason`；形状不对时返回 undefined。 */
function turnEndReason(data: unknown): TurnEndReasonLike | undefined {
  if (!isRecord(data)) return undefined
  const reason = data.reason
  if (!isRecord(reason) || typeof reason.kind !== 'string' || reason.kind === '') return undefined
  const cause = isRecord(reason.reason) ? reason.reason.kind : undefined
  return {
    kind: reason.kind,
    ...(typeof cause === 'string' && cause !== '' ? { reason: { kind: cause } } : {}),
  }
}

/** 是否是普通对象。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** 把日志里的原因字符串收窄成已知结局；未来的新原因落到 `unknown`。 */
function outcomeKind(kind: string): TurnOutcomeKind {
  switch (kind) {
    case 'completed':
    case 'interrupted':
    case 'aborted':
    case 'error':
    case 'max-tokens':
    case 'blocked':
    case 'forked':
      return kind
    default:
      return 'unknown'
  }
}

/** 判定“被打断”时采用的口径。 */
export interface RestartPolicy {
  /** hook 取消是否也算“被打断”。hook 是某个属主主动取消，可能每次都重演。 */
  readonly includeHookCancelled: boolean
}

/** 可恢复的触发点；`label` 用于日志与续跑文案里的 `{reason}`。 */
export type RestartTrigger = 'interrupted' | 'disposed' | 'parent' | 'hook'

/** 一次恢复决定。 */
export interface RestartDecision {
  readonly trigger: RestartTrigger
  /** 稳定标签：`interrupted` 或 `aborted:<cause>`。 */
  readonly label: string
}

/**
 * 判定是否恢复。只有「没跑完就被打断」才返回决定：
 * `interrupted`（含未闭合的 `open` 尾部），或非用户原因的 `aborted`。
 */
export function restartDecision(
  outcome: TurnOutcome,
  policy: RestartPolicy,
): RestartDecision | undefined {
  // 原始日志尾部未闭合的轮次就是“没跑完”；sessionQuery 的冷读通常已把它配平成
  // interrupted，这里再兜一层，避免读路径变化时整个功能静默失效。
  if (outcome.kind === 'interrupted' || outcome.kind === 'open') {
    return { trigger: 'interrupted', label: 'interrupted' }
  }
  if (outcome.kind !== 'aborted') return undefined
  switch (outcome.cancelCause) {
    case 'disposed':
      return { trigger: 'disposed', label: 'aborted:disposed' }
    case 'parent':
      return { trigger: 'parent', label: 'aborted:parent' }
    case 'hook':
      return policy.includeHookCancelled ? { trigger: 'hook', label: 'aborted:hook' } : undefined
    // user：用户明确终止。legacy：旧记录没保存原因，无法证明不是用户停的。
    case 'user':
    case 'legacy':
    default:
      return undefined
  }
}

/** 启动扫描时，从 Session 列表投影里取出与恢复相关的一行。 */
export interface SessionCandidate {
  readonly sessionId: string
  /** 最近活动时间（最后一条人类消息，缺失时回落到创建时间）。 */
  readonly updatedAt: number
  /** 此刻有 Agent 正在跑驱动器。 */
  readonly running: boolean
  /** 会话里一轮都没有。 */
  readonly blank: boolean
  /** `subagent` 表示子会话，交给 subagent 路由，不在这里恢复。 */
  readonly origin?: string
  /** 恢复会话需要记录过 cwd。 */
  readonly cwd?: string
}

/** 候选筛选口径。 */
export interface SelectionOptions {
  /** 当前时间，毫秒；测试里固定注入。 */
  readonly now: number
  /** 时间窗天数；`<= 0` 表示不限。 */
  readonly windowDays: number
  /** 已归档的会话 id：用户明确收起了，不自动跑。 */
  readonly archived: ReadonlySet<string>
  /** 已有 live Agent 的会话 id：不属于“启动时恢复”。 */
  readonly live: ReadonlySet<string>
  /** 最多检查多少个候选日志；恢复数量另有上限。 */
  readonly scanLimit: number
}

/**
 * 选出值得进一步读日志的会话，按最近活动倒序。
 *
 * 只做便宜的元数据过滤；真正的原因判定要读日志，所以在数量上限内再逐个读。
 */
export function selectCandidates(
  items: readonly SessionCandidate[],
  options: SelectionOptions,
): SessionCandidate[] {
  const limit = Number.isFinite(options.scanLimit) ? Math.max(0, Math.trunc(options.scanLimit)) : 0
  if (limit === 0) return []
  const cutoff = options.windowDays > 0 ? options.now - options.windowDays * 86_400_000 : undefined
  return items
    .filter((item) => {
      if (item.blank) return false
      if (item.origin === 'subagent') return false
      if (item.cwd === undefined) return false
      if (item.running) return false
      if (options.live.has(item.sessionId)) return false
      if (options.archived.has(item.sessionId)) return false
      if (cutoff !== undefined && (!Number.isFinite(item.updatedAt) || item.updatedAt < cutoff)) return false
      return true
    })
    .sort((left, right) => right.updatedAt - left.updatedAt || compareIds(left.sessionId, right.sessionId))
    .slice(0, limit)
}

/** 稳定排序的兜底比较。 */
function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

/** 把续跑文案里的 `{reason}` 换成这次恢复的标签。 */
export function continuationText(template: string, decision: RestartDecision): string {
  return template.replaceAll('{reason}', decision.label)
}
