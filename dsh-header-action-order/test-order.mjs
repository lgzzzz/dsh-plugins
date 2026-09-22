/**
 * 诊断脚本(非插件产物):纯 Node,无浏览器。三部分:
 *   A. src/order.ts —— planOrderWrites 的纯计划分支(重排 / 幂等 / 未列出项 / 无 id / 重复表项);
 *   B. src/order.ts + src/client.ts —— 以类方法形态的 slots 桩驱动 apply,校验渲染序、后到注册重放、
 *      冻结写入单条放弃、entries 抛错不炸;
 *   C. 构建产物 lib/client.js —— 以 window.__ModuleLoader__ 桩载入,校验包名 / inject 声明 / 无外部依赖,
 *      并走一遍「槽声明 → 装配 → 后到图标 → 顺序仍正确」。
 * 桩里的 slots 方法都读 this(仓库约定):插件若把方法摘下来调用会抛错,本脚本能测出来。
 * 用法:node test-order.mjs(需先 npm run build)
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  HEADER_ACTION_ORDER,
  HEADER_ACTION_SLOT,
  UNLISTED_ORDER_BASE,
  applyHeaderActionOrder,
  planOrderWrites,
} from './src/order.ts'
import { apply as applyPlugin } from './src/client.ts'

const here = dirname(fileURLToPath(import.meta.url))

let failures = 0
/** 断言并按仓库脚本惯例记账。 */
function check(label, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  const ok = a === e
  if (!ok) failures += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : ` — 期望 ${e},实得 ${a}`}`)
}

/** 断言布尔条件(用于含对象引用的判定)。 */
function checkTrue(label, actual) {
  const ok = actual === true
  if (!ok) failures += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : ` — 期望 true,实得 ${JSON.stringify(actual)}`}`)
}

/** 一条注册项(与上游 ledger 同形:可写 options)。 */
function entry(id, order) {
  return { options: { id, order } }
}

/** 上游 0.1.7-alpha.1 的实际注册项(order 值以源码为准)。 */
function upstreamEntries() {
  return [
    entry('agent-preset', -10),
    entry('schedule-catalog', 10),
    entry('job-list', 20),
    entry('agent-team', 20),
    entry('subagent-catalog', 30),
  ]
}

/** 目标序(与 HEADER_ACTION_ORDER 一致):schedule / job-list 挪到最后。 */
const EXPECTED = ['agent-preset', 'agent-team', 'subagent-catalog', 'schedule-catalog', 'job-list']

/** 上游渲染端语义:每帧按活注册项的 options.order 升序(稳定排序)取 id。 */
function renderedOrder(entries) {
  return [...entries]
    .sort((a, b) => (a.options?.order ?? 0) - (b.options?.order ?? 0))
    .map((e) => e.options?.id)
}

/**
 * slots 服务的类方法桩:
 * - entries / inject / subscribe 都读 this(摘引用调用会抛错);
 * - register 模拟上游注册 + 微任务批通知(这里同步通知,顺序等价);
 * - renderedOrder() 复刻渲染端排序。
 */
