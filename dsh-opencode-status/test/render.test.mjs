/**
 * 真实 React 渲染：用 `react-dom/server` 渲染纯展示组件 `StatusRows`，验证行集合、读数、
 * 字形数量与没有告警。
 *
 * 取数与轮询由 `status-client.test.mjs` / `plugin-apply.test.mjs` 覆盖；这里只测「给一组行怎么画」。
 *
 * 运行：`node test/render.test.mjs`（或 pnpm test 跑全部）。
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'

import { zh } from '../src/locales.ts'
import { statusRows } from '../src/rows.ts'
import { extractSnapshot } from '../src/wire.ts'
import { check, checkTrue, finish, pluginRoot, translator, upstreamFixture } from './helpers.mjs'

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

const { StatusRows } = loadBundle()
const t = translator(zh)

/** 上游 fixture → 浏览器看到的响应。 */
function replyOf(overrides) {
  return { ok: true, ...extractSnapshot(upstreamFixture(overrides), 1795593000000) }
}

/** 渲染并收集 React 的告警（渲染期不该有）。 */
function render(rows) {
  const messages = []
  const originalError = console.error
  const originalWarn = console.warn
  console.error = (...args) => messages.push(args.map(String).join(' '))
  console.warn = (...args) => messages.push(args.map(String).join(' '))
  try {
    const html = renderToStaticMarkup(React.createElement(StatusRows, { rows }))
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

/** 从 HTML 里取 trailing 读数。 */
function values(html) {
  return [...html.matchAll(/data-row-part="trailing">([^<]*)</g)].map(match => match[1])
}

console.log('--- V① 四行：模型 / 状态 / 首 Token / 吞吐 ---')
const full = render(statusRows(replyOf(), t))
check('标签顺序', labels(full.html), ['模型', '状态', '首 Token', '吞吐'])
check('读数顺序', values(full.html), ['deepseek-v4.1-flash', '降级 · 延迟', '9.1 秒', '148 tok/s'])
check('行数', (full.html.match(/data-session-panel-row/g) ?? []).length, 4)
check('每行一个 16px 字形', (full.html.match(/<svg[^>]*width="16"[^>]*height="16"/g) ?? []).length, 4)
check('行身份标记', [...full.html.matchAll(/data-opencode-status="([^"]*)"/g)].map(match => match[1]), [
  'model', 'status', 'ttft', 'tps',
])
check('没有更新行', labels(full.html).includes('更新'), false)
check('渲染期无告警', full.warnings, [])

console.log('--- V② 服务状态不同：多一行 Go 服务 ---')
const withService = render(statusRows(replyOf({
  breakdown: [{ id: 'deepseek-v4.1-flash', status: 'operational', reason: 'none', speed: { ttft: 4208, tps: 168 } }],
}), t))
check('五行', (withService.html.match(/data-session-panel-row/g) ?? []).length, 5)
check('首行是 Go 服务', labels(withService.html)[0], 'Go 服务')
check('服务读数', values(withService.html)[0], '降级 · 延迟')
check('模型状态行', values(withService.html)[2], '正常')
check('无告警', withService.warnings, [])

console.log('--- V③ 失败：一行警告 ---')
const failed = render(statusRows({ ok: false, error: 'network', message: 'offline' }, t))
check('一行', labels(failed.html), ['状态'])
check('读数', values(failed.html), ['暂时无法获取'])
check('行身份', [...failed.html.matchAll(/data-opencode-status="([^"]*)"/g)].map(match => match[1]), ['error'])
check('无告警', failed.warnings, [])

console.log('--- V④ 模型缺失：可诊断的两行 ---')
const missing = render(statusRows(replyOf({ breakdown: [], models: [] }), t))
check('标签', labels(missing.html), ['Go 服务', '模型', '状态'])
check('状态读数', values(missing.html)[2], '未找到')
check('无告警', missing.warnings, [])

finish()
