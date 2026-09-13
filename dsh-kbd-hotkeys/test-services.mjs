/**
 * 诊断脚本(非插件产物):用最小 DOM 桩加载 lib/client.js,验证
 * 「服务化后的动作路径」是否只走服务面,不触碰 DOM。
 *
 * 关键点:DOM 桩的 querySelector/querySelectorAll 一律返回空——若问答/审批
 * 仍依赖卡片 DOM,断言必然失败。
 *
 * 审批为固定单键:当前会话有待审批卡片时 Enter = 允许一次、Esc = 拒绝(不受焦点
 * 位置影响),组合键形式的审批键位不作为动作执行;
 * 无审批卡片时 Esc 仍走 session.stop。
 *
 * 通用问答的断言对象是**卡片自己的草稿 store**(conversation.composer 注册项
 * 上的 store handle → uiSession.resolve(sessionId) → slots.resolveStore):
 * 数字键必须写进这份 store(卡片才会高亮,且不翻题)、←/→ 必须只改题号(草稿原样保留)、
 * Enter 必须从这份 store 取草稿(非末题推进、末题结算)——插件内不另存镜像状态。
 *
 * 另含侧栏开关断言:⌘/Ctrl+B → `layout.toggleSidebar()`(左栏)、
 * ⌘/Ctrl+Alt+B → `sidebarRight.toggleExpanded()`(右栏),两者在 browse / editing
 * 两态都生效且互不串场;服务缺席或抛错(无挂载会话面)时 no-op 且不吞键;左栏键位
 * 可经 localStorage 自定义且不影响右栏默认键位。
 *
 * 另含右栏标签切换断言(⌘/Ctrl+Alt+← / →):标签顺序必须取自右栏自己的会话级 slot
 * store(`rightbar.session` 注册项上的 store handle → `uiSession.resolve(sessionId)`
 * → `slots.resolveStore` → `getSnapshot().bySession[sessionId].layout`),切换必须调
 * 公开的 `sidebarRight.focus(tabId)`;首/末标签**循环**,只有一个标签时 no-op 且不吞键,
 * 焦点在输入框(editing 态)同样可用,任一环不可用一律 no-op。
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
const clone = (value) => JSON.parse(JSON.stringify(value))

// ---- 通用装配 -------------------------------------------------------------
function loadPlugin(services) {
  globalThis.document = new FakeDocument()
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

/**
 * 假问答草稿 store:复刻上游 defineStore 的 replace/clear 语义
 * (replace 覆盖 requestKey + progress,clear 只在 requestKey 匹配时清空)。
 */
function makeDraftStore() {
  const handle = { spec: {} }
  let state = { progress: { index: 0, drafts: [] } }
  const instance = {
    getSnapshot: () => state,
    actions: {
      replace(requestKey, progress) {
        state = { requestKey, progress: clone(progress) }
      },
      clear(requestKey) {
        if (state.requestKey === requestKey) state = { progress: { index: 0, drafts: [] } }
      },
    },
  }
  return { handle, instance, read: () => state, seed: (next) => { state = clone(next) } }
}

/** conversation.composer 的假 slots:问答注册项(带 store)+ 干扰项(无 store / select 不匹配)。 */
function composerSlots(draft) {
  const otherHandle = { spec: {} }
  return {
    entries: (key) => {
      if (key !== 'conversation.composer') return []
      return [
        { store: otherHandle, select: () => null }, // select 不匹配 → 必须跳过
        { select: () => ({}) }, // 无 store → 必须跳过
        {
          store: draft.handle,
          select: ({ pendingInteraction }) =>
            pendingInteraction !== undefined && pendingInteraction.kind === 'question' ? pendingInteraction : null,
        },
      ]
    },
    resolveStore: (handle, binding) => {
      if (handle !== draft.handle) throw new Error('resolved the wrong store handle')
      if (binding?.key !== 'sess-b') throw new Error(`bad scope binding: ${JSON.stringify(binding)}`)
      return draft.instance
    },
  }
}

// ===========================================================================
// 阶段 1:公开面 uiSession.pendingInteractions(服务级路径)
// ===========================================================================
const pending = new Map()
const draft = makeDraftStore()
const services = {
  sessions,
  uiSession: {
    pendingInteractions: { getSnapshot: () => pending },
    resolve: (sessionId) => (sessionId === 'sess-b' ? { key: 'sess-b', ctx: {} } : undefined),
  },
  sidebarRight: { toggleExpanded() {} },
  workspaces: { list: { getSnapshot: () => ({ archivedSessionIds: [] }) } },
  slots: composerSlots(draft),
}
const press = loadPlugin(services)

/** 装一个待处理载体并返回结算记录。 */
function mount(interaction) {
  const log = { answer: [], cancel: 0 }
  pending.set('sess-b', {
    sessionId: 'sess-b',
    ...interaction,
    answer: (payload) => { log.answer.push(payload); pending.delete('sess-b') },
    cancel: () => { log.cancel += 1; pending.delete('sess-b') },
  })
  return log
}

console.log('--- 审批(服务级:Enter 同意 / Esc 拒绝) ---')
{
  let log = mount({ kind: 'approval', key: 'approval:1' })
  let event = press({ key: 'Enter', code: 'Enter' })
  check('Enter → answer(allowed-once)', same(log.answer, ['allowed-once']), JSON.stringify(log.answer))
  check('Enter 被吞', event.propagationStopped === true)

  log = mount({ kind: 'approval', key: 'approval:2' })
  event = press({ key: 'Escape', code: 'Escape' })
  check('Esc → answer(rejected)', same(log.answer, ['rejected']), JSON.stringify(log.answer))
  check('Esc 被吞', event.propagationStopped === true)

  // 审批是固定单键分发:组合键形式的审批键位不应答、不吞键
  log = mount({ kind: 'approval', key: 'approval:3' })
  event = press({ key: 'Enter', code: 'Enter', ctrlKey: true, altKey: true })
  check('Ctrl+Alt+Enter 不应答(审批只认固定单键)', log.answer.length === 0, JSON.stringify(log.answer))
  check('Ctrl+Alt+Enter 不吞键', event.propagationStopped !== true)
  event = press({ key: 'Backspace', code: 'Backspace', ctrlKey: true, altKey: true })
  check('Ctrl+Alt+Backspace 不应答(审批只认固定单键)', log.answer.length === 0, JSON.stringify(log.answer))
  check('Ctrl+Alt+Backspace 不吞键', event.propagationStopped !== true)
  pending.delete('sess-b')

  // 审批卡片自身没有输入框:焦点在对话输入框时同样应答(不受焦点位置影响)
  log = mount({ kind: 'approval', key: 'approval:4' })
  event = press({ key: 'Enter', code: 'Enter', target: new FakeHTMLElement('TEXTAREA') })
  check('焦点在输入框时 Enter 仍同意', same(log.answer, ['allowed-once']), JSON.stringify(log.answer))
  check('焦点在输入框时 Enter 被吞', event.propagationStopped === true)

  log = mount({ kind: 'approval', key: 'approval:5' })
  event = press({ key: 'Escape', code: 'Escape', target: new FakeHTMLElement('TEXTAREA') })
  check('焦点在输入框时 Esc 仍拒绝', same(log.answer, ['rejected']), JSON.stringify(log.answer))
  check('焦点在输入框时 Esc 被吞', event.propagationStopped === true)
}

console.log('\n--- 无审批卡片时 Esc 仍停止当前会话(不吞键) ---')
{
  pending.delete('sess-b')
  const cancelled = []
  const stopSessions = {
    list: { getSnapshot: () => snapshot },
    open() {},
    binding: (id) => ({
      session: {
        getSnapshot: () => ({ running: id === 'sess-b' }),
        cancel: () => { cancelled.push(id) },
      },
    }),
  }
  const pressStop = loadPlugin({ ...services, sessions: stopSessions })
  const event = pressStop({ key: 'Escape', code: 'Escape' })
  check('无审批卡片时 Esc → cancel(sess-b)', same(cancelled, ['sess-b']), JSON.stringify(cancelled))
  check('无审批卡片时 Esc 不吞键', event.propagationStopped !== true)
}

