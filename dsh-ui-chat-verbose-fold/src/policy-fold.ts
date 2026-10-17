/**
 * 「完全展开」工作步骤模式的整轮折叠投影。
 *
 * ui-chat 的 presentation policy 同时携带展示模式与收起时机,但只有整轮折叠
 * 打开时,收起时机才有消费者:ChatView 用它决定最新一轮是否保持展开,ChatNodeSeat
 * 用它隐藏过程成员,ChatGroupSeat 用它隐藏过程组。官方 verbose 策略把
 * foldCompletedTurns 设为 false,于是这些消费者全部短路,收起时机既不改变渲染,
 * 也不产生任何报错。
 *
 * 本模块只把 verbose 的 foldCompletedTurns 投影为 true,保留 stepGrouping:'none'
 * 和 collapseTiming,让 verbose 继续以「无组头的独立步骤行」呈现,同时复用官方
 * 已有的整轮折叠机制。除注册项 inject 与 source.getSnapshot 两处原地写入外无副作用。
 */

/** 与真实 observable 同形的最小接口;不绑定某个客户端包的版本。 */
export interface ObservableSnapshot<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}

/** 本补丁读取与改写的策略字段;其余字段原样透传。 */
export interface ChatPresentationPolicy {
  readonly mode: string
  readonly collapseTiming?: string
  readonly foldCompletedTurns: boolean
  readonly stepGrouping?: string
  readonly [key: string]: unknown
}

/** 渲染会话目标主体的槽。 */
export const CHAT_VIEW_SLOT = 'conversation.view'

/** ui-chat 在该槽内给 Chat 目标使用的注册 id。 */
export const CHAT_VIEW_ID = 'chat'

/** 需要整轮折叠的工作步骤展示模式。 */
export const VERBOSE_MODE = 'verbose'

/** 告警输出回调;测试用它捕获告警而不碰 console。 */
export type FoldWarn = (message: string, detail?: unknown) => void

/** 一次已安装补丁的可变记账。 */
export interface FoldPatchState {
  /** 已包装的 source,保证每个 source 最多包装一次。 */
  readonly patchedSources: WeakSet<object>
  /** inject 工厂已被替换的注册项,重复扫描不会叠加包装。 */
  readonly wrappedEntries: WeakSet<object>
  /** 已包装的不同 source 数(WeakSet 取不到大小)。 */
  patchedCount: number
  /** 已包装的不同 chat 视图注册项数。 */
  wrappedCount: number
  /** presentation 缺失的告警是否已发出。 */
  shapeWarned: boolean
  /** source 无法原地包装(例如被冻结)的告警是否已发出。 */
  wrapWarned: boolean
}

/** 一次安装用的空记账对象。 */
export function createFoldPatchState(): FoldPatchState {
  return {
    patchedSources: new WeakSet(),
    wrappedEntries: new WeakSet(),
    patchedCount: 0,
    wrappedCount: 0,
    shapeWarned: false,
    wrapWarned: false,
  }
}

/**
 * 按原始策略对象缓存投影结果。官方 presentationPolicyFor 对同一组
 * (mode, collapseTiming) 返回稳定对象,所以同一原始对象的投影也应保持稳定
 * 引用;否则每次 getSnapshot 都新建对象,会让选择整份策略的消费者持续失配。
 */
const foldedPolicies = new WeakMap<object, ChatPresentationPolicy>()

/**
 * 投影一份实时策略:verbose 打开整轮折叠;其余模式以及已折叠的 verbose
 * 都按原对象返回,使无关模式上的选择器保持稳定引用。
 *
 * 只改 foldCompletedTurns,不动 collapseTiming:投影后的策略仍携带用户选择的
 * 「回答结束后」或「下次有新消息时」,由官方渲染层按原逻辑消费。
 */
export function foldCompletedForVerbose(policy: ChatPresentationPolicy): ChatPresentationPolicy {
  if (policy.mode !== VERBOSE_MODE || policy.foldCompletedTurns === true) return policy
  const cached = foldedPolicies.get(policy)
  if (cached !== undefined) return cached
  const folded: ChatPresentationPolicy = { ...policy, foldCompletedTurns: true }
  foldedPolicies.set(policy, folded)
  return folded
}

