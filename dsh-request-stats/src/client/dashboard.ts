/**
 * Dashboard page: the polling hook, the state container, the presentational
 * view, and the small components the view renders.
 *
 * The view receives everything through props, so the same tree renders from the
 * Host summary and from an offline test fixture; the container only owns
 * polling, clearing, and transient notices.
 *
 * @module dsh-request-stats/client/dashboard
 */

import * as React from 'react'
import { formatClock, formatMs, formatPercent, formatRate, formatShare, formatStamp, formatTokens, intl } from './format.ts'
import { AlertIcon, PanelIcon, RefreshIcon } from './icons.ts'
import { CSS } from './styles.ts'
import type { Translate } from './i18n.ts'
import type {
  DashboardProps,
  DashboardViewProps,
  EmptyStateProps,
  KpiProps,
  Notice,
  ServerCellProps,
  StatusChipProps,
  TrendKind,
  TrendProps,
} from './types.ts'
import type { Summary, WindowKey } from '../shared/types.ts'

const { useCallback, useEffect, useMemo, useRef, useState } = React
const h = React.createElement

/** Host bridge owned by the plugin's Host half. */
const BASE = '/api/dsh-request-stats'
/** One poll interval while the panel is mounted. */
const REFRESH_MS = 4000
/** Windows offered by the range control. */
const WINDOWS: WindowKey[] = ['1h', '24h', '7d', 'all']

// ------------------------------------------------------------ presentation

/** One KPI tile. */
export function Kpi({ label, value, hint }: KpiProps): React.ReactElement {
  return h(
    'div',
    { className: 'drs-kpi' },
    h('span', { className: 'drs-kpi-label' }, label),
    h('span', { className: 'drs-kpi-value' }, value),
    hint === undefined ? null : h('span', { className: 'drs-kpi-hint' }, hint),
  )
}

/** One labelled sparkline over the most recent measured requests. */
export function Trend({ t, values, kind }: TrendProps): React.ReactElement {
  const gradientId = React.useId().replace(/:/g, '')
  const points = useMemo(() => {
    const seen: number[] = []
    for (const entry of values) {
      const value = entry[valueKey(kind)]
      if (typeof value === 'number' && Number.isFinite(value)) seen.push(value)
    }
    return seen
  }, [values, kind])
  const tone = kind === 'ttft' ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-state-success-primary)'
  const label = kind === 'ttft' ? t('trendTtft') : t('trendTps')
  const latest = points.length === 0 ? undefined : points[points.length - 1]
  const rendered = points.length < 2
    ? h('div', { className: 'drs-muted', style: { fontSize: '12px', padding: '26px 0 34px' } }, t('trendEmpty'))
    : (() => {
        const width = 560
        const height = 84
        const pad = 6
        const min = Math.min(...points)
        const max = Math.max(...points)
        const span = max - min === 0 ? 1 : max - min
        const step = (width - pad * 2) / (points.length - 1)
        const coords = points.map((value, index) => {
          const x = pad + index * step
          const y = pad + (height - pad * 2) * (1 - (value - min) / span)
          return [Math.round(x * 100) / 100, Math.round(y * 100) / 100]
        })
        const line = coords.map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${x} ${y}`).join(' ')
        const area = `${line} L${coords[coords.length - 1][0]} ${height - pad} L${coords[0][0]} ${height - pad} Z`
        return h(
          'svg',
          { viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: 'none', role: 'img', 'aria-label': label },
          h('defs', null, h('linearGradient', { id: gradientId, x1: '0', y1: '0', x2: '0', y2: '1' },
            h('stop', { offset: '0', stopColor: tone, stopOpacity: '0.28' }),
            h('stop', { offset: '1', stopColor: tone, stopOpacity: '0' }),
          )),
          h('path', { d: area, fill: `url(#${gradientId})` }),
          h('path', { d: line, fill: 'none', stroke: tone, strokeWidth: 1.6, strokeLinejoin: 'round', strokeLinecap: 'round', vectorEffect: 'non-scaling-stroke' }),
          h('circle', { cx: coords[coords.length - 1][0], cy: coords[coords.length - 1][1], r: 2.2, fill: tone }),
        )
      })()
  return h(
    'div',
    { className: 'drs-trend' },
    h('div', { className: 'drs-trend-head' },
      h('span', null, label),
      h('span', { className: 'drs-trend-value' },
        points.length === 0 ? '—' : kind === 'ttft' ? formatMs(latest) : formatRate(latest)),
    ),
    rendered,
    h('div', { className: 'drs-trend-head' },
      h('span', null, points.length === 0 ? '—' : t('trendMin', { value: bound(kind, Math.min(...points)) })),
      h('span', null, points.length === 0 ? '—' : t('trendMax', { value: bound(kind, Math.max(...points)) })),
    ),
  )
}

