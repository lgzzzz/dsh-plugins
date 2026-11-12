/**
 * 产物装配：把 `lib/client.js` 当成浏览器里的独立 bundle 加载，验证模块 id / 插件名 /
 * inject 声明、字典与样式注入、hero 槽注册，以及组件在根/子代理/投影缺席时的渲染。
 *
 * 运行：`node test/artifact-client.test.mjs`（或 pnpm test 跑全部）。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { check, checkTrue, finish, pluginRoot, settle } from './helpers.mjs'

const reactStub = {
  createElement(type, props, ...children) {
    return { type, props: props ?? {}, children: children.flat() }
  },
  useState(initial) {
    return [typeof initial === 'function' ? initial() : initial, () => {}]
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
check('模块 id', plugin.name, 'dsh-agent-team-hero-toggle')
check('插件名', plugin.name, 'dsh-agent-team-hero-toggle')
check('inject 声明', plugin.inject, ['slots', 'locale'])

console.log('--- B② apply：字典、样式、hero 注册与远程绑定 ---')
const registrations = []
const injections = []
const injectedDeps = []
const localeRegistrations = []
const effects = []
const remoteCalls = []
const remoteResult = { ok: true, value: undefined }
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
}
const remote = {
  agentTeams: {
    setEnabled: (sessionId, enabled) => {
      remoteCalls.push([sessionId, enabled])
      return Promise.resolve(remoteResult)
    },
  },
}
const ctx = {
  get: (name) => (name === 'slots' ? slots : name === 'locale' ? locale : undefined),
  effect: (callback) => { effects.push(callback()) },
  inject: (deps, callback) => {
    injectedDeps.push(deps)
    callback({ get: (name) => (name === 'remote' ? remote : name === 'slots' ? slots : undefined) })
  },
}

globalThis.document = documentStub
try {
  plugin.apply(ctx)
} finally {
  delete globalThis.document
}

check('字典命名空间', localeRegistrations[0]?.namespace, 'dsh-agent-team-hero-toggle')
check('字典语言', Object.keys(localeRegistrations[0]?.dictionaries ?? {}), ['zh', 'en'])
check('字典有 label', typeof localeRegistrations[0]?.dictionaries?.zh?.label, 'string')
check('样式注入一次', styleTags.length, 1)
check('样式标记', styleTags[0]?.dataset?.pluginCss, 'dsh-agent-team-hero-toggle/hero-toggle.css')
check('等待远程链路', injectedDeps, [['remote', 'remote.agentTeams']])
check('注入 hero 槽', injections, ['conversation.hero.options'])
check('只注册一项（A2 不遮蔽菜单旧行）', registrations.length, 1)
const registration = registrations[0]
check('注册 name', registration?.options?.name, 'conversation.hero.options')
check('注册 id', registration?.options?.id, 'agent-team.hero')
check('注册 order', registration?.options?.order, 10)
check('注册 locale', registration?.options?.locale, 'dsh-agent-team-hero-toggle')
const face = registration?.options?.inject('session-1')
check('注入面 setEnabled', typeof face?.setEnabled, 'function')
await face?.setEnabled(true)
check('写入落到当前会话', remoteCalls, [['session-1', true]])

console.log('--- B③ 组件渲染：根会话 / 子代理 / 投影缺席 ---')
const component = registration?.component
function props(overrides = {}) {
  return {
    sessionId: 'session-1',
    useSession: (selector) => selector({ subagent: null }),
    useSessions: (selector) => selector({ byId: { 'session-1': { origin: 'root' } } }),
    useProjection: (key) => (key === 'agentTeam' ? { enabled: true } : undefined),
    setEnabled: async () => ({ ok: true, value: undefined }),
    t: (key, params) => (params === undefined ? key : `${key}:${JSON.stringify(params)}`),
    ...overrides,
  }
}

const root = component(props())
check('根节点是 button', root?.type, 'button')
check('role=switch', root?.props?.role, 'switch')
check('aria-checked 跟随投影', root?.props?.['aria-checked'], true)
check('可访问名称用全称', root?.props?.['aria-label'], 'ariaLabel')
check('title 用说明', root?.props?.title, 'description')
check('默认无错误标记', root?.props?.['data-error'], undefined)
check('可见标签是短文案', root?.children?.[1]?.children?.[0], 'label')
check('轨道结构', root?.children?.[0]?.type, 'span')

const off = component(props({ useProjection: () => ({ enabled: false }) }))
check('关闭态 aria-checked', off?.props?.['aria-checked'], false)

check('血缘子代理隐藏', component(props({ useSession: (selector) => selector({ subagent: {} }) })), null)
check('目录子代理隐藏', component(props({
  useSessions: (selector) => selector({ byId: { 'session-1': { origin: 'subagent' } } }),
})), null)
check('投影缺席隐藏', component(props({ useProjection: () => undefined })), null)

console.log('--- B④ 写入失败：告警 ---')
{
  const warnings = []
  const original = console.warn
  const tree = component(props({
    setEnabled: async () => ({ ok: false, error: { message: 'flush failed' } }),
  }))
  console.warn = (...args) => warnings.push(args.map(String).join(' '))
  try {
    tree.props.onClick()
    await settle()
  } finally {
    console.warn = original
  }
  checkTrue('失败有告警', warnings.some(line => line.includes('flush failed')))
}

finish()
