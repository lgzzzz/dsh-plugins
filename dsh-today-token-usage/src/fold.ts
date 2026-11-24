/**
 * `todayTokenUsage` 的纯折叠：把一个会话的日志折成「最近一个有用量的本地日期 → 四个 Token 桶」。
 *
 * 折叠语义逐条对齐上游 `@deepseek-ai/dsh-token-meter` 的 `tokenUsage` 投影，只多了日期归属：
 *
 *   - 只认 `assistant/message` 与 `assistant/attempt`；用量取事件的 `data.usage`，缺席时取
 *     stream 里最后一个 `usage` 块（上游 `usageOf` 的判断）；
 *   - 同一 `turn + step` 重复结算按「替换」处理：先减掉上一次、再加上这一次（上游 `addReplacing`）；
 *     两组桶完全相同时整条事件不改变状态，返回原引用，下游因此零成本；
 *   - `llm/retry-started` 清空替换槽，重试后的那次结算是**新增**消耗（上游同样处理）；
 *   - fork / seed 继承来的前缀（`seq < inheritedEventCount`）不计入：那是源会话的消耗，
 *     源会话自己的日志里已经算过，算进来会让同一次请求在「今日总用量」里出现两遍。
 *
 * 与上游的差异只在状态形状：上游把全部历史累加成一个总数，这里按**事件发生的那一天**分桶，
 * 只保留最后一个有用量的日期。跨零点的替换结算（上一次结算在昨天、这一次在今天）只往今天加，
 * 不回头去减昨天的桶——昨天的桶已经不在 `current` 里，也不在今天展示的那份读数里。
 */

import type { AssistantStreamRecord } from '@deepseek-ai/dsh-llm'
import type { TokenUsage } from '@deepseek-ai/dsh-llm/types'
// 空类型导入：加载重试包对 SessionEventMap 的 `llm/retry-started` 增强（重试清空替换槽用）。
import type {} from '@deepseek-ai/dsh-llm-retry/types'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { TokenBuckets, TodayTokenUsage } from './wire.ts'
import { EMPTY_USAGE, dayKey } from './wire.ts'

/** 一次已计入的结算：`turn + step` 是替换槽的键，`day` 是它被计入的本地日期。 */
export interface Settlement {
  readonly turn: number
  readonly step: number
  readonly day: string
  readonly buckets: TokenBuckets
}

/** 一个会话的折叠状态（纯 JSON：会被投影缓存按版本存档）。 */
export interface FoldState {
  /** 继承前缀长度（`seq` 小于它的都是 fork 复制来的事件）。 */
  readonly inherited: number
  /** 最后一个有用量的日期及其四个桶；还没有用量时为 null。 */
  readonly current: TodayTokenUsage | null
  /** 最近一次结算，供同一 step 的重复结算做替换。 */
  readonly last: Settlement | null
}

/**
 * 初始状态：还没有任何结算，继承前缀从 `init` 的入参记下来。
 * @param inherited - `Session.inheritedEventCount`（普通会话为 0）。
 * @returns 空状态。
 */
export function initFold(inherited: number): FoldState {
  return { inherited: Number(inherited) || 0, current: null, last: null }
}

/** 从 stream 里取最后一个 usage 块（与上游 `lastAssistantStreamChunk(stream, 'usage')` 同义）。 */
function lastStreamUsage(stream: readonly AssistantStreamRecord[]): TokenUsage | undefined {
  for (let index = stream.length - 1; index >= 0; index -= 1) {
    const record = stream[index]
    if (record !== undefined && record.type === 'chunk' && record.chunk.type === 'usage') return record.chunk.usage
  }
  return undefined
}

/** 一条事件结算了多少 Token；不携带用量的结算返回 undefined。 */
function usageOf(event: SessionEvent): TokenUsage | undefined {
  if (event.type !== 'assistant/message' && event.type !== 'assistant/attempt') return undefined
  const reported = event.type === 'assistant/message' ? event.data.usage : undefined
  return reported ?? lastStreamUsage(event.data.stream)
}

