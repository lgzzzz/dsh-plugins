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
import { formatAxisTime, formatClock, formatMs, formatPercent, formatRate, formatShare, formatStamp, formatTokens, intl } from './format.ts'
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
import type { SeriesPoint, Summary, WindowKey } from '../shared/types.ts'

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

/** One labelled chart over the most recent measured requests. */
export function Trend({ t, values, kind }: TrendProps): React.ReactElement {
  const gradientId = React.useId().replace(/:/g, '')
  const title = t(kind === 'ttft' ? 'trendTtft' : 'trendTps')
  const accent = kind === 'ttft' ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-state-success-primary)'
  const chart = useMemo(() => {
    const samples = trendSamples(values, kind)
    return samples.length < 2 ? null : chartOf(samples, kind, t)
  }, [values, kind, t])

  return h(
    'div',
    { className: 'drs-trend', style: { '--drs-accent': accent } as React.CSSProperties },
    h(
      'div',
      { className: 'drs-trend-head' },
      h(
        'div',
        { className: 'drs-trend-name' },
        h('span', { className: 'drs-strong' }, title),
        chart === null ? null : h('span', { className: 'drs-trend-samples' }, t('trendSamples', { count: chart.placed.length })),
      ),
      chart === null
        ? null
        : h(
            'div',
            { className: 'drs-trend-legend' },
            [
              { tone: 'min', text: t('trendMin', { value: bound(kind, chart.min) }) },
              { tone: 'avg', text: t('trendAvg', { value: bound(kind, chart.avg) }) },
              { tone: 'max', text: t('trendMax', { value: bound(kind, chart.max) }) },
              { tone: 'latest', text: t('trendLatest', { value: bound(kind, chart.latest) }) },
            ].map(item => h(
              'span',
              { key: item.tone, className: 'drs-legend', 'data-tone': item.tone },
              h('i', { className: 'drs-swatch', 'aria-hidden': 'true' }),
              item.text,
            )),
          ),
    ),
    chart === null
      ? h('div', { className: 'drs-trend-empty drs-muted' }, t('trendEmpty'))
      : h(
          'div',
          { className: 'drs-chart' },
          h(
            'div',
            { className: 'drs-chart-yaxis', 'aria-hidden': 'true' },
            chart.yTicks.map(tick => h('span', { key: `y${tick.value}`, style: { top: `${tick.percent}%` } }, tick.label)),
          ),
          h(
            'div',
            { className: 'drs-chart-plot', role: 'img', 'aria-label': chart.aria },
            h(
              'svg',
              { viewBox: `0 0 ${PLOT_WIDTH} ${PLOT_HEIGHT}`, preserveAspectRatio: 'none', 'aria-hidden': 'true' },
              h('defs', null, h('linearGradient', { id: gradientId, x1: '0', y1: '0', x2: '0', y2: '1' },
                h('stop', { offset: '0', stopColor: accent, stopOpacity: '0.28' }),
                h('stop', { offset: '1', stopColor: accent, stopOpacity: '0' }),
              )),
              chart.yTicks
                .filter(tick => tick.percent > 0.5)
                .map(tick => h('line', {
                  key: `grid-y${tick.value}`,
                  className: 'drs-chart-grid',
                  x1: 0,
                  x2: PLOT_WIDTH,
                  y1: tick.percent,
                  y2: tick.percent,
                  vectorEffect: 'non-scaling-stroke',
                })),
              chart.xTicks
                .filter(tick => tick.percent > 0 && tick.percent < 100)
                .map(tick => h('line', {
                  key: `grid-x${tick.percent}`,
                  className: 'drs-chart-grid',
                  x1: tick.percent * (PLOT_WIDTH / 100),
                  x2: tick.percent * (PLOT_WIDTH / 100),
                  y1: 0,
                  y2: PLOT_HEIGHT,
                  vectorEffect: 'non-scaling-stroke',
                })),
              h('line', { className: 'drs-chart-ref', 'data-tone': 'max', x1: 0, x2: PLOT_WIDTH, y1: chart.maxY, y2: chart.maxY, vectorEffect: 'non-scaling-stroke' }),
              h('line', { className: 'drs-chart-ref', 'data-tone': 'min', x1: 0, x2: PLOT_WIDTH, y1: chart.minY, y2: chart.minY, vectorEffect: 'non-scaling-stroke' }),
              h('line', { className: 'drs-chart-ref', 'data-tone': 'avg', x1: 0, x2: PLOT_WIDTH, y1: chart.avgY, y2: chart.avgY, vectorEffect: 'non-scaling-stroke' }),
              h('path', { d: chart.area, fill: `url(#${gradientId})` }),
              h('path', {
                d: chart.line,
                fill: 'none',
                stroke: accent,
                strokeWidth: 1.6,
                strokeLinejoin: 'round',
                strokeLinecap: 'round',
                vectorEffect: 'non-scaling-stroke',
              }),
            ),
            chart.marks.map(mark => h('span', {
              key: mark.key,
              className: 'drs-chart-mark',
              'data-tone': mark.tone,
              style: { left: `${mark.x}%`, top: `${mark.y}%` },
              title: mark.title,
            })),
          ),
          h(
            'div',
            { className: 'drs-chart-xaxis', 'aria-hidden': 'true' },
            chart.xTicks.map((tick, index) => h(
              'span',
              {
                key: `x${tick.percent}`,
                className: index === 1 || index === 3 ? 'drs-tick-mid' : undefined,
                'data-align': index === 0 ? 'start' : index === chart.xTicks.length - 1 ? 'end' : 'middle',
                style: { left: `${tick.percent}%` },
              },
              tick.label,
            )),
          ),
        ),
  )
}

