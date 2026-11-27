/**
 * 月度汇总的纯逻辑：当月累计的加法、「本月」视图的口径，以及跨重启对账用的汇总文件格式。
 *
 * 面板只显示「今天」与「本月」；过去的月份不读取、不展示，但会以一个月一个小文件的形式存下来
 * （`<journal 目录>/months/YYYY-MM.json`），将来需要时可以直接读。月文件的形状：
 *
 * ```json
 * {"v":1,"month":"2026-11",
 *  "totals":{"requests":1234,"uncachedInputTokens":1,"outputTokens":2,
 *            "cacheReadTokens":3,"cacheWriteTokens":4,
 *            "cost":{"total":0.12,"peak":0.08,"offPeak":0.04,"unpricedRequests":0}},
 *  "checkpointDay":"2026-11-27",
 *  "checkpoint":{"requests":100,"uncachedInputTokens":…,"cost":{…}}}
 * ```
 *
 * `totals` 是写入时刻整月的累计；`checkpointDay` / `checkpoint` 是同一时刻当天的读数。同一天重启
 * 时用它们做差：把「汇总里那一天的读数」换成 journal 当天文件里的完整读数，跨进程也一分不差
 * （journal 的追加是异步的，最后一次写入可能晚于汇总文件的最后一次写入）。checkpoint 更早则说明
 * 汇总与今天之间还隔着整天，差额法补不回来——调用方回退为扫本月日文件重建（见 `src/store.ts`）。
 *
 * 纯模块：不做 I/O，宿主半部的 store 与测试共用。
 */

import type { TodayTotals, UsageRecord } from './journal.ts'
import { priceUsage } from './pricing.ts'
import type { CostBreakdown } from './wire.ts'
import { ZERO_COST } from './wire.ts'

/** 一个月里可以累加的计数：四个桶 + 请求数 + 费用。 */
export interface BucketTotals {
  /** 回报了用量的模型调用次数。 */
  readonly requests: number
  /** 未命中缓存的输入 Token。 */
  readonly uncachedInputTokens: number
  /** 输出 Token（含推理 Token）。 */
  readonly outputTokens: number
  /** 命中缓存读取的输入 Token。 */
  readonly cacheReadTokens: number
  /** 写入缓存的输入 Token。 */
  readonly cacheWriteTokens: number
  /** 费用（元）与峰谷拆分。 */
  readonly cost: CostBreakdown
}

/** 一个月的累计。 */
export interface MonthTotals extends BucketTotals {
  /** `YYYY-MM`。 */
  readonly month: string
}

/** 月度汇总文件的版本号；格式变化时加一，旧版本按损坏处理（回退为从日文件重建）。 */
export const MONTH_SUMMARY_VERSION = 1

/** 月度汇总文件的内容。 */
export interface MonthSummary {
  /** 文件格式版本。 */
  readonly v: typeof MONTH_SUMMARY_VERSION
  /** `YYYY-MM`。 */
  readonly month: string
  /** 写入时刻整月累计。 */
  readonly totals: BucketTotals
  /** 写入时刻最后记录的日期；那一天的读数已经包含在 `totals` 里。 */
  readonly checkpointDay?: string
  /** 写入时刻那一天的读数（已包含在 `totals` 里，重启时用来做差）。 */
  readonly checkpoint?: BucketTotals
}

/**
 * 日期键的前 7 位就是月份键。
 * @param day - `YYYY-MM-DD`。
 * @returns `YYYY-MM`。
 */
export function monthKeyOf(day: string): string {
  return day.slice(0, 7)
}

/**
 * 一个月的零值。
 * @param month - `YYYY-MM`。
 * @returns 零累计。
 */
export function emptyMonth(month: string): MonthTotals {
  return {
    month,
    requests: 0,
    uncachedInputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    cost: ZERO_COST,
  }
}

/**
 * 把一天（或一个月）合计里可累加的部分取出来。
 * @param totals - 日合计或月合计。
 * @returns 四个桶 + 请求数 + 费用。
 */
export function bucketsOf(totals: BucketTotals): BucketTotals {
  return {
    requests: totals.requests,
    uncachedInputTokens: totals.uncachedInputTokens,
    outputTokens: totals.outputTokens,
    cacheReadTokens: totals.cacheReadTokens,
    cacheWriteTokens: totals.cacheWriteTokens,
    cost: totals.cost,
  }
}

/**
 * 两个费用拆分相加。
 * @param left - 一份费用。
 * @param right - 另一份费用。
 * @returns 相加后的费用。
 */
function addCost(left: CostBreakdown, right: CostBreakdown): CostBreakdown {
  return {
    total: left.total + right.total,
    peak: left.peak + right.peak,
    offPeak: left.offPeak + right.offPeak,
    unpricedRequests: left.unpricedRequests + right.unpricedRequests,
  }
}

