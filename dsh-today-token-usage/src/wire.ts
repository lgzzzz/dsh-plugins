/**
 * 本插件的共享词汇：宿主统计路由、当天 Token 桶、日期边界与浏览器侧的响应守卫。
 *
 * 宿主半部把每一次模型调用的用量累加成 {@link TodayUsagePayload}，经同源 JSON 路由交给
 * 浏览器半部；浏览器半部只做加法与格式化。两侧共用这一个纯模块，口径因此只有一份：
 *
 *   - 四个桶互不重叠，`uncachedInputTokens` 不含缓存部分，推理 Token 已经算在 `outputTokens` 里；
 *   - 展示的「总用量」= 未缓存输入 + 缓存读取 + 缓存写入 + 输出（见 `billedInputTokens` 与
 *     `totalTokens`），与输入框下方「用量」按钮的 `UsagePill` 同式；
 *   - 缓存命中 = 缓存读取 / 三个输入侧桶之和，百分比规则也与上游 `formatCacheHitPercent` 相同。
 *
 * 纯模块：只有类型与纯函数，不引入任何运行时值，宿主与浏览器两侧都能直接加载（测试也可以）。
 */

/** 宿主统计路由的绝对路径：宿主注册它，浏览器请求它（同源）拿一次快照。 */
export const TODAY_USAGE_PATH = '/today-token-usage/today'

/** 宿主推送路由的绝对路径：SSE 长连接，宿主每次读数变化时推一帧。 */
export const TODAY_USAGE_STREAM_PATH = '/today-token-usage/stream'

/** 一个会话或一天用掉的四个 Token 桶（互不重叠）。 */
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
 * 宿主交给浏览器的当天全量读数：从本地零点起，DSH 发出的每一次模型调用加起来。
 *
 * `requests` 是当天**回报了用量**的模型调用次数——没有用量回报的请求（失败、取消且未回报）
 * 没有 Token 可记，不进 journal 也不计数。
 */
export interface TodayUsagePayload extends TokenBuckets {
  /** 宿主本地日期 `YYYY-MM-DD`。 */
  readonly day: string
  /** 当天回报了用量的模型调用次数。 */
  readonly requests: number
}

/** 四个桶的零值（常量引用，供「还没有用量」的视图直接返回）。 */
export const ZERO_BUCKETS: TokenBuckets = Object.freeze({
  uncachedInputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
})

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
 * 日期边界跟宿主进程的本地时区走：journal 文件按这个键分天，面板读数也只算宿主当天。
 * @param time - 毫秒时间戳（请求完成时刻，或 `Date.now()`）。
 * @returns `YYYY-MM-DD`。
 */
export function dayKey(time: number): string {
  const date = new Date(time)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/**
 * 某个时刻所在本地日期过后的零点（毫秒时间戳）。
 *
 * 宿主用它安排「跨零点补发一帧空读数」的定时器：面板只显示当天，零点后即使没有任何新请求，
 * 也该把昨天那一份读数从页面上撤走。
 * @param time - 毫秒时间戳。
 * @returns 下一个本地零点的毫秒时间戳。
 */
export function nextLocalMidnight(time: number): number {
  const date = new Date(time)
  date.setHours(24, 0, 0, 0)
  return date.getTime()
}

/**
 * 某个时刻往前/往后推若干天后的日期键（宿主本地时区，按日历日推进而非固定毫秒）。
 * @param time - 毫秒时间戳。
 * @param days - 偏移天数；负数表示往前。
 * @returns 偏移后那一天的 `YYYY-MM-DD`。
 */
export function shiftedDayKey(time: number, days: number): string {
  const date = new Date(time)
  date.setDate(date.getDate() + days)
  return dayKey(date.getTime())
}

/** 非负安全整数判定（浏览器守卫用，不引 zod）。 */
function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

/**
 * 校验并复制一份路由响应；形状不对时返回 undefined。
 *
 * 浏览器不做 schema 校验库的引入，只用这个手写守卫挡住 HTML fallback、错误响应与手工篡改，
 * 避免把 `NaN` 渲染进面板。
 * @param value - `response.json()` 的结果。
 * @returns 合法的当天读数，或 undefined。
 */
export function parseTodayUsagePayload(value: unknown): TodayUsagePayload | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  if (typeof record.day !== 'string' || record.day.length > 10) return undefined
  if (!isNonNegativeInteger(record.requests)) return undefined
  if (!isNonNegativeInteger(record.uncachedInputTokens)) return undefined
  if (!isNonNegativeInteger(record.outputTokens)) return undefined
  if (!isNonNegativeInteger(record.cacheReadTokens)) return undefined
  if (!isNonNegativeInteger(record.cacheWriteTokens)) return undefined
  return {
    day: record.day,
    requests: record.requests,
    uncachedInputTokens: record.uncachedInputTokens,
    outputTokens: record.outputTokens,
    cacheReadTokens: record.cacheReadTokens,
    cacheWriteTokens: record.cacheWriteTokens,
  }
}
