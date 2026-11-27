/**
 * 真实 React 渲染：用 `react-dom/server` 渲染纯展示组件 `TodayUsageRows` 与 `MonthUsageRows`，
 * 验证行集合、读数、费用行，以及「切换本月 / 切换今日」两行按钮，且没有告警。
 *
 * 分区标题不在这里：标题由面板从注册项读（切到本月时重新注册换掉），与行渲染无关。
 * 数据获取（SSE 推送）由 `usage-client.test.mjs` 与 `plugin-apply.test.mjs` 覆盖。
 *
 * 运行：`node test/render.test.mjs`（或 pnpm test 跑全部）。
 */
import { createRequire } from 'node:module'
import { renderToStaticMarkup } from 'react-dom/server'

import { MonthUsageRows, TodayUsageRows } from '../src/component.ts'
import { zh } from '../src/locales.ts'
import { check, checkTrue, finish } from './helpers.mjs'

const require = createRequire(import.meta.url)
const React = require('react')

/** common 命名空间里本插件会落到的两个单位键（真实服务对本命名空间的缺键会落到 common）。 */
const COMMON = { 'number.thousand': '{value}K', 'number.million': '{value}M' }

/** 按本插件中文词典（+ common 兜底）做插值。 */
const t = (key, params) => {
  const template = zh[key] ?? COMMON[key]
  if (typeof template !== 'string') throw new Error(`缺少字典键:${key}`)
  if (params === undefined) return template
  return template.replace(/\{(\w+)\}/g, (_, name) => (params[name] === undefined ? `{${name}}` : String(params[name])))
}

/** 一份面板合计（费用默认 ¥4.60）。 */
function totals({
  requests = 1234,
  uncachedInput = 250_000,
  output = 250_000,
  cacheRead = 750_000,
  cacheWrite = 0,
  cost = { total: 4.6, peak: 3.2, offPeak: 1.4, unpricedRequests: 0 },
} = {}) {
  const prompt = uncachedInput + cacheRead + cacheWrite
  return { uncachedInput, cacheRead, cacheWrite, output, prompt, total: prompt + output, requests, cost }
}

/** 渲染并收集 React 的告警（渲染期不该有）。 */
function renderElement(element) {
  const messages = []
  const originalError = console.error
  const originalWarn = console.warn
  console.error = (...args) => messages.push(args.map(String).join(' '))
  console.warn = (...args) => messages.push(args.map(String).join(' '))
  try {
    const html = renderToStaticMarkup(element)
    return { html, warnings: messages }
  } finally {
    console.error = originalError
    console.warn = originalWarn
  }
}

/** 渲染今日视图。 */
function render(value, onSwitchMonth = () => {}) {
  return renderElement(React.createElement(TodayUsageRows, { totals: value, t, onSwitchMonth }))
}

/** 渲染本月视图。 */
function renderMonth(value, onSwitchToday = () => {}) {
  return renderElement(React.createElement(MonthUsageRows, { totals: value, t, onSwitchToday }))
}

/** 从 HTML 里取标签文本，确认顺序。 */
function labels(html) {
  return [...html.matchAll(/data-row-part="content">([^<]*)</g)].map(match => match[1])
}

console.log('--- R① 今日视图：切换本月 + 七项读数 + 费用 ---')
const filled = render(totals())
check('标签顺序', labels(filled.html), ['切换本月', '总用量', '请求数', '缓存命中', '未缓存输入', '缓存读取', '输出', '费用'])
check('行数', (filled.html.match(/data-session-panel-row/g) ?? []).length, 8)
checkTrue('总用量 1.3M', filled.html.includes('>1.3M<'))
checkTrue('请求数 1.2K', filled.html.includes('>1.2K<'))
checkTrue('缓存命中 75%', filled.html.includes('>75%<'))
checkTrue('未缓存输入 250K', filled.html.includes('>250K<'))
checkTrue('费用只显示总额 ¥4.60', filled.html.includes('>¥4.60<'))
checkTrue('不再显示峰谷拆分', !filled.html.includes('高峰'))
check('每行一个图标', (filled.html.match(/<svg/g) ?? []).length, 8)
check('渲染期无告警', filled.warnings, [])