/** Internal width of the plot viewBox; the box is stretched to the card. */
const PLOT_WIDTH = 1000
/** Internal height of the plot viewBox; vertical coordinates are percentages. */
const PLOT_HEIGHT = 100
/** Fractions of the plot width that carry a time tick. */
const TIME_TICKS: readonly number[] = [0, 0.25, 0.5, 0.75, 1]

/** One measured sample of a trend. */
interface TrendSample {
  /** Record time, epoch milliseconds. */
  at: number
  /** Measured value in the series' own unit. */
  value: number
}

/** A rounded value axis: bounds and labelled ticks. */
interface ValueAxis {
  /** Value at the bottom of the plot. */
  low: number
  /** Value at the top of the plot. */
  high: number
  /** Distance between two ticks, which also picks label precision. */
  step: number
  /** Tick values from {@link ValueAxis.low} to {@link ValueAxis.high}. */
  ticks: number[]
}

/** One sample placed in the plot's percentage coordinate space. */
interface PlacedSample extends TrendSample {
  /** Horizontal position, 0–100 % of the plot width. */
  x: number
  /** Vertical position, 0–100 % of the plot height; 0 is the top. */
  y: number
}

/** A value that marks an extreme, or the last point, of the plot. */
interface ChartMark {
  /** Stable React key, equal to the tone. */
  key: string
  /** Visual role of the marker. */
  tone: 'min' | 'max' | 'latest'
  /** Horizontal position in percent. */
  x: number
  /** Vertical position in percent. */
  y: number
  /** Hover text naming the value and its instant. */
  title: string
}

/** Everything one trend chart needs to render. */
interface TrendChart {
  /** Value-axis ticks with their vertical positions. */
  yTicks: { value: number; percent: number; label: string }[]
  /** Time-axis ticks with their horizontal positions. */
  xTicks: { percent: number; label: string }[]
  /** Line and area paths in the stretched viewBox. */
  line: string
  area: string
  /** Vertical positions of the three reference lines. */
  maxY: number
  minY: number
  avgY: number
  /** Plotted bounds and the mean, summarized by the legend. */
  max: number
  min: number
  avg: number
  /** Value of the newest sample. */
  latest: number
  /** Placed samples, in time order. */
  placed: PlacedSample[]
  /** Extreme and latest markers. */
  marks: ChartMark[]
  /** Accessible description of the plot. */
  aria: string
}

/** Samples of one trend with a finite measurement, oldest first. */
function trendSamples(values: readonly SeriesPoint[], kind: TrendKind): TrendSample[] {
  const samples: TrendSample[] = []
  for (const entry of values) {
    const value = entry[valueKey(kind)]
    if (typeof value === 'number' && Number.isFinite(value) && typeof entry.at === 'number' && Number.isFinite(entry.at)) {
      samples.push({ at: entry.at, value })
    }
  }
  return samples.sort((left, right) => left.at - right.at)
}

/** Fraction of the data span kept free above and below the line. */
const AXIS_BREATHING_ROOM = 0.12

/**
 * A 1/2/5-decade value axis that contains the data and labels readable ticks.
 *
 * The step is chosen from the *unpadded* span so the axis does not gain a whole
 * extra division from the breathing room, then the padded bounds are rounded
 * outward by that step. The padding keeps the line off the top and bottom
 * edges, and it lets a constant series render in the middle of the plot
 * instead of on its floor.
 * @param min - smallest plotted value.
 * @param max - largest plotted value.
 * @param target - approximate number of intervals.
 * @returns Bounds that cover the data, plus their tick values.
 */
