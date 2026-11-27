/**
 * DeepSeek 价目表与峰谷计价：把一条 journal 记录折成人民币费用。
 *
 * 价格来源：https://api-docs.deepseek.com/zh-cn/quick_start/pricing —— 2026-11-27 核对，
 * 单位「元 / 百万 token」：
 *
 * | 模型 | 输入·缓存命中 | 输入·缓存未命中 | 输出 |
 * |---|---|---|---|
 * | deepseek-flash（DeepSeek-V4.1-Flash-1017） | 0.02 / 0.04 | 1 / 2 | 4 / 8 |
 * | deepseek-v4-pro（DeepSeek-V4-Pro-0813） | 0.15 / 0.30 | 4.5 / 9 | 13.5 / 27 |
 *
 * 每格是「空闲 / 高峰」；空闲价一律是高峰价的一半。峰时 = **北京时间**（与宿主时区无关）
 * 周一至周五（不含中国法定节假日）09:00–12:00、14:00–18:00，其余时段（含周末、节假日全天）
 * 都是空闲时段；调休上班的周末仍按周末算空闲。
 *
 * 计价口径：
 *
 *   - 费用 = 各类 Token × 单价 ÷ 1e6，按请求逐笔累加（不四舍五入到分）；
 *   - 峰谷按 journal 记录的 `time`（请求**完成**时刻）判定，跨时段边界的请求整笔按完成时刻算；
 *   - 缓存写入按未命中输入价计——DeepSeek 不单独计这一桶（实际恒为 0），换别的提供方时这是
 *     保守的近似，不会漏计；
 *   - 价目表里没有的模型只计 Token、不计费用，由调用方累计「未计价请求数」并在面板上说明。
 *
 * 法定节假日表只收录政府已公布年份（当前 2026）；未收录的年份按周末规则判定，落在工作日的
 * 法定假日会被当成峰时（偏保守）。新年度的安排公布后在这里补一段区间即可。
 *
 * 纯模块：只有常量与纯函数，宿主半部与测试共用；不碰 I/O、不依赖宿主时区。
 */

/** 一次调用里可计价的四个 Token 桶（与 journal 的记录形状同构）。 */
export interface BillableUsage {
  /** 未命中缓存的输入 Token。 */
  readonly inputTokens: number
  /** 输出 Token（含推理 Token）。 */
  readonly outputTokens: number
  /** 命中缓存读取的输入 Token。 */
  readonly cacheReadTokens: number
  /** 写入缓存的输入 Token。 */
  readonly cacheWriteTokens: number
}

/** 一个模型的高峰价（元 / 百万 token）；空闲价由它折半得到。 */
export interface PeakRate {
  /** 输入·缓存命中。 */
  readonly cacheHit: number
  /** 输入·缓存未命中。 */
  readonly cacheMiss: number
  /** 输出。 */
  readonly output: number
}

/** 价目表里的一行。 */
export interface ModelPrice {
  /** 展示名（排障与文档用）。 */
  readonly name: string
  /** 高峰价。 */
  readonly peak: PeakRate
}

/** DeepSeek V4.1 Flash（官方模型名 `deepseek-flash`，版本 DeepSeek-V4.1-Flash-1017）。 */
const V41_FLASH: ModelPrice = {
  name: 'DeepSeek V4.1 Flash',
  peak: { cacheHit: 0.04, cacheMiss: 2, output: 8 },
}

/** DeepSeek V4 Pro（版本 DeepSeek-V4-Pro-0813）。 */
const V4_PRO: ModelPrice = {
  name: 'DeepSeek V4 Pro',
  peak: { cacheHit: 0.3, cacheMiss: 9, output: 27 },
}

/**
 * 模型 id → 价目表。同一模型的官方名、旧模型名、带厂商前缀的写法（`deepseek/deepseek-v4.1-flash`）
 * 都归到同一行；规范化只做「去空白 + 小写 + 取最后一个 `/` 之后」。
 */
const MODEL_PRICES: Readonly<Record<string, ModelPrice>> = {
  'deepseek-flash': V41_FLASH,
  'deepseek-v4-flash': V41_FLASH,
  'deepseek-v4.1-flash': V41_FLASH,
  'deepseek-v4-flash-1017': V41_FLASH,
  'deepseek-v4.1-flash-1017': V41_FLASH,
  'deepseek-v4-pro': V4_PRO,
  'deepseek-v4-pro-0813': V4_PRO,
}

/** 中国法定节假日（放假日）区间，闭区间；这些日期全天按空闲时段计价。 */
const HOLIDAY_RANGES: readonly (readonly [string, string])[] = [
  // 国务院办公厅关于 2026 年部分节假日安排的通知（国办发明电〔2025〕7 号）。
  ['2026-01-01', '2026-01-03'],
  ['2026-02-15', '2026-02-23'],
  ['2026-04-04', '2026-04-06'],
  ['2026-05-01', '2026-05-05'],
  ['2026-06-19', '2026-06-21'],
  ['2026-09-25', '2026-09-27'],
  ['2026-10-01', '2026-10-07'],
]

/** 一天的毫秒数（只用于展开闭区间日期表）。 */
const DAY_MS = 86_400_000

/**
 * 把日期区间展开成 `YYYY-MM-DD` 集合。
 * @param ranges - 闭区间日期表。
 * @returns 日期键集合。
 */
