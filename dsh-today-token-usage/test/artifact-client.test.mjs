/**
 * 产物装配：把 `lib/client.js` 当成浏览器里的独立 bundle 加载，验证模块 id / 插件名 /
 * inject 声明 / 字典注册 / 会话面板分区注册；组件在拿到数据前渲染为空（数据来自宿主路由）。
 *
 * 行级渲染断言在 `render.test.mjs`（那里用真 React 渲染纯展示组件）。
 *
 * 运行：`node test/artifact-client.test.mjs`（或 pnpm test 跑全部）。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { check, checkTrue, finish, pluginRoot } from './helpers.mjs'

/** 只做结构记录的 React 桩：元素树断言不需要真 reconciler。 */
const reactStub = {
  createElement(type, props, ...children) {
    return { type, props: props ?? {}, children: children.flat() }
  },
  useMemo(factory) {
    return factory()
  },
  useState(initial) {
    return [typeof initial === 'function' ? initial() : initial, () => {}]
  },
  useEffect() {},
  Fragment: Symbol.for('react.fragment'),
}

/** 自动 JSX 运行时的桩：子节点按 createElement 的形态摊平。 */
function jsxElement(type, props) {
  const { children, ...rest } = props ?? {}
  return {
    type,
    props: rest,
    children: children === undefined ? [] : (Array.isArray(children) ? children.flat() : [children]),
  }
}

const jsxRuntimeStub = { Fragment: reactStub.Fragment, jsx: jsxElement, jsxs: jsxElement, jsxDEV: jsxElement }

/** 载入产物并返回它的插件对象；`react` 由桩提供。 */
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
    if (id === 'react') return reactStub
    if (id === 'react/jsx-runtime' || id === 'react/jsx-dev-runtime') return jsxRuntimeStub
    throw new Error(`产物要求了未声明的外部模块:${id}`)
  })
}

console.log('--- C① bundle 注册与插件声明 ---')
const plugin = loadPlugin()
check('模块 id', plugin.name, 'dsh-today-token-usage')
check('插件名', plugin.name, 'dsh-today-token-usage')
check('inject 声明', plugin.inject, ['slots', 'locale'])

console.log('--- C② apply：字典与分区注册 ---')
const registrations = []
const injections = []
const localeRegistrations = []
const effects = []
const ctx = {
  slots: {
    inject: (slot, callback) => {
      injections.push(slot)
      return callback()
    },
    register: (options, component) => {
      registrations.push({ options, component })
      return () => {}
    },
  },
  locale: {
    register: (namespace, dictionaries) => {
      localeRegistrations.push({ namespace, dictionaries })
      return () => {}
    },
    bind: () => (key, params) => (params === undefined ? key : `${key}:${JSON.stringify(params)}`),
  },
  effect: (callback, label) => {
    effects.push({ label, disposer: callback() })
  },
}
plugin.apply(ctx)

check('只注入一个槽', injections, ['conversation.session.panel.section'])
check('一个分区注册', registrations.length, 1)
const { options, component } = registrations[0]
check('槽键', options.name, 'conversation.session.panel.section')
check('分区 id', options.id, 'today-usage')
check('排序', options.order, 300)
check('命名空间', options.locale, 'dsh-today-token-usage')
check('标题走字典', options.label(), 'section.title')
check('组件是函数', typeof component, 'function')
check('字典登记', localeRegistrations.length, 1)
check('字典命名空间', localeRegistrations[0].namespace, 'dsh-today-token-usage')

const zh = localeRegistrations[0].dictionaries.zh
const en = localeRegistrations[0].dictionaries.en
const zhKeys = Object.keys(zh).sort()
check('中英文字典键一致', Object.keys(en).sort(), zhKeys)
checkTrue('标题与每行标签齐全', ['section.title', 'row.total', 'row.requests', 'row.cacheHit', 'row.uncachedInput', 'row.cacheRead', 'row.cacheWrite', 'row.output']
  .every(key => typeof zh[key] === 'string' && typeof en[key] === 'string'))
check('挂了一个 effect', effects.length, 1)
checkTrue('effect 带清理函数', typeof effects[0].disposer === 'function')

console.log('--- C③ 拿到宿主数据前渲染为空 ---')
const tree = component({
  presentation: 'docked',
  dismissOverlay: () => {},
  sessionId: 'current',
  t: (key) => key,
})
check('空', tree, null)

finish()
