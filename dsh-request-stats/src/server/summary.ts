/**
 * Aggregation for `dsh-request-stats`.
 *
 * Pure functions over the retained records: the panel asks the Host for one
 * summary per poll instead of folding history in the browser. Every derived
 * average is omitted when no sample qualifies, so the UI can distinguish "no
 * data yet" from a real zero.
 *
 * @module dsh-request-stats/server/summary
 */

import type {
  ConnectionKind,
  Distribution,
  LiveCall,
  ModelRow,
  RequestRecord,
  SeriesPoint,
  ServerRow,
  Summary,
  WindowKey,
} from '../shared/types.ts'

/** Selectable history windows; the panel only offers these. */
export const WINDOWS: Readonly<Record<WindowKey, number | undefined>> = Object.freeze({
  all: undefined,
  '1h': 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
})

/** Default window when a request names none. */
export const DEFAULT_WINDOW: WindowKey = 'all'

/** How many records feed the sparkline. */
const SERIES_LIMIT = 120

/** How many records the recent table receives. */
const RECENT_LIMIT = 80

/** One decimal place. */
const round = (value: number): number => Math.round(value * 10) / 10

/** Sum of a numeric list. */
const sum = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0)

/** Human mean, or undefined without samples. */
function average(values: readonly number[]): number | undefined {
  return values.length === 0 ? undefined : round(sum(values) / values.length)
}

/** Nearest-rank percentile, or undefined without samples. */
function percentile(values: readonly number[], ratio: number): number | undefined {
  if (values.length === 0) return undefined
  const sorted = [...values].sort((left, right) => left - right)
  const rank = Math.max(1, Math.ceil(ratio * sorted.length))
  return sorted[Math.min(sorted.length - 1, rank - 1)]
}

/** Run-length of one numeric field over qualifying records. */
function distribution(records: readonly RequestRecord[], field: 'ttftMs' | 'tps'): Distribution {
  const values = records
    .map(record => record[field])
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  return {
    count: values.length,
    avg: average(values),
    p50: percentile(values, 0.5),
    p90: percentile(values, 0.9),
    min: values.length === 0 ? undefined : Math.min(...values),
    max: values.length === 0 ? undefined : Math.max(...values),
  }
}

/** Identity of the server that answered one request. */
export interface ServerIdentity {
  /** Stable grouping key. */
  key: string
  /** Display label. */
  label: string
  /** Directly observed peer address, when there is one. */
  ip?: string
  /** Cloudflare edge code, when the response carried one. */
  colo?: string
  /** Transport path of the record that produced this identity. */
  connection: ConnectionKind
}

/**
 * Identity of the server that answered one request.
 *
 * A directly observed peer address wins; behind a proxy the only transport fact
 * is Cloudflare's edge code from `cf-ray`, so that becomes the identity instead
 * of inventing an address the Host never saw.
 * @param record - one retained record.
 * @returns A stable key, its display label, and the raw identity fields.
 */
export function serverIdentity(
  record: Pick<RequestRecord, 'ip' | 'colo' | 'connection'>,
): ServerIdentity {
  if (typeof record.ip === 'string' && record.ip.length > 0) {
    return { key: `ip:${record.ip}`, label: record.ip, ip: record.ip, colo: record.colo, connection: record.connection }
  }
  if (typeof record.colo === 'string' && record.colo.length > 0) {
    return { key: `edge:${record.colo}`, label: record.colo, ip: undefined, colo: record.colo, connection: record.connection }
  }
  return { key: 'unknown', label: 'unknown', ip: undefined, colo: undefined, connection: record.connection }
}

/** Bucket records by one identity descriptor, keeping first-seen insertion order. */
function groupBy<Descriptor extends { key: string }>(
  records: readonly RequestRecord[],
  identity: (record: RequestRecord) => Descriptor,
): Map<string, Descriptor & { records: RequestRecord[] }> {
  const groups = new Map<string, Descriptor & { records: RequestRecord[] }>()
  for (const record of records) {
    const descriptor = identity(record)
    let group = groups.get(descriptor.key)
    if (group === undefined) {
      group = { ...descriptor, records: [] }
      groups.set(descriptor.key, group)
    }
    group.records.push(record)
  }
  return groups
}

function serverRows(records: readonly RequestRecord[], total: number): ServerRow[] {
  const rows: ServerRow[] = []
  for (const group of groupBy(records, serverIdentity).values()) {
    const ttft = distribution(group.records, 'ttftMs')
    const tps = distribution(group.records, 'tps')
    const outputTokens = sum(group.records.map(record => record.outputTokens ?? 0))
    rows.push({
      key: group.key,
      label: group.label,
      ip: group.ip,
      colo: group.colo,
      connection: group.connection,
      requests: group.records.length,
      share: total === 0 ? 0 : Math.round((group.records.length / total) * 1000) / 1000,
      errors: group.records.filter(record => record.status === 'error').length,
      aborted: group.records.filter(record => record.status === 'aborted').length,
      ttftAvg: ttft.avg,
      ttftP50: ttft.p50,
      tpsAvg: tps.avg,
      tpsP50: tps.p50,
      outputTokens,
      lastAt: group.records.reduce((latest, record) => Math.max(latest, record.at), 0),
      models: [...new Set(group.records.map(record => record.model).filter((model): model is string => typeof model === 'string'))],
    })
  }
  return rows.sort((left, right) => right.requests - left.requests || right.lastAt - left.lastAt)
}

