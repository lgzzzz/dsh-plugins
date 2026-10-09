/**
 * 产物装配：`lib/client.js` 作为独立 bundle 注册正确的模块 id / 插件名，装配后按账本遮蔽
 * job-list 条目并透传源项契约，包装层渲染出无盒锚点包住源组件，源项消失时撤回遮蔽，
 * 并在卸载时摘掉订阅与注册。
 *
 * 运行：`node test/artifact-client.test.mjs`（或 pnpm test 跑全部）。
 */
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  FakeSlots,
  EXPANDED_ATTRIBUTE,
  HOVER_CLOSE_DELAY_MS,
  HOVER_OPEN_DELAY_MS,
  JOB_LIST_ID,
  JOB_LIST_SLOT,
  TRIGGER_SELECTOR,
  check,
  checkSame,
  checkTrue,
  finish,
  loadClientArtifact,
  platformRequire,
  pluginRoot,
} from './helpers.mjs'

const require = createRequire(import.meta.url)
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')

/** 载入产物并实例化插件，同时记账产物请求了哪些外部模块。 */
function loadPlugin() {
  const registration = loadClientArtifact()
  const requires = []
  const plugin = registration.factory((specifier) => {
    requires.push(specifier)
    return platformRequire(specifier)
  })
  return { registration, plugin, requires }
}

/** 源组件的替身：渲染出一个可断言的标记。 */
function StubInner(props) {
  return React.createElement('span', null, `inner:${String(props.sessionId)}`)
}

/** 上游 job-list 条目的替身（业务面注入工厂与包装层的透传都是断言对象）。 */
function sourceEntry(injectFace) {
  return {
    component: StubInner,
    options: { id: JOB_LIST_ID, order: 20, label: 'Jobs' },
    locale: 'job',
    inject: injectFace,
  }
}

console.log('--- A① lib/client.js 注册与声明 ---')
{
  const { registration, plugin, requires } = loadPlugin()
  checkTrue('registration 非空', registration !== null)
  check('模块 id', registration?.id, 'dsh-jobs-optimize')
  check('插件名', plugin.name, 'dsh-jobs-optimize')
  checkTrue('apply 为函数', typeof plugin.apply === 'function')
  check('声明的服务', plugin.inject, ['slots'])
  checkTrue('导出包装层工厂', typeof plugin.withHoverOpen === 'function')
  check('自检窗口约 1 秒', plugin.MISSING_PROBE_MS * plugin.MISSING_PROBE_ATTEMPTS, 1000)
  check('产物唯一的外部模块（平台模块表提供）', requires, ['react'])
}

console.log('--- A② 遮蔽注册与契约透传 ---')
{
  const { plugin } = loadPlugin()
  const slots = new FakeSlots()
  const injectFace = () => ({ hooks: { jobs: 'face' } })
  const source = sourceEntry(injectFace)
  slots.setEntries(JOB_LIST_SLOT, [source])

  plugin.apply({ get: (name) => (name === 'slots' ? slots : undefined) })
  check('等待槽位声明', slots.injections.length, 1)
  check('声明的槽键', slots.injections[0].key, JOB_LIST_SLOT)
  check('声明落地前不注册', slots.registrations.length, 0)

  const undeclare = slots.declare()
  check('声明落地后注册遮蔽项', slots.registrations.length, 1)

  const options = slots.registrations[0].options
  check('注册 id 与源项相同（遮蔽的前提）', options.id, JOB_LIST_ID)
  check('priority 低于源项', options.priority, -1)
  check('order 原样透传', options.order, 20)
  check('label 原样透传', options.label, 'Jobs')
  check('locale 原样透传', options.locale, 'job')
  checkSame('inject 面透传（业务 prop 的唯一来源）', options.inject, injectFace)
  checkSame('源项本身未被改写', slots.entries(JOB_LIST_SLOT)[0], source)

  const wrapped = slots.registrations[0].component
  const ours = slots.entries(JOB_LIST_SLOT).find((entry) => entry.component === wrapped)
  slots.setEntries(JOB_LIST_SLOT, [source, ours])
  check('账本再变化但源项未变时不重复注册', slots.registrations.length, 1)

  // 上游重挂载：源项换成新对象。FakeSlots 在 register 与撤销里同步通知订阅者，因此这一步
  // 同时覆盖「对账还没结束就又被回调」的路径。
  const remounted = sourceEntry(injectFace)
  slots.setEntries(JOB_LIST_SLOT, [remounted, ours])
  check('源项换对象后重建', slots.registrations.length, 2)
  check('重建后账本里同 id 仍是两项', slots.entries(JOB_LIST_SLOT).filter((entry) => entry.options?.id === JOB_LIST_ID).length, 2)
  check('重建后的 priority 仍是源项减一（嵌套对账没有再加一层包装）', slots.registrations[1].options.priority, -1)

  const rebuilt = slots.registrations[1].component
  const issued = slots.entries(JOB_LIST_SLOT).find((entry) => entry.component === rebuilt)
  slots.setEntries(JOB_LIST_SLOT, [issued])
  check('源项消失后撤回遮蔽项', slots.entries(JOB_LIST_SLOT).length, 0)

  // 撤回之后账本还会再变（subscribe 的冲刷是微任务，晚于这次撤销）：此刻源项缺席，
  // 但自检不该再启动——它只报「从来没找到过」。
  const probeStarts = []
  const realSetTimeout = globalThis.setTimeout
  globalThis.setTimeout = (fn, ms) => {
    probeStarts.push(ms)
    return realSetTimeout(fn, ms)
  }
  try {
    slots.notify(JOB_LIST_SLOT)
  } finally {
    globalThis.setTimeout = realSetTimeout
  }
  check('接管成功过之后不再启动自检', probeStarts.includes(plugin.MISSING_PROBE_MS), false)

  check('撤回是幂等的', (() => {
    try {
      undeclare()
      return true
    } catch {
      return false
    }
  })(), true)
}

