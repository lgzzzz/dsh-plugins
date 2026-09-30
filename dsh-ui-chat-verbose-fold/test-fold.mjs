import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  CHAT_VIEW_ID,
  CHAT_VIEW_SLOT,
  createFoldPatchState,
  findChatViewEntry,
  foldCompletedForVerbose,
  patchChatView,
  presentationOf,
  wrapPresentationSource,
} from './src/policy-fold.ts'
import { apply as applyPlugin } from './src/client.ts'

const here = dirname(fileURLToPath(import.meta.url))

let failures = 0
function check(label, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  const ok = a === e
  if (!ok) failures += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : ` — 期望 ${e},实得 ${a}`}`)
}

function checkTrue(label, actual) {
  const ok = actual === true
  if (!ok) failures += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : ` — 期望 true,实得 ${JSON.stringify(actual)}`}`)
}

/** Fresh policy objects per mode, mirroring upstream's table (verbose starts open). */
function policyFor(mode) {
  const table = {
    compact: { mode: 'compact', foldCompletedTurns: false, stepGrouping: 'collapsed' },
    standard: { mode: 'standard', foldCompletedTurns: true, stepGrouping: 'collapsed' },
    detailed: { mode: 'detailed', foldCompletedTurns: true, stepGrouping: 'history' },
    verbose: { mode: 'verbose', foldCompletedTurns: false, stepGrouping: 'none' },
  }
  return { ...table[mode] }
}