/** Chart series key for one trend kind. */
export function valueKey(kind: TrendKind): 'ttftMs' | 'tps' {
  return kind === 'ttft' ? 'ttftMs' : 'tps'
}

/** One trend bound in its own unit. */
export function bound(kind: TrendKind, value: number): string {
  return kind === 'ttft' ? formatMs(value) : formatRate(value)
}

/** Status chip for one request row. */
export function StatusChip({ t, status }: StatusChipProps): React.ReactElement {
  const spec = status === 'error'
    ? { tone: 'error', label: t('statusError') }
    : status === 'aborted'
      ? { tone: 'warn', label: t('statusAborted') }
      : { tone: 'ok', label: t('statusOk') }
  return h('span', { className: 'drs-chip', 'data-tone': spec.tone }, spec.label)
}

/** Server cell shared by the server and recent tables. */
export function ServerCell({ t, row }: ServerCellProps): React.ReactElement {
  const label = row.ip !== undefined
    ? row.ip
    : row.colo !== undefined
      ? row.colo
      : t('unknownServer')
  const connection = row.connection === 'direct'
    ? h('span', { className: 'drs-chip', 'data-tone': 'ok' }, t('direct'))
    : row.connection === 'proxied'
      ? h('span', { className: 'drs-chip', 'data-tone': 'warn' }, t('proxied'))
      : null
  return h(
    'span',
    { className: 'drs-server' },
    h('span', { className: 'drs-mono' }, label),
    row.ip !== undefined && row.colo !== undefined
      ? h('span', { className: 'drs-chip' }, `${t('edge')} ${row.colo}`)
      : row.colo !== undefined
        ? h('span', { className: 'drs-chip' }, t('edge'))
        : null,
    connection,
  )
}

/** Empty state shown before the first request lands, or for an empty window. */
export function EmptyState({ t, scoped, onShowAll }: EmptyStateProps): React.ReactElement {
  return h(
    'div',
    { className: 'drs-card' },
    h(
      'div',
      { className: 'drs-empty' },
      h(PanelIcon, { size: 34, active: true }),
      h('div', { className: 'drs-empty-title' }, scoped ? t('emptyScope') : t('emptyTitle')),
      scoped
        ? h('button', { type: 'button', className: 'drs-btn', onClick: onShowAll }, t('showAll'))
        : h('div', { className: 'drs-empty-hint' }, t('emptyHint')),
    ),
  )
}

// ------------------------------------------------------------------- data

/** One field of a thrown value, mirroring `failure?.<key>` without trusting its shape. */
function failureField(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[key] : undefined
}

/** Human-readable message of a thrown value, for the error notice. */
function describeFailure(value: unknown): string {
  const message = failureField(value, 'message')
  return typeof message === 'string' ? message : String(message ?? value)
}

/** What the polling hook returns to the page. */
export interface LedgerState {
  /** Latest summary, or `null` before the first poll. */
  data: Summary | null
  /** Transport error of the latest poll, or `null`. */
  error: string | null
  /** No summary has arrived yet. */
  loading: boolean
  /** A manual refresh is in flight. */
  refreshing: boolean
  /** Ask for a refresh on the next effect pass. */
  refresh: () => void
}

/**
 * Poll the Host ledger while the panel is mounted.
 * @param windowKey - selected history window.
 * @returns The latest summary, transport error, and a manual refresh.
 */