console.log('--- A③ 包装层渲染 ---')
{
  const { plugin } = loadPlugin()
  const slots = new FakeSlots()
  slots.setEntries(JOB_LIST_SLOT, [sourceEntry(() => ({}))])
  plugin.apply({ get: (name) => (name === 'slots' ? slots : undefined) })
  slots.declare()

  const markup = renderToStaticMarkup(React.createElement(slots.registrations[0].component, { sessionId: 's1' }))
  checkTrue('包装层是无盒锚点', markup.includes('display:contents'))
  checkTrue('源组件在锚点内照常渲染', markup.includes('inner:s1'))
}

console.log('--- A④ 服务的形状守卫 ---')
{
  const { plugin } = loadPlugin()
  let applied = true
  try {
    plugin.apply({ get: () => undefined })
    plugin.apply({ get: () => ({}) })
    plugin.apply({ get: () => ({ entries: () => [] }) })
  } catch {
    applied = false
  }
  checkTrue('slots 服务缺席或形状不符时不抛错', applied)
}

console.log('--- A⑤ 产物里的稳定契约 ---')
{
  const text = readFileSync(join(pluginRoot, 'lib', 'client.js'), 'utf8')
  checkTrue('产物含槽键', text.includes(JOB_LIST_SLOT))
  checkTrue('产物含注册 id', text.includes(JOB_LIST_ID))
  checkTrue('产物含触发器选择器', text.includes(TRIGGER_SELECTOR))
  checkTrue('产物含开合属性名', text.includes(EXPANDED_ATTRIBUTE))
  checkTrue('产物含无盒锚点', text.includes('display: contents') || text.includes('display:contents'))
  checkTrue('产物含悬停延迟', text.includes(String(HOVER_OPEN_DELAY_MS)) && text.includes(String(HOVER_CLOSE_DELAY_MS)))
}

console.log('--- A⑥ 源项始终缺席时的自检窗口 ---')
{
  const { plugin } = loadPlugin()
  const slots = new FakeSlots()
  slots.setEntries(JOB_LIST_SLOT, [])
  plugin.apply({ get: (name) => (name === 'slots' ? slots : undefined) })

  const probeStarts = []
  const realSetTimeout = globalThis.setTimeout
  const realWarn = console.warn
  globalThis.setTimeout = (fn, ms) => {
    probeStarts.push(ms)
    return realSetTimeout(fn, ms)
  }
  let undeclare
  try {
    undeclare = slots.declare()
  } finally {
    globalThis.setTimeout = realSetTimeout
  }
  check('源项缺席时启动自检窗口', probeStarts.includes(plugin.MISSING_PROBE_MS), true)
  check('声明落地时没有注册任何条目', slots.registrations.length, 0)

  // 卸载后自检窗口不再推进，也不再告警：待触发的那一拍会自行返回。
  const warnings = []
  console.warn = (...args) => {
    warnings.push(args.join(' '))
  }
  try {
    undeclare()
    await new Promise((resolve) => realSetTimeout(resolve, plugin.MISSING_PROBE_MS * 3))
  } finally {
    console.warn = realWarn
  }
  check('卸载后不再告警', warnings, [])
}

finish()
