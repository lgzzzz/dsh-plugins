/**
 * 临时诊断脚本(非插件产物):用最小 DOM 桩加载 lib/client.js,验证
 * 「服务化后的动作路径」是否只走 uiSession 待处理交互,不触碰 DOM。
 *
 * 关键点:DOM 桩的 querySelector/querySelectorAll 一律返回空——若问答/审批
 * 仍依赖卡片 DOM,断言必然失败。
 *
 * 用法: node test-services.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

// ---- 最小 DOM 桩(刻意不提供任何卡片元素) --------------------------------
class FakeNode {}
class FakeHTMLElement extends FakeNode {
  constructor(tag = 'DIV') {
    super()
    this.tagName = tag
    this.isContentEditable = false
    this.disabled = false
  }
  focus() { this.focused = true }
  click() { this.clicked = true }
  getAttribute() { return null }
  querySelector() { return null }
  querySelectorAll() { return [] }
  closest() { return null }
  contains() { return false }
  remove() {}
  appendChild() {}
  addEventListener() {}
}
class FakeDocument {
  constructor() { this.listeners = new Map() }
  addEventListener(type, fn, capture) {
    if (!this.listeners.has(type)) this.listeners.set(type, [])
    this.listeners.get(type).push({ fn, capture })
  }
  removeEventListener() {}
  querySelector() { return null }
  querySelectorAll() { return [] }
  createElement(tag) { return new FakeHTMLElement(tag.toUpperCase()) }
  getElementById() { return null }
  get body() { return new FakeHTMLElement('BODY') }
  get head() { return new FakeHTMLElement('HEAD') }
}
class FakeKeyboardEvent {
  constructor(init) {
    Object.assign(this, {
      ctrlKey: false, metaKey: false, altKey: false, shiftKey: false,
      repeat: false, isComposing: false, key: '', code: '',
      target: null,
      preventDefault() { this.defaultPrevented = true },
      stopPropagation() { this.propagationStopped = true },
    }, init)
  }
}

globalThis.Node = FakeNode
globalThis.HTMLElement = FakeHTMLElement
globalThis.document = new FakeDocument()
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { platform: 'Win32', userAgent: 'Mozilla/5.0 (Windows NT 10.0)' },
})
const storage = new Map()
globalThis.localStorage = {
  getItem: (k) => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => storage.set(k, String(v)),
}
let registration = null
globalThis.window = { __ModuleLoader__: { load: (reg) => { registration = reg } } }

const source = readFileSync(join(here, 'lib', 'client.js'), 'utf8')

// ---- 断言工具 -------------------------------------------------------------
let failures = 0
function check(label, condition, detail) {
  const ok = condition === true
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || detail === undefined ? '' : `  → ${detail}`}`)
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

// ---- 通用装配 -------------------------------------------------------------
function loadPlugin(services) {
  ;(0, eval)(source)
  if (registration === null) throw new Error('bundle did not register')
  const plugin = registration.factory(() => { throw new Error('unexpected external require') })
  const ctx = {
    get: (name) => services[name],
    effect: (cb) => { const dispose = cb(); if (typeof dispose === 'function') dispose() },
  }
  plugin.apply(ctx)
  const handler = document.listeners.get('keydown')?.at(-1)?.fn
  if (handler === undefined) throw new Error('no keydown listener installed')
  return (init) => {
    const event = new FakeKeyboardEvent({ target: new FakeHTMLElement('DIV'), ...init })
    handler(event)
    return event
  }
}

const now = Date.now()
const snapshot = {
  current: 'sess-b',
  ids: ['sess-a', 'sess-b'],
  byId: {
    'sess-a': { id: 'sess-a', running: false, completed: false, blank: false, updatedAt: now - 1000 },
    'sess-b': { id: 'sess-b', running: true, completed: false, blank: false, updatedAt: now },
  },
  subagentsByParent: {},
}
const sessions = { list: { getSnapshot: () => snapshot }, open() {}, binding: () => undefined }

// ===========================================================================
// 阶段 1:公开面 uiSession.pendingInteractions(服务级路径)
// ===========================================================================
const pending = new Map()
const services = {
  sessions,
  uiSession: { pendingInteractions: { getSnapshot: () => pending } },
  layout: { toggleSidebar() {} },
  workspaces: { list: { getSnapshot: () => ({ archivedSessionIds: [] }) } },
}
const press = loadPlugin(services)

/** 装一个待处理载体并返回结算记录。 */
function mount(interaction) {
  const log = { answer: [], cancel: 0 }
  pending.set('sess-b', {
    ...interaction,
    answer: (payload) => { log.answer.push(payload); pending.delete('sess-b') },
    cancel: () => { log.cancel += 1; pending.delete('sess-b') },
  })
  return log
}

