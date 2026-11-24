/**
 * 本插件的线上词汇：会话投影键、按天分桶的 Token 桶与日期边界。
 *
 * 宿主半部用它注册投影（`todayTokenUsage`），浏览器半部从会话列表 / 会话投影里读同一个值。
 * 纯模块：只有类型与纯函数，不引入任何 DSH 运行时值，因此两侧都能直接加载（测试也可以）。
 *
 * 口径与输入框下方「用量」按钮（`@deepseek-ai/dsh-client-ui-chat` 的 `UsagePill`）一致：
 *
 *   - 四个桶互不重叠，`uncachedInputTokens` 不含缓存部分，推理 Token 已经算在 `outputTokens` 里；
 *   - 展示的「总用量」= 未缓存输入 + 缓存读取 + 缓存写入 + 输出（见 `billedInputTokens` 与
 *     `totalTokens`），与 `UsagePill` 的 `billedInputTokens(usage) + usage.outputTokens` 同式；
 *   - 缓存命中 = 缓存读取 / 三个输入侧桶之和，百分比规则也与上游 `formatCacheHitPercent` 相同。
 */

import type {} from '@deepseek-ai/dsh-session-projection/types'

/** 会话投影键：一个会话在「某一个本地日期」上的 Token 用量。 */
export const PROJECTION_KEY = 'todayTokenUsage'

/** 一个会话某一天用掉的四个 Token 桶（互不重叠）。 */
export interface TokenBuckets {
  /** 未命中缓存的输入 Token。 */
  readonly uncachedInputTokens: number
  /** 输出 Token（含推理 Token）。 */
  readonly outputTokens: number
  /** 命中缓存读取的输入 Token。 */
  readonly cacheReadTokens: number
  /** 写入缓存的输入 Token。 */
  readonly cacheWriteTokens: number
}

/**
 * `todayTokenUsage` 的 wire 值：该会话**最后一个有结算的本地日期**与那一天的四个桶。
 *
 * `day` 为空串表示这个会话还没有任何用量。客户端只累加 `day` 等于自己今天的会话，所以
 * 跨过零点的会话不会把昨天的读数算进今天，零点后也不会有一次结算就换一次日期之外的抖动。
 */
export interface TodayTokenUsage extends TokenBuckets {
  /** 宿主本地日期 `YYYY-MM-DD`；还没有用量时为空串。 */
  readonly day: string
}

/** 四个桶的零值（常量引用，供「还没有用量」的视图直接返回）。 */
export const ZERO_BUCKETS: TokenBuckets = Object.freeze({
  uncachedInputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
})

/**
 * 「还没有用量」的 wire 值：常量引用让投影登记表按 `Object.is` 判定视图没变、不重复发布。
 */
export const EMPTY_USAGE: TodayTokenUsage = Object.freeze({ day: '', ...ZERO_BUCKETS })

/** 输入侧三个桶之和（与上游 `billedInputTokens` 同式）；只需要这三个桶，调用方不必凑齐输出桶。 */
export function billedInputTokens(
  buckets: Pick<TokenBuckets, 'uncachedInputTokens' | 'cacheReadTokens' | 'cacheWriteTokens'>,
): number {
  return buckets.uncachedInputTokens + buckets.cacheReadTokens + buckets.cacheWriteTokens
}

/** 计入「总用量」的 Token 数：输入侧三个桶加输出（与上游用量按钮同式）。 */
export function totalTokens(buckets: TokenBuckets): number {
  return billedInputTokens(buckets) + buckets.outputTokens
}

/**
 * 某个时刻在本机时区里的日期键 `YYYY-MM-DD`。
 *
 * 日期边界跟宿主进程的本地时区走：浏览器与宿主在同一台机器时，两边算出的键相同。
 * @param time - 毫秒时间戳（会话事件的 `time`，或 `Date.now()`）。
 * @returns `YYYY-MM-DD`。
 */
export function dayKey(time: number): string {
  const date = new Date(time)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/**
 * 某个时刻所在本地日期的零点（毫秒时间戳）。
 * @param time - 毫秒时间戳。
 * @returns 当天 00:00:00.000 的时间戳。
 */
export function startOfDay(time: number): number {
  const date = new Date(time)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

/** 下一个本地零点之后的一刻（客户端用它安排跨零点的重渲染）。 */
export function nextMidnight(time: number): number {
  const next = new Date(startOfDay(time))
  next.setDate(next.getDate() + 1)
  return next.getTime()
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** 一个会话在最近一个有用量的本地日期上的 Token 用量；客户端按自己的今天过滤。 */
    todayTokenUsage: TodayTokenUsage
  }
}
