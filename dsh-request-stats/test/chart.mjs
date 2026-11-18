/**
 * Edge cases for the chart geometry of `dsh-request-stats`.
 *
 * The built client bundle renders one trend per shape below; nothing here
 * asserts pixel positions, only the invariants that make a chart readable:
 * every point inside the axis, a labelled time span, and a legend that names
 * the real extremes of the plotted series.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

let boot
globalThis.window = {
  __ModuleLoader__: { load(config) { boot = config } },
  addEventListener() {},
  removeEventListener() {},
}
;(0, eval)(readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'))
const api = boot.factory(name => {
  if (name === 'react') return React
  throw new Error(`unexpected module request: ${name}`)
})
const { DashboardView, zh } = api.__test
const t = (key, params) => {
  const template = zh[key] ?? key
  return params === undefined
    ? template
    : template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match))
}

const now = Date.now()
const series = (points) => points.map((point, index) => ({
  at: now - (points.length - 1 - index) * 60_000,
  key: 'ip:10.0.0.1',
  model: 'deepseek-v4.1-flash',
  status: 'ok',
  ...point,
}))

function view(points) {
  return renderToStaticMarkup(React.createElement(DashboardView, {
    t,
    data: {
      generatedAt: now,
      window: 'all',
      retained: points.length,
      auxiliary: 0,
      includeAuxiliary: false,
      watched: { providers: ['opencode-go'], hosts: ['opencode.ai'] },
      totals: {
        requests: points.length, ok: points.length, errors: 0, aborted: 0, inFlight: 0,
        successRate: 1, ttft: { count: points.length }, tps: { count: points.length },
        outputTokens: 9000, inputTokens: 20_000, cacheReadTokens: 0, estimatedSpeeds: 0,
      },
      coverage: { direct: points.length, proxied: 0, unknown: 0, edge: 0 },
      servers: [],
      models: [],
      series: series(points),
      recent: [],
      live: [],
    },
    error: null,
    loading: false,
    windowKey: 'all',
    includeAuxiliary: false,
    onWindow() {},
    onRefresh() {},
    onClear() {},
    onRequestClear() {},
  }))
}

/** Axis tick numbers of the first trend in the markup. */
function firstAxis(html) {
  const match = /class="drs-chart-yaxis" aria-hidden="true">([\s\S]*?)<\/div>/.exec(html)
  assert.ok(match !== null, 'the first trend labels a value axis')
  return [...match[1].matchAll(/>([\d,.]+)</g)].map(tick => Number(tick[1].replace(/,/g, '')))
}

/** `left` percentages of the plotted markers, in markup order. */
function markerLefts(html) {
  return [...html.matchAll(/class="drs-chart-mark"[^>]*style="left:([\d.]+)%/g)].map(match => Number(match[1]))
}

// ------------------------------------------------------- a constant series

{
  // A flat line has no span to scale to: the old math divided by a zero range.
  const html = view(Array.from({ length: 6 }, () => ({ ttftMs: 800, tps: 150 })))
  const ticks = firstAxis(html)
  assert.ok(ticks.length >= 3, 'a flat series still labels an axis')
  // The axis is padded from the value's own magnitude, so the line sits inside
  // the plot instead of on its floor or its ceiling.
  assert.ok(ticks[0] < 800 && ticks[ticks.length - 1] > 800, 'the flat line keeps off the axis bounds')
  assert.ok(html.includes('最低 800 ms') && html.includes('最高 800 ms'), 'a flat series reports equal bounds')
  assert.ok(html.includes('平均 800 ms'), 'a flat series reports its mean')
  assert.ok(!html.includes('NaN') && !html.includes('undefined'), 'a flat series leaks no NaN')
}

// ---------------------------------------------------------- a single point

{
  const html = view([{ ttftMs: 640, tps: 120 }])
  // One sample cannot draw a line: the empty hint replaces the plot, and the
  // card must not render an axis around nothing.
  assert.ok(html.includes('请求还不够'), 'a single sample shows the hint')
  assert.equal((html.match(/class="drs-chart"/g) ?? []).length, 0, 'a single sample draws no chart')
  assert.ok(!html.includes('NaN'), 'a single sample leaks no NaN')
}

// ------------------------------------------------------ gap in the middle

{
  // The aborted request carries no measurement, so it must be skipped rather
  // than plotted as zero, which would drag the line to the floor.
  const html = view([
    { ttftMs: 700, tps: 140 },
    { ttftMs: undefined, tps: undefined },
    { ttftMs: 900, tps: 160 },
  ])
  assert.ok(html.includes('2 个样本'), 'samples without a measurement are not counted')
  assert.ok(html.includes('最低 700 ms') && html.includes('最高 900 ms'), 'the gap does not enter the bounds')
  assert.ok(html.includes('最低 140.0 tok/s'), 'the speed chart skips the gap too')
  const ticks = firstAxis(html)
  assert.ok(ticks[0] < 700 && ticks[ticks.length - 1] > 900, 'the axis still contains the visible points')
}

// ------------------------------------------------------------- extremes

{
  // The newest sample is both the maximum and the last point: the plot marks
  // it once, as "latest", instead of stacking two markers on one spot.
  const html = view([
    { ttftMs: 700, tps: 140 },
    { ttftMs: 720, tps: 145 },
    { ttftMs: 950, tps: 170 },
  ])
  const lefts = markerLefts(html)
  assert.equal(lefts.length, 4, 'each chart marks a minimum and a maximum sample')
  for (let index = 0; index + 1 < lefts.length; index += 2) {
    assert.ok(lefts[index] < lefts[index + 1], 'marks keep their left-to-right order')
  }
  assert.ok(html.includes('最新 950 ms'), 'the latest sample reports its own value')
}

// ------------------------------------------------------------ time labels

{
  // A three-day window must date its ticks; a one-minute window must not.
  const spread = (count, stepMs) => Array.from({ length: count }, (_, index) => ({
    ttftMs: 700 + index * 10,
    tps: 140 + index,
    at: now - (count - 1 - index) * stepMs,
  }))
  const long = view(spread(6, 18 * 60 * 60 * 1000)).match(/class="drs-chart-xaxis"[\s\S]{0,1200}/)[0]
  assert.ok(/\d\d-\d\d/.test(long), 'a multi-day span dates its ticks')
  const short = view(spread(6, 10_000)).match(/class="drs-chart-xaxis"[\s\S]{0,1200}/)[0]
  assert.ok(/\d\d:\d\d:\d\d/.test(short), 'a sub-minute-per-tick span shows seconds')
  assert.ok(!/\d\d-\d\d/.test(short), 'a short span omits the date')
}

console.log('dsh-request-stats: chart edge case tests passed')