console.log('--- 审批(服务级) ---')
{
  let log = mount({ kind: 'approval', key: 'approval:1' })
  let event = press({ key: 'Enter', code: 'Enter', ctrlKey: true, altKey: true })
  check('Ctrl+Alt+Enter → answer(allowed-once)', same(log.answer, ['allowed-once']), JSON.stringify(log.answer))
  check('Ctrl+Alt+Enter 被吞', event.propagationStopped === true)
  log = mount({ kind: 'approval', key: 'approval:2' })
  event = press({ key: 'Backspace', code: 'Backspace', ctrlKey: true, altKey: true })
  check('Ctrl+Alt+Backspace → answer(rejected)', same(log.answer, ['rejected']), JSON.stringify(log.answer))
  check('Ctrl+Alt+Backspace 被吞', event.propagationStopped === true)
}

const planQuestions = [{
  id: 'p1',
  question: 'Plan?',
  detail: 'plan body',
  options: [{ label: '确认执行' }, { label: '拒绝' }],
  intent: { kind: 'plan-review', approve: '确认执行' },
}]

console.log('\n--- 计划评审(服务级,按键语义按 intent.approve 判定) ---')
{
  let log = mount({ kind: 'plan-review', key: 'question:1', questions: planQuestions })
  let event = press({ key: '1', code: 'Digit1' })
  check('1 → answer(确认执行)', same(log.answer, [{ answers: [{ id: 'p1', selected: ['确认执行'] }] }]), JSON.stringify(log.answer))
  check('1 被吞', event.propagationStopped === true)

  log = mount({ kind: 'plan-review', key: 'question:2', questions: planQuestions })
  press({ key: '2', code: 'Digit2' })
  check('2 → answer(拒绝)', same(log.answer, [{ answers: [{ id: 'p1', selected: ['拒绝'] }] }]), JSON.stringify(log.answer))

  log = mount({ kind: 'plan-review', key: 'question:3', questions: planQuestions })
  press({ key: '3', code: 'Digit3' })
  check('3 → cancel(去聊天里说)', log.cancel === 1, `cancel=${String(log.cancel)}`)

  log = mount({ kind: 'plan-review', key: 'question:4', questions: planQuestions })
  event = press({ key: 'Enter', code: 'Enter' })
  check('Enter → answer(确认执行)', same(log.answer, [{ answers: [{ id: 'p1', selected: ['确认执行'] }] }]), JSON.stringify(log.answer))
  check('Enter 被吞', event.propagationStopped === true)

  log = mount({ kind: 'plan-review', key: 'question:5', questions: planQuestions })
  press({ key: '4', code: 'Digit4' })
  check('4 → no-op(计划评审仅 1/2/3)', log.answer.length === 0 && log.cancel === 0)
}

console.log('\n--- 通用问答:单题单选(服务级 + 镜像) ---')
{
  const log = mount({
    kind: 'question',
    key: 'question:6',
    questions: [{ id: 'g1', question: 'Q?', options: [{ label: 'A' }, { label: 'B' }] }],
  })
  let event = press({ key: '2', code: 'Digit2' })
  check('2 → 仅选中,未结算', log.answer.length === 0, JSON.stringify(log.answer))
  check('2 被吞', event.propagationStopped === true)
  event = press({ key: 'Enter', code: 'Enter' })
  check('Enter → answer(选中 B)', same(log.answer, [{ answers: [{ id: 'g1', selected: ['B'] }] }]), JSON.stringify(log.answer))
  check('Enter 被吞', event.propagationStopped === true)
}

