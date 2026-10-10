/**
 * verbose 工作详情折叠补丁的纯逻辑。
 *
 * 复用实时 slots 账本:注册项自带 inject 工厂,ui-renderer 的 bindSnapshotSelector
 * 每次快照都动态读 source.getSnapshot(),因此在原地包装共享的 presentation source
 * 就能让已绑定的 usePresentation 选择器直接读到折叠值,无需重挂载。
 *
 * 除两处原地写入(注册项的 inject 与 source 的 getSnapshot)外无副作用。
 *
 * 上游锚点、已知边界与验证方式见 docs/dsh-ui-chat-verbose-fold.md。
 */
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { ChatPresentationPolicy } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { StoredEntry } from '@deepseek-ai/dsh-client-ui-slots'

/** 渲染会话目标主体的槽。 */
export const CHAT_VIEW_SLOT = 'conversation.view'

/** ui-chat 在该槽内给 Chat 目标使用的注册 id。 */
export const CHAT_VIEW_ID = 'chat'

/** 需要折叠已完成 Turn 的工作详情模式。 */
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
}

/** 一次安装用的空记账对象。 */
export function createFoldPatchState(): FoldPatchState {
  return {
    patchedSources: new WeakSet(),
    wrappedEntries: new WeakSet(),
    patchedCount: 0,
    wrappedCount: 0,
    shapeWarned: false,
  }
}

/**
 * 投影一份实时策略:verbose 始终折叠已完成 Turn;其余模式以及已折叠的 verbose
 * 都按原对象返回,使无关模式上的选择器保持稳定引用。
 */
export function foldCompletedForVerbose(policy: ChatPresentationPolicy): ChatPresentationPolicy {
  if (policy.mode !== VERBOSE_MODE || policy.foldCompletedTurns) return policy
  return { ...policy, foldCompletedTurns: true }
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

/**
 * 在实时账本里按 id 定位 ui-chat 的 Chat 视图注册项;缺席或账本不可读时返回 undefined。
 */
export function findChatViewEntry(slots: SlotRegistry): StoredEntry | undefined {
  if (typeof slots.entries !== 'function') return undefined
  const entries = slots.entries(CHAT_VIEW_SLOT)
  if (entries === undefined || entries === null) return undefined
  return entries.find(entry => entry.options?.id === CHAT_VIEW_ID)
}

/**
 * 原地包装一个实时 source:渲染每次快照都重读 source.getSnapshot(),因此包装后
 * (含此前已绑定的选择器)立即读到折叠值。返回本次是否执行了包装。
 */
export function wrapPresentationSource(source: ObservableSnapshot<ChatPresentationPolicy>, state: FoldPatchState): boolean {
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
    wrapPresentationSource(source, state)
    return face
  }
  return 'patched'
}
