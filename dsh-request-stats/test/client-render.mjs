/**
 * Offline render test for the browser half of `dsh-request-stats`.
 *
 * The module is loaded exactly as the Web shell loads it — through
 * `window.__ModuleLoader__.load` — with React supplied by the same factory
 * `require`. The presentational page is then rendered with a fixture summary,
 * so a crash in the table, trend, or empty-state branches fails here instead of
 * blanking the slot in the browser. No Host, network, or DOM is involved.
 */

import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

let boot

globalThis.window = {
  __ModuleLoader__: {
    load(config) {
      boot = config
    },
  },
}

await import('../client.js')

assert.ok(boot !== undefined, 'client.js registers through window.__ModuleLoader__.load')
assert.equal(boot.id, 'dsh-request-stats', 'factory id equals the package name')

const api = boot.factory(name => {
  if (name === 'react') return React
  throw new Error(`unexpected module request: ${name}`)
})

assert.ok(Array.isArray(api.inject), 'the plugin declares an inject list')
assert.equal(typeof api.apply, 'function', 'the plugin exports apply')
const { DashboardView, PanelIcon, zh } = api.__test ?? {}
assert.equal(typeof DashboardView, 'function', 'the test seam exposes the view')
assert.equal(typeof PanelIcon, 'function', 'the test seam exposes the icon')
assert.equal(typeof zh, 'object', 'the test seam exposes the dictionaries')

const t = key => key
const noop = () => {}

function view(overrides = {}) {
  return renderToStaticMarkup(React.createElement(DashboardView, {
    t,
    data: null,
    error: null,
    loading: false,
    notice: null,
    windowKey: 'all',
    includeAuxiliary: false,
    clearing: false,
    confirmClear: false,
    onWindow: noop,
    onRefresh: noop,
    onClear: noop,
    onRequestClear: noop,
    onCancelClear: noop,
    ...overrides,
  }))
}

const now = Date.now()

const summary = {
  generatedAt: now,
  window: 'all',
  retained: 12,
  auxiliary: 3,
  includeAuxiliary: false,
  watched: { providers: ['opencode-go'], hosts: ['opencode.ai'] },
  totals: {
    requests: 12,
    ok: 11,
    errors: 1,
    aborted: 0,
    inFlight: 1,
    successRate: 0.917,
    ttft: { count: 11, avg: 820.5, p50: 790, p90: 1200, min: 600, max: 1400 },
    tps: { count: 11, avg: 143.2, p50: 150, p90: 200, min: 90, max: 240 },
    outputTokens: 15_320,
    inputTokens: 42_000,
    cacheReadTokens: 1_500,
    estimatedSpeeds: 0,
    avgOutputTokens: 1276,
  },
  coverage: { direct: 9, proxied: 3, unknown: 0, edge: 12 },
  servers: [
    {
      key: 'ip:104.18.10.66', label: '104.18.10.66', ip: '104.18.10.66', colo: 'SIN', connection: 'direct',
      requests: 6, share: 0.5, errors: 0, aborted: 0, ttftAvg: 700, ttftP50: 690, tpsAvg: 160.4, tpsP50: 158,
      outputTokens: 8000, lastAt: now - 20_000, models: ['deepseek-v4.1-flash'],
    },
    {
      key: 'edge:LAX', label: 'LAX', ip: undefined, colo: 'LAX', connection: 'proxied',
      requests: 6, share: 0.5, errors: 1, aborted: 0, ttftAvg: 941, ttftP50: 900, tpsAvg: 126, tpsP50: 120,
      outputTokens: 7320, lastAt: now - 90_000, models: ['deepseek-v4.1-flash'],
    },
  ],
  models: [
    {
      key: 'opencode-go/deepseek-v4.1-flash', model: 'deepseek-v4.1-flash', provider: 'opencode-go',
      requests: 12, errors: 1, ttftAvg: 820.5, tpsAvg: 143.2, outputTokens: 15_320, lastAt: now,
    },
  ],
  series: Array.from({ length: 12 }, (_, index) => ({
    at: now - (11 - index) * 5_000,
    ttftMs: 700 + index * 25,
    tps: 140 + index,
    key: index < 6 ? 'ip:104.18.10.66' : 'edge:LAX',
    model: 'deepseek-v4.1-flash',
    status: 'ok',
  })),
  recent: [
    {
      id: 'r1', at: now, provider: 'opencode-go', model: 'deepseek-v4.1-flash', status: 'ok',
      connection: 'direct', ip: '104.18.10.66', colo: 'SIN', ttftMs: 700, tps: 160.4, outputTokens: 1200,
      finishKind: 'stop',
    },
    {
      id: 'r2', at: now - 6000, provider: 'opencode-go', model: 'deepseek-v4.1-flash', status: 'error',
      connection: 'proxied', colo: 'LAX', ttftMs: 940, tps: 120, outputTokens: 800,
      failure: { code: 'RATE_LIMIT', message: '429 too many requests' },
    },
  ],
  live: [{ model: 'deepseek-v4.1-flash', provider: 'opencode-go', startedAt: now - 300, elapsedMs: 300 }],
}

// --------------------------------------------------------------- populated