console.log('\n--- 通用问答:多题(自动翻题 + 批量结算) ---')
{
  const log = mount({
    kind: 'question',
    key: 'question:7',
    questions: [
      { id: 'm1', question: 'Q1?', options: [{ label: 'A' }, { label: 'B' }] },
      { id: 'm2', question: 'Q2?', options: [{ label: 'C' }, { label: 'D' }] },
    ],
  })
  press({ key: '1', code: 'Digit1' })
  check('第 1 题选 A 后未结算', log.answer.length === 0)
  press({ key: '2', code: 'Digit2' })
  check('第 2 题选 D 后未结算', log.answer.length === 0)
  press({ key: 'Enter', code: 'Enter' })
  check(
    'Enter → answer(两题批量)',
    same(log.answer, [{ answers: [{ id: 'm1', selected: ['A'] }, { id: 'm2', selected: ['D'] }] }]),
    JSON.stringify(log.answer),
  )
}

console.log('\n--- 通用问答:多选切换 ---')
{
  const log = mount({
    kind: 'question',
    key: 'question:8',
    questions: [{
      id: 's1',
      question: 'Multi?',
      multiSelect: true,
      options: [{ label: 'A' }, { label: 'B' }, { label: 'C' }],
    }],
  })
  press({ key: '1', code: 'Digit1' })
  press({ key: '3', code: 'Digit3' })
  press({ key: '1', code: 'Digit1' }) // 再按 1 取消 A
  press({ key: 'Enter', code: 'Enter' })
  check('多选切换后 answer([C])', same(log.answer, [{ answers: [{ id: 's1', selected: ['C'] }] }]), JSON.stringify(log.answer))
}

console.log('\n--- 未作答 / 无待处理时的放行 ---')
{
  const log = mount({
    kind: 'question',
    key: 'question:9',
    questions: [{ id: 'u1', question: 'Q?', options: [{ label: 'A' }] }],
  })
  const event = press({ key: 'Enter', code: 'Enter' })
  check('未作答 Enter 不结算', log.answer.length === 0)
  check('未作答 Enter 不吞键', event.propagationStopped !== true)
  pending.delete('sess-b')
  const idle = press({ key: 'Enter', code: 'Enter', ctrlKey: true, altKey: true })
  check('无待处理审批时不吞键', idle.propagationStopped !== true)
  const digit = press({ key: '1', code: 'Digit1' })
  check('无待处理问答时不吞键', digit.propagationStopped !== true)
}

// ===========================================================================
// 阶段 2:仅私有字段 pendingSnapshot(兼容回退)
// ===========================================================================
console.log('\n--- 兼容回退:仅 pendingSnapshot ---')
{
  globalThis.document = new FakeDocument()
  const legacy = new Map()
  const legacyServices = {
    sessions,
    uiSession: { pendingSnapshot: legacy },
    layout: { toggleSidebar() {} },
    workspaces: { list: { getSnapshot: () => ({ archivedSessionIds: [] }) } },
  }
  const pressLegacy = loadPlugin(legacyServices)
  const log = { answer: [] }
  legacy.set('sess-b', {
    kind: 'approval',
    key: 'approval:9',
    answer: (payload) => { log.answer.push(payload); legacy.delete('sess-b') },
  })
  const event = pressLegacy({ key: 'Enter', code: 'Enter', ctrlKey: true, altKey: true })
  check('pendingSnapshot 回退仍可应答', same(log.answer, ['allowed-once']), JSON.stringify(log.answer))
  check('回退路径吞键', event.propagationStopped === true)
}

console.log(`\n${failures === 0 ? 'ALL PASS' : `${String(failures)} FAILED`}`)
process.exitCode = failures === 0 ? 0 : 1
