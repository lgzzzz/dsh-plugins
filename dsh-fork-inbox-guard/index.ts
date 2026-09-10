/**
 * dsh-fork-inbox-guard — 分叉会话不继承源会话「已入队但未被认领」的输入。
 *
 * ## 问题（上游 0.1.5-rc.1 的 fork 切点）
 *
 * 用户在**某个 turn 仍在运行**时补发的消息走 `mode: "queue"`：
 * `dsh-api-session-controller` 的 `prompt()` → `agent.followup(message)` →
 * `agent.send(message, "next-turn", true)` → `inbox.splice(...)`，落一条
 * `agent/inbox/spliced`（insert）。因此这条 insert 事件位于该 turn 的
 * `turn/start` 与 `turn/end` 之间；而它被认领（claim）发生在**下一个**
 * turn 的 `preStep`，即下一个 `turn/start` 之后。
 *
 * 分叉按钮把助手消息事件的 seq 交给 `session.fork({atSeq})`，宿主侧的切点是
 * （`dsh-api-session-controller/lib/index.js` 的 `fork()`）：
 *
 * ```js
 * const boundary = events.find(e => e.type === "turn/end" && e.seq >= atSeq) ?? …
 * let cut = boundary.seq + 1;
 * while (cut < events.length && events[cut]?.type !== "turn/start") cut++;
 * // 子会话 seed = events.slice(0, cut)
 * ```
 *
 * 即「目标轮 `turn/end` 之后、下一轮 `turn/start` 之前」的全部事件。于是 seed
 * **带走了那条 insert，却没有带走配对的 claim**。
 *
 * 更关键的是：inbox 不是内存态，而是从会话日志里的 `agent/inbox/spliced`
 * 折叠出来的持久投影（`dsh-agent-loop` 的 `inboxProjectionDefinition`；子会话
 * 的投影 cell 会 fold 整个日志，含 seed）。于是子会话凭空多出一条 pending
 * 消息：它不会自动起跑（fork 不唤醒驱动），等你发下一条消息时才被唤醒，而
 * `inbox.claim()` 的语义是「next-step 全部 + **next-turn 恰好一条**」，继承来
 * 的那条排在队首 → 于是「分叉前那条没被认领的消息」先被发给模型，你刚输入的
 * 消息反而留在队列里显示为排队中。
 *
 * ## 本插件的修法（不改全局包、不改 fork 的 seed）
 *
 * 监听宿主事件 `agent/created`。fork 返回前该事件已**同步**派发
 * （`agents.announce()`），而在那之前子会话不可能跑过任何 turn（没有唤醒），
 * 所以这是唯一且足够的时机。对 seeded 会话：
 *
 * 1. 折叠**继承前缀** `events[0, inheritedEventCount)` 里的 inbox splice，
 *    得到「在切点上仍处于 pending」的消息 id 集合；
 * 2. 与子会话**当前** pending 队列求交；
 * 3. 只对命中的 id 调 `agent.inbox.remove(id)`，落一条
 *    `agent/inbox/spliced`（`outcome: 'canceled'`）到**子会话自己的日志**。
 *
 * 用「前缀折叠 + 求交」而不是 `inbox.clear()` 的原因：
 * - 普通（非 seeded）会话 `inheritedEventCount === 0` → 前缀为空 → 天然不动作；
 * - 被 resume 的 fork 子会话 `isSeeded === true` 且继承前缀不变，插件加载**之前**
 *   它自己在切点之后排队的消息在**当前** pending 里，但不在前缀折叠结果里 →
 *   不会被误删；
 * - 已被认领的继承消息不在当前 pending 里 → 不会重复移除；
 * - 消息 id 由控制器用 `randomUUID()` 生成，子会话自己的新消息不可能与前缀里
 *   的 id 相同 → 交集不会误伤；
 * - **子代理 fork 天然不受影响**：`dsh-subagent-fork-in-process` 的
 *   `completedTurnPrefix()` 恰好切在最后一个 `turn/end`（含），而 `claim` 必然
 *   发生在某个 `turn/start` 之后，所以该前缀里的 splice 一定成对平衡 → 折叠
 *   结果为空 → 交集为空 → 一条消息都不移除、一条日志都不追加。插件另外**显式
 *   跳过**有 runtime owner 的子代理（`ctx.agents.isOwnedBy`），让这条边界成为
 *   可读的契约而不是隐式的巧合。
 *
 * ## 同步 listener 不得抛错
 *
 * `agent/created` 是同步 emit，**同步抛错会否决 Agent 发布**
 * （`dsh-agent` 的 `announce()` 与事件类型文档）。因此回调整体 try/catch，
 * 任何异常（含 logger 自身抛错、`ctx.get` 失败）都被吞掉并降级为 warn。
 *
 * 本文件由 Node 22+ 内置的 Type Stripping 直接加载（仅可擦除语法：无 enum /
 * 命名空间 / 参数属性），无需编译步骤；package.json 需保持 `"type": "module"`。
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

/** 会话的结构切片：仅需继承切点、header 标记与全量事件快照。 */
interface GuardedSession {
  readonly id: string
  readonly header: { readonly isSeeded: boolean }
  /** fork 继承前缀长度；非 seeded 会话与普通会话均为 0。 */
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

/**
 * `ctx.get('agents')` 返回的宿主 Agent 注册表结构切片：只用于判断「刚创建的
 * Agent 是否由某个 Agent 拥有」（即子代理），据此显式跳过。
 */
interface AgentRegistrySlice {
  list(): readonly unknown[]
  isOwnedBy(id: unknown, owner: unknown): boolean
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
 * 解析一条 `agent/inbox/spliced` 数据；形状不合法时返回 undefined。
 *
 * 刻意「跳过而不是抛错」：历史日志里出现异常 splice 时，既不能让守卫的整体
 * 计算失败（进而经同步 listener 否决 Agent 发布），也不该凭空猜测其语义。
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
    if (!isRecord(item) || typeof item.id !== 'string' || item.id.length === 0) return undefined
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
 * 一致，含同样的截断与钳制规则）折叠一段事件前缀，返回折叠结束时仍处于
 * pending 的消息 id 集合。
 *
 * 上游对非法 splice 是抛错，这里跳过非法 splice——两者的差异只体现在「本该
 * 崩溃的日志」上，而守卫的职责是收敛而不是放大故障。
 *
 * @param prefix - 按 seq 升序的继承前缀事件。
 * @returns 折叠结束时两个 pending 列表里所有消息的 id 集合。
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
 * 读取一个会话「继承前缀在切点上仍 pending」的消息 id 集合。
 *
 * 非 seeded 会话、`inheritedEventCount` 非正、或事件不可读时返回空集（即不
 * 动作），因此调用方不需要额外判断「这是不是一次 fork」。
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
 * 移除子会话中「继承自源会话且仍 pending」的消息。
 *
 * 只移除命中的项：子会话自己排队的消息、已被认领的继承消息、另一个 target
 * 列表里的无关项都不受影响。每个 id 只尝试一次，重复调用是幂等的（第二次
 * `inbox.remove` 返回 false）。
 *
 * @param agent - 新创建（或 resume）的 Agent。
 * @param report - 可选日志回调，仅在确实移除时调用一次。
 * @returns 被移除的消息 id（按当前 pending 的顺序）。
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
  const seen = new Set<string>()
  for (const message of pending) {
    if (message === undefined || message === null) continue
    const id = message.id
    if (typeof id !== 'string' || seen.has(id) || !inherited.has(id)) continue
    seen.add(id)
    if (inbox.remove(id) === true) removed.push(id)
  }
  if (removed.length > 0 && report !== undefined) {
    report(`dropped ${removed.length} inherited pending message(s) on forked session "${session.id}"`)
  }
  return removed
}

/**
 * 判断刚创建的 Agent 是否为「由某个 Agent 拥有」的子代理。
 *
 * 子代理 fork 的 seed 恰好切在 `turn/end`（见 `dsh-subagent-fork-in-process`
 * 的 `completedTurnPrefix`），继承前缀天然平衡，本插件对它本来就不会动作；
 * 这里显式跳过是让边界成为可读契约。注册表不可用或读取失败时保守跳过
 * （宁可不动作，也不碰子代理）。
 *
 * @param ctx - 插件上下文（用于 `ctx.get('agents')`）。
 * @param agent - 刚创建的 Agent。
 * @returns true 表示应当跳过。
 */
function isOwnedChildAgent(ctx: Context, agent: GuardedAgent): boolean {
  const id = agent.session?.id
  if (typeof id !== 'string' || id.length === 0) return true
  const registry = ctx.get('agents') as AgentRegistrySlice | undefined
  if (registry === undefined || registry === null) return true
  if (typeof registry.list !== 'function' || typeof registry.isOwnedBy !== 'function') return true
  for (const owner of registry.list()) {
    if (owner === undefined || owner === null) continue
    if (owner === agent) continue
    if (registry.isOwnedBy(id, owner)) return true
  }
  return false
}

// ---------------------------------------------------------------------------
// 插件入口
// ---------------------------------------------------------------------------

export const name = 'dsh-fork-inbox-guard'

/**
 * 注册 `agent/created` 监听：每个 Agent 发布时检查它是否为 seeded 会话，并丢弃
 * 继承前缀里仍 pending 的输入。
 *
 * 同步 listener 抛错会否决 Agent 发布，因此这里整体 try/catch，任何失败都只
 * 记日志；子代理（有 runtime owner）显式跳过。
 */
export function apply(ctx: Context): void {
  ctx.on('agent/created', ({ agent }: { agent: Agent }) => {
    try {
      const guarded = agent as unknown as GuardedAgent
      if (isOwnedChildAgent(ctx, guarded)) return
      // 日志回调自身吞掉异常：记录失败不能影响移除结果，更不能否决 Agent 发布。
      dropInheritedPending(guarded, message => {
        try {
          ctx.logger.info(message)
        } catch {
          /* 记录失败无关紧要 */
        }
      })
    } catch (error) {
      try {
        ctx.logger.warn(
          `dsh-fork-inbox-guard: ${error instanceof Error ? error.message : String(error)}`,
        )
      } catch {
        /* 同步 listener 抛错会否决发布，日志失败也必须吞掉 */
      }
    }
  })
}

export default { name, apply }
