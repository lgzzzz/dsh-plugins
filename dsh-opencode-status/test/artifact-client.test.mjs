/**
 * 产物装配：把 `lib/client.js` 当成浏览器里的独立 bundle 加载，验证模块 id / 插件名 /
 * inject 声明 / 字典注册 / 会话面板分区注册 / 后台轮询的启动与清理；组件在拿到数据前渲染为空
 * （数据来自宿主路由）。测试环境没有 window，后台轮询必须安静跳过、不发请求。
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
}

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
    throw new Error(`产物要求了未声明的外部模块:${id}`)
  })
}

console.log('--- C① bundle 注册与插件声明 ---')
const plugin = loadPlugin()
check('模块 id', plugin.name, 'dsh-opencode-status')
check('插件名', plugin.name, 'dsh-opencode-status')
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
const originalFetch = globalThis.fetch
let fetchCalls = 0
globalThis.fetch = async () => {
  fetchCalls += 1
  throw new Error('测试环境不应发起后台请求')
}
plugin.apply(ctx)
check('测试环境不悄悄发起后台请求', fetchCalls, 0)

check('只注入一个槽', injections, ['conversation.session.panel.section'])
check('一个分区注册', registrations.length, 1)
const { options, component } = registrations[0]
check('槽键', options.name, 'conversation.session.panel.section')
check('分区 id', options.id, 'opencode-status')
check('排序', options.order, 320)
check('命名空间', options.locale, 'dsh-opencode-status')
check('标题走字典', options.label(), 'section.title')
check('组件是函数', typeof component, 'function')
check('字典登记', localeRegistrations.length, 1)
check('字典命名空间', localeRegistrations[0].namespace, 'dsh-opencode-status')

const zh = localeRegistrations[0].dictionaries.zh
const en = localeRegistrations[0].dictionaries.en
check('中英文字典键一致', Object.keys(en).sort(), Object.keys(zh).sort())
const required = [
  'section.title',
  'row.service', 'row.model', 'row.status', 'row.ttft', 'row.tps',
  'model.missing', 'status.unavailable',
  'status.operational', 'status.degraded', 'status.unknown',
  'reason.availability', 'reason.errors', 'reason.latency', 'reason.monitoring', 'reason.upstream',
  'value.seconds', 'value.tps',
]
checkTrue('文案键齐全', required.every(key => typeof zh[key] === 'string' && typeof en[key] === 'string'))
check('字典与后台轮询各挂一个 effect', effects.length, 2)
check('effect 标签', effects.map(effect => effect.label), [
  'dsh-opencode-status: dictionaries',
  'dsh-opencode-status: background polling',
])
checkTrue('每个 effect 带清理函数', effects.every(effect => typeof effect.disposer === 'function'))

console.log('--- C③ 拿到宿主数据前渲染为空 ---')
const tree = component({
  presentation: 'docked',
  dismissOverlay: () => {},
  sessionId: 'current',
  t: (key) => key,
})
check('空', tree, null)

globalThis.fetch = originalFetch
finish()