/**
 * 两个费用拆分相减（每个分量不小于 0；对账用的差额不会为负，负数只可能来自损坏的文件）。
 * @param left - 被减数。
 * @param right - 减数。
 * @returns 相减后的费用。
 */
function subtractCost(left: CostBreakdown, right: CostBreakdown): CostBreakdown {
  return {
    total: Math.max(0, left.total - right.total),
    peak: Math.max(0, left.peak - right.peak),
    offPeak: Math.max(0, left.offPeak - right.offPeak),
    unpricedRequests: Math.max(0, left.unpricedRequests - right.unpricedRequests),
  }
}

/**
 * 把一个月的计数合成 `MonthTotals`。
 * @param month - `YYYY-MM`。
 * @param buckets - 可累加的计数。
 * @returns 月累计。
 */
export function monthTotalsOf(month: string, buckets: BucketTotals): MonthTotals {
  return {
    month,
    requests: buckets.requests,
    uncachedInputTokens: buckets.uncachedInputTokens,
    outputTokens: buckets.outputTokens,
    cacheReadTokens: buckets.cacheReadTokens,
    cacheWriteTokens: buckets.cacheWriteTokens,
    cost: buckets.cost,
  }
}

/**
 * 把一条记录加进当月的累计（与 `journal.addRecord` 同一套计价）。
 * @param totals - 当前月累计。
 * @param record - 新记录。
 * @returns 下一个累计。
 */
export function addRecordToMonth(totals: MonthTotals, record: UsageRecord): MonthTotals {
  const priced = priceUsage(record.model, record.time, record.usage)
  return {
    month: totals.month,
    requests: totals.requests + 1,
    uncachedInputTokens: totals.uncachedInputTokens + record.usage.inputTokens,
    outputTokens: totals.outputTokens + record.usage.outputTokens,
    cacheReadTokens: totals.cacheReadTokens + record.usage.cacheReadTokens,
    cacheWriteTokens: totals.cacheWriteTokens + record.usage.cacheWriteTokens,
    cost: {
      total: totals.cost.total + priced.total,
      peak: totals.cost.peak + priced.peak,
      offPeak: totals.cost.offPeak + priced.offPeak,
      unpricedRequests: totals.cost.unpricedRequests + (priced.priced ? 0 : 1),
    },
  }
}

/**
 * 月累计加上一份计数。
 * @param totals - 月累计。
 * @param delta - 要加的计数。
 * @returns 新的月累计。
 */
export function addBucketsToMonth(totals: MonthTotals, delta: BucketTotals): MonthTotals {
  return {
    month: totals.month,
    requests: totals.requests + delta.requests,
    uncachedInputTokens: totals.uncachedInputTokens + delta.uncachedInputTokens,
    outputTokens: totals.outputTokens + delta.outputTokens,
    cacheReadTokens: totals.cacheReadTokens + delta.cacheReadTokens,
    cacheWriteTokens: totals.cacheWriteTokens + delta.cacheWriteTokens,
    cost: addCost(totals.cost, delta.cost),
  }
}

/**
 * 月累计减去一份计数（每个分量截到 0）。
 * @param totals - 月累计。
 * @param delta - 要减的计数。
 * @returns 新的月累计。
 */
export function subtractBucketsFromMonth(totals: MonthTotals, delta: BucketTotals): MonthTotals {
  return {
    month: totals.month,
    requests: Math.max(0, totals.requests - delta.requests),
    uncachedInputTokens: Math.max(0, totals.uncachedInputTokens - delta.uncachedInputTokens),
    outputTokens: Math.max(0, totals.outputTokens - delta.outputTokens),
    cacheReadTokens: Math.max(0, totals.cacheReadTokens - delta.cacheReadTokens),
    cacheWriteTokens: Math.max(0, totals.cacheWriteTokens - delta.cacheWriteTokens),
    cost: subtractCost(totals.cost, delta.cost),
  }
}

/**
 * 用一份月累计与当天读数拼出月度汇总文件的内容。
 * @param totals - 月累计。
 * @param day - 当天日期键（checkpoint 日期）。
 * @param dayTotals - 当天合计。
 * @returns 可落盘的汇总。
 */
export function monthSummaryOf(totals: MonthTotals, day: string, dayTotals: TodayTotals): MonthSummary {
  return {
    v: MONTH_SUMMARY_VERSION,
    month: totals.month,
    totals: bucketsOf(totals),
    checkpointDay: day,
    checkpoint: bucketsOf(dayTotals),
  }
}

/**
 * 月度汇总的落盘文本。
 * @param summary - 汇总。
 * @returns 单行 JSON。
 */