/**
 * 从注入面里取出 presentation source;缺少可用的 hooks.presentation 时返回
 * undefined(按缺失处理,降级为空操作并告警一次)。
 */
export function presentationOf(face: unknown): ObservableSnapshot<ChatPresentationPolicy> | undefined {
  if (face === null || typeof face !== 'object') return undefined
  const hooks = (face as { hooks?: unknown }).hooks
  if (hooks === null || typeof hooks !== 'object') return undefined
  const source = (hooks as { presentation?: unknown }).presentation
  if (source === null || typeof source !== 'object') return undefined
  const candidate = source as { getSnapshot?: unknown; subscribe?: unknown }
  if (typeof candidate.getSnapshot !== 'function' || typeof candidate.subscribe !== 'function') return undefined
  return source as ObservableSnapshot<ChatPresentationPolicy>
}

/** 实时 slots 账本里本补丁需要的最小注册项形状。 */
export interface SlotEntry {
  readonly options?: { readonly id?: string }
  inject?: (...args: never[]) => Record<string, unknown>
  readonly [key: string]: unknown
}

/** 实时 slots 注册表里本补丁需要的最小查询面。 */
export interface SlotRegistry {
  entries(key: string): readonly SlotEntry[] | undefined
  subscribe?(key: string, listener: () => void): () => void
  inject?(key: string, callback: () => (() => void) | void): unknown
}

/** 在实时账本里按 id 定位 ui-chat 的 Chat 视图注册项;缺席或账本不可读时返回 undefined。 */
export function findChatViewEntry(slots: SlotRegistry): SlotEntry | undefined {
  if (typeof slots.entries !== 'function') return undefined
  const entries = slots.entries(CHAT_VIEW_SLOT)
  if (entries === undefined || entries === null) return undefined
  return entries.find(entry => entry.options?.id === CHAT_VIEW_ID)
}

/**
 * 原地包装一个实时 source:渲染每次快照都重读 source.getSnapshot(),因此包装后
 * (含此前已绑定的选择器)立即读到折叠值。返回本次是否执行了包装。
 */
export function wrapPresentationSource(
  source: ObservableSnapshot<ChatPresentationPolicy>,
  state: FoldPatchState,
): boolean {
  if (state.patchedSources.has(source)) return false
  state.patchedSources.add(source)
  const original = source.getSnapshot.bind(source)
  source.getSnapshot = () => foldCompletedForVerbose(original())
  state.patchedCount += 1
  return true
}

/** 一次打补丁尝试的结果。 */
export type PatchOutcome =
  /** 已找到 chat 注册项并包装了它的 inject 工厂。 */
  | 'patched'
  /** 该注册项在此前的扫描中已被包装。 */
  | 'already'
  /** 账本上还没有 chat 注册项(或其 inject 工厂)。 */
  | 'pending'

/**
 * 包装 Chat 视图的 inject 工厂,使它返回的每个注入面都带折叠后的策略;可重复调用,
 * 已包装的注册项不再处理。返回本次扫描的结果。
 */
export function patchChatView(slots: SlotRegistry, state: FoldPatchState, warn?: FoldWarn): PatchOutcome {
  const entry = findChatViewEntry(slots)
  if (entry === undefined || entry.inject === undefined) return 'pending'
  if (state.wrappedEntries.has(entry)) return 'already'
  state.wrappedEntries.add(entry)
  state.wrappedCount += 1
  const original = entry.inject
  entry.inject = (...args: never[]): Record<string, unknown> => {
    const face = original(...args)
    const source = presentationOf(face)
    if (source === undefined) {
      if (!state.shapeWarned) {
        state.shapeWarned = true
        warn?.(`${CHAT_VIEW_SLOT}#${CHAT_VIEW_ID} 的注入面没有 hooks.presentation;ui-chat 形状可能已变`)
      }
      return face
    }
    try {
      wrapPresentationSource(source, state)
    } catch (error) {
      if (!state.wrapWarned) {
        state.wrapWarned = true
        warn?.('包装 presentation source 失败;补丁未生效:', error)
      }
    }
    return face
  }
  return 'patched'
}