console.log('\n--- 固定分发动作不可经 bindings 覆盖 ---')
{
  storage.set('dsh-kbd-hotkeys:v1', JSON.stringify({
    bindings: { 'approval.allow': 'mod+alt+enter', 'approval.reject': 'mod+alt+backspace' },
  }))
  const pressStale = loadPlugin(services)
  const log = mount({ kind: 'approval', key: 'approval:6' })
  let event = pressStale({ key: 'Enter', code: 'Enter', ctrlKey: true, altKey: true })
  check('自定义组合键不应答', log.answer.length === 0 && event.propagationStopped !== true, JSON.stringify(log.answer))
  event = pressStale({ key: 'Enter', code: 'Enter' })
  check('固定单键 Enter 仍同意', same(log.answer, ['allowed-once']), JSON.stringify(log.answer))
  storage.delete('dsh-kbd-hotkeys:v1')
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

console.log('\n--- 通用问答:数字键不翻题、Enter 非末题推进、末题结算 ---')
{
  const log = mount({
    kind: 'question',
    key: 'question:6',
    questions: [
      { id: 'g1', question: 'Q1?', options: [{ label: 'A' }, { label: 'B' }] },
      { id: 'g2', question: 'Q2?', options: [{ label: 'C' }, { label: 'D' }] },
      { id: 'g3', question: 'Q3?', options: [{ label: 'E' }] },
    ],
  })
  let event = press({ key: '2', code: 'Digit2' })
  check('第 1 题按 2 → store 记录 B 且停在第 1 题', same(draft.read(), {
    requestKey: 'question:6',
    progress: {
      index: 0,
      drafts: [
        { selected: ['B'], custom: '', skipped: false },
        { selected: [], custom: '', skipped: false },
        { selected: [], custom: '', skipped: false },
      ],
    },
  }), JSON.stringify(draft.read()))
  check('第 1 题按 2 被吞', event.propagationStopped === true)
  check('第 1 题按 2 未结算', log.answer.length === 0)

  // Enter:当前题已作答且非末题 → 翻到下一题(保留上游 continueFlow 的推进)
  event = press({ key: 'Enter', code: 'Enter' })
  check('已作答非末题 Enter → 翻到第 2 题', draft.read().progress.index === 1, `index=${String(draft.read().progress.index)}`)
  check('已作答非末题 Enter 被吞', event.propagationStopped === true)
  check('翻题不结算', log.answer.length === 0)

  // 当前题未作答 → 不吞键、不翻题
  event = press({ key: 'Enter', code: 'Enter' })
  check('未作答 Enter 不翻题(仍在第 2 题)', draft.read().progress.index === 1, `index=${String(draft.read().progress.index)}`)
  check('未作答 Enter 不吞键', event.propagationStopped !== true)
  check('未作答 Enter 不结算', log.answer.length === 0)

  press({ key: 'ArrowRight', code: 'ArrowRight' })
  check('→ 到第 3 题(末题)', draft.read().progress.index === 2, `index=${String(draft.read().progress.index)}`)
  press({ key: '1', code: 'Digit1' })
  check('第 3 题按 1 → store 记录 E 且停在第 3 题', draft.read().progress.index === 2 && same(draft.read().progress.drafts[2].selected, ['E']), JSON.stringify(draft.read().progress.drafts[2]))

  // 末题仍有未完成题 → 不结算、不吞键、不跳回未完成题
  event = press({ key: 'Enter', code: 'Enter' })
  check('末题仍有未完成题 Enter 不结算', log.answer.length === 0, JSON.stringify(log.answer))
  check('末题仍有未完成题 Enter 不吞键', event.propagationStopped !== true)
  check('末题仍有未完成题 Enter 不跳回(仍在第 3 题)', draft.read().progress.index === 2, `index=${String(draft.read().progress.index)}`)

  // 回到第 2 题补答,再回到末题结算
  press({ key: 'ArrowLeft', code: 'ArrowLeft' })
  check('← 回到第 2 题', draft.read().progress.index === 1, `index=${String(draft.read().progress.index)}`)
  press({ key: '1', code: 'Digit1' })
  press({ key: 'ArrowRight', code: 'ArrowRight' })
  event = press({ key: 'Enter', code: 'Enter' })
  check(
    '全部完成后末题 Enter → answer(三题批量)',
    same(log.answer, [{
      answers: [
        { id: 'g1', selected: ['B'] },
        { id: 'g2', selected: ['C'] },
        { id: 'g3', selected: ['E'] },
      ],
    }]),
    JSON.stringify(log.answer),
  )
  check('Enter 被吞', event.propagationStopped === true)
  check('结算后草稿被清理', same(draft.read(), { progress: { index: 0, drafts: [] } }), JSON.stringify(draft.read()))
}

console.log('\n--- 通用问答:多选切换(store 为唯一真源) ---')
{
  const log = mount({
    kind: 'question',
    key: 'question:7',
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
  check('多选切换后 store 只留 C', same(draft.read().progress.drafts[0].selected, ['C']), JSON.stringify(draft.read()))
  press({ key: 'Enter', code: 'Enter' })
  check('多选 Enter → answer([C])', same(log.answer, [{ answers: [{ id: 's1', selected: ['C'] }] }]), JSON.stringify(log.answer))
}

console.log('\n--- 通用问答:鼠标/输入框写过的草稿被热键沿用(单一真源) ---')
{
  const log = mount({
    kind: 'question',
    key: 'question:8',
    questions: [{ id: 'c1', question: 'Q?', options: [{ label: 'A' }, { label: 'B' }] }],
  })
  // 模拟用户先在卡片里点了 A 又敲了自定义文本(上游 draftCustom 会清空 selected)
  draft.seed({
    requestKey: 'question:8',
    progress: { index: 0, drafts: [{ selected: [], custom: '手写答案', skipped: false }] },
  })
  press({ key: 'Enter', code: 'Enter' })
  check(
    'Enter → answer(沿用 store 里的 custom)',
    same(log.answer, [{ answers: [{ id: 'c1', selected: [], custom: '手写答案' }] }]),
    JSON.stringify(log.answer),
  )
}

console.log('\n--- 通用问答:← / → 切题(只改题号,草稿保留,首末题不循环) ---')
{
  const log = mount({
    kind: 'question',
    key: 'question:11',
    questions: [
      { id: 'a1', question: 'Q1?', options: [{ label: 'A' }, { label: 'B' }] },
      { id: 'a2', question: 'Q2?', options: [{ label: 'C' }] },
      { id: 'a3', question: 'Q3?', options: [{ label: 'D' }] },
    ],
  })
  // 第 1 题单选作答 → 数字键只改选中态,题号不动
  press({ key: '1', code: 'Digit1' })
  check('按 1 后仍停在第 1 题(数字键不翻题)', draft.read().progress.index === 0, `index=${String(draft.read().progress.index)}`)

  let event = press({ key: 'ArrowRight', code: 'ArrowRight' })
  check('→ 到第 2 题', draft.read().progress.index === 1, `index=${String(draft.read().progress.index)}`)
  check('→ 被吞', event.propagationStopped === true)

  event = press({ key: 'ArrowLeft', code: 'ArrowLeft' })
  check('← 回到第 1 题', draft.read().progress.index === 0, `index=${String(draft.read().progress.index)}`)
  check('← 保留已选草稿', same(draft.read().progress.drafts[0].selected, ['A']), JSON.stringify(draft.read().progress.drafts[0]))

  event = press({ key: 'ArrowLeft', code: 'ArrowLeft' })
  check('首题按 ← 不循环(仍第 1 题)', draft.read().progress.index === 0, `index=${String(draft.read().progress.index)}`)
  check('首题按 ← 不吞键', event.propagationStopped !== true)

  press({ key: 'ArrowRight', code: 'ArrowRight' })
  check('→ 到第 2 题', draft.read().progress.index === 1, `index=${String(draft.read().progress.index)}`)
  event = press({ key: 'ArrowRight', code: 'ArrowRight' })
  check('→ 到第 3 题(末题)', draft.read().progress.index === 2, `index=${String(draft.read().progress.index)}`)
  check('→ 被吞', event.propagationStopped === true)

  event = press({ key: 'ArrowRight', code: 'ArrowRight' })
  check('末题按 → 不循环(仍第 3 题)', draft.read().progress.index === 2, `index=${String(draft.read().progress.index)}`)
  check('末题按 → 不吞键', event.propagationStopped !== true)
  check('切题全程不结算', log.answer.length === 0, JSON.stringify(log.answer))

  // 焦点在可编辑元素时方向键必须交回输入框(光标移动),不得切题
  event = press({ key: 'ArrowLeft', code: 'ArrowLeft', target: new FakeHTMLElement('INPUT') })
  check('焦点在输入框时 ← 不吞键(交回输入框)', event.propagationStopped !== true)
  check('焦点在输入框时 ← 不切题', draft.read().progress.index === 2, `index=${String(draft.read().progress.index)}`)
  pending.delete('sess-b')
}

console.log('\n--- 计划评审:← / → no-op(单题一次决策) ---')
{
  const log = mount({ kind: 'plan-review', key: 'question:12', questions: planQuestions })
  let event = press({ key: 'ArrowLeft', code: 'ArrowLeft' })
  check('计划评审 ← 不吞键', event.propagationStopped !== true)
  event = press({ key: 'ArrowRight', code: 'ArrowRight' })
  check('计划评审 → 不吞键', event.propagationStopped !== true)
  check('计划评审方向键不结算', log.answer.length === 0 && log.cancel === 0)
}

console.log('\n--- 无待处理卡片时 ← / → 放行(浏览态) ---')
{
  const event = press({ key: 'ArrowLeft', code: 'ArrowLeft' })
  check('无卡片时 ← 不吞键', event.propagationStopped !== true)
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
  const idle = press({ key: 'Enter', code: 'Enter' })
  check('无待处理审批时 Enter 不吞键', idle.propagationStopped !== true)
  const idleEsc = press({ key: 'Escape', code: 'Escape' })
  check('无待处理审批时 Esc 不吞键', idleEsc.propagationStopped !== true)
  const digit = press({ key: '1', code: 'Digit1' })
  check('无待处理问答时不吞键', digit.propagationStopped !== true)
}

console.log('\n--- 权威来源不可用 → no-op(无降级) ---')
{
  const cases = [
    ['slots 服务缺失', { slots: undefined }],
    ['slots 无 resolveStore', { slots: { entries: () => [{ store: {} }] } }],
    ['uiSession 无 resolve', { uiSession: { pendingInteractions: { getSnapshot: () => pending } } }],
    ['注册项 select 不匹配', {
      slots: {
        entries: () => [{ store: {}, select: () => null }],
        resolveStore: () => { throw new Error('must not resolve') },
      },
    }],
    ['活实例缺 actions.replace', {
      slots: {
        entries: () => [{ store: {}, select: () => ({}) }],
        resolveStore: () => ({ getSnapshot: () => ({}) }),
      },
    }],
  ]
  for (const [label, extra] of cases) {
    const isolated = new Map()
    isolated.set('sess-b', {
      kind: 'question',
      key: 'question:10',
      sessionId: 'sess-b',
      questions: [{ id: 'n1', question: 'Q?', options: [{ label: 'A' }] }],
      answer: () => { throw new Error('must not answer') },
    })
    const env = loadPlugin({
      sessions,
      uiSession: {
        pendingInteractions: { getSnapshot: () => isolated },
        resolve: (sessionId) => (sessionId === 'sess-b' ? { key: 'sess-b', ctx: {} } : undefined),
      },
      sidebarRight: { toggleExpanded() {} },
      workspaces: { list: { getSnapshot: () => ({ archivedSessionIds: [] }) } },
      ...extra,
    })
    const digitEvent = env({ key: '1', code: 'Digit1' })
    const enterEvent = env({ key: 'Enter', code: 'Enter' })
    const arrowEvent = env({ key: 'ArrowRight', code: 'ArrowRight' })
    check(`${label} → 数字键不吞键`, digitEvent.propagationStopped !== true)
    check(`${label} → Enter 不吞键`, enterEvent.propagationStopped !== true)
    check(`${label} → → 不吞键`, arrowEvent.propagationStopped !== true)
  }
}

// ===========================================================================
// 阶段 2:仅私有字段 pendingSnapshot(兼容回退)
// ===========================================================================
console.log('\n--- 兼容回退:仅 pendingSnapshot ---')
{
  const legacy = new Map()
  const legacyServices = {
    sessions,
    uiSession: { pendingSnapshot: legacy },
    sidebarRight: { toggleExpanded() {} },
    workspaces: { list: { getSnapshot: () => ({ archivedSessionIds: [] }) } },
  }
  const pressLegacy = loadPlugin(legacyServices)
  const log = { answer: [] }
  legacy.set('sess-b', {
    kind: 'approval',
    key: 'approval:9',
    answer: (payload) => { log.answer.push(payload); legacy.delete('sess-b') },
  })
  const event = pressLegacy({ key: 'Enter', code: 'Enter' })
  check('pendingSnapshot 回退仍可应答', same(log.answer, ['allowed-once']), JSON.stringify(log.answer))
  check('回退路径吞键', event.propagationStopped === true)
}

// ===========================================================================
// 阶段 3:⌘/Ctrl+B → 左栏(layout.toggleSidebar)、⌘/Ctrl+Alt+B → 右栏
//          (sidebarRight.toggleExpanded);两键互不串场,服务缺席一律不吞键
// ===========================================================================
console.log('\n--- ⌘/Ctrl+B / ⌘/Ctrl+Alt+B → 左右栏开关 ---')
{
  const base = {
    sessions,
    uiSession: { pendingInteractions: { getSnapshot: () => new Map() } },
    workspaces: { list: { getSnapshot: () => ({ archivedSessionIds: [] }) } },
  }

  let left = 0
  let right = 0
  const both = loadPlugin({
    ...base,
    layout: { toggleSidebar: () => { left += 1 } },
    sidebarRight: { toggleExpanded: () => { right += 1 } },
  })

  // ⌘/Ctrl+B:只打左栏
  let event = both({ key: 'b', code: 'KeyB', ctrlKey: true })
  check('browse 态 ⌘/Ctrl+B → layout.toggleSidebar(左栏)', same([left, right], [1, 0]), `${left},${right}`)
  check('browse 态 ⌘/Ctrl+B 被吞', event.propagationStopped === true)

  // ⌘/Ctrl+Alt+B:只打右栏
  event = both({ key: 'b', code: 'KeyB', ctrlKey: true, altKey: true })
  check('browse 态 ⌘/Ctrl+Alt+B → sidebarRight.toggleExpanded(右栏)', same([left, right], [1, 1]), `${left},${right}`)
  check('browse 态 ⌘/Ctrl+Alt+B 被吞', event.propagationStopped === true)

  // editing 态(焦点在输入框)两个键位同样生效
  event = both({ key: 'b', code: 'KeyB', ctrlKey: true, target: new FakeHTMLElement('TEXTAREA') })
  check('editing 态 ⌘/Ctrl+B → 左栏', same([left, right], [2, 1]), `${left},${right}`)
  check('editing 态 ⌘/Ctrl+B 被吞', event.propagationStopped === true)
  event = both({ key: 'b', code: 'KeyB', ctrlKey: true, altKey: true, target: new FakeHTMLElement('TEXTAREA') })
  check('editing 态 ⌘/Ctrl+Alt+B → 右栏', same([left, right], [2, 2]), `${left},${right}`)
  check('editing 态 ⌘/Ctrl+Alt+B 被吞', event.propagationStopped === true)

  // bindings 覆盖:sidebar.toggle 是左栏的合法动作 id(键位可自定义)
  storage.set('dsh-kbd-hotkeys:v1', JSON.stringify({ bindings: { 'sidebar.toggle': 'mod+alt+s' } }))
  let customLeft = 0
  let customRight = 0
  const custom = loadPlugin({
    ...base,
    layout: { toggleSidebar: () => { customLeft += 1 } },
    sidebarRight: { toggleExpanded: () => { customRight += 1 } },
  })
  event = custom({ key: 'b', code: 'KeyB', ctrlKey: true })
  check('左栏自定义键位后 ⌘/Ctrl+B 不再触发左栏', same([customLeft, customRight], [0, 0]), `${customLeft},${customRight}`)
  event = custom({ key: 's', code: 'KeyS', ctrlKey: true, altKey: true })
  check('自定义 ⌘/Ctrl+Alt+S → 左栏', same([customLeft, customRight], [1, 0]), `${customLeft},${customRight}`)
  event = custom({ key: 'b', code: 'KeyB', ctrlKey: true, altKey: true })
  check('右栏默认键位不受左栏自定义影响', same([customLeft, customRight], [1, 1]), `${customLeft},${customRight}`)
  storage.delete('dsh-kbd-hotkeys:v1')

  // 无降级:服务缺席 / 无挂载会话面(控制器 require 抛错)→ no-op 且不吞键
  const missing = loadPlugin(base)
  event = missing({ key: 'b', code: 'KeyB', ctrlKey: true })
  check('layout 缺席 → ⌘/Ctrl+B 不吞键', event.propagationStopped !== true)
  event = missing({ key: 'b', code: 'KeyB', ctrlKey: true, altKey: true })
  check('sidebarRight 缺席 → ⌘/Ctrl+Alt+B 不吞键', event.propagationStopped !== true)

  const dead = loadPlugin({
    ...base,
    layout: { toggleSidebar: () => { throw new Error('layout: not mounted') } },
    sidebarRight: { toggleExpanded: () => { throw new Error('sidebarRight: no session surface is mounted') } },
  })
  event = dead({ key: 'b', code: 'KeyB', ctrlKey: true })
  check('layout 抛错 → ⌘/Ctrl+B 不吞键', event.propagationStopped !== true)
  event = dead({ key: 'b', code: 'KeyB', ctrlKey: true, altKey: true })
  check('无挂载会话面(抛错)→ ⌘/Ctrl+Alt+B 不吞键', event.propagationStopped !== true)
}

// ===========================================================================
// 阶段 4:⌘/Ctrl+I → 聚焦对话输入框
//         路径 = sessions.binding(id).ctx → conversation.input.for(actx)
//                → shell.editor.getRootElement() → element.focus({preventScroll:true})
//         只允许走服务链路:DOM 桩的 querySelector/querySelectorAll 恒空,任何
//         选择器式实现都拿不到元素;断言对象是服务图里的假元素与 binding.ctx 同一性。
// ===========================================================================
console.log('\n--- ⌘/Ctrl+I → 聚焦输入框(conversation.input → shell.editor) ---')
{
  const actx = { scope: 'sess-b' } // sessions.binding('sess-b').ctx(必须原样传给 input.for)
  const makeComposerSessions = (ctx = actx) => ({
    list: { getSnapshot: () => snapshot },
    open() {},
    binding: (id) => (id === 'sess-b' ? { ctx } : undefined),
  })
  const makeRoot = () => new FakeHTMLElement('DIV') // editor 宿主内容(ComposerContentEditable 绑定的 div)
  const base = {
    uiSession: { pendingInteractions: { getSnapshot: () => new Map() } },
    workspaces: { list: { getSnapshot: () => ({ archivedSessionIds: [] }) } },
  }

  // --- 主路径:browse 态 ⌘/Ctrl+I 聚焦,且 for() 收到的就是 binding.ctx 本身 ---
  const root = makeRoot()
  const seenActx = []
  const shellCalls = []
  const main = loadPlugin({
    ...base,
    sessions: makeComposerSessions(),
    conversation: {
      input: {
        for: (arg) => { seenActx.push(arg); return { editor: { getRootElement: () => root } } },
        shell: (id) => { shellCalls.push(id); return undefined },
      },
    },
  })
  let event = main({ key: 'i', code: 'KeyI', ctrlKey: true })
  check('browse 态 Ctrl+I → 宿主元素 focus({preventScroll:true})', root.focused === true)
  check('Ctrl+I 被吞', event.propagationStopped === true)
  check('input.for 收到 binding.ctx 本身', same(seenActx, [actx]))
  check('主路径不触碰 shell(id)', shellCalls.length === 0, JSON.stringify(shellCalls))

  // --- macOS ⌘I:metaKey 同样归一化成 mod+i ---
  const macRoot = makeRoot()
  const mac = loadPlugin({
    ...base,
    sessions: makeComposerSessions(),
    conversation: { input: { for: () => ({ editor: { getRootElement: () => macRoot } }) } },
  })
  event = mac({ key: 'i', code: 'KeyI', metaKey: true })
  check('macOS ⌘I(metaKey)→ 同样聚焦', macRoot.focused === true)
  check('macOS ⌘I 被吞', event.propagationStopped === true)

  // --- 态门闸:editing(焦点已在可编辑元素)不接管,交回输入框 ---
  const editRoot = makeRoot()
  const editing = loadPlugin({
    ...base,
    sessions: makeComposerSessions(),
    conversation: { input: { for: () => ({ editor: { getRootElement: () => editRoot } }) } },
  })
  event = editing({ key: 'i', code: 'KeyI', ctrlKey: true, target: new FakeHTMLElement('TEXTAREA') })
  check('editing 态 Ctrl+I 不聚焦(不干扰文本编辑)', editRoot.focused !== true)
  check('editing 态 Ctrl+I 不吞键', event.propagationStopped !== true)

  // --- 态门闸:card(有待审批卡片)不接管 ---
  const cardPending = new Map([['sess-b', { kind: 'approval', key: 'a:1', answer() {} }]])
  const cardRoot = makeRoot()
  const card = loadPlugin({
    ...base,
    sessions: makeComposerSessions(),
    uiSession: { pendingInteractions: { getSnapshot: () => cardPending } },
    conversation: { input: { for: () => ({ editor: { getRootElement: () => cardRoot } }) } },
  })
  event = card({ key: 'i', code: 'KeyI', ctrlKey: true })
  check('card 态 Ctrl+I 不聚焦', cardRoot.focused !== true)
  check('card 态 Ctrl+I 不吞键', event.propagationStopped !== true)

  // --- for 缺席 → 回退公开的 shell(id)(同一 SessionInputShell) ---
  const shellRoot = makeRoot()
  const shellIds = []
  const viaShell = loadPlugin({
    ...base,
    sessions: makeComposerSessions(),
    conversation: {
      input: { shell: (id) => { shellIds.push(id); return { editor: { getRootElement: () => shellRoot } } } },
    },
  })
  event = viaShell({ key: 'i', code: 'KeyI', ctrlKey: true })
  check('input.for 缺席 → shell(id) 回退聚焦', shellRoot.focused === true)
  check('shell(id) 收到当前会话 id', same(shellIds, ['sess-b']), JSON.stringify(shellIds))
  check('shell 回退路径吞键', event.propagationStopped === true)

  // --- 无 binding.ctx → 直接走 shell(id) ---
  const noCtxRoot = makeRoot()
  const noCtx = loadPlugin({
    ...base,
    sessions: makeComposerSessions(undefined),
    conversation: {
      input: {
        for: () => { throw new Error('for must not be called without a scope ctx') },
        shell: () => ({ editor: { getRootElement: () => noCtxRoot } }),
      },
    },
  })
  event = noCtx({ key: 'i', code: 'KeyI', ctrlKey: true })
  check('无 binding.ctx → 走 shell(id)', noCtxRoot.focused === true)
  check('无 binding.ctx 路径吞键', event.propagationStopped === true)

  // --- 无降级:任一环缺失 / 抛错一律 no-op 且不吞键,不回退到 DOM 查询 ---
  const cases = [
    ['conversation 服务缺席', { conversation: undefined }],
    ['input 缺席', { conversation: {} }],
    ['for/shell 都缺席', { conversation: { input: {} } }],
    ['for 返回 undefined 且无 shell', { conversation: { input: { for: () => undefined } } }],
    ['shell 返回 undefined', { conversation: { input: { shell: () => undefined } } }],
    ['shell 抛错(会话无绑定)', { conversation: { input: { shell: () => { throw new Error('no binding') } } } }],
    ['shell 返回无 editor 的壳', { conversation: { input: { shell: () => ({}) } } }],
    [
      'editor 未绑宿主元素(getRootElement → null)',
      { conversation: { input: { shell: () => ({ editor: { getRootElement: () => null } }) } } },
    ],
    ['editor 缺 getRootElement', { conversation: { input: { shell: () => ({ editor: {} }) } } }],
    [
      '宿主元素缺 focus',
      { conversation: { input: { shell: () => ({ editor: { getRootElement: () => ({}) } }) } } },
    ],
  ]
  for (const [label, extra] of cases) {
    const env = loadPlugin({ ...base, sessions: makeComposerSessions(), ...extra })
    event = env({ key: 'i', code: 'KeyI', ctrlKey: true })
    check(`${label} → Ctrl+I 不吞键(no-op)`, event.propagationStopped !== true)
  }

  // 无当前会话 / current 为空串:sessions 有 conversation 也不动作
  for (const [label, current] of [['无当前会话', undefined], ['current 为空串', '']]) {
    const env = loadPlugin({
      ...base,
      sessions: { list: { getSnapshot: () => ({ ...snapshot, current }) }, binding: () => ({ ctx: actx }) },
      conversation: {
        input: { for: () => { throw new Error('must not resolve without a current session') } },
      },
    })
    event = env({ key: 'i', code: 'KeyI', ctrlKey: true })
    check(`${label} → Ctrl+I 不吞键`, event.propagationStopped !== true)
  }

  // 键位可经 localStorage 覆盖(与左右栏同一套 bindings 机制)
  storage.set('dsh-kbd-hotkeys:v1', JSON.stringify({ bindings: { 'composer.focus': 'mod+alt+k' } }))
  const customRoot = makeRoot()
  const custom = loadPlugin({
    ...base,
    sessions: makeComposerSessions(),
    conversation: { input: { for: () => ({ editor: { getRootElement: () => customRoot } }) } },
  })
  event = custom({ key: 'i', code: 'KeyI', ctrlKey: true })
  check('覆盖键位后 ⌘/Ctrl+I 不再聚焦', customRoot.focused !== true)
  event = custom({ key: 'k', code: 'KeyK', ctrlKey: true, altKey: true })
  check('自定义 ⌘/Ctrl+Alt+K → 聚焦', customRoot.focused === true)
  check('自定义键位被吞', event.propagationStopped === true)
  storage.delete('dsh-kbd-hotkeys:v1')
}

// ===========================================================================
// 阶段 5:⌘/Ctrl+Alt+← / → → 右侧栏标签切换
//         标签顺序 = rightbar.session 注册项 store handle → uiSession.resolve →
//         slots.resolveStore → bySession[sessionId].layout(activePaneId 面板);
//         切换 = 公开的 sidebarRight.focus(tabId)。DOM 桩无任何标签元素,
//         任何选择器式实现都拿不到顺序。
// ===========================================================================
console.log('\n--- ⌘/Ctrl+Alt+← / → → 右侧栏标签切换 ---')
{
  /** 假右栏会话级 store:快照形状 = { bySession: { <id>: { layout } } }。 */
  function makeTabsStore() {
    const handle = { spec: {} }
    let state = { bySession: {} }
    /** 复刻上游 focusTab 语义:改当前面板的 activeTabId(下一次按键据此重新计算)。 */
    const focusTab = (tabId, sessionId = 'sess-b') => {
      const layout = state.bySession[sessionId]?.layout
      if (layout === undefined) throw new Error('sidebarRight: no session surface is mounted')
      const pane = layout.nodes[layout.activePaneId]
      if (pane === undefined || !pane.tabs.includes(tabId)) return
      pane.activeTabId = tabId
    }
    return {
      handle,
      instance: { getSnapshot: () => state },
      read: () => state,
      focusTab,
      seed: (layout, sessionId = 'sess-b') => {
        state = { bySession: { [sessionId]: { layout: clone(layout) } } }
      },
    }
  }
  /** 三个标签、当前在中间:guide → file → diff。 */
  const layoutTabs = (over = {}) => ({
    rootId: 'pane-1',
    activePaneId: 'pane-1',
    expanded: true,
    nodes: { 'pane-1': { kind: 'pane', host: 'dock', id: 'pane-1', tabs: ['t1', 't2', 't3'], activeTabId: 't2' } },
    tabs: {
      t1: { id: 't1', kind: 'guide' },
      t2: { id: 't2', kind: 'text' },
      t3: { id: 't3', kind: 'document-preview' },
    },
    ...over,
  })
  /** rightbar.session 的假 slots:无 store 的干扰项 + 承载 store handle 的注册项。 */
  function tabsSlots(tabs) {
    return {
      entries: (key) => (key !== 'rightbar.session' ? [] : [{ select: () => ({}) }, { store: tabs.handle }]),
      resolveStore: (handle, binding) => {
        if (handle !== tabs.handle) throw new Error('resolved the wrong store handle')
        if (binding?.key !== 'sess-b') throw new Error(`bad scope binding: ${JSON.stringify(binding)}`)
        return tabs.instance
      },
    }
  }
  const okBinding = (sessionId) => (sessionId === 'sess-b' ? { key: 'sess-b', ctx: {} } : undefined)
  /** 装一个「右栏完整可用」的环境,返回按键函数与 focus 调用记录。 */
  function env(tabs, over = {}) {
    const focused = []
    const pressKey = loadPlugin({
      sessions: { ...sessions, binding: () => undefined },
      uiSession: { pendingInteractions: { getSnapshot: () => new Map() }, resolve: okBinding },
      workspaces: { list: { getSnapshot: () => ({ archivedSessionIds: [] }) } },
      slots: tabsSlots(tabs),
      sidebarRight: {
        toggleExpanded() {},
        // 与上游同一语义:focus 落到 store 上(下一次按键据新状态重新计算)。
        focus: (tabId) => { focused.push(tabId); tabs.focusTab(tabId) },
      },
      ...over,
    })
    return { press: pressKey, focused }
  }

  const tabs = makeTabsStore()
  tabs.seed(layoutTabs())
  const { press, focused } = env(tabs)

  // → 中间 → 末个标签
  let event = press({ key: 'ArrowRight', code: 'ArrowRight', ctrlKey: true, altKey: true })
  check('⌘/Ctrl+Alt+→ → focus(下一个标签 t3)', same(focused, ['t3']), JSON.stringify(focused))
  check('⌘/Ctrl+Alt+→ 被吞', event.propagationStopped === true)

  // 末个标签按 → 循环回第一个
  event = press({ key: 'ArrowRight', code: 'ArrowRight', ctrlKey: true, altKey: true })
  check('末个标签按 → 循环回 t1', same(focused, ['t3', 't1']), JSON.stringify(focused))
  check('循环切换被吞', event.propagationStopped === true)

  // 第一个标签按 ← 循环回最后一个
  event = press({ key: 'ArrowLeft', code: 'ArrowLeft', ctrlKey: true, altKey: true })
  check('首个标签按 ← 循环到 t3', same(focused, ['t3', 't1', 't3']), JSON.stringify(focused))
  check('⌘/Ctrl+Alt+← 被吞', event.propagationStopped === true)

  // 输入态(焦点在输入框)同样可用:带修饰键的组合不干扰文本编辑
  event = press({ key: 'ArrowLeft', code: 'ArrowLeft', ctrlKey: true, altKey: true, target: new FakeHTMLElement('TEXTAREA') })
  check('editing 态 ⌘/Ctrl+Alt+← 仍切标签', same(focused, ['t3', 't1', 't3', 't2']), JSON.stringify(focused))
  check('editing 态 ⌘/Ctrl+Alt+← 被吞', event.propagationStopped === true)

  // 无修饰键的 ← / → 不得触发右栏切标签(browse 态放行给页面)
  event = press({ key: 'ArrowRight', code: 'ArrowRight' })
  check('裸 → 不切右栏标签', same(focused, ['t3', 't1', 't3', 't2']), JSON.stringify(focused))
  check('裸 → 不吞键', event.propagationStopped !== true)

  // 当前标签不在面板里(activeTabId 失配)→ 落到第一个,而不是乱跳
  const unknown = makeTabsStore()
  unknown.seed(layoutTabs({ nodes: { 'pane-1': { kind: 'pane', host: 'dock', id: 'pane-1', tabs: ['t1', 't2'], activeTabId: 'nope' } } }))
  const unknownEnv = env(unknown)
  unknownEnv.press({ key: 'ArrowRight', code: 'ArrowRight', ctrlKey: true, altKey: true })
  check('activeTabId 失配时落在首个标签', same(unknownEnv.focused, ['t1']), JSON.stringify(unknownEnv.focused))

  // 只有一个标签:no-op 且不吞键(不循环回自身)
  const single = makeTabsStore()
  single.seed(layoutTabs({ nodes: { 'pane-1': { kind: 'pane', host: 'dock', id: 'pane-1', tabs: ['t1'], activeTabId: 't1' } }, tabs: { t1: { id: 't1' } } }))
  const singleEnv = env(single)
  event = singleEnv.press({ key: 'ArrowRight', code: 'ArrowRight', ctrlKey: true, altKey: true })
  check('单标签 → 不调 focus(no-op)', same(singleEnv.focused, []), JSON.stringify(singleEnv.focused))
  check('单标签 → 不吞键', event.propagationStopped !== true)
  event = singleEnv.press({ key: 'ArrowLeft', code: 'ArrowLeft', ctrlKey: true, altKey: true })
  check('单标签 ← 不吞键', event.propagationStopped !== true)

  // 面板无标签 / 非 pane 节点 / 该会话尚无面板:全部 no-op
  const noTabs = makeTabsStore()
  noTabs.seed(layoutTabs({ nodes: { 'pane-1': { kind: 'pane', host: 'dock', id: 'pane-1', tabs: [], activeTabId: undefined } } }))
  event = env(noTabs).press({ key: 'ArrowRight', code: 'ArrowRight', ctrlKey: true, altKey: true })
  check('面板无标签 → 不吞键', event.propagationStopped !== true)

  const notPane = makeTabsStore()
  notPane.seed(layoutTabs({ nodes: { 'pane-1': { kind: 'split' } } }))
  event = env(notPane).press({ key: 'ArrowRight', code: 'ArrowRight', ctrlKey: true, altKey: true })
  check('activePaneId 指向非 pane 节点 → 不吞键', event.propagationStopped !== true)

  const otherSession = makeTabsStore()
  otherSession.seed(layoutTabs(), 'sess-other')
  event = env(otherSession).press({ key: 'ArrowRight', code: 'ArrowRight', ctrlKey: true, altKey: true })
  check('该会话尚无面板 → 不吞键', event.propagationStopped !== true)

  // 无降级:服务 / 注册项 / store 任一环不可用 → no-op 且不吞键
  const noopCases = [
    ['sidebarRight 缺席', { sidebarRight: undefined }],
    ['sidebarRight 无 focus', { sidebarRight: { toggleExpanded() {} } }],
    ['slots 缺席', { slots: undefined }],
    ['slots 无 resolveStore', { slots: { entries: () => [{ store: tabs.handle }] } }],
    ['注册项都没有 store', { slots: { entries: () => [{ select: () => ({}) }], resolveStore: () => tabs.instance } }],
    ['uiSession 无 resolve', { uiSession: { pendingInteractions: { getSnapshot: () => new Map() } } }],
    ['resolveStore 抛错(handle 未注册)', {
      slots: { entries: () => [{ store: tabs.handle }], resolveStore: () => { throw new Error('store handle is not registered') } },
    }],
    ['活实例缺 getSnapshot', {
      slots: { entries: () => [{ store: tabs.handle }], resolveStore: () => ({}) },
    }],
    ['快照缺 bySession', {
      slots: { entries: () => [{ store: tabs.handle }], resolveStore: () => ({ getSnapshot: () => ({}) }) },
    }],
    ['focus 抛错(无挂载会话面)', { sidebarRight: { toggleExpanded() {}, focus: () => { throw new Error('sidebarRight: no session surface is mounted') } } }],
  ]
  for (const [label, extra] of noopCases) {
    const envCase = env(tabs, extra)
    const right = envCase.press({ key: 'ArrowRight', code: 'ArrowRight', ctrlKey: true, altKey: true })
    const left = envCase.press({ key: 'ArrowLeft', code: 'ArrowLeft', ctrlKey: true, altKey: true })
    check(`${label} → → 不吞键(no-op)`, right.propagationStopped !== true)
    check(`${label} → ← 不吞键(no-op)`, left.propagationStopped !== true)
  }

  // 无当前会话 / current 为空串:sessions 服务也在,但不得切标签
  for (const [label, current] of [['无当前会话', undefined], ['current 为空串', '']]) {
    const envCase = env(tabs, {
      sessions: { ...sessions, list: { getSnapshot: () => ({ ...snapshot, current }) } },
    })
    event = envCase.press({ key: 'ArrowRight', code: 'ArrowRight', ctrlKey: true, altKey: true })
    check(`${label} → 切标签不吞键`, event.propagationStopped !== true)
  }

  // card 态(有待处理问答卡片)同样接管:卡片占用的是**裸** ← / →,带 mod+alt 的组合键不冲突
  const cardTabs = makeTabsStore()
  cardTabs.seed(layoutTabs())
  const cardEnv = env(cardTabs, {
    uiSession: {
      pendingInteractions: { getSnapshot: () => new Map([['sess-b', { kind: 'question', key: 'question:20', sessionId: 'sess-b', questions: [{ id: 'q1', question: 'Q?', options: [{ label: 'A' }] }] }]]) },
      resolve: okBinding,
    },
  })
  event = cardEnv.press({ key: 'ArrowRight', code: 'ArrowRight', ctrlKey: true, altKey: true })
  check('card 态 ⌘/Ctrl+Alt+→ 仍切标签(与裸方向键不冲突)', same(cardEnv.focused, ['t3']), JSON.stringify(cardEnv.focused))
  check('card 态 ⌘/Ctrl+Alt+→ 被吞', event.propagationStopped === true)
  // 裸 ← / → 在 card 态仍归问答卡片(不切右栏标签)
  event = cardEnv.press({ key: 'ArrowLeft', code: 'ArrowLeft' })
  check('card 态裸 ← 不切右栏标签', same(cardEnv.focused, ['t3']), JSON.stringify(cardEnv.focused))
  pending.delete('sess-b')

  // 键位可经 localStorage 独立覆盖(与左右栏 / 聚焦输入框同一套 bindings 机制)
  storage.set('dsh-kbd-hotkeys:v1', JSON.stringify({ bindings: { 'sidebarRight.tabNext': 'mod+alt+.' } }))
  const custom = env(tabs)
  event = custom.press({ key: 'ArrowRight', code: 'ArrowRight', ctrlKey: true, altKey: true })
  check('覆盖键位后 ⌘/Ctrl+Alt+→ 不再切标签', same(custom.focused, []), JSON.stringify(custom.focused))
  check('覆盖键位后 ⌘/Ctrl+Alt+→ 不吞键', event.propagationStopped !== true)
  event = custom.press({ key: '.', code: 'Period', ctrlKey: true, altKey: true })
  check('自定义 ⌘/Ctrl+Alt+. → 切标签', same(custom.focused, ['t3']), JSON.stringify(custom.focused))
  check('自定义键位被吞', event.propagationStopped === true)
  event = custom.press({ key: 'ArrowLeft', code: 'ArrowLeft', ctrlKey: true, altKey: true })
  check('未覆盖的 ← 仍按默认键位切标签', same(custom.focused, ['t3', 't2']), JSON.stringify(custom.focused))
  storage.delete('dsh-kbd-hotkeys:v1')
}

// ===========================================================================
// 阶段 6:⌘/Ctrl+Alt+\ → 右侧栏打开文件浏览器并置于首位
//         打开必须走公开的 `sidebarRight.openTab('files')`;
//         置顶必须走**同一份**会话级 slot store 实例的动作面
//         `actions.placeTab(sessionId, tabId, paneId, 0)`(与标签拖拽同一入口)。
//         DOM 桩没有任何标签元素:任何选择器式实现都拿不到标签顺序。
// ===========================================================================
console.log('\n--- ⌘/Ctrl+Alt+\\ → 右栏打开文件浏览器并置于首位 ---')
{
  const FILES_KIND = 'files'

  /** 假右栏会话级 store:快照 { bySession: { <id>: { layout } } } + 实例动作面 placeTab。 */
  function makeFilesStore() {
    const handle = { spec: {} }
    let state = { bySession: {} }
    const calls = []
    let minted = 0
    /** 复刻上游 placeTab 的落位语义(同面板重排 / 跨面板搬移;越界 clamp)。 */
    const placeTab = (sessionId, tabId, toPaneId, index) => {
      calls.push([sessionId, tabId, toPaneId, index])
      const layout = state.bySession[sessionId]?.layout
      if (layout === undefined) throw new Error('sidebarRight: no session surface is mounted')
      const target = layout.nodes[toPaneId]
      if (target === undefined || target.kind !== 'pane' || target.host !== 'dock') return
      for (const node of Object.values(layout.nodes)) {
        if (node?.kind !== 'pane') continue
        node.tabs = (node.tabs ?? []).filter((id) => id !== tabId)
      }
      const at = Math.max(0, Math.min(index, target.tabs.length))
      target.tabs.splice(at, 0, tabId)
      layout.activePaneId = target.id
    }
    /** 复刻上游 openContent 的页语义:目标面板已有该页 → 只聚焦;否则在面板末尾新建。 */
    const open = (kind, sessionId = 'sess-b') => {
      const layout = state.bySession[sessionId]?.layout
      if (layout === undefined) throw new Error('sidebarRight: no session surface is mounted')
      const pane = layout.nodes[layout.activePaneId]
      if (pane === undefined || pane.kind !== 'pane') throw new Error('sidebarRight: no session surface is mounted')
      const held = (pane.tabs ?? []).find((id) => layout.tabs[id]?.kind === kind)
      if (held !== undefined) {
        pane.activeTabId = held
        return held
      }
      minted += 1
      const tabId = `${kind}-${minted}`
      layout.tabs[tabId] = { id: tabId, kind, contentId: `sidebar://${kind}`, title: kind }
      pane.tabs.push(tabId)
      pane.activeTabId = tabId
      return tabId
    }
    return {
      handle,
      calls,
      open,
      instance: { getSnapshot: () => state, actions: { placeTab }, subscribe: () => () => {} },
      seed: (layout, sessionId = 'sess-b') => { state = { bySession: { [sessionId]: { layout: clone(layout) } } } },
      layout: (sessionId = 'sess-b') => state.bySession[sessionId]?.layout,
    }
  }

  const pageTabs = (id, kind) => ({ [id]: { id, kind, contentId: `sidebar://${kind}` } })
  /** 单面板布局:标签顺序 + 每条记录(供 kind 判定)。 */
  const singlePane = (ids, extraTabs = {}, over = {}) => ({
    rootId: 'pane-1',
    activePaneId: 'pane-1',
    expanded: true,
    nodes: { 'pane-1': { kind: 'pane', host: 'dock', id: 'pane-1', tabs: [...ids], activeTabId: ids[ids.length - 1] } },
    tabs: { ...pageTabs('t1', 'guide'), ...extraTabs },
    ...over,
  })
  /** rightbar.session 的假 slots:无 store 的干扰项 + 承载 store handle 的注册项。 */
  function filesSlots(tabs) {
    return {
      entries: (key) => (key !== 'rightbar.session' ? [] : [{ select: () => ({}) }, { store: tabs.handle }]),
      resolveStore: (handle, binding) => {
        if (handle !== tabs.handle) throw new Error('resolved the wrong store handle')
        if (binding?.key !== 'sess-b') throw new Error(`bad scope binding: ${JSON.stringify(binding)}`)
        return tabs.instance
      },
    }
  }
  const okBinding = (sessionId) => (sessionId === 'sess-b' ? { key: 'sess-b', ctx: {} } : undefined)
  /** 装一个「右栏完整可用」的环境;`openTab` 落到假 store 上(下一次读快照即新状态)。 */
  function env(tabs, over = {}) {
    const opened = []
    const press = loadPlugin({
      sessions: { ...sessions, binding: () => undefined },
      uiSession: { pendingInteractions: { getSnapshot: () => new Map() }, resolve: okBinding },
      workspaces: { list: { getSnapshot: () => ({ archivedSessionIds: [] }) } },
      slots: filesSlots(tabs),
      sidebarRight: {
        toggleExpanded() {},
        openTab: (kind) => { opened.push(kind); tabs.open(kind) },
      },
      ...over,
    })
    return { press, opened }
  }
  const combo = { key: '\\', code: 'Backslash', ctrlKey: true, altKey: true }

  // ① 已有文件浏览器 tab 但不在首位 → 打开(聚焦) + placeTab(…, 0)
  const tabs = makeFilesStore()
  tabs.seed(singlePane(['t1', 't2', 't3'], {
    t2: { id: 't2', kind: 'text', contentId: 'dsh-resource://file/session/sess-b/a.ts' },
    t3: { id: 't3', kind: 'files', contentId: 'sidebar://files' },
  }))
  const first = env(tabs)
  let event = first.press(combo)
  check('⌘/Ctrl+Alt+\\ → 调 openTab("files")', same(first.opened, ['files']), JSON.stringify(first.opened))
  check('置顶 → placeTab(sess-b, t3, pane-1, 0)',
    same(tabs.calls, [['sess-b', 't3', 'pane-1', 0]]), JSON.stringify(tabs.calls))
  check('置顶后标签顺序 = [t3, t1, t2]',
    same(tabs.layout().nodes['pane-1'].tabs, ['t3', 't1', 't2']), JSON.stringify(tabs.layout().nodes['pane-1'].tabs))
  check('⌘/Ctrl+Alt+\\ 被吞', event.propagationStopped === true)

  // ② 面板里没有文件浏览器 tab → openTab 新建(末尾)→ 再置顶到首位
  const fresh = makeFilesStore()
  fresh.seed(singlePane(['t1']))
  const freshEnv = env(fresh)
  event = freshEnv.press(combo)
  check('无 files tab → 仍然 openTab("files")', same(freshEnv.opened, ['files']), JSON.stringify(freshEnv.opened))
  check('新建的 files tab 被置顶',
    same(fresh.layout().nodes['pane-1'].tabs, ['files-1', 't1']), JSON.stringify(fresh.layout().nodes['pane-1'].tabs))
  check('新建的 files tab 被聚焦', fresh.layout().nodes['pane-1'].activeTabId === 'files-1')
  check('新建后仍被吞', event.propagationStopped === true)

  // ③ 已经在首位 → 零提交、零历史(不调 placeTab),但打开照旧吞键
  const already = makeFilesStore()
  already.seed(singlePane(['files-9', 't1', 't2'], {}, {
    tabs: {
      ...pageTabs('t1', 'guide'),
      t2: { id: 't2', kind: 'text', contentId: 'dsh-resource://file/session/sess-b/a.ts' },
      'files-9': { id: 'files-9', kind: 'files', contentId: 'sidebar://files' },
    },
  }))
  const alreadyEnv = env(already)
  event = alreadyEnv.press(combo)
  check('已在首位 → 不调 placeTab(零提交)', same(already.calls, []), JSON.stringify(already.calls))
  check('已在首位 → 顺序不变', same(already.layout().nodes['pane-1'].tabs, ['files-9', 't1', 't2']),
    JSON.stringify(already.layout().nodes['pane-1'].tabs))
  check('已在首位 → 仍吞键(打开确实做了事)', event.propagationStopped === true)

  // ④ 跨面板:优先当前面板(本次 openTab 的落点),不去搬别的面板里已有的 files tab
  const split = makeFilesStore()
  split.seed({
    rootId: 'pane-1',
    activePaneId: 'pane-1',
    expanded: true,
    nodes: {
      'pane-1': { kind: 'pane', host: 'dock', id: 'pane-1', tabs: ['t1'], activeTabId: 't1' },
      'pane-2': { kind: 'pane', host: 'dock', id: 'pane-2', tabs: ['t-other'], activeTabId: 't-other' },
    },
    tabs: {
      ...pageTabs('t1', 'guide'),
      't-other': { id: 't-other', kind: 'files', contentId: 'sidebar://files' },
    },
  })
  const splitEnv = env(split)
  event = splitEnv.press(combo)
  check('跨面板 → 置顶的是当前面板里刚打开的那个', same(split.calls, [['sess-b', 'files-1', 'pane-1', 0]]), JSON.stringify(split.calls))
  check('另一个面板里的 files tab 不被搬动(不被 arriving 关掉)',
    same(split.layout().nodes['pane-2'].tabs, ['t-other']), JSON.stringify(split.layout().nodes['pane-2'].tabs))
  check('跨面板置顶被吞', event.propagationStopped === true)

  // ⑤ 浮窗里的 files tab 不参与置顶(浮窗不碰)
  const floated = makeFilesStore()
  floated.seed({
    rootId: 'pane-1',
    activePaneId: 'pane-1',
    expanded: true,
    floats: ['pane-f'],
    nodes: {
      'pane-1': { kind: 'pane', host: 'dock', id: 'pane-1', tabs: ['t1'], activeTabId: 't1' },
      'pane-f': { kind: 'pane', host: 'float', id: 'pane-f', tabs: ['t-float'], activeTabId: 't-float' },
    },
    tabs: {
      ...pageTabs('t1', 'guide'),
      't-float': { id: 't-float', kind: 'files', contentId: 'sidebar://files' },
    },
  })
  const floatEnv = env(floated)
  event = floatEnv.press(combo)
  check('浮窗 → 落点是停靠面板', same(floated.calls, [['sess-b', 'files-1', 'pane-1', 0]]), JSON.stringify(floated.calls))
  check('浮窗里的 files tab 原样保留',
    same(floated.layout().nodes['pane-f'].tabs, ['t-float']), JSON.stringify(floated.layout().nodes['pane-f'].tabs))

  // ⑥ 无降级:打开失败(无挂载会话面 / files 类型未注册)→ no-op 且不吞键
  for (const [label, message] of [
    ['无挂载会话面', 'sidebarRight: no session surface is mounted'],
    ['files 类型未注册', 'sidebarRight: no tab type is registered as "files"'],
  ]) {
    const failing = makeFilesStore()
    failing.seed(singlePane(['t1']))
    const caseEnv = env(failing, {
      sidebarRight: { toggleExpanded() {}, openTab: () => { throw new Error(message) } },
    })
    event = caseEnv.press(combo)
    check(`${label} → 不吞键(no-op)`, event.propagationStopped !== true)
    check(`${label} → 不调 placeTab`, same(failing.calls, []), JSON.stringify(failing.calls))
  }

  // ⑦ 服务/注册项不可用:打开成功仍吞键,置顶静默跳过(不回退 DOM、不抛)
  const storeCases = [
    ['sidebarRight 无 openTab', () => ({ sidebarRight: { toggleExpanded() {} } }), false],
    ['slots 缺席', () => ({ slots: undefined }), true],
    ['slots 无 resolveStore', (t) => ({ slots: { entries: () => [{ store: t.handle }] } }), true],
    ['resolveStore 抛错(handle 未注册)', (t) => ({
      slots: { entries: () => [{ store: t.handle }], resolveStore: () => { throw new Error('store handle is not registered') } },
    }), true],
    ['活实例缺 getSnapshot', (t) => ({
      slots: { entries: () => [{ store: t.handle }], resolveStore: () => ({ actions: { placeTab() {} } }) },
    }), true],
    ['快照缺 bySession', (t) => ({
      slots: { entries: () => [{ store: t.handle }], resolveStore: () => ({ getSnapshot: () => ({}), actions: { placeTab() {} } }) },
    }), true],
    ['实例无 actions(只读面)', (t) => ({
      slots: { entries: () => [{ store: t.handle }], resolveStore: () => ({ getSnapshot: () => t.instance.getSnapshot() }) },
    }), true],
  ]
  for (const [label, makeOver, shouldSwallow] of storeCases) {
    const caseTabs = makeFilesStore()
    caseTabs.seed(singlePane(['t1']))
    const caseEnv = env(caseTabs, makeOver(caseTabs))
    event = caseEnv.press(combo)
    check(`${label} → 不崩、吞键=${String(shouldSwallow)}`, (event.propagationStopped === true) === shouldSwallow,
      `stopped=${String(event.propagationStopped)} calls=${JSON.stringify(caseTabs.calls)}`)
  }

  // ⑧ 无当前会话 → 打开照旧,但不得置顶(取不到 sessionId)
  const noSession = makeFilesStore()
  noSession.seed(singlePane(['t1']))
  const noSessionEnv = env(noSession, {
    sessions: { ...sessions, list: { getSnapshot: () => ({ ...snapshot, current: undefined }) } },
  })
  event = noSessionEnv.press(combo)
  check('无当前会话 → 不调 placeTab', same(noSession.calls, []), JSON.stringify(noSession.calls))

  // ⑨ editing / card 态同样生效(带修饰键的组合不与文本编辑、卡片的裸键冲突)
  const editable = makeFilesStore()
  editable.seed(singlePane(['t1']))
  const editableEnv = env(editable)
  event = editableEnv.press({ ...combo, target: new FakeHTMLElement('TEXTAREA') })
  check('editing 态 ⌘/Ctrl+Alt+\\ 仍打开并置顶', same(editable.calls, [['sess-b', 'files-1', 'pane-1', 0]]), JSON.stringify(editable.calls))
  check('editing 态被吞', event.propagationStopped === true)

  const cardFiles = makeFilesStore()
  cardFiles.seed(singlePane(['t1']))
  const cardFilesEnv = env(cardFiles, {
    uiSession: {
      pendingInteractions: { getSnapshot: () => new Map([['sess-b', { kind: 'question', key: 'question:21', sessionId: 'sess-b', questions: [{ id: 'q1', question: 'Q?', options: [{ label: 'A' }] }] }]]) },
      resolve: okBinding,
    },
  })
  event = cardFilesEnv.press(combo)
  check('card 态 ⌘/Ctrl+Alt+\\ 仍打开并置顶', cardFiles.calls.length === 1, JSON.stringify(cardFiles.calls))
  check('card 态被吞', event.propagationStopped === true)

  // ⑩ 裸 \ 不触发(mod+alt 才触发)
  const bare = makeFilesStore()
  bare.seed(singlePane(['t1']))
  const bareEnv = env(bare)
  event = bareEnv.press({ key: '\\', code: 'Backslash' })
  check('裸 \\ 不打开文件浏览器', same(bareEnv.opened, []), JSON.stringify(bareEnv.opened))
  check('裸 \\ 不吞键', event.propagationStopped !== true)

  // ⑪ 键位可独立覆盖(与左右栏 / 标签切换 / 聚焦输入框同一套 bindings 机制)
  storage.set('dsh-kbd-hotkeys:v1', JSON.stringify({ bindings: { 'sidebarRight.files': 'mod+alt+7' } }))
  const custom = makeFilesStore()
  custom.seed(singlePane(['t1']))
  const customEnv = env(custom)
  event = customEnv.press(combo)
  check('覆盖键位后 ⌘/Ctrl+Alt+\\ 不再打开', same(customEnv.opened, []), JSON.stringify(customEnv.opened))
  check('覆盖键位后 ⌘/Ctrl+Alt+\\ 不吞键', event.propagationStopped !== true)
  event = customEnv.press({ key: '7', code: 'Digit7', ctrlKey: true, altKey: true })
  check('自定义 ⌘/Ctrl+Alt+7 → 打开并置顶', same(custom.calls, [['sess-b', 'files-1', 'pane-1', 0]]), JSON.stringify(custom.calls))
  check('自定义键位被吞', event.propagationStopped === true)
  storage.delete('dsh-kbd-hotkeys:v1')
}

console.log(`\n${failures === 0 ? 'ALL PASS' : `${String(failures)} FAILED`}`)
process.exitCode = failures === 0 ? 0 : 1