export function useLedger(windowKey: WindowKey, includeAuxiliary: boolean): LedgerState {
  const [data, setData] = useState<Summary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [nonce, setNonce] = useState(0)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setInterval> | undefined

    const load = async () => {
      if (typeof document !== 'undefined' && document.hidden) return
      try {
        const query = `window=${encodeURIComponent(windowKey)}&includeAux=${includeAuxiliary ? '1' : '0'}`
        const response = await fetch(`${BASE}/state?${query}`, {
          method: 'GET',
          credentials: 'same-origin',
          headers: { accept: 'application/json' },
          signal: controller.signal,
        })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const body = await response.json()
        if (body?.ok !== true) throw new Error(body?.message ?? 'read failed')
        if (!alive.current) return
        setData(body.value)
        setError(null)
      } catch (failure) {
        if (!alive.current || failureField(failure, 'name') === 'AbortError') return
        setError(describeFailure(failure))
      } finally {
        setRefreshing(false)
        if (alive.current) setLoading(false)
      }
    }

    void load()
    timer = setInterval(() => { void load() }, REFRESH_MS)
    const onVisible = () => { if (!document.hidden) void load() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      controller.abort()
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [windowKey, includeAuxiliary, nonce])

  const refresh = useCallback(() => {
    setRefreshing(true)
    setNonce(value => value + 1)
  }, [])
  return { data, error, loading, refreshing, refresh }
}

// -------------------------------------------------------------- dashboard

/** State container for the page: polling, clearing, and transient notices. */
export function Dashboard(props: DashboardProps): React.ReactElement {
  const t: Translate = typeof props?.t === 'function' ? props.t : (key) => key
  const [windowKey, setWindowKey] = useState<WindowKey>('all')
  const [includeAuxiliary, setIncludeAuxiliary] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  const { data, error, loading, refreshing, refresh } = useLedger(windowKey, includeAuxiliary)

  const clearRecords = useCallback(async () => {
    setClearing(true)
    try {
      const response = await fetch(`${BASE}/clear`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: '{}',
      })
      const body = await response.json().catch(() => undefined)
      if (!response.ok || body?.ok !== true) throw new Error(body?.message ?? `HTTP ${response.status}`)
      setNotice({ tone: 'ok', text: t('allClear') })
      setConfirmClear(false)
      refresh()
    } catch (failure) {
      setNotice({ tone: 'error', text: `${t('clearFailed')}: ${describeFailure(failure)}` })
    } finally {
      setClearing(false)
    }
  }, [refresh, t])

  useEffect(() => {
    if (!confirmClear) return undefined
    const timer = setTimeout(() => setConfirmClear(false), 4000)
    return () => clearTimeout(timer)
  }, [confirmClear])

  useEffect(() => {
    if (notice === null) return undefined
    const timer = setTimeout(() => setNotice(null), 4000)
    return () => clearTimeout(timer)
  }, [notice])

  return h(DashboardView, {
    t,
    data,
    error,
    loading,
    refreshing,
    notice,
    windowKey,
    includeAuxiliary,
    clearing,
    confirmClear,
    onWindow: setWindowKey,
    onToggleAux: () => setIncludeAuxiliary(value => !value),
    onRefresh: refresh,
    onClear: clearRecords,
    onRequestClear: () => setConfirmClear(true),
    onCancelClear: () => setConfirmClear(false),
  })
}

/**
 * Presentational dashboard: everything it shows arrives as props, so the
 * same tree renders from the Host summary and from a test fixture.
 */