class FakeSlots {
  constructor(entries) {
    this.list = entries
    this.listeners = new Set()
    this.injected = []
    this.entriesThrows = false
  }
  entries(key) {
    if (this.entriesThrows) throw new Error('entries boom')
    if (key !== HEADER_ACTION_SLOT) return []
    return this.list
  }
  inject(key, callback) {
    this.injected.push(key)
    this.dispose = callback()
    return () => {}
  }
  subscribe(key, listener) {
    if (key !== HEADER_ACTION_SLOT) return () => {}
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  register(next) {
    this.list = [...this.list, next]
    for (const listener of [...this.listeners]) listener()
  }
  renderedOrder() {
    return renderedOrder(this.list)
  }
  listenerCount() {
    return this.listeners.size
  }
}

// ---- A. 纯计划 -------------------------------------------------------------

console.log('--- A① 上游序 → 目标序:schedule / job-list 挪到最后 ---')
{
  const entries = upstreamEntries()
  const writes = planOrderWrites(entries)
  check('待写条数', writes.length, 5)
  check('上游初始渲染序', renderedOrder(entries), [
    'agent-preset',
    'schedule-catalog',
    'job-list',
    'agent-team',
    'subagent-catalog',
  ])
  for (const write of writes) write.target.order = write.order
  check('写入后渲染序', renderedOrder(entries), EXPECTED)
}

console.log('--- A② 幂等:同一批注册项重复计划不产生写入 ---')
{
  const entries = upstreamEntries()
  for (const write of planOrderWrites(entries)) write.target.order = write.order
  check('第二次计划为空', planOrderWrites(entries), [])
  check('渲染序不变', renderedOrder(entries), EXPECTED)
}

console.log('--- A③ 未列出的 id:排在表内项之后,相对先后保持 ---')
{
  const entries = [...upstreamEntries(), entry('desktop-notify', 120), entry('zzz-new-icon', 5)]
  for (const write of planOrderWrites(entries)) write.target.order = write.order
  check('表内项按数组下标', entries.slice(0, 5).map((e) => [e.options.id, e.options.order]), [
    ['agent-preset', 0],
    ['schedule-catalog', 3],
    ['job-list', 4],
    ['agent-team', 1],
    ['subagent-catalog', 2],
  ])
  check('未列出项落在基址段且按原 order 排名', [entries[5].options.order, entries[6].options.order], [
    UNLISTED_ORDER_BASE + 1,
    UNLISTED_ORDER_BASE,
  ])
  check('整体渲染序', renderedOrder(entries), [...EXPECTED, 'zzz-new-icon', 'desktop-notify'])
}

console.log('--- A④ 无 id / 已正确 / 重复表项 ---')
{
  const anonymous = { options: { order: 7 } }
  const entries = [...upstreamEntries(), anonymous]
  const writes = planOrderWrites(entries)
  check('无 id 项也纳入计划', writes.some((w) => w.id === '(no id)'), true)
  for (const write of writes) write.target.order = write.order
  check('无 id 项排在未列出段', anonymous.options.order, UNLISTED_ORDER_BASE)
  checkTrue('无 id 项渲染在末尾', renderedOrder(entries).indexOf(undefined) === entries.length - 1)

  const already = [
    entry('agent-preset', 0),
    entry('agent-team', 1),
    entry('subagent-catalog', 2),
    entry('schedule-catalog', 3),
    entry('job-list', 4),
  ]
  check('已正确 → 无写入', planOrderWrites(already), [])

  const dup = planOrderWrites([entry('a', 9), entry('b', 9)], ['b', 'a', 'b'])
  check('重复表项取首个下标', dup.map((w) => [w.id, w.order]), [
    ['a', 1],
    ['b', 0],
  ])
}

// ---- B. 服务面装配(直载 src,不经产物) ------------------------------------

console.log('--- B① slots.inject 后立刻重排,渲染序为目标序 ---')
{
  const slots = new FakeSlots(upstreamEntries())
  applyPlugin({ get: (name) => (name === 'slots' ? slots : undefined) })
  check('注入的槽', slots.injected, [HEADER_ACTION_SLOT])
  check('渲染序', slots.renderedOrder(), EXPECTED)
  check('已登记注册变化订阅', slots.listenerCount(), 1)
}

console.log('--- B② 后到的注册(独立 bundle 的图标)被重放带进正确的位 ---')
{
  const slots = new FakeSlots(upstreamEntries())
  applyPlugin({ get: (name) => (name === 'slots' ? slots : undefined) })
  slots.register(entry('desktop-notify', 120))
  check('后到图标排最后', slots.renderedOrder(), [...EXPECTED, 'desktop-notify'])
  slots.register(entry('agent-team-late', 20))
  // 未列出项之间按各自原始 order 排名(20 < 120),所以后到的这个排在 desktop-notify 之前
  check('后到图标按原 order 落在未列出段', slots.renderedOrder(), [
    ...EXPECTED,
    'agent-team-late',
    'desktop-notify',
  ])
}

console.log('--- B③ 冻结的 options:只放弃那一条,其余照写 ---')
{
  const frozen = { options: Object.freeze({ id: 'agent-preset', order: -10 }) }
  const slots = new FakeSlots([frozen, entry('job-list', 20), entry('agent-team', 20)])
  const warnings = []
  const originalWarn = console.warn
  console.warn = (...args) => warnings.push(args[0])
  let written
  try {
    written = applyHeaderActionOrder(slots)
  } finally {
    console.warn = originalWarn
  }
  check('只写了能写的', written, 2)
  check('冻结项保持原序', frozen.options.order, -10)
  check('渲染序(冻结项仍在最前)', slots.renderedOrder(), ['agent-preset', 'agent-team', 'job-list'])
  check('记了一条 warn', warnings.length, 1)
}

console.log('--- B④ 服务缺席 / entries 抛错:no-op,不抛 ---')
{
  applyPlugin({})
  applyPlugin({ get: () => undefined })
  const throwing = new FakeSlots(upstreamEntries())
  throwing.entriesThrows = true
  let threw = null
  const warnings = []
  const originalWarn = console.warn
  console.warn = (...args) => warnings.push(args[0])
  try {
    applyPlugin({ get: (name) => (name === 'slots' ? throwing : undefined) })
  } catch (error) {
    threw = error
  } finally {
    console.warn = originalWarn
  }
  check('entries 抛错不冒泡', threw, null)
  check('entries 抛错记了 warn', warnings.length, 1)
  check('注册变化订阅仍已登记', throwing.listenerCount(), 1)
}

// ---- C. 构建产物装配 -------------------------------------------------------

console.log('--- C① lib/client.js 注册与声明 ---')
{
  let registration = null
  globalThis.window = {
    __ModuleLoader__: {
      load: (reg) => {
        registration = reg
      },
    },
  }
  try {
    // eslint-disable-next-line no-eval
    ;(0, eval)(readFileSync(join(here, 'lib', 'client.js'), 'utf8'))
  } finally {
    delete globalThis.window
  }
  checkTrue('registration 非空', registration !== null)
  check('模块 id', registration?.id, 'dsh-header-action-order')
  const plugin = registration.factory(() => {
    throw new Error('产物要求了外部模块:本插件不应有任何 external')
  })
  check('插件名', plugin.name, 'dsh-header-action-order')
  check('inject 声明', plugin.inject, ['slots'])

  const slots = new FakeSlots(upstreamEntries())
  plugin.apply({ get: (name) => (name === 'slots' ? slots : undefined) })
  check('产物装配后渲染序', slots.renderedOrder(), EXPECTED)
  slots.register(entry('desktop-notify', 120))
  check('产物装配后后到图标也归位', slots.renderedOrder(), [...EXPECTED, 'desktop-notify'])
}

console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`)
process.exitCode = failures === 0 ? 0 : 1
