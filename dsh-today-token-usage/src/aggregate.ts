/**
 * 浏览器半部的纯计算：把各会话今天的 Token 桶相加，并按「用量」按钮同一套规则格式化。
 *
 * 口径一致性是这一栏的重点，因此格式化不重写，而是逐条照抄上游
 * `@deepseek-ai/dsh-client-ui-chat` 的 `src/client/chat/token-format.ts`：
 *
 *   - `formatCompactTokens`：`517 / 12.2K / 517K / 1.2M`，三位数以上取整、其余保留一位小数，
 *     单位键走 common 字典的 `number.thousand` / `number.million`；
 *   - `formatCacheHitPercent`：整数百分比，且**部分命中永远不会被四舍五入成 100%**（用多少位
 *     小数区分到 100 以下为止），这个二分与阈值算法原样搬自上游，避免两条读数各说各话。
 *
 * 与上游的差别只在数据面：上游读的是单个会话的 `tokenUsage`（整段日志的累计），这里读各会话
 * `todayTokenUsage`（只算自己、只算今天）并把它们加起来。
 *
 * 纯模块：只依赖 `./wire.ts` 的类型与纯函数，可直接测试。
 */

import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS } from './locales.ts'
import type { TodayTokenUsage } from './wire.ts'
import { PROJECTION_KEY, billedInputTokens } from './wire.ts'

/** 一整天、全部会话加起来的用量（四个数足够推出「总用量」与缓存命中）。 */
export interface TodayTotals {
  /** 未缓存输入。 */
  readonly uncachedInput: number
  /** 缓存读取。 */
  readonly cacheRead: number
  /** 缓存写入。 */
  readonly cacheWrite: number
  /** 输出（含推理）。 */
  readonly output: number
  /** 输入侧三个桶之和（缓存命中的分母）。 */
  readonly prompt: number
  /** 计入总用量的 Token 数：`prompt + output`，与「用量」按钮同式。 */
  readonly total: number
}

/**
 * 会话列表里能读到的投影值：已连接会话的完整投影，或列表行带的摘要投影。
 * @param state - 会话列表快照。
 * @returns 全部已知的「某会话某天用量」值（不保证唯一，按 id 去重）。
 */
function valuesOf(state: Pick<SessionListState, 'byId' | 'projectionsBySession'>): Map<string, TodayTokenUsage> {
  const values = new Map<string, TodayTokenUsage>()
  // 已连接会话的投影（控制基线 / 跟随流）比列表行更新，先放它们。
  for (const [id, projection] of Object.entries(state.projectionsBySession)) {
    const value = projection.values[PROJECTION_KEY]
    if (value !== undefined) values.set(id, value)
  }
  // 列表行：冷会话只有这一处来源；同时存在的会话以已连接的那份为准，不覆盖。
  for (const [id, summary] of Object.entries(state.byId)) {
    if (values.has(id)) continue
    const value = summary.projectionValues?.[PROJECTION_KEY]
    if (value !== undefined) values.set(id, value)
  }
  return values
}

/**
 * 汇总今天（`today` 是本机日期键）全部会话的用量。
 *
 * 一个会话的 `day` 不是今天就不计：它的桶属于更早的某一天，零点之后没有新结算就不该进今天。
 * @param state - 会话列表快照。
 * @param today - 本机今天 `YYYY-MM-DD`。
 * @returns 汇总值；今天没有任何用量（或会话列表还没到）时为 undefined。
 */
export function aggregateToday(
  state: Pick<SessionListState, 'byId' | 'projectionsBySession'>,
  today: string,
): TodayTotals | undefined {
  let uncachedInput = 0
  let cacheRead = 0
  let cacheWrite = 0
  let output = 0
  for (const value of valuesOf(state).values()) {
    if (value.day !== today) continue
    uncachedInput += value.uncachedInputTokens
    cacheRead += value.cacheReadTokens
    cacheWrite += value.cacheWriteTokens
    output += value.outputTokens
  }
  const prompt = billedInputTokens({ uncachedInputTokens: uncachedInput, cacheReadTokens: cacheRead, cacheWriteTokens: cacheWrite })
  const total = prompt + output
  if (total === 0) return undefined
  return { uncachedInput, cacheRead, cacheWrite, output, prompt, total }
}

