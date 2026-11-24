/**
 * 真实 React 渲染：用 `react-dom/server` 把产物里的分区组件渲染成 HTML，验证它在真 React
 * （hooks 与元素树）下能渲染、读数与命中插值正确、没有告警。
 *
 * 元素树与各分支的逐项断言在 `artifact-client.test.mjs`；这里补的是「真 React 不抛、不告警」。
 *
 * 运行：`node test/render.test.mjs`（或 pnpm test 跑全部）。
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'

import { check, checkTrue, finish, pluginRoot } from './helpers.mjs'

const require = createRequire(import.meta.url)

/** 载入产物并返回它的插件对象；`react` 交给真 React。 */
function loadPlugin() {
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
  if (registration === null) throw new Error('bundle 没有注册到 __ModuleLoader__')
  return registration.factory((id) => {
    if (id === 'react') return require('react')
    throw new Error(`产物要求了未声明的外部模块:${id}`)
  })
}

const plugin = loadPlugin()
const registrations = []
const dictionaries = {}
const ctx = {
  slots: {
    inject: (slot, callback) => callback(),
    register: (options, component) => {
      registrations.push({ options, component })
      return () => {}
    },
  },
  locale: {
    register: (namespace, dicts) => {
      Object.assign(dictionaries, dicts)
      return () => {}
    },
    bind: () => (key) => key,
  },
  effect: (callback) => { callback() },
}
plugin.apply(ctx)

const component = registrations[0]?.component
const zh = dictionaries.zh ?? {}
const COMMON = { 'number.thousand': '{value}K', 'number.million': '{value}M' }

/** 按本插件中文词典（+ common 兜底）做插值。 */
const t = (key, params) => {
  const template = zh[key] ?? COMMON[key]
  if (typeof template !== 'string') throw new Error(`缺少字典键:${key}`)
  if (params === undefined) return template
  return template.replace(/\{(\w+)\}/g, (_, name) => (params[name] === undefined ? `{${name}}` : String(params[name])))
}

const DAY = '2026-11-24'

/** 造一份会话列表快照。 */
function snapshot(values) {
  return {
    ids: Object.keys(values),
    byId: Object.fromEntries(Object.entries(values).map(([id, value]) => [id, {
      id,
      projectionValues: { todayTokenUsage: value },
    }])),
    projectionsBySession: {},
  }
}

/** 渲染并收集 React 的告警（渲染期不该有）。 */
function render(state) {
  const messages = []
  const originalError = console.error
  const originalWarn = console.warn
  console.error = (...args) => messages.push(args.map(String).join(' '))
  console.warn = (...args) => messages.push(args.map(String).join(' '))
  try {
    const html = renderToStaticMarkup(require('react').createElement(component, {
      presentation: 'docked',
      dismissOverlay: () => {},
      sessionId: 'current',
      useSessions: (selector) => selector(state),
      t,
    }))
    return { html, warnings: messages }
  } finally {
    console.error = originalError
    console.warn = originalWarn
  }
}

console.log('--- R① 今天有用量：一项指标一行，无告警 ---')
const filled = render(snapshot({
  a: { day: DAY, uncachedInputTokens: 250_000, outputTokens: 200_000, cacheReadTokens: 750_000, cacheWriteTokens: 0 },
}))
checkTrue('渲染出五行', (filled.html.match(/data-session-panel-row/g) ?? []).length === 5)
checkTrue('总用量无单位', filled.html.includes('>1.2M<'))
checkTrue('总用量标签', filled.html.includes('>总用量<'))
checkTrue('缓存命中行', filled.html.includes('>缓存命中<') && filled.html.includes('>75%<'))
checkTrue('未缓存输入', filled.html.includes('>未缓存输入<') && filled.html.includes('>250K<'))
checkTrue('缓存读取', filled.html.includes('>缓存读取<') && filled.html.includes('>750K<'))
checkTrue('输出', filled.html.includes('>输出<') && filled.html.includes('>200K<'))
checkTrue('没有 tok 后缀', !/\d\s*tok/.test(filled.html))
checkTrue('每行一个图标', (filled.html.match(/<svg/g) ?? []).length === 5)
check('渲染期无告警', filled.warnings, [])

console.log('--- R② 今天没有用量：渲染为空 ---')
const empty = render(snapshot({}))
check('空字符串', empty.html, '')
check('无告警', empty.warnings, [])

console.log('--- R③ 昨天有用量但今天没有：不显示 ---')
const stale = render(snapshot({
  a: { day: '2026-11-23', uncachedInputTokens: 100, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 },
}))
check('空字符串', stale.html, '')

finish()