/** A live presentation source whose mode can be flipped between reads. */
function makeSource(initialMode) {
  let mode = initialMode
  const listeners = new Set()
  const source = {
    getSnapshot() {
      return policyFor(mode)
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
  return {
    source,
    listeners,
    setMode(next) {
      mode = next
    },
  }
}

/** One ui-chat-shaped view entry carrying the given presentation source. */
function chatEntry(source) {
  return {
    options: { id: CHAT_VIEW_ID },
    inject: () => ({ hooks: { presentation: source }, openFile: () => {} }),
  }
}

/** Minimal slots registry: no declaration wait, entries + change fan-out. */
class FakeSlots {
  constructor(entries) {
    this.list = entries
    this.listeners = new Set()
    this.injected = []
    this.entriesThrows = false
  }
  entries(key) {
    if (this.entriesThrows) throw new Error('entries boom')
    if (key !== CHAT_VIEW_SLOT) return []
    return this.list
  }
  inject(key, callback) {
    this.injected.push(key)
    this.dispose = callback()
    return () => {}
  }
  subscribe(key, listener) {
    if (key !== CHAT_VIEW_SLOT) return () => {}
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  register(next) {
    this.list = [...this.list, next]
    for (const listener of [...this.listeners]) listener()
  }
  listenerCount() {
    return this.listeners.size
  }
}

/** Capture console.warn for the duration of `run`. */
function captureWarnings(run) {
  const warnings = []
  const original = console.warn
  console.warn = (...args) => warnings.push(args[0])
  try {
    run()
  } finally {
    console.warn = original
  }
  return warnings
}

console.log('--- A① 纯投影:verbose 折叠,其余按身份透传 ---')
{
  const verbose = policyFor('verbose')
  const folded = foldCompletedForVerbose(verbose)
  check('verbose 折叠为 true', folded.foldCompletedTurns, true)
  check('verbose 其余字段不变', folded.stepGrouping, 'none')
  checkTrue('verbose 返回新对象(不污染 POLICIES)', folded !== verbose)
  check('verbose 原对象仍为 false', verbose.foldCompletedTurns, false)

  const compact = policyFor('compact')
  checkTrue('compact 按身份透传', foldCompletedForVerbose(compact) === compact)
  check('compact 保持 false', foldCompletedForVerbose(compact).foldCompletedTurns, false)

  const already = { mode: 'verbose', foldCompletedTurns: true }
  checkTrue('verbose 已折叠 → 按身份透传', foldCompletedForVerbose(already) === already)

  const bare = {}
  checkTrue('无 mode → 按身份透传', foldCompletedForVerbose(bare) === bare)
}

console.log('--- A② presentationOf:形状不符一律判缺失 ---')
{
  const source = makeSource('verbose').source
  checkTrue('合法注入面取到 source', presentationOf({ hooks: { presentation: source } }) === source)
  check('无 hooks', presentationOf({}), undefined)
  check('hooks 非对象', presentationOf({ hooks: 3 }), undefined)
  check('presentation 缺席', presentationOf({ hooks: {} }), undefined)
  check('presentation 非对象', presentationOf({ hooks: { presentation: 7 } }), undefined)
  check('缺 getSnapshot', presentationOf({ hooks: { presentation: { subscribe() {} } } }), undefined)
  check('缺 subscribe', presentationOf({ hooks: { presentation: { getSnapshot() {} } } }), undefined)
  check('face 为 null', presentationOf(null), undefined)
}

console.log('--- A③ findChatViewEntry:按 id 命中,容忍缺席 ---')
{
  const entry = chatEntry(makeSource('verbose').source)
  check('命中注册项', findChatViewEntry(new FakeSlots([entry])), entry)
  check('无注册项', findChatViewEntry(new FakeSlots([])), undefined)
  check('entries 非函数', findChatViewEntry({}), undefined)
}

console.log('--- B① 包装后就地生效:已折叠 + 其余模式不受影响 ---')
{
  const { source, setMode } = makeSource('verbose')
  const state = createFoldPatchState()
  const entry = chatEntry(source)
  check('首次包装返回 true', wrapPresentationSource(source, state), true)
  check('verbose 读取即折叠', source.getSnapshot().foldCompletedTurns, true)

  setMode('compact')
  const compact = source.getSnapshot()
  check('compact 仍为 false', compact.foldCompletedTurns, false)
  check('compact 其余字段不变', compact.stepGrouping, 'collapsed')

  setMode('standard')
  check('standard 仍为 true', source.getSnapshot().foldCompletedTurns, true)

  check('重复包装返回 false', wrapPresentationSource(source, state), false)
  check('patchedCount 只记一次', state.patchedCount, 1)
  checkTrue('注册项未被改动', entry.options.id === CHAT_VIEW_ID)
}

console.log('--- B② 装配:slots.inject 后即打,渲染读走折叠后的值 ---')
{
  const { source } = makeSource('verbose')
  const entry = chatEntry(source)
  const slots = new FakeSlots([entry])
  applyPlugin({ get: (name) => (name === 'slots' ? slots : undefined) })
  check('注入的槽', slots.injected, [CHAT_VIEW_SLOT])
  check('已登记注册变化订阅', slots.listenerCount(), 1)

  const face = entry.inject()
  checkTrue('注入面透传 hooks', face.hooks.presentation === source)
  checkTrue('openFile 等其余成员原样保留', typeof face.openFile === 'function')
  check('verbose 折叠', face.hooks.presentation.getSnapshot().foldCompletedTurns, true)
}

console.log('--- B③ 幂等:重复扫描不叠加包装 ---')
{
  const { source } = makeSource('verbose')
  const entry = chatEntry(source)
  const slots = new FakeSlots([entry])
  applyPlugin({ get: (name) => (name === 'slots' ? slots : undefined) })
  const first = entry.inject

  slots.register({ options: { id: 'other' }, inject: () => ({}) })
  slots.register({ options: { id: 'other-2' }, inject: () => ({}) })
  checkTrue('inject 未被二次包装', entry.inject === first)

  entry.inject()
  entry.inject()
  check('读取多次仍为 true', source.getSnapshot().foldCompletedTurns, true)
  checkTrue('只包装了一个 source', source.getSnapshot() !== undefined)
}

console.log('--- B④ 晚到的注册(ui-chat 在本插件之后 apply)也被打上 ---')
{
  const { source } = makeSource('verbose')
  const slots = new FakeSlots([])
  applyPlugin({ get: (name) => (name === 'slots' ? slots : undefined) })
  const entry = chatEntry(source)
  slots.register(entry)
  check('后到注册的 inject 被包装', entry.inject().hooks.presentation.getSnapshot().foldCompletedTurns, true)
}

console.log('--- B⑤ 目标缺席:no-op 不抛,延后一拍告警一次 ---')
{
  const slots = new FakeSlots([])
  const warnings = []
  const original = console.warn
  console.warn = (...args) => warnings.push(args[0])
  try {
    applyPlugin({ get: (name) => (name === 'slots' ? slots : undefined) })
    check('同步阶段不告警', warnings.length, 0)
    await Promise.resolve() // 冲掉 queueMicrotask 里的那次自检
    check('延后一拍告警一次', warnings.length, 1)
    checkTrue('告警含槽名', String(warnings[0]).includes(CHAT_VIEW_SLOT))
  } finally {
    console.warn = original
  }
}

console.log('--- B⑥ 形状变化:告警一次,注入面原样返回 ---')
{
  const entry = { options: { id: CHAT_VIEW_ID }, inject: () => ({ hooks: {} }) }
  const slots = new FakeSlots([entry])
  applyPlugin({ get: (name) => (name === 'slots' ? slots : undefined) })
  const warnings = captureWarnings(() => {
    entry.inject()
    entry.inject()
  })
  check('告警一次', warnings.length, 1)
  checkTrue('告警提到 presentation', String(warnings[0]).includes('presentation'))
}

console.log('--- B⑦ 服务缺席 / entries 抛错 / 无 inject 方法:no-op ---')
{
  applyPlugin({})
  applyPlugin({ get: () => undefined })
  applyPlugin({ get: () => null })

  const throwing = new FakeSlots([chatEntry(makeSource('verbose').source)])
  throwing.entriesThrows = true
  const warnings = captureWarnings(() => {
    applyPlugin({ get: (name) => (name === 'slots' ? throwing : undefined) })
  })
  check('entries 抛错记一条 warn', warnings.length, 1)
  checkTrue('entries 抛错不冒泡', throwing.listenerCount() === 1)

  const bare = { entries: () => [chatEntry(makeSource('verbose').source)] }
  let threw = null
  try {
    applyPlugin({ get: (name) => (name === 'slots' ? bare : undefined) })
  } catch (error) {
    threw = error
  }
  check('无 inject 方法也能直接打', threw, null)
}

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
  check('模块 id', registration?.id, 'dsh-ui-chat-verbose-fold')
  const plugin = registration.factory(() => {
    throw new Error('产物要求了外部模块:本插件不应有任何 external')
  })
  check('插件名', plugin.name, 'dsh-ui-chat-verbose-fold')
  check('inject 声明', plugin.inject, ['slots'])

  const { source } = makeSource('verbose')
  const entry = chatEntry(source)
  const slots = new FakeSlots([entry])
  plugin.apply({ get: (name) => (name === 'slots' ? slots : undefined) })
  check('产物装配后 verbose 折叠', entry.inject().hooks.presentation.getSnapshot().foldCompletedTurns, true)
}

console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`)
process.exitCode = failures === 0 ? 0 : 1