/**
 * 紧凑 Token 读数：`517 / 12.2K / 517K / 1.2M`（与上游 `formatTokens` 逐行同式）。
 * @param value - 非负 Token 数。
 * @param t - 本插件的翻译函数（单位键落到 common 字典）。
 * @returns 本地化的紧凑读数（不含 `tok` 后缀）。
 */
export function formatCompactTokens(value: number, t: TranslateNS<typeof NS>): string {
  const scaled = (candidate: number): string =>
    candidate >= 100 ? String(Math.round(candidate)) : String(Math.round(candidate * 10) / 10)
  if (value < 1_000) return String(value)
  if (value < 1_000_000) return t('number.thousand', { value: scaled(value / 1_000) })
  return t('number.million', { value: scaled(value / 1_000_000) })
}

/** 把 0–100 的百分比单位（十进制为 0–1000）渲染成文案。 */
function displayPercentUnits(units: number, decimalPlaces: 0 | 1): string {
  if (decimalPlaces === 0) return String(units)
  const whole = Math.floor(units / 10)
  const tenths = units % 10
  return tenths === 0 ? String(whole) : `${whole}.${tenths}`
}

/** 缓存读取比例落到百分比单位；正数的一半按向上取整（与上游同一个二分）。 */
function roundedPercentUnits(cacheReadTokens: number, denominator: number, decimalPlaces: 0 | 1): number {
  const unitsPerPercent = decimalPlaces === 0 ? 1 : 10
  const scale = unitsPerPercent * 100
  const doubledScale = scale * 2
  const denominatorQuotient = Math.floor(denominator / doubledScale)
  const denominatorRemainder = denominator % doubledScale
  let lower = 0
  let upper = scale
  while (lower < upper) {
    const candidate = Math.floor((lower + upper + 1) / 2)
    const factor = candidate * 2 - 1
    const threshold = factor * denominatorQuotient
      + Math.ceil(factor * denominatorRemainder / doubledScale)
    if (cacheReadTokens >= threshold) lower = candidate
    else upper = candidate - 1
  }
  return lower
}

/**
 * 缓存命中百分比文本：部分命中不会被舍入成 100%（与上游 `formatCacheHitPercent` 同式）。
 * @param cacheReadTokens - 命中缓存读取的输入 Token。
 * @param promptTokens - 输入侧全部 Token（三个输入桶之和）。
 * @param decimalPlaces - 一般比例的小数位；部分命中会自动用更多位保证诚实。
 * @returns 百分比文本，没有输入时为 null。
 */
export function formatCacheHitPercent(
  cacheReadTokens: number,
  promptTokens: number,
  decimalPlaces: 0 | 1 = 0,
): string | null {
  if (promptTokens === 0) return null
  const missedInputTokens = promptTokens - cacheReadTokens
  if (missedInputTokens <= 0) return '100'

  const roundedUnits = roundedPercentUnits(cacheReadTokens, promptTokens, decimalPlaces)
  const fullHitUnits = decimalPlaces === 0 ? 100 : 1_000
  if (roundedUnits < fullHitUnits) return displayPercentUnits(roundedUnits, decimalPlaces)

  let distinguishingPlaces = 1
  let scaledDoubleGap = missedInputTokens * 200
  const denominatorTens = Math.floor(promptTokens / 10)
  while (scaledDoubleGap <= denominatorTens) {
    scaledDoubleGap *= 10
    distinguishingPlaces += 1
  }
  const denominatorOnes = promptTokens % 10
  let roundedLoss = 5
  for (let loss = 1; loss < 5; loss += 1) {
    const factor = loss * 2 + 1
    const threshold = factor * denominatorTens + Math.floor(factor * denominatorOnes / 10)
    if (scaledDoubleGap <= threshold) {
      roundedLoss = loss
      break
    }
  }
  return `99.${'9'.repeat(distinguishingPlaces - 1)}${10 - roundedLoss}`
}
