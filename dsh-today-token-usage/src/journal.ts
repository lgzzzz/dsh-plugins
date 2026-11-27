/**
 * journal 的纯词汇：一天一行 JSON 的记录格式、文件名、解析、合计与按日折价。
 *
 * 记录只存元数据与用量（provider / model / 可选的推理强度、会话、用途、结束原因），
 * 不存 prompt、消息内容或凭据。一行一个请求，便于人工用 `jq` 查账：
 *
 * ```json
 * {"v":1,"time":1795…,"day":"2026-11-25","provider":"opencode-go","model":"deepseek-v4.1-flash",
 *  "purpose":"session-title","sessionId":"session-…","finish":"stop",
 *  "usage":{"inputTokens":1234,"outputTokens":456,"cacheReadTokens":7890,"cacheWriteTokens":0}}
 * ```
 *
 * 合计除了四个 Token 桶，还按模型与完成时刻把每条记录折成人民币费用（见 `./pricing.ts`），
 * 峰谷拆分与「未计价请求数」随合计一起走。
 *
 * 纯模块：不做 I/O，宿主半部的 store 与测试共用。
 */

import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import { priceUsage } from './pricing.ts'
import type { UsageTotals } from './wire.ts'
import { ZERO_COST } from './wire.ts'

/** 记录格式版本；字段语义变化时加一，旧版本行会被跳过。 */
export const RECORD_VERSION = 1

/** 日文件保留天数：今天 + 前 34 天，共 35 个日文件。
 *
 * 多留几天是为了月度汇总缺失 / 损坏时还能把整月重算出来：最长的一个月有 31 天，35 天足够覆盖。
 * 月度汇总（`months/YYYY-MM.json`）不随日文件清理。 */
export const RETENTION_DAYS = 35

/** 日文件名前缀。 */
export const JOURNAL_FILE_PREFIX = 'requests-'

/** 日文件名后缀。 */
export const JOURNAL_FILE_SUFFIX = '.jsonl'

/** journal 文件里记下的用量（provider 原始字段名，聚合时再映射成面板的四个桶）。 */
export interface JournalUsage {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens: number
  readonly cacheWriteTokens: number
  /** 推理 Token 已在 `outputTokens` 里；单独存取只为对账，不计入合计。 */
  readonly reasoningTokens?: number
  /** provider 自报的全量；与四桶口径可能不一致，只存档，不计入合计。 */
  readonly totalTokens?: number
}

/** 一次模型调用的记录。 */
export interface UsageRecord {
  readonly v: typeof RECORD_VERSION
  /** 请求**完成**时刻的毫秒时间戳。 */
  readonly time: number
  /** 宿主本地日期 `YYYY-MM-DD`，与所在文件名一致。 */
  readonly day: string
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string
  readonly sessionId?: string
  /** `GenerateOptions.purpose`；普通对话请求没有。 */
  readonly purpose?: string
  /** 结束原因 `stop` / `tool-calls` / `max-tokens` / `aborted` / `error`（缺省表示没收到 finish 块）。 */
  readonly finish?: string
  readonly usage: JournalUsage
}

/** 当天合计：四个桶 + 请求数 + 费用，外加日期键（journal 内部状态与路由响应共用）。 */
export interface TodayTotals extends UsageTotals {
  /** 宿主本地日期 `YYYY-MM-DD`。 */
  readonly day: string
}

/** 当天零值。 */
export function emptyTotals(day: string): TodayTotals {
  return {
    day,
    requests: 0,
    uncachedInputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    cost: ZERO_COST,
  }
}

/**
 * 某个日期的 journal 文件名。
 * @param day - `YYYY-MM-DD`。
 * @returns `requests-YYYY-MM-DD.jsonl`。
 */
export function journalFileName(day: string): string {
  return `${JOURNAL_FILE_PREFIX}${day}${JOURNAL_FILE_SUFFIX}`
}

/**
 * 从文件名反解日期；不认识的文件名返回 undefined（用于清理与加载）。
 * @param name - 目录里的文件名。
 * @returns `YYYY-MM-DD`，或 undefined。
 */
export function dayOfJournalFileName(name: string): string | undefined {
  if (!name.startsWith(JOURNAL_FILE_PREFIX) || !name.endsWith(JOURNAL_FILE_SUFFIX)) return undefined
  const day = name.slice(JOURNAL_FILE_PREFIX.length, name.length - JOURNAL_FILE_SUFFIX.length)
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : undefined
}

/**
 * 非负安全整数；非法值折成 0（provider 上报异常时不让面板出现 NaN/负数）。
 * @param value - provider 上报值。
 * @returns 非负整数。
 */
export function sanitizeCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0
  return Math.min(Math.floor(value), Number.MAX_SAFE_INTEGER)
}

/**
 * 把 provider 的 `TokenUsage` 规整成存档形状；没有用量时返回 undefined。
 * @param usage - 流里最后一个 usage 块。
 * @returns 规整后的用量。
 */
export function sanitizeUsage(usage: TokenUsage | undefined): JournalUsage | undefined {
  if (usage === undefined) return undefined
  const journal: JournalUsage = {
    inputTokens: sanitizeCount(usage.inputTokens),
    outputTokens: sanitizeCount(usage.outputTokens),
    cacheReadTokens: sanitizeCount(usage.cacheReadTokens),
    cacheWriteTokens: sanitizeCount(usage.cacheWriteTokens),
    ...usage.reasoningTokens === undefined ? {} : { reasoningTokens: sanitizeCount(usage.reasoningTokens) },
    ...usage.totalTokens === undefined ? {} : { totalTokens: sanitizeCount(usage.totalTokens) },
  }
  return journal
}