/** 把一条 provider 用量摊成四个互不重叠的桶（与上游 `bucketsFrom` 同式）。 */
function bucketsOf(usage: TokenUsage): TokenBuckets {
  return {
    uncachedInputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens ?? 0,
    cacheWriteTokens: usage.cacheWriteTokens ?? 0,
  }
}

/** 两组桶是否完全相同。 */
function bucketsEqual(left: TokenBuckets, right: TokenBuckets): boolean {
  return left.uncachedInputTokens === right.uncachedInputTokens
    && left.outputTokens === right.outputTokens
    && left.cacheReadTokens === right.cacheReadTokens
    && left.cacheWriteTokens === right.cacheWriteTokens
}

/** 两组桶逐项相加。 */
function addBuckets(left: TokenBuckets, right: TokenBuckets): TokenBuckets {
  return {
    uncachedInputTokens: left.uncachedInputTokens + right.uncachedInputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    cacheReadTokens: left.cacheReadTokens + right.cacheReadTokens,
    cacheWriteTokens: left.cacheWriteTokens + right.cacheWriteTokens,
  }
}

/** 两组桶逐项相减，并夹到非负（对账差值不会把某个桶减成负数）。 */
function subtractBuckets(left: TokenBuckets, right: TokenBuckets): TokenBuckets {
  return {
    uncachedInputTokens: Math.max(0, left.uncachedInputTokens - right.uncachedInputTokens),
    outputTokens: Math.max(0, left.outputTokens - right.outputTokens),
    cacheReadTokens: Math.max(0, left.cacheReadTokens - right.cacheReadTokens),
    cacheWriteTokens: Math.max(0, left.cacheWriteTokens - right.cacheWriteTokens),
  }
}

/**
 * 折叠一条会话事件。
 *
 * 返回原状态引用表示这条事件不影响本投影（绝大多数事件如此），下游按引用判定没有变化。
 * @param state - 当前状态。
 * @param event - 已提交流转的新事件。
 * @returns 下一个状态，或原状态。
 */
export function applyFold(state: FoldState, event: SessionEvent): FoldState {
  if (event.seq < state.inherited) return state

  if (event.type === 'llm/retry-started') {
    const { turn, step } = event.data
    return state.last !== null && state.last.turn === turn && state.last.step === step
      ? { ...state, last: null }
      : state
  }

  const usage = usageOf(event)
  if (usage === undefined) return state
  if (event.type !== 'assistant/message' && event.type !== 'assistant/attempt') return state

  const { turn, step } = event.data
  const day = dayKey(event.time)
  const buckets = bucketsOf(usage)
  // 同一 turn + step 的重复结算：上一次的桶要被这一次替换掉。
  const previous = state.last !== null && state.last.turn === turn && state.last.step === step
    ? state.last
    : undefined

  if (state.current !== null && state.current.day === day) {
    if (previous !== undefined && previous.day === day && bucketsEqual(previous.buckets, buckets)) {
      // 完全相同的重复结算：状态不变。
      return state
    }
    const counted = previous !== undefined && previous.day === day ? previous.buckets : undefined
    const without = counted === undefined ? state.current : subtractBuckets(state.current, counted)
    const next: TodayTokenUsage = { day, ...addBuckets(without, buckets) }
    return { ...state, current: next, last: { turn, step, day, buckets } }
  }

  // 新的一天（或第一次结算）：从零开始记这一天。
  return { ...state, current: { day, ...buckets }, last: { turn, step, day, buckets } }
}

/**
 * 对外发布的 wire 值：当前日期的四个桶。
 *
 * 没有用量时返回模块级常量，投影登记表据此按 `Object.is` 抑制无变化的发布。
 * @param state - 当前状态。
 * @returns wire 值（状态里的同一个对象，引用稳定）。
 */
export function viewOf(state: FoldState): TodayTokenUsage {
  return state.current ?? EMPTY_USAGE
}