function modelRows(records: readonly RequestRecord[]): ModelRow[] {
  const rows: ModelRow[] = []
  for (const group of groupBy(records, record => ({
    key: `${record.provider ?? ''}/${record.model ?? ''}`,
    label: record.model ?? 'unknown',
    provider: record.provider,
  })).values()) {
    const ttft = distribution(group.records, 'ttftMs')
    const tps = distribution(group.records, 'tps')
    rows.push({
      key: group.key,
      model: group.label,
      provider: group.provider,
      requests: group.records.length,
      errors: group.records.filter(record => record.status === 'error').length,
      ttftAvg: ttft.avg,
      tpsAvg: tps.avg,
      outputTokens: sum(group.records.map(record => record.outputTokens ?? 0)),
      lastAt: group.records.reduce((latest, record) => Math.max(latest, record.at), 0),
    })
  }
  return rows.sort((left, right) => right.requests - left.requests)
}

/** Options for {@link buildSummary}. */
export interface BuildSummaryOptions {
  /** Clock used for the window cutoff and `generatedAt`. */
  now?: number
  /** Requested window; unknown values fall back to `all`. */
  window?: string
  /** Model calls currently streaming. */
  inFlight?: readonly LiveCall[]
  /** Watched provider routes, echoed back to the panel. */
  providers?: readonly string[]
  /** Watched endpoint hosts, echoed back to the panel. */
  hosts?: readonly string[]
  /** Include auxiliary calls (title generation, compaction, …) in the view. */
  includeAuxiliary?: boolean
}

/**
 * Build the panel's one-shot view of the ledger.
 * @param records - retained records, oldest first.
 * @param options - window, live calls, and the watched routes.
 * @returns A JSON-safe summary.
 */
export function buildSummary(records: readonly RequestRecord[], {
  now = Date.now(),
  window: requestedWindow = DEFAULT_WINDOW,
  inFlight = [],
  providers = [],
  hosts = [],
  includeAuxiliary = false,
}: BuildSummaryOptions = {}): Summary {
  const selected: WindowKey = typeof requestedWindow === 'string' && Object.hasOwn(WINDOWS, requestedWindow)
    ? requestedWindow as WindowKey
    : DEFAULT_WINDOW
  const span = WINDOWS[selected]
  const cutoff = span === undefined ? undefined : now - span
  const windowed: RequestRecord[] = cutoff === undefined ? records.slice() : records.filter(record => record.at >= cutoff)
  // Auxiliary calls (title generation, compaction, translation) are real
  // server requests but much shorter, so they would drag every average down.
  // They are counted and can be included, but stay out of the default view.
  const isAuxiliary = (record: RequestRecord): boolean => typeof record.purpose === 'string' && record.purpose.length > 0
  const auxiliary = windowed.filter(isAuxiliary).length
  const scoped = includeAuxiliary ? windowed : windowed.filter(record => !isAuxiliary(record))

  const ok = scoped.filter(record => record.status === 'ok')
  const errors = scoped.filter(record => record.status === 'error')
  const aborted = scoped.filter(record => record.status === 'aborted')
  const measured = scoped.filter(record => record.status === 'ok')
  const ttft = distribution(measured, 'ttftMs')
  const tps = distribution(measured, 'tps')
  const direct = scoped.filter(record => record.connection === 'direct' && typeof record.ip === 'string')
  const proxied = scoped.filter(record => record.connection === 'proxied')
  const withEdge = scoped.filter(record => typeof record.colo === 'string')
  const completed = ok.length + errors.length

  const series: SeriesPoint[] = scoped.slice(-SERIES_LIMIT).map(record => ({
    at: record.at,
    ttftMs: record.ttftMs,
    tps: record.tps,
    key: serverIdentity(record).key,
    model: record.model,
    status: record.status,
  }))

  return {
    generatedAt: now,
    window: selected,
    retained: records.length,
    includeAuxiliary,
    auxiliary,
    watched: { providers: [...providers], hosts: [...hosts] },
    totals: {
      requests: scoped.length,
      ok: ok.length,
      errors: errors.length,
      aborted: aborted.length,
      inFlight: inFlight.length,
      successRate: completed === 0 ? undefined : Math.round((ok.length / completed) * 1000) / 1000,
      ttft,
      tps,
      outputTokens: sum(scoped.map(record => record.outputTokens ?? 0)),
      inputTokens: sum(scoped.map(record => record.inputTokens ?? 0)),
      cacheReadTokens: sum(scoped.map(record => record.cacheReadTokens ?? 0)),
      estimatedSpeeds: measured.filter(record => record.tpsEstimated === true).length,
      avgOutputTokens: average(scoped.map(record => record.outputTokens).filter((value): value is number => typeof value === 'number')),
    },
    coverage: {
      direct: direct.length,
      proxied: proxied.length,
      unknown: scoped.length - direct.length - proxied.length,
      edge: withEdge.length,
    },
    servers: serverRows(scoped, scoped.length),
    models: modelRows(scoped),
    series,
    recent: scoped.slice(-RECENT_LIMIT).reverse(),
    live: inFlight.slice(0, 8),
  }
}