export function DashboardView(props: DashboardViewProps): React.ReactElement {
  const t: Translate = typeof props?.t === 'function' ? props.t : (key) => key
  const {
    data, error, loading, refreshing, notice, windowKey, includeAuxiliary, clearing, confirmClear,
    onWindow, onToggleAux, onRefresh, onClear, onRequestClear, onCancelClear,
  } = props
  const totals = data?.totals
  const hasRecords = (totals?.requests ?? 0) > 0
  const canClear = (data?.retained ?? 0) > 0
  const proxied = data?.coverage?.proxied ?? 0
  const inFlight = totals?.inFlight ?? 0
  const live = data?.live ?? []
  const ttft = totals?.ttft
  const tps = totals?.tps

  const rangeButtons = WINDOWS.map(key => h(
    'button',
    {
      key,
      type: 'button',
      className: 'drs-seg-btn',
      'aria-pressed': windowKey === key,
      onClick: () => onWindow(key),
    },
    t(key === '1h' ? 'range1h' : key === '24h' ? 'range24h' : key === '7d' ? 'range7d' : 'rangeAll'),
  ))

  return h(
    'div',
    { className: 'drs-page' },
    h('style', null, CSS),
    h(
      'header',
      { className: 'drs-head' },
      h(
        'div',
        { className: 'drs-heading' },
        h('h1', { className: 'drs-title' }, t('title')),
        h('p', { className: 'drs-sub' }, t('subtitle')),
      ),
      h(
        'div',
        { className: 'drs-actions' },
        inFlight > 0
          ? h(
              'span',
              {
                className: 'drs-live',
                title: live.map(entry => `${entry.model ?? ''} ${formatMs(entry.elapsedMs)}`).join('\n'),
              },
              h('span', { className: 'drs-dot' }),
              `${t('live')} ${inFlight}`,
            )
          : null,
        h(
          'button',
          {
            type: 'button',
            className: 'drs-btn drs-toggle',
            'aria-pressed': includeAuxiliary,
            onClick: onToggleAux,
            title: t('includeAux'),
          },
          t('includeAux'),
        ),
        h('div', { className: 'drs-seg', role: 'group', 'aria-label': t('range') }, rangeButtons),
        h(
          'button',
          {
            type: 'button',
            className: 'drs-btn',
            onClick: onRefresh,
            title: t('refresh'),
            'aria-busy': refreshing,
            'data-busy': refreshing ? 'true' : undefined,
          },
          h(RefreshIcon),
          t('refresh'),
        ),
        h(
          'button',
          {
            type: 'button',
            className: 'drs-btn',
            'data-tone': 'danger',
            disabled: clearing || !canClear,
            onClick: () => {
              if (clearing) return
              if (confirmClear) onClear()
              else onRequestClear()
            },
            title: confirmClear ? t('confirmClearTitle') : t('clear'),
          },
          clearing ? t('clearing') : confirmClear ? t('confirmClear') : t('clear'),
        ),
        confirmClear
          ? h('button', { type: 'button', className: 'drs-btn', onClick: onCancelClear }, t('cancel'))
          : null,
      ),
    ),
    h(
      'div',
      { className: 'drs-scroll' },
      h(
        'div',
        { className: 'drs-inner' },
        data === null
          ? null
          : h(
              'div',
              { className: 'drs-notes' },
              h(
                'div',
                null,
                t('watched', {
                  providers: (data.watched?.providers ?? []).join(', ') || '—',
                  hosts: (data.watched?.hosts ?? []).join(', ') || '—',
                }),
              ),
              (data.auxiliary ?? 0) > 0
                ? h(
                    'div',
                    null,
                    t(includeAuxiliary ? 'auxiliaryIncluded' : 'auxiliaryExcluded', { count: data.auxiliary }),
                  )
                : null,
              (data.coverage?.edge ?? 0) > 0 ? h('div', null, t('edgeNotice')) : null,
              h('div', null, t('privacy')),
            ),
        error === null
          ? null
          : h(
              'div',
              { className: 'drs-notice', 'data-tone': 'error', role: 'alert' },
              h(AlertIcon),
              h(
                'span',
                null,
                `${t('failed')}: ${error}`,
                String(error).includes('403') ? ` — ${t('forbiddenHint')}` : '',
              ),
              h('button', { type: 'button', className: 'drs-btn', onClick: onRefresh, style: { marginLeft: 'auto' } }, t('retry')),
            ),
        notice === null || notice === undefined
          ? null
          : h(
              'div',
              { className: 'drs-notice', 'data-tone': notice.tone === 'error' ? 'error' : undefined, role: 'status' },
              h('span', null, notice.text),
            ),
        proxied > 0
          ? h('div', { className: 'drs-notice', 'data-tone': 'warn' }, h(AlertIcon), h('span', null, t('proxyNotice', { count: proxied })))
          : null,
        data === null
          ? h('div', { className: 'drs-card' }, h('div', { className: 'drs-empty drs-muted' }, loading ? t('loading') : '—'))
          : !hasRecords || totals === undefined
            ? h(EmptyState, {
                t,
                scoped: (data.retained ?? 0) > 0 && windowKey !== 'all',
                onShowAll: () => onWindow('all'),
              })
            : h(
                React.Fragment,
                null,
                h(
                  'div',
                  { className: 'drs-kpis' },
                  h(Kpi, {
                    label: t('kpiRequests'),
                    value: intl.format(totals.requests),
                    hint: t('kpiRequestsHint', {
                      ok: totals.ok,
                      errors: totals.errors,
                      aborted: totals.aborted,
                      rate: formatPercent(totals.successRate),
                    }),
                  }),
                  h(Kpi, {
                    label: t('kpiTtft'),
                    value: formatMs(ttft?.avg),
                    hint: t('kpiTtftHint', { p50: formatMs(ttft?.p50), p90: formatMs(ttft?.p90) }),
                  }),
                  h(Kpi, {
                    label: t('kpiTps'),
                    value: formatRate(tps?.avg),
                    hint: t('kpiTpsHint', {
                      p50: formatRate(tps?.p50),
                      count: tps?.count ?? 0,
                      estimated: totals.estimatedSpeeds ?? 0,
                    }),
                  }),
                  h(Kpi, {
                    label: t('kpiTokens'),
                    value: formatTokens(totals.outputTokens),
                    hint: t('kpiTokensHint', { cache: formatTokens(totals.cacheReadTokens) }),
                  }),
                ),
                h(
                  'section',
                  { className: 'drs-card' },
                  h(
                    'div',
                    { className: 'drs-card-head' },
                    h('h2', { className: 'drs-card-title' }, t('servers')),
                    h('span', { className: 'drs-card-hint' }, t('serversHint')),
                  ),
                  h(
                    'div',
                    { className: 'drs-table-wrap' },
                    h(
                      'table',
                      { className: 'drs-table' },
                      h(
                        'thead',
                        null,
                        h(
                          'tr',
                          null,
                          h('th', { scope: 'col' }, t('colServer')),
                          h('th', { scope: 'col', className: 'drs-align-right' }, t('colRequests')),
                          h('th', { scope: 'col' }, t('colShare')),
                          h('th', { scope: 'col', className: 'drs-align-right' }, t('colTtft')),
                          h('th', { scope: 'col', className: 'drs-align-right' }, t('colTps')),
                          h('th', { scope: 'col', className: 'drs-align-right' }, t('colTokens')),
                          h('th', { scope: 'col', className: 'drs-align-right' }, t('colLast')),
                        ),
                      ),
                      h(
                        'tbody',
                        null,
                        (data.servers ?? []).map(row => h(
                          'tr',
                          { key: row.key },
                          h('td', null, h(ServerCell, { t, row })),
                          h('td', { className: 'drs-align-right drs-strong' }, intl.format(row.requests)),
                          h(
                            'td',
                            null,
                            h(
                              'span',
                              { className: 'drs-share' },
                              h('span', { className: 'drs-bar' }, h('span', { style: { width: `${Math.max(2, Math.round(row.share * 100))}%` } })),
                              h('span', { className: 'drs-muted' }, formatShare(row.share)),
                            ),
                          ),
                          h('td', { className: 'drs-align-right' }, formatMs(row.ttftAvg)),
                          h('td', { className: 'drs-align-right' }, formatRate(row.tpsAvg)),
                          h('td', { className: 'drs-align-right drs-muted' }, formatTokens(row.outputTokens)),
                          h('td', { className: 'drs-align-right drs-muted' }, formatClock(row.lastAt)),
                        )),
                      ),
                    ),
                  ),
                ),
                h(
                  'section',
                  { className: 'drs-card' },
                  h(
                    'div',
                    { className: 'drs-card-head' },
                    h('h2', { className: 'drs-card-title' }, t('trend')),
                    (data.series ?? []).length < 2
                      ? h('span', { className: 'drs-card-hint' }, t('trendEmpty'))
                      : null,
                  ),
                  h(
                    'div',
                    { className: 'drs-trends' },
                    h(Trend, { t, values: data.series ?? [], kind: 'ttft' }),
                    h(Trend, { t, values: data.series ?? [], kind: 'tps' }),
                  ),
                ),
                (data.models ?? []).length > 1
                  ? h(
                      'section',
                      { className: 'drs-card' },
                      h('div', { className: 'drs-card-head' }, h('h2', { className: 'drs-card-title' }, t('models'))),
                      h(
                        'div',
                        { className: 'drs-table-wrap' },
                        h(
                          'table',
                          { className: 'drs-table' },
                          h('thead', null, h(
                            'tr',
                            null,
                            h('th', { scope: 'col' }, t('colModel')),
                            h('th', { scope: 'col', className: 'drs-align-right' }, t('colRequests')),
                            h('th', { scope: 'col', className: 'drs-align-right' }, t('colTtft')),
                            h('th', { scope: 'col', className: 'drs-align-right' }, t('colTps')),
                            h('th', { scope: 'col', className: 'drs-align-right' }, t('colTokens')),
                            h('th', { scope: 'col', className: 'drs-align-right' }, t('colLast')),
                          )),
                          h(
                            'tbody',
                            null,
                            data.models.map(row => h(
                              'tr',
                              { key: row.key },
                              h('td', null, h('span', { className: 'drs-strong' }, row.model), row.provider === undefined ? null : h('span', { className: 'drs-muted' }, ` · ${row.provider}`)),
                              h('td', { className: 'drs-align-right' }, intl.format(row.requests)),
                              h('td', { className: 'drs-align-right' }, formatMs(row.ttftAvg)),
                              h('td', { className: 'drs-align-right' }, formatRate(row.tpsAvg)),
                              h('td', { className: 'drs-align-right drs-muted' }, formatTokens(row.outputTokens)),
                              h('td', { className: 'drs-align-right drs-muted' }, formatClock(row.lastAt)),
                            )),
                          ),
                        ),
                      ),
                    )
                  : null,
                h(
                  'section',
                  { className: 'drs-card' },
                  h(
                    'div',
                    { className: 'drs-card-head' },
                    h('h2', { className: 'drs-card-title' }, t('recent')),
                    h('span', { className: 'drs-card-hint' }, t('recentScope', {
                      shown: (data.recent ?? []).length,
                      retained: data.retained ?? 0,
                    })),
                  ),
                  h(
                    'div',
                    { className: 'drs-table-wrap' },
                    h(
                      'table',
                      { className: 'drs-table' },
                      h('thead', null, h(
                        'tr',
                        null,
                        h('th', { scope: 'col' }, t('colTime')),
                        h('th', { scope: 'col' }, t('colModel')),
                        h('th', { scope: 'col' }, t('colServer')),
                        h('th', { scope: 'col', className: 'drs-align-right' }, t('colTtft')),
                        h('th', { scope: 'col', className: 'drs-align-right' }, t('colTps')),
                        h('th', { scope: 'col', className: 'drs-align-right' }, t('colTokens')),
                        h('th', { scope: 'col' }, t('colStatus')),
                      )),
                      h(
                        'tbody',
                        null,
                        (data.recent ?? []).map(record => h(
                          'tr',
                          { key: record.id },
                          h('td', { className: 'drs-mono drs-muted' }, formatStamp(record.at)),
                          h(
                            'td',
                            null,
                            h('span', { className: 'drs-strong' }, record.model ?? '—'),
                            record.purpose === undefined
                              ? null
                              : h('span', { className: 'drs-chip', style: { marginLeft: '8px' }, title: t('colPurpose') }, record.purpose),
                          ),
                          h('td', null, h(ServerCell, { t, row: record })),
                          h('td', { className: 'drs-align-right' }, formatMs(record.ttftMs)),
                          h('td', { className: 'drs-align-right' }, formatRate(record.tps)),
                          h('td', { className: 'drs-align-right drs-muted' }, formatTokens(record.outputTokens)),
                          h('td', null, h(StatusChip, { t, status: record.status })),
                        )),
                      ),
                    ),
                  ),
                ),
              ),
      ),
    ),
  )
}
