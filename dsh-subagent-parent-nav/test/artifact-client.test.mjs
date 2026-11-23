/**
 * 产物装配：把 `lib/client.js` 当成浏览器里的独立 bundle 加载，验证模块 id / 插件名 /
 * inject 声明、字典与样式注入、会话面板分区注册，以及组件在根会话 / 一级 / 多级 /
 * 列表缺行时的渲染与点击。
 *
 * 运行：`node test/artifact-client.test.mjs`（或 pnpm test 跑全部）。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { captureWarnings, check, checkTrue, finish, pluginRoot } from './helpers.mjs'

const reactStub = {
  createElement(type, props, ...children) {
    return { type, props: props ?? {}, children: children.flat() }
  },
  useMemo(factory) {
    return factory()
  },
}

const styleTags = []
const documentStub = {
  querySelector: () => null,
  createElement: (tag) => ({ tag, dataset: {}, textContent: '' }),
  head: { appendChild: (element) => { styleTags.push(element) } },
}

/** 载入产物并返回它的插件对象。 */
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

console.log('--- B① bundle 注册 / 插件声明 ---')
const plugin = loadPlugin()
check('模块 id', plugin.name, 'dsh-subagent-parent-nav')
check('插件名', plugin.name, 'dsh-subagent-parent-nav')
check('inject 声明', plugin.inject, ['slots', 'locale', 'uiWorkspace'])

console.log('--- B② apply：字典、样式、分区注册与跳转动作 ---')
const registrations = []
const injections = []
const localeRegistrations = []
const opened = []
const effects = []
const slots = {
  inject: (slot, callback) => {
    injections.push(slot)
    return callback()
  },
  register: (options, component) => {
    registrations.push({ options, component })
    return () => {}
  },
}
const locale = {
  register: (namespace, dictionaries) => {
    localeRegistrations.push({ namespace, dictionaries })
    return () => {}
  },
  bind: (namespace) => (key, params) => {
    if (namespace !== 'dsh-subagent-parent-nav') throw new Error(`意外的命名空间:${namespace}`)
    return params === undefined ? key : `${key}:${JSON.stringify(params)}`
  },
}
const ctx = {
  slots,
  locale,
  uiWorkspace: { openSession: (sessionId) => { opened.push(sessionId) } },
  effect: (callback) => { effects.push(callback()) },
}

globalThis.document = documentStub
try {
  plugin.apply(ctx)
} finally {
  delete globalThis.document
}

check('字典命名空间', localeRegistrations[0]?.namespace, 'dsh-subagent-parent-nav')
check('字典语言', Object.keys(localeRegistrations[0]?.dictionaries ?? {}), ['zh', 'en'])
check('中文分区标题', localeRegistrations[0]?.dictionaries?.zh?.['section.title'], '主智能体')
check('英文分区标题', localeRegistrations[0]?.dictionaries?.en?.['section.title'], 'Main agent')
check('英文角色标签按层级措辞', localeRegistrations[0]?.dictionaries?.en?.['row.parent'], 'Ancestor agent')
check('样式注入一次', styleTags.length, 1)
check('样式标记', styleTags[0]?.dataset?.pluginCss, 'dsh-subagent-parent-nav/section.css')
check('等待会话面板分区槽', injections, ['conversation.session.panel.section'])
check('只注册一项', registrations.length, 1)
const registration = registrations[0]
check('注册 name', registration?.options?.name, 'conversation.session.panel.section')
check('注册 id', registration?.options?.id, 'subagent-parent')
check('注册 order：在子智能体(200)之前', registration?.options?.order, 190)
check('注册 locale', registration?.options?.locale, 'dsh-subagent-parent-nav')
check('标题按语言现取', registration?.options?.label?.(), 'section.title')
const face = registration?.options?.inject?.('ignored-session')
check('注入面 open', typeof face?.open, 'function')
check('跳转成功回报 true', face?.open('root'), true)
check('跳转落到主视图导航', opened, ['root'])

console.log('--- B③ 跳转失败：告警而不抛 ---')
{
  const failingPlugin = loadPlugin()
  const failingCtx = {
    ...ctx,
    uiWorkspace: { openSession: () => { throw new Error('session is not retained') } },
  }
  const warnings = captureWarnings(() => {
    const failingSlots = {
      inject: (slot, callback) => callback(),
      register: (options) => { failingSlots.options = options },
    }
    failingPlugin.apply({ ...failingCtx, slots: failingSlots })
    failingSlots.options.inject().open('missing')
  })
  checkTrue('失败有告警', warnings.some(line => line.includes('session is not retained')))
}

console.log('--- B④ 组件渲染：根会话 / 一级 / 多级 ---')
const component = registration?.component
const zh = localeRegistrations[0]?.dictionaries?.zh ?? {}

