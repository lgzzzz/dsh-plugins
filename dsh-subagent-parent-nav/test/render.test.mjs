/**
 * 真实 React 渲染：用 `react-dom/server` 把产物里的分区组件渲染成 HTML，验证它在
 * 真 React（hooks 与元素树）下能渲染、文案插值正确、根会话渲染为空。
 *
 * 元素树与点击的逐项断言在 `artifact-client.test.mjs`；这里补的是「真 React 不抛」。
 *
 * 运行：`node test/render.test.mjs`（或 pnpm test 跑全部）。
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'

import { check, checkTrue, finish, pluginRoot } from './helpers.mjs'

const require = createRequire(import.meta.url)

const documentStub = {
  querySelector: () => null,
  createElement: (tag) => ({ tag, dataset: {}, textContent: '' }),
  head: { appendChild: () => {} },
}

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
  uiWorkspace: { openSession: () => {} },
  effect: (callback) => { callback() },
}

globalThis.document = documentStub
try {
  plugin.apply(ctx)
} finally {
  delete globalThis.document
}

const component = registrations[0]?.component
const zh = dictionaries.zh ?? {}

/** 按本插件中文词典做插值。 */
const t = (key, params) => {
  const template = zh[key]
  if (typeof template !== 'string') throw new Error(`缺少字典键:${key}`)
  if (params === undefined) return template
  return template.replace(/\{(\w+)\}/g, (_, name) => (params[name] === undefined ? `{${name}}` : String(params[name])))
}

const summaries = {
  root: { id: 'root', displayTitle: '主会话', running: true, origin: 'root' },
  child: { id: 'child', displayTitle: '一级子智能体', running: false, origin: 'subagent', parentId: 'root' },
  grandchild: { id: 'grandchild', displayTitle: '二级子智能体', running: false, origin: 'subagent', parentId: 'child' },
}

function props({ sessionId, address, byId }) {
  return {
    sessionId,
    presentation: 'docked',
    dismissOverlay: () => {},
    useSession: (selector) => selector({ subagent: address === undefined ? null : { address } }),
    useSessions: (selector) => selector({ ids: Object.keys(byId), byId, projectionsBySession: {} }),
    open: () => true,
    t,
  }
}

/** 渲染并收集 React 的告警（渲染期不该有）。 */
function render(overrides) {
  const messages = []
  const originalError = console.error
  const originalWarn = console.warn
  console.error = (...args) => messages.push(args.map(String).join(' '))
  console.warn = (...args) => messages.push(args.map(String).join(' '))
  try {
    const html = renderToStaticMarkup(require('react').createElement(component, props(overrides)))
    return { html, warnings: messages }
  } finally {
    console.error = originalError
    console.warn = originalWarn
  }
}

console.log('--- R① 多级：真 React 渲染出两行 ---')
const multi = render({
  sessionId: 'grandchild',
  address: { parentSessionId: 'child', childSessionId: 'grandchild', mode: 'continuable' },
  byId: summaries,
})
checkTrue('渲染出列表', multi.html.includes('data-subagent-parent-nav=""'))
checkTrue('链首标题', multi.html.includes('>主会话<'))
checkTrue('链首运行读屏名', multi.html.includes('aria-label="跳转到 主会话（正在运行）"'))
checkTrue('链首运行标记', multi.html.includes('data-running=""'))
checkTrue('直接上级标题', multi.html.includes('>一级子智能体<'))
checkTrue('直接上级读屏名', multi.html.includes('aria-label="跳转到 一级子智能体"'))
checkTrue('直接上级角色标签', multi.html.includes('>上级智能体<'))
checkTrue('两行', (multi.html.match(/<li/g) ?? []).length === 2)
check('渲染期无告警', multi.warnings, [])

console.log('--- R② 一级：一行，不带角色标签 ---')
const single = render({
  sessionId: 'child',
  address: { parentSessionId: 'root', childSessionId: 'child', mode: 'one-shot' },
  byId: summaries,
})
checkTrue('一行', (single.html.match(/<li/g) ?? []).length === 1)
checkTrue('无角色标签', !single.html.includes('上级智能体'))

console.log('--- R③ 根会话：整节渲染为空 ---')
const root = render({
  sessionId: 'root',
  address: undefined,
  byId: { root: summaries.root },
})
check('空输出', root.html, '')
check('渲染期无告警', root.warnings, [])

finish()
