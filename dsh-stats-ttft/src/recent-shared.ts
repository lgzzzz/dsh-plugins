/**
 * 最近步次统计的共享纯词汇：宿主投影与浏览器折叠共用同一套类型、窗口大小和
 * TTFT/TPS 口径。这里不引入 zod、cordis 或任何宿主侧运行时依赖，客户端 bundle
 * 可以安全内联。
 *
 * 窗口口径是「最近结束的 7 个 step」：由 `step/end` 计数，进行中的步不计入；
 * 每步只累计有首 token / 有 usage 的样本。TTFT 是窗口内 `ttftMs / ttftSteps` 的
 * 样本平均，TPS 是窗口内解码 token 与解码时间的加权合并。
 *
 * @module dsh-stats-ttft/recent-shared
 */
import type { SessionProjectionSummaryExcluded } from '@deepseek-ai/dsh-session-projection/types'

/** 投影保留、客户端统计的最近 step 数。 */
export const RECENT_STEPS = 7

/** 一个 step 的 TTFT 与解码累计。 */
export interface RecentStepStats {
  /** 所属 turn 编号。 */
  turn: number
  /** 步编号。 */
  step: number
  /** 该步有首 token 时的首 token 延迟（毫秒）。 */
  ttftMs: number
  /** 记录到首 token 的样本数（0 或 1；TTFT 平均的分母）。 */
  ttftSteps: number
  /** 该步上报 outputTokens 时的解码时间（毫秒）。 */
  decodeMs: number
  /** 与 `decodeMs` 同一批步的 provider 输出 token。 */
  decodeTokens: number
}

/** 解码 token 与解码时间的累计：TPS 的唯一输入。 */
export interface DecodeTotals {
  decodeMs: number
  decodeTokens: number
}

/** 一个窗口内所有 step 的累计值。 */
export interface RecentStatsTotals extends DecodeTotals {
  ttftMs: number
  ttftSteps: number
}

/**
 * 把逐步记录求和。
 * @param steps - 逐步记录（顺序无关）。
 * @returns 四字段累计；空输入时全为 0。
 */
export function sumRecentSteps(steps: readonly RecentStepStats[]): RecentStatsTotals {
  const totals: RecentStatsTotals = { ttftMs: 0, ttftSteps: 0, decodeMs: 0, decodeTokens: 0 }
  for (const item of steps) {
    totals.ttftMs += item.ttftMs
    totals.ttftSteps += item.ttftSteps
    totals.decodeMs += item.decodeMs
    totals.decodeTokens += item.decodeTokens
  }
  return totals
}

/**
 * 窗口内的平均首 token 时长。
 * @param totals - 窗口累计。
 * @returns 平均毫秒数；没有 TTFT 样本或数值不合法时返回 null。
 */
export function averageTTFT(totals: RecentStatsTotals): number | null {
  if (!Number.isFinite(totals.ttftMs) || !Number.isFinite(totals.ttftSteps)) return null
  if (totals.ttftSteps <= 0) return null
  return Math.max(0, totals.ttftMs) / totals.ttftSteps
}

/**
 * 解码累计的输出速度。
 * @param totals - 任意带解码累计的窗口（最近 7 步或全会话）。
 * @returns token/秒；没有解码时间或数值不合法时返回 null。
 */
export function tokensPerSecond(totals: DecodeTotals): number | null {
  if (!Number.isFinite(totals.decodeMs) || !Number.isFinite(totals.decodeTokens)) return null
  if (totals.decodeMs <= 0) return null
  return Math.max(0, totals.decodeTokens) / (totals.decodeMs / 1_000)
}

/**
 * 与上游 `formatTokensPerSecond` 逐字一致的 TPS 文本：≥10 取整，否则保留 1 位小数。
 * @param tps - token/秒。
 * @returns 显示文本。
 */
export function formatTokensPerSecond(tps: number): string {
  const clamped = Number.isFinite(tps) ? Math.max(0, tps) : 0
  return clamped >= 10 ? String(Math.round(clamped)) : String(Math.round(clamped * 10) / 10)
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /**
     * 最近 {@link RECENT_STEPS} 个已结束 step 的 TTFT/解码累计；见
     * {@link RecentStepStats}。Session 摘要不携带它。
     */
    recentStepStats: SessionProjectionSummaryExcluded<RecentStepStats[]>
  }
}
