/**
 * 产物装配：把 `lib/client.js` 当成浏览器里的独立 bundle 加载，验证模块 id / 插件名 /
 * inject 声明 / 字典注册 / 会话面板分区注册，以及组件在「有用量」「无命中」「无输入」等
 * 数据下的元素树（一行一项指标）。
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
checkTrue('标题与五行标签齐全', ['section.title', 'row.total', 'row.cacheHit', 'row.uncachedInput', 'row.cacheRead', 'row.cacheWrite', 'row.output']
  .every(key => typeof zh[key] === 'string' && typeof en[key] === 'string'))
check('挂了一个 effect', effects.length, 1)
checkTrue('effect 带清理函数', typeof effects[0].disposer === 'function')

/** common 命名空间里本插件会落到的两个单位键（真实服务对本命名空间的缺键会落到 common）。 */
const COMMON = { 'number.thousand': '{value}K', 'number.million': '{value}M' }

/** 按中文字典 + common 兜底插值出的 `t`。 */
const t = (key, params) => {
  const template = zh[key] ?? COMMON[key]
  if (typeof template !== 'string') throw new Error(`缺少字典键:${key}`)
  if (params === undefined) return template
  return template.replace(/\{(\w+)\}/g, (_, name) => (params[name] === undefined ? `{${name}}` : String(params[name])))
}

/** 造一份会话列表快照。 */
function state(rows, projections = {}) {
  return {
    ids: Object.keys(rows),
    byId: Object.fromEntries(Object.entries(rows).map(([id, value]) => [id, { id, projectionValues: { todayTokenUsage: value } }])),
    projectionsBySession: Object.fromEntries(Object.entries(projections).map(([id, value]) => [
      id,
      { values: { todayTokenUsage: value }, state: 'idle', error: null },
    ])),
  }
}

/** 用桩渲染组件，返回元素树（数组，或空数据的 null）。 */
function render(snapshot) {
  return component({ presentation: 'docked', dismissOverlay: () => {}, sessionId: 'current', useSessions: (selector) => selector(snapshot), t })
}

/** 从元素树里取出面板行：指标键、标签与数值。 */
function readRows(tree) {
  const rows = (Array.isArray(tree) ? tree : tree === null || tree === undefined ? [] : [tree]).filter(node => node?.type === 'div')
  return rows.map((row) => {
    const parts = row.children.filter(child => child !== null && typeof child === 'object')
    const body = parts.find(part => part.props['data-row-part'] === 'body')
    const content = body?.children.find(child => child?.props?.['data-row-part'] === 'content')
    const trailing = parts.find(part => part.props['data-row-part'] === 'trailing')
    const icon = body?.children.find(child => child?.props?.['data-row-part'] === 'icon')
    return {
      key: row.props['data-today-token-usage'],
      label: content?.children[0],
      value: trailing?.children[0],
      // 字形是自定义组件元素（桩不展开），所以这里只数图标位有没有子元素。
      iconChildren: (icon?.children ?? []).filter(child => child !== null && child !== undefined).length,
    }
  })
}

const DAY = '2026-11-24'
const TODAY = { day: DAY, uncachedInputTokens: 250_000, outputTokens: 250_000, cacheReadTokens: 750_000, cacheWriteTokens: 0 }

console.log('--- C③ 今天有用量：一项指标一行 ---')
const rows = readRows(render(state({ a: TODAY, b: { ...TODAY, uncachedInputTokens: 250_000 } })))
check('五行（没有缓存写入时不占行）', rows.map(row => row.key), ['total', 'cache-hit', 'uncached-input', 'cache-read', 'output'])
check('读数', rows.map(row => row.label), ['总用量', '缓存命中', '未缓存输入', '缓存读取', '输出'])
check('数值（无单位 / K / M）', rows.map(row => row.value), ['2.5M', '75%', '500K', '1.5M', '500K'])
check('只有首行放图标', rows.map(row => row.iconChildren), [1, 0, 0, 0, 0])
checkTrue('没有 tok 后缀', rows.every(row => !String(row.value).includes('tok')))

console.log('--- C④ 有缓存写入：多一行 ---')
const withWrite = readRows(render(state({
  a: { day: DAY, uncachedInputTokens: 1000, outputTokens: 20, cacheReadTokens: 9000, cacheWriteTokens: 1111 },
})))
check('六行', withWrite.map(row => row.key), ['total', 'cache-hit', 'uncached-input', 'cache-read', 'cache-write', 'output'])
check('写入值', withWrite[4], { key: 'cache-write', label: '缓存写入', value: '1.1K', iconChildren: 0 })
// 缓存写入也计入输入侧：命中率 = 9000 / (1000 + 9000 + 1111)
check('命中率', withWrite[1].value, '81%')

console.log('--- C⑤ 有输入但没有命中：命中行显示 0% ---')
const noHit = readRows(render(state({
  a: { day: DAY, uncachedInputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 },
})))
check('命中行仍在', noHit.map(row => row.key), ['total', 'cache-hit', 'uncached-input', 'cache-read', 'output'])
check('0%', noHit[1].value, '0%')
check('无单位的小树', noHit.map(row => row.value), ['15', '0%', '10', '0', '5'])

console.log('--- C⑥ 只有输出、没有输入：不显示命中行 ---')
const outputOnly = readRows(render(state({
  a: { day: DAY, uncachedInputTokens: 0, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 },
})))
check('四行', outputOnly.map(row => row.key), ['total', 'uncached-input', 'cache-read', 'output'])

console.log('--- C⑦ 今天没有用量：整节渲染为空 ---')
check('昨天的值不算今天', render(state({ a: { ...TODAY, day: '2026-11-23' } })), null)
check('完全空列表', render(state({})), null)

finish()