function niceAxis(min: number, max: number, target = 4): ValueAxis {
  const span = max - min
  const base = Math.abs(max) > 0 ? Math.abs(max) : 1
  // A constant series has no span to grow, so give it one from its magnitude.
  const pad = (span > 0 ? span : base) * AXIS_BREATHING_ROOM
  const raw = (span > 0 ? span : base) / Math.max(1, target)
  if (!Number.isFinite(raw) || raw <= 0) return { low: 0, high: 1, step: 1, ticks: [0, 1] }
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  const ratio = raw / magnitude
  const step = (ratio <= 1 ? 1 : ratio <= 2 ? 2 : ratio <= 5 ? 5 : 10) * magnitude
  const high = Math.ceil((max + pad) / step) * step
  let low = Math.floor((min - pad) / step) * step
  // Latency and speed never go negative: keep the floor at zero instead of
  // labelling a negative value that cannot happen.
  if (min >= 0 && low < 0) low = 0
  const ticks: number[] = []
  for (let index = 0; low + index * step <= high + step * 1e-6; index += 1) {
    ticks.push(Math.round((low + index * step) / step) * step)
  }
  return { low, high: high > low ? high : low + step, step, ticks }
}

/** Place samples against the time span and the value axis. */
function placeSamples(samples: readonly TrendSample[], axis: ValueAxis): PlacedSample[] {
  const first = samples[0]?.at ?? 0
  const last = samples[samples.length - 1]?.at ?? first
  const span = last - first
  const valueSpan = axis.high - axis.low
  return samples.map((sample, index) => ({
    ...sample,
    x: span > 0
      ? ((sample.at - first) / span) * 100
      : (index / Math.max(1, samples.length - 1)) * 100,
    y: valueSpan > 0 ? ((axis.high - sample.value) / valueSpan) * 100 : 50,
  }))
}

/** Tick label without the unit suffix, which the chart title carries. */
function formatTick(value: number, step: number): string {
  if (!Number.isFinite(value)) return '—'
  if (step >= 1) return intl.format(Math.round(value))
  const digits = Math.min(2, Math.max(1, Math.ceil(-Math.log10(step))))
  return value.toFixed(digits)
}

/** Round one viewBox coordinate to two decimals. */
function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * Build the geometry and labels of one trend chart.
 * @param samples - measured samples, at least two, oldest first.
 * @param kind - which measurement the samples carry.
 * @param t - locale lookup.
 * @returns Axis ticks, paths, reference positions, markers, and the aria label.
 */
function chartOf(samples: readonly TrendSample[], kind: TrendKind, t: Translate): TrendChart {
  const values = samples.map(sample => sample.value)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const avg = values.reduce((total, value) => total + value, 0) / values.length
  const axis = niceAxis(min, max)
  const placed = placeSamples(samples, axis)
  const first = samples[0].at
  const span = samples[samples.length - 1].at - first

  const yPercent = (value: number): number => ((axis.high - value) / (axis.high - axis.low)) * 100
  const xCoord = (percent: number): number => round2(percent * (PLOT_WIDTH / 100))
  const line = placed
    .map((sample, index) => `${index === 0 ? 'M' : 'L'}${xCoord(sample.x)} ${round2(sample.y)}`)
    .join(' ')
  const lastSample = placed[placed.length - 1]
  const area = `${line} L${xCoord(lastSample.x)} ${PLOT_HEIGHT} L${xCoord(placed[0].x)} ${PLOT_HEIGHT} Z`

  const title = t(kind === 'ttft' ? 'trendTtft' : 'trendTps')
  const lastIndex = placed.length - 1
  const maxIndex = placed.findIndex(sample => sample.value === max)
  const minIndex = placed.findIndex(sample => sample.value === min)
  const mark = (tone: ChartMark['tone'], sample: PlacedSample, label: string): ChartMark => ({
    key: tone,
    tone,
    x: sample.x,
    y: sample.y,
    title: `${label} · ${formatStamp(sample.at)}`,
  })
  const marks: ChartMark[] = []
  if (maxIndex >= 0 && maxIndex !== lastIndex) marks.push(mark('max', placed[maxIndex], t('trendMax', { value: bound(kind, max) })))
  if (minIndex >= 0 && minIndex !== lastIndex && minIndex !== maxIndex) marks.push(mark('min', placed[minIndex], t('trendMin', { value: bound(kind, min) })))
  marks.push(mark('latest', lastSample, t('trendLatest', { value: bound(kind, lastSample.value) })))

  return {
    yTicks: axis.ticks.map(value => ({ value, percent: yPercent(value), label: formatTick(value, axis.step) })),
    xTicks: TIME_TICKS.map(fraction => ({
      percent: fraction * 100,
      label: formatAxisTime(first + span * fraction, span),
    })),
    line,
    area,
    maxY: yPercent(max),
    minY: yPercent(min),
    avgY: yPercent(avg),
    max,
    min,
    avg,
    latest: lastSample.value,
    placed,
    marks,
    aria: t('trendAria', {
      title,
      min: bound(kind, min),
      avg: bound(kind, avg),
      max: bound(kind, max),
    }),
  }
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
                    h('span', { className: 'drs-card-hint' }, t('trendHint')),
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