{
  const html = view({ data: summary })
  for (const expected of ['104.18.10.66', 'SIN', 'LAX', 'tok/s', '700 ms', 'drs-page', '<table', 'drs-title']) {
    assert.ok(html.includes(expected), `rendered page contains "${expected}"`)
  }
  assert.ok(html.includes('drs-trend svg') || html.includes('<svg'), 'the trend renders an SVG')
  assert.ok(html.includes('drs-live'), 'the in-flight counter renders')
  assert.ok(html.includes('proxied'), 'proxied rows are labelled')
  assert.ok(!html.includes('undefined') && !html.includes('NaN'), 'no undefined/NaN leaks into the markup')
}

// --------------------------------------------------------------- empty state

{
  const empty = {
    ...summary,
    retained: 0,
    totals: { ...summary.totals, requests: 0, ok: 0, errors: 0, inFlight: 0, ttft: { count: 0 }, tps: { count: 0 } },
    coverage: { direct: 0, proxied: 0, unknown: 0, edge: 0 },
    servers: [],
    models: [],
    series: [],
    recent: [],
    live: [],
  }
  const html = view({ data: empty })
  assert.ok(html.includes('emptyTitle'), 'the first-run hint renders')
  assert.ok(html.includes('drs-empty'), 'the empty state uses its layout')
  assert.ok(!html.includes('<table'), 'no table renders without records')
}

// -------------------------------------------------------- empty window + error

{
  const scoped = {
    ...summary,
    retained: 12,
    totals: { ...summary.totals, requests: 0, ok: 0, errors: 0, inFlight: 0, ttft: { count: 0 }, tps: { count: 0 } },
    servers: [],
    models: [],
    series: [],
    recent: [],
    live: [],
  }
  const html = view({ data: scoped, windowKey: '1h' })
  assert.ok(html.includes('emptyScope'), 'an empty window explains itself')

  const failed = view({ data: null, error: 'HTTP 403' })
  assert.ok(failed.includes('HTTP 403'), 'a transport error is surfaced')
  assert.ok(failed.includes('retry'), 'the failure offers a retry')

  const notice = view({ data: summary, notice: { tone: 'ok', text: 'All records cleared.' } })
  assert.ok(notice.includes('All records cleared.'), 'a notice is surfaced')

  const confirming = view({ data: summary, confirmClear: true })
  assert.ok(confirming.includes('confirmClear'), 'the destructive action asks once')
  assert.ok(confirming.includes('cancel'), 'the confirmation can be cancelled')
}

// -------------------------------------------------------------------- icon

{
  const html = renderToStaticMarkup(React.createElement(PanelIcon, { size: 18, active: true }))
  assert.ok(html.startsWith('<svg'), 'the sidebar glyph is an SVG')
  assert.ok(html.includes('viewBox="0 0 24 24"'), 'the glyph keeps its viewBox')
  assert.ok(html.includes('aria-hidden="true"'), 'the glyph stays out of the accessibility tree')
}

// ---------------------------------------------------------- registration

{
  const registered = []
  const ctx = {
    effect(callback) {
      return callback()
    },
    locale: {
      register() {
        return () => {}
      },
      bind() {
        return key => key
      },
    },
    slots: {
      inject(owner, callback) {
        const result = callback()
        if (result !== null && typeof result === 'object' && typeof result.next === 'function') {
          let step = result.next()
          while (step.done !== true) step = result.next()
        }
        return () => {}
      },
      register(options, component) {
        registered.push({ options, component })
        return () => {}
      },
    },
  }
  api.apply(ctx)
  const panel = registered.find(entry => entry.options?.name === 'sidebar.panellist')
  const main = registered.find(entry => entry.options?.name === 'main')
  assert.ok(panel !== undefined, 'the sidebar entry is registered')
  assert.equal(panel.options.id, 'requestStats')
  assert.equal(panel.options.locale, 'requestStats')
  assert.equal(typeof panel.options.label, 'function')
  assert.equal(panel.options.label(), 'panel')
  assert.equal(panel.component, PanelIcon, 'the sidebar entry renders the glyph')
  assert.ok(main !== undefined, 'the main panel is registered under the same id')
  assert.equal(main.options.key, 'requestStats')
  assert.equal(typeof main.component, 'function', 'the main panel has a React component')
}

// ------------------------------------------------- real dictionary coverage

{
  const translate = (key, params) => {
    const template = zh[key] ?? key
    return params === undefined
      ? template
      : template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match))
  }
  const html = renderToStaticMarkup(React.createElement(DashboardView, {
    t: translate,
    data: { ...summary, includeAuxiliary: false, auxiliary: 3 },
    error: null,
    loading: false,
    refreshing: false,
    notice: { tone: 'ok', text: translate('allClear') },
    windowKey: 'all',
    includeAuxiliary: false,
    clearing: false,
    confirmClear: false,
    onWindow: noop,
    onToggleAux: noop,
    onRefresh: noop,
    onClear: noop,
    onRequestClear: noop,
    onCancelClear: noop,
  }))
  for (const leaked of ['kpiRequests', 'kpiTtft', 'kpiTps', 'kpiTokens', 'trendMin', 'trendMax', 'includeAux', 'auxiliaryExcluded', 'watched', 'footerCount', 'colPurpose']) {
    assert.ok(!html.includes(leaked), `translated view does not leak "${leaked}"`)
  }
  for (const expected of ['请求数', '平均首字延迟', '平均输出速度', '输出 tokens', '已排除 3 条辅助调用', '监控 opencode-go → opencode.ai', '最近 2 条 · 本 profile 保留 12 条', '包含辅助请求', '成功', '经代理', '边缘']) {
    assert.ok(html.includes(expected), `translated view contains "${expected}"`)
  }
}

console.log('dsh-request-stats: client render tests passed')