function expandRanges(ranges: readonly (readonly [string, string])[]): ReadonlySet<string> {
  const days = new Set<string>()
  for (const [from, to] of ranges) {
    const start = Date.parse(`${from}T00:00:00Z`)
    const end = Date.parse(`${to}T00:00:00Z`)
    for (let time = start; time <= end; time += DAY_MS) days.add(new Date(time).toISOString().slice(0, 10))
  }
  return days
}

/** 法定节假日集合（模块加载时展开一次）。 */
const HOLIDAY_DAYS: ReadonlySet<string> = expandRanges(HOLIDAY_RANGES)

/**
 * 北京时间（Asia/Shanghai）的解析器。
 *
 * 峰谷只看北京时间，与宿主进程的本地时区无关；`hourCycle: 'h23'` 保证零点读成 `00` 而不是 `24`。
 */
const BEIJING_CLOCK = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

/** 北京时间下的日期键、星期与钟点。 */
interface BeijingClock {
  /** `YYYY-MM-DD`。 */
  readonly day: string
  /** `Mon` / `Tue` / …（en-US 短星期）。 */
  readonly weekday: string
  /** 0–23。 */
  readonly hour: number
  /** 0–59。 */
  readonly minute: number
}

/**
 * 把毫秒时间戳读成北京时间的日期、星期与钟点。
 * @param time - 毫秒时间戳。
 * @returns 北京时间读数。
 */
function beijingClock(time: number): BeijingClock {
  const parts = BEIJING_CLOCK.formatToParts(new Date(time))
  /** 取一个 formatToParts 字段；缺失时给空串（随后由数值转换折成 0）。 */
  const pick = (type: Intl.DateTimeFormatPartTypes): string => parts.find(part => part.type === type)?.value ?? ''
  const year = pick('year')
  const month = pick('month')
  const day = pick('day')
  return {
    day: `${year}-${month}-${day}`,
    weekday: pick('weekday'),
    hour: Number(pick('hour')),
    minute: Number(pick('minute')),
  }
}

/**
 * 规范化模型 id：去首尾空白、转小写、取最后一个 `/` 之后。
 * @param model - provider 上报的模型名（可能是 `deepseek/deepseek-v4.1-flash` 这类带前缀写法）。
 * @returns 规范化后的 id。
 */
export function normalizeModelId(model: string): string {
  const lower = model.trim().toLowerCase()
  const slash = lower.lastIndexOf('/')
  return slash === -1 ? lower : lower.slice(slash + 1)
}

/**
 * 查一个模型的价目表行。
 * @param model - provider 上报的模型名。
 * @returns 价目表行，未知模型返回 undefined。
 */
export function resolveModelPrice(model: string): ModelPrice | undefined {
  return MODEL_PRICES[normalizeModelId(model)]
}

/**
 * 把高峰价折半成空闲价。
 * @param rate - 高峰价。
 * @returns 空闲价。
 */
function halfRate(rate: PeakRate): PeakRate {
  return { cacheHit: rate.cacheHit / 2, cacheMiss: rate.cacheMiss / 2, output: rate.output / 2 }
}

/**
 * 某个时刻是否落在高峰时段：北京时间周一至周五（不含法定节假日）09:00–12:00、14:00–18:00。
 *
 * 边界按左闭右开：12:00 与 18:00 整点起算空闲，09:00 与 14:00 整点起算高峰。
 * @param time - 毫秒时间戳（journal 记录的请求完成时刻）。
 * @returns 是否高峰。
 */
export function isPeakTime(time: number): boolean {
  const clock = beijingClock(time)
  if (clock.weekday === 'Sat' || clock.weekday === 'Sun') return false
  if (HOLIDAY_DAYS.has(clock.day)) return false
  const minutes = clock.hour * 60 + clock.minute
  return (minutes >= 9 * 60 && minutes < 12 * 60) || (minutes >= 14 * 60 && minutes < 18 * 60)
}

/** 一条记录的计价结果。 */
export interface PricedUsage {
  /** 合计费用（元）。 */
  readonly total: number
  /** 高峰时段部分的费用（元）。 */
  readonly peak: number
  /** 空闲时段部分的费用（元）。 */
  readonly offPeak: number
  /** 模型是否在价目表里；false 时上面三项都是 0，只计 Token。 */
  readonly priced: boolean
}

/**
 * 给一条记录计价：按完成时刻判定峰谷，套该模型的单价。
 * @param model - provider 上报的模型名。
 * @param time - 请求完成时刻（毫秒时间戳）。
 * @param usage - 四个 Token 桶。
 * @returns 费用（元）与峰谷拆分；模型不认识时 `priced: false`。
 */
export function priceUsage(model: string, time: number, usage: BillableUsage): PricedUsage {
  const price = resolveModelPrice(model)
  if (price === undefined) return { total: 0, peak: 0, offPeak: 0, priced: false }
  const peak = isPeakTime(time)
  const rate = peak ? price.peak : halfRate(price.peak)
  const total = (
    usage.inputTokens * rate.cacheMiss
    + usage.cacheReadTokens * rate.cacheHit
    + usage.cacheWriteTokens * rate.cacheMiss
    + usage.outputTokens * rate.output
  ) / 1_000_000
  return peak
    ? { total, peak: total, offPeak: 0, priced: true }
    : { total, peak: 0, offPeak: total, priced: true }
}
