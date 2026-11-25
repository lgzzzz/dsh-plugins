/**
 * 浏览器半部的纯格式化：把上游的状态码、原因码与读数摊成面板文案。
 *
 * 几条刻意规则：
 *
 *   - 只翻译已知词汇。状态 `operational / degraded / unknown` 与原因
 *     `availability / errors / latency / monitoring / upstream` 走字典；上游以后新增的码原样显示，
 *     不硬塞一个近似的中文词；
 *   - 原因的 `none` 与空串不显示：状态本身已经说明问题，不再补一句「无原因」；
 *   - 首 Token 用秒（毫秒 ÷ 1000；100 秒以内保留一位小数，更长的取整），吞吐用整数 tok/s。
 *
 * 纯模块：不依赖 React，可直接测试。
 */

import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS, OpencodeStatusKey } from './locales.ts'

/** 本插件的翻译函数（键落到 {@link NS} 命名空间）。 */
export type StatusTranslate = TranslateNS<typeof NS>

/** 已知状态码 → 字典键；未知码不在此表，原样输出。 */
const STATUS_KEYS: Readonly<Record<string, OpencodeStatusKey>> = {
  operational: 'status.operational',
  degraded: 'status.degraded',
  unknown: 'status.unknown',
}

/** 已知原因码 → 字典键；`none` 不在表里（它表示「没有原因」）。 */
const REASON_KEYS: Readonly<Record<string, OpencodeStatusKey>> = {
  availability: 'reason.availability',
  errors: 'reason.errors',
  latency: 'reason.latency',
  monitoring: 'reason.monitoring',
  upstream: 'reason.upstream',
}

/**
 * 状态码的显示文案。
 * @param status - 上游状态码。
 * @param t - 本插件翻译函数。
 * @returns 已知码的译文，未知码原样返回。
 */
export function statusText(status: string, t: StatusTranslate): string {
  const key = STATUS_KEYS[status]
  return key === undefined ? status : t(key)
}

/**
 * 原因码的显示文案。
 * @param reason - 上游原因码。
 * @param t - 本插件翻译函数。
 * @returns 译文；`none` 或空串返回 null（调用方据此省掉这一段），未知码原样返回。
 */
export function reasonText(reason: string, t: StatusTranslate): string | null {
  if (reason === '' || reason === 'none') return null
  const key = REASON_KEYS[reason]
  return key === undefined ? reason : t(key)
}

/**
 * 「状态 · 原因」的一行值；没有原因时只有状态。
 * @param status - 上游状态码。
 * @param reason - 上游原因码。
 * @param t - 本插件翻译函数。
 * @returns 例如 `降级 · 延迟`。
 */
export function statusValue(status: string, reason: string, t: StatusTranslate): string {
  const statusLabel = statusText(status, t)
  const reasonLabel = reasonText(reason, t)
  return reasonLabel === null ? statusLabel : `${statusLabel} · ${reasonLabel}`
}

/**
 * 毫秒读数 → 秒（100 秒以内保留一位小数，更长取整）。
 * @param ms - 毫秒数（正数）。
 * @returns 数值字符串，例如 `9.1` / `15.8` / `120`。
 */
export function formatSeconds(ms: number): string {
  const seconds = ms / 1_000
  return seconds >= 100 ? String(Math.round(seconds)) : String(Math.round(seconds * 10) / 10)
}

/**
 * 吞吐读数 → 整数。
 * @param tps - 每秒 Token 数（正数）。
 * @returns 例如 `148`。
 */
export function formatTps(tps: number): string {
  return String(Math.round(tps))
}