console.log('--- R② 有缓存写入：多一行 ---')
const withWrite = render(totals({ cacheWrite: 1111 }))
check('九行', (withWrite.html.match(/data-session-panel-row/g) ?? []).length, 9)
check('写入行标签', labels(withWrite.html), ['切换本月', '总用量', '请求数', '缓存命中', '未缓存输入', '缓存读取', '缓存写入', '输出', '费用'])
checkTrue('写入值 1.1K', withWrite.html.includes('>1.1K<'))
// 命中率 = 750000 / (250000 + 750000 + 1111)
checkTrue('命中率按三桶算', withWrite.html.includes('>75%<'))
check('无告警', withWrite.warnings, [])

console.log('--- R③ 有输入但没有命中：命中行显示 0% ---')
const noHit = render(totals({ uncachedInput: 10, output: 5, cacheRead: 0 }))
check('标签', labels(noHit.html), ['切换本月', '总用量', '请求数', '缓存命中', '未缓存输入', '缓存读取', '输出', '费用'])
checkTrue('0%', noHit.html.includes('>0%<'))
checkTrue('总用量 15', noHit.html.includes('>15<'))

console.log('--- R④ 只有输出、没有输入：不显示命中行 ---')
const outputOnly = render(totals({ uncachedInput: 0, output: 5, cacheRead: 0, requests: 1 }))
check('标签', labels(outputOnly.html), ['切换本月', '总用量', '请求数', '未缓存输入', '缓存读取', '输出', '费用'])

console.log('--- R⑤ 合计为 0：渲染为空 ---')
const empty = render(totals({ uncachedInput: 0, output: 0, cacheRead: 0, requests: 0 }))
check('空字符串', empty.html, '')
check('无告警', empty.warnings, [])

console.log('--- R⑥ 费用行：全部未计价时显示「—」，不写成 ¥0.00 ---')
const unpriced = render(totals({
  cost: { total: 0, peak: 0, offPeak: 0, unpricedRequests: 3 },
}))
checkTrue('显示「—」', unpriced.html.includes('>—<'))
checkTrue('不出现 ¥0.00', !unpriced.html.includes('¥0.00'))

console.log('--- R⑦ 「切换本月」行是按钮：紧贴标题、可点、有 aria-label ---')
checkTrue('body 是 button', /data-row-part="body"[^>]*aria-label="切换到本月用量"/.test(filled.html))
checkTrue('切换行排在最上面', labels(filled.html)[0] === '切换本月')
checkTrue('按钮可聚焦（type=button）', /<button[^>]*type="button"[^>]*data-row-part="body"/.test(filled.html))

console.log('--- R⑧ 本月视图：切换今日 + 同一套指标（没有「本月合计」行） ---')
const month = renderMonth(totals({ requests: 12_345, uncachedInput: 1_000_000, output: 500_000, cacheRead: 2_000_000, cost: { total: 12.34, peak: 9, offPeak: 3.34, unpricedRequests: 0 } }))
check('标签', labels(month.html), ['切换今日', '总用量', '请求数', '缓存命中', '未缓存输入', '缓存读取', '输出', '费用'])
checkTrue('没有「本月合计」行', !month.html.includes('本月合计'))
checkTrue('本月费用 ¥12.34', month.html.includes('>¥12.34<'))
checkTrue('本月费用同样只显示总额', !month.html.includes('高峰'))
checkTrue('切换今日是按钮', /aria-label="切换到今日用量"/.test(month.html))
/** 取第一行的图标（切换行排在最上面）。 */
const firstIcon = html => html.match(/<svg[\s\S]*?<\/svg>/)?.[0]
check('两种视图的切换行用同一个图标', firstIcon(filled.html), firstIcon(month.html))
check('渲染期无告警', month.warnings, [])

console.log('--- R⑨ 本月视图：当月为 0 时渲染为空 ---')
check('空字符串', renderMonth(totals({ uncachedInput: 0, output: 0, cacheRead: 0, requests: 0 })).html, '')

console.log('--- R⑩ 本月视图：未计价模型同样显示「—」 ---')
const monthUnpriced = renderMonth(totals({
  cost: { total: 0, peak: 0, offPeak: 0, unpricedRequests: 2 },
}))
checkTrue('显示「—」', monthUnpriced.html.includes('>—<'))

console.log('--- R⑪ 每一行都是单行：不再有 lines / detail 两行结构 ---')
checkTrue('今日视图没有两行行', !filled.html.includes('data-row-part="lines"') && !filled.html.includes('data-row-part="detail"'))
checkTrue('本月视图没有两行行', !month.html.includes('data-row-part="lines"') && !month.html.includes('data-row-part="detail"'))

finish()
