/**
 * 浏览器半部的纯计算：把宿主给的当天 / 当月读数摊成面板口径，并按「用量」按钮同一套规则格式化。
 *
 * 口径一致性是这一栏的重点，因此格式化不重写，而是逐条照抄上游
 * `@deepseek-ai/dsh-client-ui-chat` 的 `src/client/chat/token-format.ts`：
 *
 *   - `formatCompactTokens`：`517 / 12.2K / 517K / 1.2M`，三位数以上取整、其余保留一位小数，
 *     单位键走 common 字典的 `number.thousand` / `number.million`；
 *   - `formatCacheHitPercent`：整数百分比，且**部分命中永远不会被四舍五入成 100%**（用多少位
 *     小数区分到 100 以下为止），这个二分与阈值算法原样搬自上游，避免两条读数各说各话。
 *
 * 当天与当月只差数据来源：{@link totalsOf} 读 `TodayUsagePayload`，{@link monthTotalsOf} 读同一
 * 载荷里的 `month`，两者折成同一个 {@link TodayTotals} 形状，因此面板只用一套行渲染。
 * 费用只做展示格式化（`formatCny`）：金额由宿主逐笔算好，浏览器不重算单价，避免两处价格表。
 *
 * 与上游的差别只在数据面：上游读单个会话的 `tokenUsage`（整段日志的累计），这里读宿主当天
 * 全部模型调用的合计——包括标题生成、压缩摘要等没有会话结算的调用。
 *
 * 纯模块：只依赖 `./wire.ts` 的类型与纯函数，可直接测试。
 */

import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS } from './locales.ts'
import type { CostBreakdown, MonthUsage, TodayUsagePayload } from './wire.ts'
import { billedInputTokens } from './wire.ts'

/** 一天（或一个月）全部模型调用加起来的用量（四个数足够推出「总用量」与缓存命中）。 */
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
  /** 回报了用量的模型调用次数。 */
  readonly requests: number
  /** 费用（元）与峰谷拆分。 */
  readonly cost: CostBreakdown
}

/**
 * 把一份读数折成面板口径。
 * @param totals - 当天或当月读数。
 * @returns 面板合计；总用量为 0 时返回 undefined（面板整节隐藏）。
 */
function panelTotalsOf(totals: MonthUsage | TodayUsagePayload): TodayTotals | undefined {
  const prompt = billedInputTokens(totals)
  const total = prompt + totals.outputTokens
  if (total === 0) return undefined
  return {
    uncachedInput: totals.uncachedInputTokens,
    cacheRead: totals.cacheReadTokens,
    cacheWrite: totals.cacheWriteTokens,
    output: totals.outputTokens,
    prompt,
    total,
    requests: totals.requests,
    cost: totals.cost,
  }
}

/**
 * 把宿主读数换成「今日」视图的合计。
 *
 * 总用量为 0（当天还没有任何用量回报）时返回 undefined：面板整节隐藏，与其它分区一致。
 * @param payload - 宿主路由的当天读数。
 * @returns 面板合计，或 undefined。
 */
export function totalsOf(payload: TodayUsagePayload): TodayTotals | undefined {
  return panelTotalsOf(payload)
}

/**
 * 把载荷里的当月累计换成「本月」视图的合计。
 * @param month - 当月读数。
 * @returns 面板合计，或 undefined（本月还没有用量）。
 */
export function monthTotalsOf(month: MonthUsage): TodayTotals | undefined {
  return panelTotalsOf(month)
}

/** 千位分隔（`1234567.5` → `1,234,567.5`）。 */
function groupDigits(text: string): string {
  const [whole, fraction] = text.split('.')
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return fraction === undefined ? grouped : `${grouped}.${fraction}`
}

/**
 * 人民币金额：`¥0.00 / ¥0.0034 / ¥1,234.56`。
 *
 * 小数位随量级调整，小钱不显示成 `¥0.00`：≥ 0.01 元两位、≥ 0.0001 元四位、更小六位。
 * 零与非法值统一 `¥0.00`（面板不出现 `NaN` / `¥-0.00`）。
 * @param value - 金额（元）。
 * @returns 带 `¥` 的文本。
 */
export function formatCny(value: number): string {
  const amount = Number.isFinite(value) && value > 0 ? value : 0
  const decimals = amount === 0 ? 2 : amount < 0.0001 ? 6 : amount < 0.01 ? 4 : 2
  return `¥${groupDigits(amount.toFixed(decimals))}`
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
