/**
 * 产物装配：把 `lib/client.js` 当成浏览器里的独立 bundle 加载，验证模块 id / 插件名 /
 * inject 声明、样式注入、行槽注册，以及守卫在子会话（两条依据）/ 普通会话 / 残留地址
 * 三种输入下的渲染——**只隐藏，不渲染任何可见内容**。
 *
 * 运行：`node test/artifact-client.test.mjs`（或 pnpm test 跑全部）。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { check, checkTrue, finish, pluginRoot } from './helpers.mjs'

const reactStub = {
  createElement(type, props, ...children) {
    return { type, props: props ?? {}, children: children.flat() }
  },
  Fragment: Symbol.for('react.fragment'),
  useRef(initial) {
    return { current: initial }
  },
  useEffect(fn) {
    reactStub.effectList.push(fn)
  },
  /** 上一次渲染注册的 effect；`props()` 每次渲染前清空。 */
  effectList: [],
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
    if (id === 'react/jsx-runtime' || id === 'react/jsx-dev-runtime') return jsxRuntimeStub
    throw new Error(`产物要求了未声明的外部模块:${id}`)
  })
}

console.log('--- B① bundle 注册 / 插件声明 ---')
const plugin = loadPlugin()
check('模块 id', plugin.name, 'dsh-subagent-forge-panel')
check('插件名', plugin.name, 'dsh-subagent-forge-panel')
check('inject 声明', plugin.inject, ['slots', 'forgeChanges'])

console.log('--- B② apply：样式与行槽注册 ---')
const registrations = []
const injections = []
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
  effect: (callback, label) => { effects.push({ label, cleanup: callback() }) },
}

globalThis.document = documentStub
try {
  plugin.apply(ctx)
} finally {
  delete globalThis.document
}

check('样式注入一次', styleTags.length, 1)
check('样式标记', styleTags[0]?.dataset?.pluginCss, 'dsh-subagent-forge-panel/panel.css')
checkTrue('样式隐藏 forge 连接行', styleTags[0]?.textContent?.includes('[data-forge-connection]') === true)
checkTrue('样式带分区标记前缀', styleTags[0]?.textContent?.includes('[data-session-panel-section][data-dsh-subagent-forge-panel]') === true)
checkTrue('样式只隐藏不重排', styleTags[0]?.textContent?.includes('display: none') === true)
check('等待「环境」行槽', injections, ['conversation.session.panel.environment.row'])
check('只注册一项', registrations.length, 1)
const registration = registrations[0]
check('注册 name', registration?.options?.name, 'conversation.session.panel.environment.row')
check('注册 id', registration?.options?.id, 'forge-subagent-guard')
check('注册 order：紧跟 forge 连接行(40)', registration?.options?.order, 41)
check('不声明 locale 座位（没有可见文案）', registration?.options?.locale, undefined)

console.log('--- B③ 守卫渲染：子会话 / 普通会话 / 残留地址 ---')
const component = registration?.component

/** 按行槽的标准 props 造组件 props，并取出这次渲染注册的 effect。 */
function props({ sessionId, address = null, origin }) {
  reactStub.effectList = []
  const tree = component({
    sessionId,
    presentation: 'docked',
    dismissOverlay: () => {},
    useSession: (selector) => selector({ subagent: address === null ? null : { address } }),
    useSessions: (selector) => selector({ ids: [], byId: origin === undefined ? {} : { [sessionId]: { origin } } }),
  })
  return { tree, effects: [...reactStub.effectList] }
}

const childAddress = { parentSessionId: 'root', childSessionId: 'child', mode: 'continuable' }
const fromAddress = props({ sessionId: 'child', address: childAddress })
check('子会话：只渲染一个标记元素', fromAddress.tree?.type, 'span')
check('子会话：标记元素不可见', fromAddress.tree?.props?.hidden, true)
check('子会话：标记元素对读屏隐藏', fromAddress.tree?.props?.['aria-hidden'], 'true')
check('子会话：带守卫标记', fromAddress.tree?.props?.['data-forge-subagent-guard'], '')
check('子会话：不带面板行锚点（不占一行）', fromAddress.tree?.props?.['data-session-panel-row'], undefined)
check('子会话：无子节点（不渲染任何文字）', fromAddress.tree?.children, [])
check('子会话：一行一个 effect', fromAddress.effects.length, 1)
check('effect 返回卸载函数', typeof fromAddress.effects[0](), 'function')

const fromSummary = props({ sessionId: 'child', origin: 'subagent' })
checkTrue('只有列表行依据也隐藏', fromSummary.tree?.props?.['data-forge-subagent-guard'] === '')

check('根会话不渲染', props({ sessionId: 'root', origin: undefined }).tree, null)
check('没有任何依据不渲染', props({ sessionId: 'root' }).tree, null)
check('残留地址属于别的会话时不渲染', props({
  sessionId: 'root',
  address: { parentSessionId: 'root', childSessionId: 'another-child', mode: 'continuable' },
  origin: undefined,
}).tree, null)

finish()