/**
 * 一行 journal 文本。
 * @param record - 记录。
 * @returns 不带换行的 JSON。
 */
export function encodeRecord(record: UsageRecord): string {
  return JSON.stringify(record)
}

/** 严格读取一个非负整数字段（解析落盘记录用；不合法就整行丢弃）。 */
function readCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

/** 读取可选的短字符串字段。 */
function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/**
 * 解析一行 journal；损坏、版本不符、日期与文件名不符都返回 undefined。
 * @param line - 文件里的一行（可带首尾空白）。
 * @param fileDay - 该文件对应的日期。
 * @returns 记录，或 undefined。
 */
export function parseRecordLine(line: string, fileDay: string): UsageRecord | undefined {
  const text = line.trim()
  if (text.length === 0) return undefined
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return undefined
  }
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  if (record.v !== RECORD_VERSION) return undefined
  if (record.day !== fileDay) return undefined
  if (typeof record.time !== 'number' || !Number.isFinite(record.time) || record.time < 0) return undefined
  if (typeof record.provider !== 'string' || record.provider.length === 0) return undefined
  if (typeof record.model !== 'string' || record.model.length === 0) return undefined
  if (typeof record.usage !== 'object' || record.usage === null) return undefined
  const usageRecord = record.usage as Record<string, unknown>
  const inputTokens = readCount(usageRecord.inputTokens)
  const outputTokens = readCount(usageRecord.outputTokens)
  const cacheReadTokens = readCount(usageRecord.cacheReadTokens)
  const cacheWriteTokens = readCount(usageRecord.cacheWriteTokens)
  if (inputTokens === undefined || outputTokens === undefined
    || cacheReadTokens === undefined || cacheWriteTokens === undefined) return undefined
  const reasoningTokens = usageRecord.reasoningTokens === undefined ? undefined : readCount(usageRecord.reasoningTokens)
  const totalTokens = usageRecord.totalTokens === undefined ? undefined : readCount(usageRecord.totalTokens)
  if (usageRecord.reasoningTokens !== undefined && reasoningTokens === undefined) return undefined
  if (usageRecord.totalTokens !== undefined && totalTokens === undefined) return undefined
  const reasoningEffort = readOptionalString(record.reasoningEffort)
  const sessionId = readOptionalString(record.sessionId)
  const purpose = readOptionalString(record.purpose)
  const finish = readOptionalString(record.finish)
  return {
    v: RECORD_VERSION,
    time: record.time,
    day: fileDay,
    provider: record.provider,
    model: record.model,
    ...reasoningEffort === undefined ? {} : { reasoningEffort },
    ...sessionId === undefined ? {} : { sessionId },
    ...purpose === undefined ? {} : { purpose },
    ...finish === undefined ? {} : { finish },
    usage: {
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      ...reasoningTokens === undefined ? {} : { reasoningTokens },
      ...totalTokens === undefined ? {} : { totalTokens },
    },
  }
}

/**
 * 把一条记录加进当天合计，返回新对象（不改入参）。
 *
 * 口径与面板一致：`inputTokens` 是未缓存输入，四桶相加即总用量；`reasoningTokens` 已经在
 * `outputTokens` 里，`totalTokens` 可能与四桶口径不一致，两者都不参与合计。费用按记录的
 * 模型与完成时刻逐条计算，峰谷分别累加；模型不在价目表里时只增加「未计价请求数」。
 * @param totals - 当前合计。
 * @param record - 新记录。
 * @returns 下一个合计。
 */
export function addRecord(totals: TodayTotals, record: UsageRecord): TodayTotals {
  const priced = priceUsage(record.model, record.time, record.usage)
  return {
    day: totals.day,
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
 * 一天的记录累加成合计。
 * @param day - 当天日期键。
 * @param records - 当天记录（顺序无关）。
 * @returns 合计。
 */
export function totalsFromRecords(day: string, records: Iterable<UsageRecord>): TodayTotals {
  let totals = emptyTotals(day)
  for (const record of records) totals = addRecord(totals, record)
  return totals
}

/** 一份 journal 文本折成的合计与坏行数。 */
export interface JournalTextTotals {
  /** 合法记录累加出的合计。 */
  readonly totals: TodayTotals
  /** 无法解析而被跳过的非空行数。 */
  readonly skipped: number
}

/**
 * 把一天的 journal 文本（一行一条记录）累加成合计。
 *
 * 与 `store.load()` 同一条解析路径：坏行、版本不符、日期与文件名不符的行都跳过并计数，
 * 不中断整天的合计。历史读取按日复用这个函数，面板与 journal 因此永远同一个口径。
 * @param day - 这份文件对应的日期键。
 * @param text - 文件全文。
 * @returns 合计与坏行数。
 */
export function totalsFromJournalText(day: string, text: string): JournalTextTotals {
  let totals = emptyTotals(day)
  let skipped = 0
  for (const line of text.split('\n')) {
    const record = parseRecordLine(line, day)
    if (record === undefined) {
      if (line.trim().length > 0) skipped += 1
      continue
    }
    totals = addRecord(totals, record)
  }
  return { totals, skipped }
}
