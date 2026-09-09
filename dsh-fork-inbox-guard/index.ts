/**
 * dsh-fork-inbox-guard — 分叉会话不继承源会话「已入队但未被认领」的输入。
 *
 * ## 问题（上游 0.1.5-alpha.1 的行为）
 *
 * 会话 fork 的切点是「最后一个 `turn/end` 之后、下一个 `turn/start` 之前」
 * （`dsh-api-session-controller/lib/index.js` 的 `fork()`：`cut` 会前推到下一个
 * `turn/start`，以保留 between-turn 的状态事件）。而用户消息入队是
 * `agent/inbox/spliced` 事件：空闲时发消息的顺序是
 * `turn/end` → `spliced`(insert) → `turn/start` → `spliced`(remove) →
 * `user/message`。于是 fork 若在 `turn/start` 之前切片，就只带走了 insert、
 * 没带走对应的 remove。
 *
 * 更关键的是：**inbox 不是内存态，而是从日志里的 `agent/inbox/spliced`
 * 折叠出来的持久投影**（`dsh-agent-loop` 的 `inboxProjectionDefinition`；
 * 新会话的投影 cell 会 fold 整个日志，含 seed）。因此子会话凭空多出一条
 * pending 消息 —— 它不会自动起跑（没有 wake），等你发下一条消息时，第一个
 * turn 的 `claim()` 先取走这条继承消息（`next-step` 全部 + `next-turn` 取
 * 最早一条），旧消息于是被「一起」发给模型。
 *
 * ## 本插件的修法（不改全局包）
 *
 * 监听宿主事件 `agent/created`。对 `header.isSeeded === true` 的会话，折叠
 * 继承前缀 `events[0, inheritedEventCount)` 里的 inbox splice，得到「在切点上
 * 仍处于 pending」的消息 id；再与子会话**当前**的 pending 队列求交，只移除
 * 命中的那些（`agent.inbox.remove(id)`，落一条 `agent/inbox/spliced`
 * `outcome: 'canceled'`）。
 *
 * 用「前缀折叠 + 求交」而不是「清空队列」的原因：
 * - 普通会话 `inheritedEventCount === 0`，前缀为空，天然不动作；
 * - 被 resume 的 fork 子会话同样 `isSeeded === true`，其**自己**在继承切点
 *   之后排队的消息（seq >= inheritedEventCount）会被保留；
 * - 已经被认领过的继承消息不在当前 pending 里，不会重复移除；
 * - 子代理 fork 的 seed 以 `turn/end` 结尾（`dsh-subagent-fork-in-process`
 *   的 `completedTurnPrefix`），天然不含 pending splice，本插件对其无副作用。
 *
 * 本文件由 Node 22 内置的 Type Stripping 直接加载（可擦除语法，无 enum /
 * 命名空间 / 参数属性），无需编译；package.json 需保持 `"type": "module"`。
 */
import type { Context } from '@deepseek-ai/cordis'
// 仅为加载宿主事件（含 'agent/created'）的类型声明与 Agent 结构；运行时被擦除。
import type { Agent } from '@deepseek-ai/dsh-agent'

// ---------------------------------------------------------------------------
// 结构切片（只覆盖本插件实际消费的字段，以上游 lib/types 为准）
// ---------------------------------------------------------------------------

/** 会话事件信封的结构切片。 */
interface EventLike {
  readonly type: string
  readonly seq: number
  readonly data?: unknown
}

/** 会话的结构切片：仅需继承切点与全量事件快照。 */
interface GuardedSession {
  readonly id: string
  readonly header: { readonly isSeeded: boolean }
  /** fork 继承前缀长度；普通会话为 0。 */
  readonly inheritedEventCount: number
  snapshotEvents(): readonly EventLike[]
}

/** pending 消息的结构切片（只需要 id 用于身份匹配）。 */
interface GuardedMessage {
  readonly id: string
}

/** inbox 的结构切片：两个 pending 列表 + 按 id 移除。 */
interface GuardedInbox {
  readonly nextTurn: readonly GuardedMessage[]
  readonly nextStep: readonly GuardedMessage[]
  remove(id: string): boolean
}

/** 被守卫的 Agent 结构切片。 */
interface GuardedAgent {
  readonly session: GuardedSession
  readonly inbox: GuardedInbox
}

/** inbox 的两个目标列表。 */
type InboxTarget = 'next-turn' | 'next-step'

/** `agent/inbox/spliced` 数据的结构切片（折叠 inbox 的唯一输入）。 */
interface SpliceLike {
  readonly target: InboxTarget
  readonly start: number
  readonly removedCount: number
  readonly inserted: readonly GuardedMessage[]
}

// ---------------------------------------------------------------------------
// inbox 前缀折叠
// ---------------------------------------------------------------------------

/** 判断是否为可索引的普通对象（排除 null / 数组）。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 解析一条 `agent/inbox/spliced` 数据；形状不合法时返回 undefined
 * （跳过而不是抛错——历史日志里出现异常 splice 时不能让创建流程被否决）。
 */