/** 按标准 props 的座位造组件 props。 */
function props(overrides = {}) {
  const state = overrides.state ?? { ids: [], byId: {}, projectionsBySession: {} }
  let dismissals = 0
  const tree = component({
    sessionId: 'grandchild',
    presentation: 'docked',
    dismissOverlay: () => { dismissals += 1 },
    renderFactorySlot: () => null,
    useSession: (selector) => selector(overrides.snapshot ?? { subagent: null }),
    useSessions: (selector) => selector(state),
    open: (sessionId) => { opened.push(sessionId); return true },
    t: (key, params) => (params === undefined ? key : `${key}:${JSON.stringify(params)}`),
    ...overrides.props,
  })
  return { tree, dismissals: () => dismissals }
}

const summaries = {
  root: { id: 'root', displayTitle: '主会话', running: true, origin: 'root' },
  child: { id: 'child', displayTitle: '一级子智能体', running: false, origin: 'subagent', parentId: 'root' },
  grandchild: { id: 'grandchild', displayTitle: '二级子智能体', running: false, origin: 'subagent', parentId: 'child' },
}
const state = { ids: ['root', 'child', 'grandchild'], byId: summaries, projectionsBySession: {} }
const address = { parentSessionId: 'child', childSessionId: 'grandchild', mode: 'continuable' }

const multi = props({ state, snapshot: { subagent: { address } } })
check('多级：根节点是列表', multi.tree?.type, 'ul')
check('多级：显式列表语义', multi.tree?.props?.role, 'list')
check('多级：带插件标记', multi.tree?.props?.['data-subagent-parent-nav'], '')
check('多级：两行', multi.tree?.children?.length, 2)
const rootItem = multi.tree?.children?.[0]
const childItem = multi.tree?.children?.[1]
check('链首列表项', rootItem?.type, 'li')
const rootButton = rootItem?.children?.[0]
check('链首按钮', rootButton?.type, 'button')
check('链首读屏名称带运行中', rootButton?.props?.['aria-label'], 'row.jumpRunning:{"title":"主会话"}')
check('链首原生 title 兜底看全名', rootButton?.props?.title, '主会话')
checkTrue('链首标出运行状态', 'data-running' in (rootButton?.props ?? {}))
check('链首标题', rootButton?.children?.[1]?.children?.[0], '主会话')
check('链首没有角色标签', rootButton?.children?.[2], null)
const childButton = childItem?.children?.[0]
check('直接上级读屏名称', childButton?.props?.['aria-label'], 'row.jump:{"title":"一级子智能体"}')
checkTrue('直接上级无运行标记', !('data-running' in (childButton?.props ?? {})))
check('直接上级带角色标签', childButton?.children?.[2]?.children?.[0], 'row.parent')
check('行尾箭头在最后', childButton?.children?.[3]?.props?.className, 'dsh-subagent-parent-nav__arrow')

rootButton?.props?.onClick?.()
check('点一行切到该会话', opened.at(-1), 'root')
check('点一行收起浮层', multi.dismissals(), 1)

const failedJump = props({ state, snapshot: { subagent: { address } }, props: { open: () => false } })
failedJump.tree?.children?.[0]?.children?.[0]?.props?.onClick?.()
check('跳转失败不收起浮层', failedJump.dismissals(), 0)

const single = props({
  state: { ids: ['root', 'child'], byId: { ...summaries }, projectionsBySession: {} },
  snapshot: { subagent: { address: { parentSessionId: 'root', childSessionId: 'grandchild', mode: 'continuable' } } },
})
check('一级：一行', single.tree?.children?.length, 1)
check('一级：不显示角色标签', single.tree?.children?.[0]?.children?.[0]?.children?.[2], null)

const rootSession = props({ state: { ids: ['root'], byId: { root: summaries.root }, projectionsBySession: {} } })
check('根会话整节不渲染', rootSession.tree, null)

console.log('--- B⑤ 列表缺行 / 目录投影兜底 ---')
const orphan = props({
  state: { ids: ['grandchild'], byId: { grandchild: summaries.grandchild }, projectionsBySession: {} },
  snapshot: { subagent: { address } },
})
check('列表缺父行仍列出', orphan.tree?.children?.length, 1)
check('标题退回 id', orphan.tree?.children?.[0]?.children?.[0]?.children?.[1]?.children?.[0], 'child')

const fromProjection = props({
  state: {
    ids: ['grandchild'],
    byId: {
      grandchild: summaries.grandchild,
      catalogParent: { id: 'catalogParent', displayTitle: '目录父会话', running: false, origin: 'root' },
    },
    projectionsBySession: { catalogParent: { state: 'ready', error: null, values: { subagentCatalog: [{ id: 'child' }] } } },
  },
  snapshot: { subagent: null },
})
check('目录投影认出父会话', fromProjection.tree?.children?.[0]?.children?.[0]?.children?.[1]?.children?.[0], '目录父会话')

check('中文标题文案存在', typeof zh['row.parent'], 'string')

finish()
