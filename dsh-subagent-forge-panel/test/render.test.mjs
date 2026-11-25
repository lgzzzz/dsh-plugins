/**
 * 真实 React 渲染：用 `react-dom/server` 把产物里的守卫渲染成 HTML，验证它在真 React
 * （hooks 与元素树）下能渲染、只输出那个不可见的标记元素、普通会话输出为空。
 *
 * 元素树的逐项断言在 `artifact-client.test.mjs`；这里补的是「真 React 不抛」与
 * 「子会话里没有可见文字」。
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
    if (id === 'react/jsx-runtime' || id === 'react/jsx-dev-runtime') return require(id)
    throw new Error(`产物要求了未声明的外部模块:${id}`)
  })
}

const plugin = loadPlugin()
const registrations = []
const ctx = {
  slots: {
    inject: (slot, callback) => callback(),
    register: (options, component) => {
      registrations.push({ options, component })
      return () => {}
    },
  },
  effect: (callback) => { callback() },
}

globalThis.document = documentStub
try {
  plugin.apply(ctx)
} finally {
  delete globalThis.document
}

const component = registrations[0]?.component

/** 渲染一次并收集 React 的告警（渲染期不该有）。 */
function render({ sessionId, address = null, origin }) {
  const messages = []
  const originalError = console.error
  const originalWarn = console.warn
  console.error = (...args) => messages.push(args.map(String).join(' '))
  console.warn = (...args) => messages.push(args.map(String).join(' '))
  try {
    const html = renderToStaticMarkup(require('react').createElement(component, {
      sessionId,
      presentation: 'docked',
      dismissOverlay: () => {},
      useSession: (selector) => selector({ subagent: address === null ? null : { address } }),
      useSessions: (selector) => selector({ ids: [], byId: origin === undefined ? {} : { [sessionId]: { origin } } }),
    }))
    return { html, warnings: messages }
  } finally {
    console.error = originalError
    console.warn = originalWarn
  }
}

console.log('--- R① 子会话（快照带地址）：只输出不可见的标记元素 ---')
const child = render({
  sessionId: 'child',
  address: { parentSessionId: 'root', childSessionId: 'child', mode: 'continuable' },
})
check('只有标记元素', child.html, '<span hidden="" aria-hidden="true" data-forge-subagent-guard=""></span>')
checkTrue('没有任何可见文字', /^<span [^>]*><\/span>$/.test(child.html))
check('渲染期无告警', child.warnings, [])

console.log('--- R② 子会话（只有列表行依据） ---')
const fromSummary = render({ sessionId: 'child', origin: 'subagent' })
checkTrue('同样只输出标记元素', fromSummary.html.includes('data-forge-subagent-guard=""'))
check('渲染期无告警', fromSummary.warnings, [])

console.log('--- R③ 普通会话：什么都不输出 ---')
const root = render({ sessionId: 'root', origin: undefined })
check('空输出', root.html, '')
check('渲染期无告警', root.warnings, [])

finish()
