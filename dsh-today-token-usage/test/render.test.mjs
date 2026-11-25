/**
 * 真实 React 渲染：用 `react-dom/server` 渲染纯展示组件 `TodayUsageRows`，验证行集合、
 * 读数与命中插值正确、没有告警。
 *
 * 数据获取（SSE 推送）由 `usage-client.test.mjs` 与 `plugin-apply.test.mjs` 覆盖；这里只测
 * 「给一份合计怎么画」。
 *
 * 运行：`node test/render.test.mjs`（或 pnpm test 跑全部）。
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'

import { zh } from '../src/locales.ts'
import { check, checkTrue, finish, pluginRoot } from './helpers.mjs'

const require = createRequire(import.meta.url)
const React = require('react')

/** 加载构建产物：组件用真 React 渲染，源码里不再提供可被 Node 直接执行的 JSX 模块。 */
function loadBundle() {
  let registration = null
  globalThis.window = {
    __ModuleLoader__: {
      load: (value) => { registration = value },
    },
  }
  try {
    // eslint-disable-next-line no-eval
    ;(0, eval)(readFileSync(join(pluginRoot, 'lib', 'client.js'), 'utf8'))
  } finally {
    delete globalThis.window
  }
  if (registration === null) throw new Error('bundle 没有注册到 __ModuleLoader__（先跑 pnpm build）')
  return registration.factory((id) => {
    if (id === 'react') return React
    if (id === 'react/jsx-runtime' || id === 'react/jsx-dev-runtime') return require(id)
    throw new Error(`产物要求了未声明的外部模块:${id}`)
  })
}

const { TodayUsageRows } = loadBundle()

/** common 命名空间里本插件会落到的两个单位键（真实服务对本命名空间的缺键会落到 common）。 */
const COMMON = { 'number.thousand': '{value}K', 'number.million': '{value}M' }

/** 按本插件中文词典（+ common 兜底）做插值。 */
const t = (key, params) => {
  const template = zh[key] ?? COMMON[key]
  if (typeof template !== 'string') throw new Error(`缺少字典键:${key}`)
  if (params === undefined) return template
  return template.replace(/\{(\w+)\}/g, (_, name) => (params[name] === undefined ? `{${name}}` : String(params[name])))
}

/** 一份面板合计。 */
function totals({ requests = 1234, uncachedInput = 250_000, output = 250_000, cacheRead = 750_000, cacheWrite = 0 } = {}) {
  const prompt = uncachedInput + cacheRead + cacheWrite
  return { uncachedInput, cacheRead, cacheWrite, output, prompt, total: prompt + output, requests }
}

/** 渲染并收集 React 的告警（渲染期不该有）。 */
function render(value) {
  const messages = []
  const originalError = console.error
  const originalWarn = console.warn
  console.error = (...args) => messages.push(args.map(String).join(' '))
  console.warn = (...args) => messages.push(args.map(String).join(' '))
  try {
    const html = renderToStaticMarkup(React.createElement(TodayUsageRows, { totals: value, t }))
    return { html, warnings: messages }
  } finally {
    console.error = originalError
    console.warn = originalWarn
  }
}

/** 从 HTML 里取标签文本，确认顺序。 */
function labels(html) {
  return [...html.matchAll(/data-row-part="content">([^<]*)</g)].map(match => match[1])
}

console.log('--- R① 六行读数：总用量 / 请求数 / 缓存命中 / 未缓存输入 / 缓存读取 / 输出 ---')
const filled = render(totals())
check('标签顺序', labels(filled.html), ['总用量', '请求数', '缓存命中', '未缓存输入', '缓存读取', '输出'])
check('行数', (filled.html.match(/data-session-panel-row/g) ?? []).length, 6)
checkTrue('总用量 1.3M', filled.html.includes('>1.3M<'))
checkTrue('请求数 1.2K', filled.html.includes('>1.2K<'))
checkTrue('缓存命中 75%', filled.html.includes('>75%<'))
checkTrue('未缓存输入 250K', filled.html.includes('>250K<'))
checkTrue('缓存读取 750K', filled.html.includes('>750K<'))
checkTrue('输出 250K', filled.html.includes('>250K<'))
checkTrue('没有 tok 后缀', !/\d\s*tok/.test(filled.html))
check('每行一个图标', (filled.html.match(/<svg/g) ?? []).length, 6)
check('渲染期无告警', filled.warnings, [])

console.log('--- R② 有缓存写入：多一行 ---')
const withWrite = render(totals({ cacheWrite: 1111 }))
check('七行', (withWrite.html.match(/data-session-panel-row/g) ?? []).length, 7)
check('写入行标签', labels(withWrite.html), ['总用量', '请求数', '缓存命中', '未缓存输入', '缓存读取', '缓存写入', '输出'])
checkTrue('写入值 1.1K', withWrite.html.includes('>1.1K<'))
// 命中率 = 750000 / (250000 + 750000 + 1111)
checkTrue('命中率按三桶算', withWrite.html.includes('>75%<'))
check('无告警', withWrite.warnings, [])

console.log('--- R③ 有输入但没有命中：命中行显示 0% ---')
const noHit = render(totals({ uncachedInput: 10, output: 5, cacheRead: 0 }))
check('标签', labels(noHit.html), ['总用量', '请求数', '缓存命中', '未缓存输入', '缓存读取', '输出'])
checkTrue('0%', noHit.html.includes('>0%<'))
checkTrue('总用量 15', noHit.html.includes('>15<'))

console.log('--- R④ 只有输出、没有输入：不显示命中行 ---')
const outputOnly = render(totals({ uncachedInput: 0, output: 5, cacheRead: 0, requests: 1 }))
check('标签', labels(outputOnly.html), ['总用量', '请求数', '未缓存输入', '缓存读取', '输出'])

console.log('--- R⑤ 合计为 0：渲染为空 ---')
const empty = render(totals({ uncachedInput: 0, output: 0, cacheRead: 0, requests: 0 }))
check('空字符串', empty.html, '')
check('无告警', empty.warnings, [])

finish()
