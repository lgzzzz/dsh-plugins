/**
 * Number and time formatting shared by the dashboard.
 *
 * Every formatter is total: a missing or non-finite value renders as an em
 * dash instead of leaking `undefined` or `NaN` into the markup.
 *
 * @module dsh-request-stats/client/format
 */

/** Locale-independent integer grouping for counts. */
export const intl = new Intl.NumberFormat()

/** Millisecond value as a short human duration. */
export function formatMs(value?: number): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
  if (value >= 1000) return `${(value / 1000).toFixed(2)} s`
  return `${Math.round(value)} ms`
}

/** Tokens-per-second value. */
export function formatRate(value?: number): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
  return `${value.toFixed(1)} tok/s`
}

/** Token count, compact above one thousand without a 1000.0k artefact. */
export function formatTokens(value?: number): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
  if (value >= 999_500) return `${(value / 1_000_000).toFixed(2)}M`
  if (value >= 9_950) return `${(value / 1000).toFixed(1)}k`
  return intl.format(value)
}

/** Clock time of one record. */
export function formatClock(at?: number): string {
  if (typeof at !== 'number') return '—'
  return new Date(at).toLocaleTimeString(undefined, { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

/** Date and clock: the recent table can span up to 30 retained days. */
export function formatStamp(at?: number): string {
  if (typeof at !== 'number') return '—'
  const date = new Date(at)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${month}-${day} ${formatClock(at)}`
}

/**
 * Compact clock label for one tick of a chart time axis.
 *
 * Precision follows the distance between ticks, not the total span, so a
 * three-day chart labelled every eighteen hours keeps its dates.
 * @param at - instant to label, in epoch milliseconds.
 * @param span - plotted time span, in milliseconds.
 * @returns A label narrow enough to sit under the axis.
 */
export function formatAxisTime(at: number, span: number): string {
  if (!Number.isFinite(at)) return '—'
  const date = new Date(at)
  const pad = (value: number): string => String(value).padStart(2, '0')
  const month = pad(date.getMonth() + 1)
  const day = pad(date.getDate())
  const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}`
  const interval = Math.max(1, (Number.isFinite(span) ? span : 0) / 4)
  if (interval >= 24 * 60 * 60 * 1000) return `${month}-${day}`
  if (interval >= 60 * 60 * 1000) return span >= 24 * 60 * 60 * 1000 ? `${month}-${day} ${clock}` : clock
  if (interval >= 60 * 1000) return clock
  return `${clock}:${pad(date.getSeconds())}`
}

/** Percent value from a 0..1 ratio; a tiny non-zero share stays visible. */
export function formatShare(value?: number): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
  if (value > 0 && value < 0.005) return '<1%'
  return `${Math.round(value * 100)}%`
}

/** Percent value from a 0..1 success rate. */
export function formatPercent(value?: number): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
  return `${(value * 100).toFixed(1)}%`
}