function parseSplice(data: unknown): SpliceLike | undefined {
  if (!isRecord(data)) return undefined
  const target = data.target
  if (target !== 'next-turn' && target !== 'next-step') return undefined
  const start = data.start
  if (typeof start !== 'number' || !Number.isFinite(start)) return undefined
  const rawRemoved = data.removedCount
  if (rawRemoved !== undefined && (typeof rawRemoved !== 'number' || !Number.isFinite(rawRemoved))) {
    return undefined
  }
  const inserted = data.inserted
  if (!Array.isArray(inserted)) return undefined
  const messages: GuardedMessage[] = []
  for (const item of inserted) {
    if (!isRecord(item) || typeof item.id !== 'string') return undefined
    messages.push({ id: item.id })
  }
  return {
    target,
    start,
    removedCount: typeof rawRemoved === 'number' ? rawRemoved : 0,
    inserted: messages,
  }
}

/**
 * 按 `agent/inbox/spliced` 的语义（与上游 `inboxProjectionDefinition.apply`
 * 一致，含同样的钳制规则）折叠一段事件前缀，返回折叠后仍处于 pending 的消息 id。
 *
 * @param prefix - 按 seq 升序的继承前缀事件。
 * @returns 折叠结束时两个列表里所有 pending 消息的 id 集合。
 */
export function collectInheritedPendingIds(prefix: readonly EventLike[]): Set<string> {
  const lists: Record<InboxTarget, GuardedMessage[]> = { 'next-turn': [], 'next-step': [] }
  if (!Array.isArray(prefix)) return new Set()
  for (const event of prefix) {
    if (event === undefined || event === null || event.type !== 'agent/inbox/spliced') continue
    const splice = parseSplice(event.data)
    if (splice === undefined) continue
    const list = lists[splice.target]
    const start = Math.min(Math.max(Math.trunc(splice.start), 0), list.length)
    const removedCount = Math.min(Math.max(Math.trunc(splice.removedCount), 0), list.length - start)
    lists[splice.target] = list.toSpliced(start, removedCount, ...splice.inserted)
  }
  const pending = new Set<string>()
  for (const message of lists['next-turn']) pending.add(message.id)
  for (const message of lists['next-step']) pending.add(message.id)
  return pending
}

/**
 * 读取一个会话「继承前缀在切点上仍 pending」的消息 id。
 *
 * 非 seeded 会话、`inheritedEventCount` 非正、或无法读取事件时返回空集
 * （即不动作），因此调用方不需要额外判断是否 fork。
 *
 * @param session - 目标会话（结构切片）。
 * @returns 继承 pending 消息 id 集合。
 */
export function inheritedPendingIdsOf(session: GuardedSession): Set<string> {
  const empty = new Set<string>()
  if (session === undefined || session === null) return empty
  const header = session.header
  if (header === undefined || header === null || header.isSeeded !== true) return empty
  const cut = session.inheritedEventCount
  if (typeof cut !== 'number' || !Number.isSafeInteger(cut) || cut <= 0) return empty
  const events = session.snapshotEvents()
  if (!Array.isArray(events) || events.length === 0) return empty
  return collectInheritedPendingIds(events.slice(0, Math.min(cut, events.length)))
}

// ---------------------------------------------------------------------------
// 移除
// ---------------------------------------------------------------------------

/**
 * 移除子会话中「继承自源会话且仍 pending」的消息。只做移除，不改动其他队列项：
 * 子会话自己新排队的消息、已被认领的继承消息都不受影响。
 *
 * @param agent - 新创建（或 resume）的 Agent。
 * @param report - 可选日志回调，仅在确实移除时调用一次。
 * @returns 被移除的消息 id（按 `next-turn`、`next-step` 顺序）。
 */
export function dropInheritedPending(
  agent: GuardedAgent,
  report?: (message: string) => void,
): string[] {
  if (agent === undefined || agent === null) return []
  const session = agent.session
  const inbox = agent.inbox
  if (session === undefined || session === null || inbox === undefined || inbox === null) return []
  const inherited = inheritedPendingIdsOf(session)
  if (inherited.size === 0) return []

  const pending: GuardedMessage[] = []
  if (Array.isArray(inbox.nextTurn)) pending.push(...inbox.nextTurn)
  if (Array.isArray(inbox.nextStep)) pending.push(...inbox.nextStep)

  const removed: string[] = []
  for (const message of pending) {
    if (message === undefined || message === null) continue
    if (typeof message.id !== 'string' || !inherited.has(message.id)) continue
    if (inbox.remove(message.id) === true) removed.push(message.id)
  }
  if (removed.length > 0 && report !== undefined) {
    report(`dropped ${removed.length} inherited pending message(s) on forked session "${session.id}"`)
  }
  return removed
}

// ---------------------------------------------------------------------------
// 插件入口
// ---------------------------------------------------------------------------

export const name = 'dsh-fork-inbox-guard'

/**
 * 注册 `agent/created` 监听：每个 Agent 发布时检查它是否为 seeded 会话，
 * 并丢弃继承前缀里仍 pending 的输入。
 *
 * 同步 listener 抛错会否决 Agent 发布，因此这里整体 try/catch，只记日志。
 */
export function apply(ctx: Context): void {
  ctx.on('agent/created', ({ agent }: { agent: Agent }) => {
    try {
      // 日志回调自身吞掉异常：记录失败不能影响移除结果，更不能否决 Agent 发布。
      dropInheritedPending(agent, message => {
        try {
          ctx.logger.info(message)
        } catch {
          /* 记录失败无关紧要 */
        }
      })
    } catch (error) {
      try {
        ctx.logger.warn(`dsh-fork-inbox-guard: ${error instanceof Error ? error.message : String(error)}`)
      } catch {
        /* 同步 listener 抛错会否决发布，日志失败也必须吞掉 */
      }
    }
  })
}

export default { name, apply }