export function encodeMonthSummary(summary: MonthSummary): string {
  return JSON.stringify(summary)
}

/** 非负安全整数。 */
function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

/** 非负有限数（费用）。 */
function isMoney(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

/**
 * 读一份计数对象；形状不对返回 undefined。
 * @param value - JSON 里的一段。
 * @returns 计数，或 undefined。
 */
function parseBuckets(value: unknown): BucketTotals | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  if (!isCount(record.requests)) return undefined
  if (!isCount(record.uncachedInputTokens) || !isCount(record.outputTokens)) return undefined
  if (!isCount(record.cacheReadTokens) || !isCount(record.cacheWriteTokens)) return undefined
  const cost = record.cost
  if (typeof cost !== 'object' || cost === null) return undefined
  const money = cost as Record<string, unknown>
  if (!isMoney(money.total) || !isMoney(money.peak) || !isMoney(money.offPeak)) return undefined
  if (!isCount(money.unpricedRequests)) return undefined
  return {
    requests: record.requests,
    uncachedInputTokens: record.uncachedInputTokens,
    outputTokens: record.outputTokens,
    cacheReadTokens: record.cacheReadTokens,
    cacheWriteTokens: record.cacheWriteTokens,
    cost: {
      total: money.total,
      peak: money.peak,
      offPeak: money.offPeak,
      unpricedRequests: money.unpricedRequests,
    },
  }
}

/**
 * 解析一份月度汇总；损坏、版本不符或月份格式不对都返回 undefined（调用方回退为扫日文件）。
 * @param text - 文件全文。
 * @returns 汇总，或 undefined。
 */
export function parseMonthSummary(text: string): MonthSummary | undefined {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return undefined
  }
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  if (record.v !== MONTH_SUMMARY_VERSION) return undefined
  if (typeof record.month !== 'string' || !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(record.month)) return undefined
  const totals = parseBuckets(record.totals)
  if (totals === undefined) return undefined
  if (record.checkpointDay !== undefined && (typeof record.checkpointDay !== 'string'
    || !/^\d{4}-\d{2}-\d{2}$/.test(record.checkpointDay))) return undefined
  const checkpoint = record.checkpoint === undefined ? undefined : parseBuckets(record.checkpoint)
  if (record.checkpoint !== undefined && checkpoint === undefined) return undefined
  return {
    v: MONTH_SUMMARY_VERSION,
    month: record.month,
    totals,
    ...record.checkpointDay === undefined ? {} : { checkpointDay: record.checkpointDay },
    ...checkpoint === undefined ? {} : { checkpoint },
  }
}

/**
 * 汇总里的 checkpoint：重启对账的前提。
 *
 * 只有「checkpoint 就是今天」时才拿它做差额；checkpoint 更早、缺失或落在别的月份都说明汇总与
 * 今天的日文件之间还隔着别的日子，差额法补不回来，调用方要回退为扫日文件重建。
 * @param summary - 落盘的月度汇总。
 * @returns checkpoint；不可用时 undefined。
 */
export interface MonthCheckpoint {
  /** checkpoint 是哪一天。 */
  readonly day: string
  /** 那天在汇总里的读数。 */
  readonly buckets: BucketTotals
}

/**
 * 读出汇总里可用的 checkpoint。
 * @param summary - 落盘的月度汇总。
 * @returns checkpoint；没有、或它落在别的月份时 undefined。
 */
export function checkpointOf(summary: MonthSummary): MonthCheckpoint | undefined {
  const { checkpointDay, checkpoint } = summary
  if (checkpointDay === undefined || checkpoint === undefined) return undefined
  if (monthKeyOf(checkpointDay) !== summary.month) return undefined
  return { day: checkpointDay, buckets: checkpoint }
}

/**
 * 同一天重启：把汇总里 checkpoint 那天的读数换成 journal 当天文件里的全量。
 *
 * journal 的追加是异步的，最后一次写入可能晚于汇总文件，所以汇总里今天的数可能偏小；换成文件
 * 里的全量既不重复也不漏计。调用方必须先确认 `checkpoint.day` 就是今天，并且今天的日文件
 * 确实读出来了——文件读不出来时拿 0 去替换会把今天抹掉。
 * @param summary - 落盘的月度汇总。
 * @param checkpoint - 该汇总的 checkpoint。
 * @param dayTotals - journal 今天文件里的全量。
 * @returns 对账后的当月累计。
 */
export function replaceCheckpointDay(
  summary: MonthSummary,
  checkpoint: MonthCheckpoint,
  dayTotals: TodayTotals,
): MonthTotals {
  const base = monthTotalsOf(summary.month, summary.totals)
  return addBucketsToMonth(subtractBucketsFromMonth(base, checkpoint.buckets), bucketsOf(dayTotals))
}
