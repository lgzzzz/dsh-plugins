/**
 * 诊断脚本(非插件产物):最小 DOM 桩加载 lib/client.js,验证各动作只走服务面、不触碰 DOM(桩的 querySelector 恒空);
 * 覆盖交互/草稿 store、左右栏与标签、文件/终端、聚焦输入框、强度循环与三个数据浮窗;桩里上游方法须写成读 this 的类方法形态。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

// ---- 最小 DOM 桩:不提供任何卡片元素,仅记录浮层自建的 DOM 子树 ----
class FakeNode {}
class FakeHTMLElement extends FakeNode {
  constructor(tag = 'DIV') {
    super()
    this.tagName = tag
    this.isContentEditable = false
    this.disabled = false
    // 仅用于观察插件浮层自建的子树;业务代码不读 DOM(卡片元素一律不存在)。
    this.children = []
    this.parent = null
    this.textContent = null
  }
  focus() { this.focused = true }
  click() { this.clicked = true }
  getAttribute() { return null }
  querySelector() { return null }
  querySelectorAll() { return [] }
  closest() { return null }
  contains() { return false }
  remove() {
    if (this.parent !== null) this.parent.children = this.parent.children.filter((child) => child !== this)
    this.parent = null
  }
  appendChild(child) { this.children.push(child); child.parent = this; return child }
  addEventListener() {}
}
class FakeDocument {
  constructor() {
    this.listeners = new Map()
    // body / head 须是稳定实例,否则浮层挂载点不可观察(子树会被丢掉)
    this._body = new FakeHTMLElement('BODY')
    this._head = new FakeHTMLElement('HEAD')
  }
  addEventListener(type, fn, capture) {
    if (!this.listeners.has(type)) this.listeners.set(type, [])
    this.listeners.get(type).push({ fn, capture })
  }
  removeEventListener() {}
  querySelector() { return null }
  querySelectorAll(selector) { return selector === '[data-dockkit-pane]' ? dockPanes : [] }
  createElement(tag) { return new FakeHTMLElement(tag.toUpperCase()) }
  getElementById() { return null }
  get body() { return this._body }
  get head() { return this._head }
}
/** 可注入的假停靠面板:仅 ⌘/Ctrl+L 的元素级聚焦需要 DOM(见阶段 7 的 ⑮),默认空。 */
let dockPanes = []
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

// ---- 浮层观察工具(只读插件自建子树) ----------------------------------------
/** 深度优先收集满足条件的元素。 */
function collectNodes(node, predicate, out = []) {
  for (const child of node.children ?? []) {
    if (predicate(child)) out.push(child)
    collectNodes(child, predicate, out)
  }
  return out
}
const classHas = (el, name) => typeof el.className === 'string' && el.className.split(' ').includes(name)
/** 当前浮层渲染的工作区行(按 DOM 顺序)。 */
const pickerRows = () => collectNodes(globalThis.document.body, (el) => classHas(el, 'dsh-kbd-row'))
/** 高亮行下标(-1 = 无高亮)。 */
const activeRowIndex = () => pickerRows().findIndex((el) => classHas(el, 'isActive'))
/** 一行/一个节点的全部文本(自带 textContent + 子树,压缩空白)。 */
function nodeText(node) {
  const own = typeof node.textContent === 'string' ? node.textContent : ''
  return [own, ...(node.children ?? []).map(nodeText)].join(' ').replace(/\s+/g, ' ').trim()
}

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

/** 假草稿 store:复刻上游 replace(覆盖 requestKey + progress)/ clear(仅 requestKey 匹配时清空)。 */
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

/** conversation.composer 假 slots:承载 store 的注册项 + 干扰项(无 store / select 不匹配)。 */
function composerSlots(draft) {
  const otherHandle = { spec: {} }
  return {
    entries: (key) => {
      if (key !== 'conversation.composer') return []
      return [
        { store: otherHandle, select: () => null }, // select 不匹配,必须跳过
        { select: () => ({}) }, // 无 store,必须跳过
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

// ---- 阶段 1:公开面 uiSession.pendingInteractions(服务级路径) ----
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

// ---- 阶段 2:仅私有字段 pendingSnapshot(兼容回退) ----
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

// ---- 阶段 3:⌘/Ctrl+B → layout.toggleSidebar、⌘/Ctrl+O → sidebarRight.toggleExpanded(互不串场) ----
console.log('\n--- ⌘/Ctrl+B / ⌘/Ctrl+O → 左右栏开关 ---')
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

  // ⌘/Ctrl+O:只打右栏
  event = both({ key: 'o', code: 'KeyO', ctrlKey: true })
  check('browse 态 ⌘/Ctrl+O → sidebarRight.toggleExpanded(右栏)', same([left, right], [1, 1]), `${left},${right}`)
  check('browse 态 ⌘/Ctrl+O 被吞', event.propagationStopped === true)

  // editing 态(焦点在输入框)两个键位同样生效
  event = both({ key: 'b', code: 'KeyB', ctrlKey: true, target: new FakeHTMLElement('TEXTAREA') })
  check('editing 态 ⌘/Ctrl+B → 左栏', same([left, right], [2, 1]), `${left},${right}`)
  check('editing 态 ⌘/Ctrl+B 被吞', event.propagationStopped === true)
  event = both({ key: 'o', code: 'KeyO', ctrlKey: true, target: new FakeHTMLElement('TEXTAREA') })
  check('editing 态 ⌘/Ctrl+O → 右栏', same([left, right], [2, 2]), `${left},${right}`)
  check('editing 态 ⌘/Ctrl+O 被吞', event.propagationStopped === true)

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
  event = custom({ key: 'o', code: 'KeyO', ctrlKey: true })
  check('右栏默认键位不受左栏自定义影响', same([customLeft, customRight], [1, 1]), `${customLeft},${customRight}`)
  storage.delete('dsh-kbd-hotkeys:v1')

  // 无降级:服务缺席 / 无挂载会话面(控制器 require 抛错)→ no-op 且不吞键
  const missing = loadPlugin(base)
  event = missing({ key: 'b', code: 'KeyB', ctrlKey: true })
  check('layout 缺席 → ⌘/Ctrl+B 不吞键', event.propagationStopped !== true)
  event = missing({ key: 'o', code: 'KeyO', ctrlKey: true })
  check('sidebarRight 缺席 → ⌘/Ctrl+O 不吞键', event.propagationStopped !== true)

  const dead = loadPlugin({
    ...base,
    layout: { toggleSidebar: () => { throw new Error('layout: not mounted') } },
    sidebarRight: { toggleExpanded: () => { throw new Error('sidebarRight: no session surface is mounted') } },
  })
  event = dead({ key: 'b', code: 'KeyB', ctrlKey: true })
  check('layout 抛错 → ⌘/Ctrl+B 不吞键', event.propagationStopped !== true)
  event = dead({ key: 'o', code: 'KeyO', ctrlKey: true })
  check('无挂载会话面(抛错)→ ⌘/Ctrl+O 不吞键', event.propagationStopped !== true)
}

// ---- 阶段 3b:⌘/Ctrl+N → uiWorkspace.startSession();三态放行,服务缺席 / 无动词 / 抛错 no-op 不吞键 ----
console.log('\n--- ⌘/Ctrl+N → 新建会话并跳转(uiWorkspace.startSession) ---')
{
  const base = {
    sessions,
    uiSession: { pendingInteractions: { getSnapshot: () => new Map() } },
    workspaces: { list: { getSnapshot: () => ({ archivedSessionIds: [] }) } },
  }

  const calls = []
  const workspace = loadPlugin({ ...base, uiWorkspace: { startSession: (id) => { calls.push(id) } } })

  let event = workspace({ key: 'n', code: 'KeyN', ctrlKey: true })
  check('browse 态 ⌘/Ctrl+N → startSession()', same(calls, [undefined]), JSON.stringify(calls))
  check('browse 态 ⌘/Ctrl+N 被吞', event.propagationStopped === true)

  // macOS:metaKey 同样命中(mod 同时吸收 ctrl/meta)
  event = workspace({ key: 'n', code: 'KeyN', metaKey: true })
  check('macOS ⌘N(metaKey)→ startSession()', calls.length === 2, JSON.stringify(calls))
  check('macOS ⌘N 被吞', event.propagationStopped === true)

  // editing 态(焦点在输入框)与 card 态(有待回应卡片)同样生效
  event = workspace({ key: 'n', code: 'KeyN', ctrlKey: true, target: new FakeHTMLElement('TEXTAREA') })
  check('editing 态 ⌘/Ctrl+N → startSession()', calls.length === 3, JSON.stringify(calls))
  check('editing 态 ⌘/Ctrl+N 被吞', event.propagationStopped === true)

  const cardPending = new Map([['sess-b', { kind: 'approval', key: 'approval:1', answer() {} }]])
  const cardCalls = []
  const cardEnv = loadPlugin({
    ...base,
    uiSession: { pendingInteractions: { getSnapshot: () => cardPending } },
    uiWorkspace: { startSession: () => { cardCalls.push(1) } },
  })
  event = cardEnv({ key: 'n', code: 'KeyN', ctrlKey: true })
  check('card 态 ⌘/Ctrl+N → startSession()(新建会话与卡片无关)', cardCalls.length === 1, String(cardCalls.length))
  check('card 态 ⌘/Ctrl+N 被吞', event.propagationStopped === true)

  // bindings 覆盖:session.new 是合法动作 id,键位可自定义
  storage.set('dsh-kbd-hotkeys:v1', JSON.stringify({ bindings: { 'session.new': 'mod+alt+n' } }))
  const customCalls = []
  const custom = loadPlugin({ ...base, uiWorkspace: { startSession: () => { customCalls.push(1) } } })
  event = custom({ key: 'n', code: 'KeyN', ctrlKey: true })
  check('覆盖键位后 ⌘/Ctrl+N 不再新建', customCalls.length === 0 && event.propagationStopped !== true)
  event = custom({ key: 'n', code: 'KeyN', ctrlKey: true, altKey: true })
  check('自定义 ⌘/Ctrl+Alt+N → startSession()', customCalls.length === 1, String(customCalls.length))
  check('自定义键位被吞', event.propagationStopped === true)
  storage.delete('dsh-kbd-hotkeys:v1')

  // 无降级:服务缺席 / 无 startSession / 抛错(无挂载会话面)→ no-op 且不吞键
  const missing = loadPlugin(base)
  event = missing({ key: 'n', code: 'KeyN', ctrlKey: true })
  check('uiWorkspace 缺席 → ⌘/Ctrl+N 不吞键', event.propagationStopped !== true)

  const noMethod = loadPlugin({ ...base, uiWorkspace: {} })
  event = noMethod({ key: 'n', code: 'KeyN', ctrlKey: true })
  check('无 startSession → ⌘/Ctrl+N 不吞键', event.propagationStopped !== true)

  const dead = loadPlugin({
    ...base,
    uiWorkspace: { startSession: () => { throw new Error('uiWorkspace: no mounted session surface') } },
  })
  event = dead({ key: 'n', code: 'KeyN', ctrlKey: true })
  check('startSession 抛错 → ⌘/Ctrl+N 不吞键', event.propagationStopped !== true)
}

// ---- 阶段 4:⌘/Ctrl+J → 聚焦对话输入框(J = Jump);只走服务链路(DOM 桩查询恒空) ----
// 路径 = binding.ctx → input.for(actx) → editor.getRootElement() → focus({preventScroll:true})
// 键位 mod+j;旧键位 mod+i 已不再绑定(见下方回归断言)。
console.log('\n--- ⌘/Ctrl+J → 聚焦输入框(conversation.input → shell.editor) ---')
{
  const actx = { scope: 'sess-b' } // binding('sess-b').ctx,必须原样传给 input.for
  const makeComposerSessions = (ctx = actx) => ({
    list: { getSnapshot: () => snapshot },
    open() {},
    binding: (id) => (id === 'sess-b' ? { ctx } : undefined),
  })
  const makeRoot = () => new FakeHTMLElement('DIV') // composer editor 宿主 div
  const base = {
    uiSession: { pendingInteractions: { getSnapshot: () => new Map() } },
    workspaces: { list: { getSnapshot: () => ({ archivedSessionIds: [] }) } },
  }

  // --- 主路径:browse 态 ⌘/Ctrl+J 聚焦,且 for() 收到的就是 binding.ctx 本身 ---
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
  let event = main({ key: 'j', code: 'KeyJ', ctrlKey: true, altKey: false })
  check('browse 态 Ctrl+J → 宿主元素 focus({preventScroll:true})', root.focused === true)
  check('Ctrl+J 被吞', event.propagationStopped === true)
  check('input.for 收到 binding.ctx 本身', same(seenActx, [actx]))
  check('主路径不触碰 shell(id)', shellCalls.length === 0, JSON.stringify(shellCalls))

  // --- 旧键位 ⌘/Ctrl+I 不再聚焦输入框(现为近期对话浮窗,按键仍被吞掉) ---
  const oldRoot = makeRoot()
  const old = loadPlugin({
    ...base,
    sessions: makeComposerSessions(),
    conversation: { input: { for: () => ({ editor: { getRootElement: () => oldRoot } }) } },
  })
  event = old({ key: 'i', code: 'KeyI', ctrlKey: true, altKey: false })
  check('Ctrl+I 不聚焦输入框(聚焦已改为 ⌘/Ctrl+J)', oldRoot.focused !== true)
  check('Ctrl+I 被近期对话浮窗消费(吞键)', event.propagationStopped === true)
  old({ key: 'Escape', code: 'Escape' })

  // --- macOS ⌘J:metaKey 同样归一化成 mod+j ---
  const macRoot = makeRoot()
  const mac = loadPlugin({
    ...base,
    sessions: makeComposerSessions(),
    conversation: { input: { for: () => ({ editor: { getRootElement: () => macRoot } }) } },
  })
  event = mac({ key: 'j', code: 'KeyJ', metaKey: true, altKey: false })
  check('macOS ⌘J(metaKey)→ 同样聚焦', macRoot.focused === true)
  check('macOS ⌘J 被吞', event.propagationStopped === true)

  // --- 元素级门闸:editing = 焦点在可编辑元素里,但不一定是 composer ---
  // 右栏终端(.xterm-helper-textarea)与 Monaco(.inputarea)都是真 textarea;焦点在那里时正是要跳回输入框。
  const elsewhereRoot = makeRoot()
  const seenEditing = [] // contains 与 focus 各取一次元素,故一次按键取两次
  const editing = loadPlugin({
    ...base,
    sessions: makeComposerSessions(),
    conversation: {
      input: { for: (arg) => { seenEditing.push(arg); return { editor: { getRootElement: () => elsewhereRoot } } } },
    },
  })
  event = editing({ key: 'j', code: 'KeyJ', ctrlKey: true, altKey: false, target: new FakeHTMLElement('TEXTAREA') })
  check('editing 态 + 焦点在别处可编辑元素(终端 / Monaco)→ Ctrl+J 聚焦输入框', elsewhereRoot.focused === true)
  check('editing 态 + 焦点在别处 → Ctrl+J 被吞', event.propagationStopped === true)
  check('editing 态 + 焦点在别处 → 走服务链路且 for 收到 binding.ctx', same(seenEditing, [actx, actx]), JSON.stringify(seenEditing))

  // 焦点已在 composer 内:不重复聚焦,但组合键仍被吞掉(放行会触发 Win/Linux 浏览器 Ctrl+J = 下载页)
  const inComposerTarget = new FakeHTMLElement('DIV')
  inComposerTarget.isContentEditable = true
  const inComposerRoot = makeRoot()
  inComposerRoot.contains = (node) => node === inComposerTarget
  const insideComposer = loadPlugin({
    ...base,
    sessions: makeComposerSessions(),
    conversation: { input: { for: () => ({ editor: { getRootElement: () => inComposerRoot } }) } },
  })
  event = insideComposer({ key: 'j', code: 'KeyJ', ctrlKey: true, altKey: false, target: inComposerTarget })
  check('editing 态 + 焦点已在 composer 内 → 不聚焦(动作无事可做)', inComposerRoot.focused !== true)
  check('editing 态 + 焦点已在 composer 内 → 仍吞键(不放行浏览器下载页)', event.propagationStopped === true)

  // 取不到 composer 宿主元素时门闸判为「不在 composer 内」,仍会走一次服务链路 → no-op 不吞键
  const noRootEditable = loadPlugin({ ...base, sessions: makeComposerSessions(), conversation: { input: {} } })
  event = noRootEditable({ key: 'j', code: 'KeyJ', ctrlKey: true, altKey: false, target: new FakeHTMLElement('TEXTAREA') })
  check('editing 态 + 取不到 composer 宿主 → Ctrl+J 不吞键(no-op)', event.propagationStopped !== true)

  // --- 态门闸:card(有待审批卡片)不接管 ---
  const cardPending = new Map([['sess-b', { kind: 'approval', key: 'a:1', answer() {} }]])
  const cardRoot = makeRoot()
  const card = loadPlugin({
    ...base,
    sessions: makeComposerSessions(),
    uiSession: { pendingInteractions: { getSnapshot: () => cardPending } },
    conversation: { input: { for: () => ({ editor: { getRootElement: () => cardRoot } }) } },
  })
  event = card({ key: 'j', code: 'KeyJ', ctrlKey: true, altKey: false })
  check('card 态 Ctrl+J 不聚焦', cardRoot.focused !== true)
  check('card 态 Ctrl+J 不吞键', event.propagationStopped !== true)

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
  event = viaShell({ key: 'j', code: 'KeyJ', ctrlKey: true, altKey: false })
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
  event = noCtx({ key: 'j', code: 'KeyJ', ctrlKey: true, altKey: false })
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
    event = env({ key: 'j', code: 'KeyJ', ctrlKey: true, altKey: false })
    check(`${label} → Ctrl+J 不吞键(no-op)`, event.propagationStopped !== true)
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
    event = env({ key: 'j', code: 'KeyJ', ctrlKey: true, altKey: false })
    check(`${label} → Ctrl+J 不吞键`, event.propagationStopped !== true)
  }

  // 键位可经 localStorage 覆盖(刻意避开默认 ⌘/Ctrl+K,改用 ⌘/Ctrl+Alt+J);
  storage.set('dsh-kbd-hotkeys:v1', JSON.stringify({ bindings: { 'composer.focus': 'mod+alt+j' } }))
  const customRoot = makeRoot()
  const custom = loadPlugin({
    ...base,
    sessions: makeComposerSessions(),
    conversation: { input: { for: () => ({ editor: { getRootElement: () => customRoot } }) } },
  })
  event = custom({ key: 'j', code: 'KeyJ', ctrlKey: true, altKey: false })
  check('覆盖键位后 ⌘/Ctrl+J 不再聚焦', customRoot.focused !== true)
  event = custom({ key: 'j', code: 'KeyJ', ctrlKey: true, altKey: true })
  check('自定义 ⌘/Ctrl+Alt+J → 聚焦', customRoot.focused === true)
  check('自定义键位被吞', event.propagationStopped === true)
  storage.delete('dsh-kbd-hotkeys:v1')
}

// ---- 阶段 5:⌘/Ctrl+Alt+← / → → 右栏标签切换 ----
// 顺序 = rightbar.session store(三步取数)→ bySession[id].layout;切换 = sidebarRight.focus(tabId)
console.log('\n--- ⌘/Ctrl+Alt+← / → → 右侧栏标签切换 ---')
{
  /** 假右栏会话级 store:快照形状 = { bySession: { <id>: { layout } } }。 */
  function makeTabsStore() {
    const handle = { spec: {} }
    let state = { bySession: {} }
    /** 复刻上游 focusTab:改当前面板的 activeTabId。 */
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
  /** rightbar.session 假 slots:干扰项 + 承载 store handle 的注册项。 */
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

// ---- 阶段 5b:⌘/Ctrl+. → 关闭右栏当前标签(现场与标签切换同源) ----
// 关闭 = sidebarRight.close(tabId);关完回读布局确认标签消失才吞键,否则 no-op(不复制上游判定)
console.log('\n--- ⌘/Ctrl+. → 右侧栏关闭当前标签 ---')
{
  /** 假右栏会话级 store:快照 { bySession: { <id>: { layout } } } + 复刻上游 closeTab 的可见结果。 */
  function makeCloseStore() {
    const handle = { spec: {} }
    let state = { bySession: {} }
    return {
      handle,
      instance: { getSnapshot: () => state },
      read: () => state,
      seed: (layout, sessionId = 'sess-b') => { state = { bySession: { [sessionId]: { layout: clone(layout) } } } },
      /** 复刻上游 closeTab:独占停靠的 guide 不关;其余从面板与 tabs 表里删掉。 */
      closeTab(tabId, sessionId = 'sess-b') {
        const layout = state.bySession[sessionId]?.layout
        if (layout === undefined) return
        const record = layout.tabs?.[tabId]
        if (record === undefined) return
        const panes = Object.values(layout.nodes).filter((node) => node.kind === 'pane')
        const pane = panes.find((node) => (node.tabs ?? []).includes(tabId))
        if (record.kind === 'guide' && pane?.host === 'dock' && pane.tabs.length === 1 && panes.length === 1) return
        delete layout.tabs[tabId]
        if (pane !== undefined) {
          pane.tabs = pane.tabs.filter((id) => id !== tabId)
          if (pane.activeTabId === tabId) pane.activeTabId = pane.tabs[0]
        }
        state = { bySession: { ...state.bySession, [sessionId]: { layout } } }
      },
    }
  }
  /** 默认布局:单停靠面板,当前标签 t2。 */
  const layoutClose = (over = {}) => ({
    rootId: 'pane-1',
    activePaneId: 'pane-1',
    expanded: true,
    nodes: { 'pane-1': { kind: 'pane', host: 'dock', id: 'pane-1', tabs: ['t1', 't2'], activeTabId: 't2' } },
    tabs: { t1: { id: 't1', kind: 'guide' }, t2: { id: 't2', kind: 'text' } },
    ...over,
  })
  /** rightbar.session 的假 slots:承载 store handle 的注册项(带无 store 的干扰项)。 */
  function closeSlots(store) {
    return {
      entries: (key) => (key !== 'rightbar.session' ? [] : [{ select: () => ({}) }, { store: store.handle }]),
      resolveStore: (handle, binding) => {
        if (handle !== store.handle) throw new Error('resolved the wrong store handle')
        if (binding?.key !== 'sess-b') throw new Error(`bad scope binding: ${JSON.stringify(binding)}`)
        return store.instance
      },
    }
  }
  /** 装一个「右栏完整可用」的环境,返回按键函数、close 调用记录与回读的标签列表。 */
  function env(store, over = {}) {
    const closed = []
    const pressKey = loadPlugin({
      sessions: { ...sessions, binding: () => undefined },
      uiSession: { pendingInteractions: { getSnapshot: () => new Map() }, resolve: (sessionId) => (sessionId === 'sess-b' ? { key: 'sess-b', ctx: {} } : undefined) },
      workspaces: { list: { getSnapshot: () => ({ archivedSessionIds: [] }) } },
      slots: closeSlots(store),
      sidebarRight: {
        toggleExpanded() {},
        // 与上游同一语义:close 落到 store 上(标签真的被删掉)。
        close: (tabId) => { closed.push(tabId); store.closeTab(tabId) },
      },
      ...over,
    })
    return { press: pressKey, closed, tabs: () => Object.keys(store.read().bySession['sess-b']?.layout?.tabs ?? {}) }
  }

  // 当前面板当前标签 → 关闭它并吞键
  const store = makeCloseStore()
  store.seed(layoutClose())
  const base = env(store)
  let event = base.press({ key: '.', code: 'Period', ctrlKey: true })
  check('⌘/Ctrl+. → close(当前标签 t2)', same(base.closed, ['t2']), JSON.stringify(base.closed))
  check('⌘/Ctrl+. 被吞', event.propagationStopped === true)
  check('标签真的从布局里消失', same(base.tabs(), ['t1']), JSON.stringify(base.tabs()))

  // 关的必须是**当前面板**的当前标签,不是第一个面板
  const twoPanes = makeCloseStore()
  twoPanes.seed(layoutClose({
    activePaneId: 'pane-2',
    nodes: {
      'pane-1': { kind: 'pane', host: 'dock', id: 'pane-1', tabs: ['t1', 't2'], activeTabId: 't2' },
      'pane-2': { kind: 'pane', host: 'dock', id: 'pane-2', tabs: ['t3'], activeTabId: 't3' },
    },
    tabs: { t1: { id: 't1', kind: 'guide' }, t2: { id: 't2' }, t3: { id: 't3', kind: 'terminal' } },
  }))
  const twoEnv = env(twoPanes)
  event = twoEnv.press({ key: '.', code: 'Period', ctrlKey: true })
  check('多面板时关当前面板的当前标签 t3', same(twoEnv.closed, ['t3']), JSON.stringify(twoEnv.closed))
  check('另一个面板的标签不受影响', same(twoEnv.tabs(), ['t1', 't2']), JSON.stringify(twoEnv.tabs()))

  // 未被激活的标签不关(当前标签缺失 → no-op 不吞键)
  const noActive = makeCloseStore()
  noActive.seed(layoutClose({ nodes: { 'pane-1': { kind: 'pane', host: 'dock', id: 'pane-1', tabs: ['t1', 't2'], activeTabId: 'nope' } } }))
  const noActiveEnv = env(noActive)
  event = noActiveEnv.press({ key: '.', code: 'Period', ctrlKey: true })
  check('activeTabId 失配 → 不调 close', same(noActiveEnv.closed, []), JSON.stringify(noActiveEnv.closed))
  check('activeTabId 失配 → 不吞键', event.propagationStopped !== true)

  // 独占停靠的 guide:上游拒关 → 不吞键
  const soleGuide = makeCloseStore()
  soleGuide.seed(layoutClose({ nodes: { 'pane-1': { kind: 'pane', host: 'dock', id: 'pane-1', tabs: ['t1'], activeTabId: 't1' } }, tabs: { t1: { id: 't1', kind: 'guide' } } }))
  const soleGuideEnv = env(soleGuide)
  event = soleGuideEnv.press({ key: '.', code: 'Period', ctrlKey: true })
  check('独占停靠的 guide → 标签未消失', same(soleGuideEnv.closed, ['t1']) && same(soleGuideEnv.tabs(), ['t1']), JSON.stringify(soleGuideEnv.tabs()))
  check('独占停靠的 guide → 不吞键', event.propagationStopped !== true)

  // guide 不是独占(面板里还有别的标签)→ 可以关
  const guideWithPeer = makeCloseStore()
  guideWithPeer.seed(layoutClose({ nodes: { 'pane-1': { kind: 'pane', host: 'dock', id: 'pane-1', tabs: ['t1', 't2'], activeTabId: 't1' } } }))
  const peerEnv = env(guideWithPeer)
  event = peerEnv.press({ key: '.', code: 'Period', ctrlKey: true })
  check('guide 与其它标签共存时可关', same(peerEnv.closed, ['t1']) && same(peerEnv.tabs(), ['t2']), JSON.stringify(peerEnv.tabs()))
  check('guide 与其它标签共存时吞键', event.propagationStopped === true)

  // 面板无标签 / 非 pane 节点 / 该会话尚无布局:全部 no-op
  const noTabs = makeCloseStore()
  noTabs.seed(layoutClose({ nodes: { 'pane-1': { kind: 'pane', host: 'dock', id: 'pane-1', tabs: [], activeTabId: undefined } } }))
  event = env(noTabs).press({ key: '.', code: 'Period', ctrlKey: true })
  check('面板无标签 → 不吞键', event.propagationStopped !== true)
  const notPane = makeCloseStore()
  notPane.seed(layoutClose({ nodes: { 'pane-1': { kind: 'split' } } }))
  event = env(notPane).press({ key: '.', code: 'Period', ctrlKey: true })
  check('activePaneId 指向非 pane 节点 → 不吞键', event.propagationStopped !== true)
  const otherSession = makeCloseStore()
  otherSession.seed(layoutClose(), 'sess-other')
  event = env(otherSession).press({ key: '.', code: 'Period', ctrlKey: true })
  check('该会话尚无布局 → 不吞键', event.propagationStopped !== true)

  // 无降级:服务 / 注册项 / store / close 面任一环不可用 → no-op 且不吞键
  const noopCases = [
    ['sidebarRight 缺席', { sidebarRight: undefined }],
    ['sidebarRight 无 close', { sidebarRight: { toggleExpanded() {}, focus() {} } }],
    ['slots 缺席', { slots: undefined }],
    ['slots 无 resolveStore', { slots: { entries: () => [{ store: store.handle }] } }],
    ['注册项都没有 store', { slots: { entries: () => [{ select: () => ({}) }], resolveStore: () => store.instance } }],
    ['uiSession 无 resolve', { uiSession: { pendingInteractions: { getSnapshot: () => new Map() } } }],
    ['resolveStore 抛错(handle 未注册)', {
      slots: { entries: () => [{ store: store.handle }], resolveStore: () => { throw new Error('store handle is not registered') } },
    }],
    ['活实例缺 getSnapshot', {
      slots: { entries: () => [{ store: store.handle }], resolveStore: () => ({}) },
    }],
    ['快照缺 bySession', {
      slots: { entries: () => [{ store: store.handle }], resolveStore: () => ({ getSnapshot: () => ({}) }) },
    }],
    ['close 抛错(无挂载会话面)', { sidebarRight: { toggleExpanded() {}, close: () => { throw new Error('sidebarRight: no session surface is mounted') } } }],
  ]
  for (const [label, extra] of noopCases) {
    const envCase = env(makeCloseStore(), extra)
    const pressed = envCase.press({ key: '.', code: 'Period', ctrlKey: true })
    check(`${label} → 不吞键(no-op)`, pressed.propagationStopped !== true)
  }

  // editing / card 态同样可用:mod+. 与卡片裸键、文本编辑都不冲突
  const editingStore = makeCloseStore()
  editingStore.seed(layoutClose())
  const editingEnv = env(editingStore)
  event = editingEnv.press({ key: '.', code: 'Period', ctrlKey: true, target: new FakeHTMLElement('TEXTAREA') })
  check('editing 态 ⌘/Ctrl+. 仍关标签', same(editingEnv.closed, ['t2']), JSON.stringify(editingEnv.closed))
  check('editing 态 ⌘/Ctrl+. 被吞', event.propagationStopped === true)
  const cardStore = makeCloseStore()
  cardStore.seed(layoutClose())
  const cardEnv = env(cardStore, {
    uiSession: {
      pendingInteractions: { getSnapshot: () => new Map([['sess-b', { kind: 'question', key: 'question:21', sessionId: 'sess-b', questions: [{ id: 'q1', options: [{ label: 'A' }] }] }]]) },
      resolve: (sessionId) => (sessionId === 'sess-b' ? { key: 'sess-b', ctx: {} } : undefined),
    },
  })
  event = cardEnv.press({ key: '.', code: 'Period', ctrlKey: true })
  check('card 态 ⌘/Ctrl+. 仍关标签', same(cardEnv.closed, ['t2']), JSON.stringify(cardEnv.closed))
  check('card 态 ⌘/Ctrl+. 被吞', event.propagationStopped === true)

  // 裸 . / 别的组合键不触发(不误伤页面)
  event = base.press({ key: '.', code: 'Period' })
  check('裸 . 不关标签、不吞键', event.propagationStopped !== true)
  event = base.press({ key: '.', code: 'Period', ctrlKey: true, altKey: true })
  check('⌘/Ctrl+Alt+. 不关标签、不吞键', event.propagationStopped !== true)

  // 键位可经 localStorage 独立覆盖
  storage.set('dsh-kbd-hotkeys:v1', JSON.stringify({ bindings: { 'sidebarRight.closeTab': 'mod+alt+8' } }))
  const customStore = makeCloseStore()
  customStore.seed(layoutClose())
  const custom = env(customStore)
  event = custom.press({ key: '.', code: 'Period', ctrlKey: true })
  check('覆盖键位后 ⌘/Ctrl+. 不再关标签', same(custom.closed, []), JSON.stringify(custom.closed))
  check('覆盖键位后 ⌘/Ctrl+. 不吞键', event.propagationStopped !== true)
  event = custom.press({ key: '8', code: 'Digit8', ctrlKey: true, altKey: true })
  check('自定义 ⌘/Ctrl+Alt+8 → 关标签', same(custom.closed, ['t2']), JSON.stringify(custom.closed))
  check('自定义键位被吞', event.propagationStopped === true)
  storage.delete('dsh-kbd-hotkeys:v1')
}

// ---- 阶段 6:⌘/Ctrl+\ → 右栏文件浏览器定位并置顶 ----
// 打开 = sidebarRight.openTab('files');置顶 = store 的 actions.placeTab(…, 0)(与标签拖拽同一入口)
console.log('\n--- ⌘/Ctrl+\\ → 右栏打开文件浏览器并置于首位 ---')
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
  const combo = { key: '\\', code: 'Backslash', ctrlKey: true }

  // ① 已有文件浏览器 tab 但不在首位 → 打开(聚焦) + placeTab(…, 0)
  const tabs = makeFilesStore()
  tabs.seed(singlePane(['t1', 't2', 't3'], {
    t2: { id: 't2', kind: 'text', contentId: 'dsh-resource://file/session/sess-b/a.ts' },
    t3: { id: 't3', kind: 'files', contentId: 'sidebar://files' },
  }))
  const first = env(tabs)
  let event = first.press(combo)
  check('⌘/Ctrl+\\ → 调 openTab("files")', same(first.opened, ['files']), JSON.stringify(first.opened))
  check('置顶 → placeTab(sess-b, t3, pane-1, 0)',
    same(tabs.calls, [['sess-b', 't3', 'pane-1', 0]]), JSON.stringify(tabs.calls))
  check('置顶后标签顺序 = [t3, t1, t2]',
    same(tabs.layout().nodes['pane-1'].tabs, ['t3', 't1', 't2']), JSON.stringify(tabs.layout().nodes['pane-1'].tabs))
  check('⌘/Ctrl+\\ 被吞', event.propagationStopped === true)

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
  check('editing 态 ⌘/Ctrl+\\ 仍打开并置顶', same(editable.calls, [['sess-b', 'files-1', 'pane-1', 0]]), JSON.stringify(editable.calls))
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
  check('card 态 ⌘/Ctrl+\\ 仍打开并置顶', cardFiles.calls.length === 1, JSON.stringify(cardFiles.calls))
  check('card 态被吞', event.propagationStopped === true)

  // ⑩ 裸 \ 不触发(mod 才触发)
  const bare = makeFilesStore()
  bare.seed(singlePane(['t1']))
  const bareEnv = env(bare)
  event = bareEnv.press({ key: '\\', code: 'Backslash' })
  check('裸 \\ 不打开文件浏览器', same(bareEnv.opened, []), JSON.stringify(bareEnv.opened))
  check('裸 \\ 不吞键', event.propagationStopped !== true)

  // ⑪ 键位可独立覆盖(与左右栏 / 标签切换 / 聚焦输入框同一套 bindings 机制)
  storage.set('dsh-kbd-hotkeys:v1', JSON.stringify({ bindings: { 'sidebarRight.files': 'mod+7' } }))
  const custom = makeFilesStore()
  custom.seed(singlePane(['t1']))
  const customEnv = env(custom)
  event = customEnv.press(combo)
  check('覆盖键位后 ⌘/Ctrl+\\ 不再打开', same(customEnv.opened, []), JSON.stringify(customEnv.opened))
  check('覆盖键位后 ⌘/Ctrl+\\ 不吞键', event.propagationStopped !== true)
  event = customEnv.press({ key: '7', code: 'Digit7', ctrlKey: true })
  check('自定义 ⌘/Ctrl+7 → 打开并置顶', same(custom.calls, [['sess-b', 'files-1', 'pane-1', 0]]), JSON.stringify(custom.calls))
  check('自定义键位被吞', event.propagationStopped === true)
  storage.delete('dsh-kbd-hotkeys:v1')
}

// ---- 阶段 7:⌘/Ctrl+L → 右栏定位终端(已有则聚焦、缺则新建) ----
// terminal 是 multiple 页:上游每次 openTab 都铸带 UUID 的 contentId,planOpenContent 不按 (kind, contentId) 去重,
// 故直接 openTab('terminal') 会每按一次多开一个终端 ⇒ 认页由插件读 store 布局(kind === 'terminal' 或地址前缀)。
console.log('\n--- ⌘/Ctrl+L → 右栏定位终端(已有则聚焦、缺则新建) ---')
{
  /** 假右栏会话级 store:快照 { bySession: { <id>: { layout } } } + 复刻上游口径的写入。 */
  function makeTerminalStore() {
    const handle = { spec: {} }
    let state = { bySession: {} }
    let minted = 0
    /** 复刻上游 focusTab:改当前面板的 activeTabId(已在当前标签上时上游计划为空)。 */
    const focusTab = (tabId, sessionId = 'sess-b') => {
      const layout = state.bySession[sessionId]?.layout
      if (layout === undefined) throw new Error('sidebarRight: no session surface is mounted')
      const target = layout.nodes[layout.activePaneId]
      if (target === undefined || !(target.tabs ?? []).includes(tabId)) return
      target.activeTabId = tabId
    }
    /** 复刻上游 openTab 对 multiple 页的语义:**每次**都是新 contentId + 新 tab。 */
    const open = (kind, sessionId = 'sess-b') => {
      const layout = state.bySession[sessionId]?.layout
      if (layout === undefined) throw new Error('sidebarRight: no session surface is mounted')
      const target = layout.nodes[layout.activePaneId]
      if (target === undefined || target.kind !== 'pane') throw new Error('sidebarRight: no session surface is mounted')
      minted += 1
      const tabId = `${kind}-${minted}`
      layout.tabs[tabId] = { id: tabId, kind, contentId: `sidebar://${kind}/uuid-${minted}`, title: kind }
      target.tabs.push(tabId)
      target.activeTabId = tabId
      layout.expanded = true
      return tabId
    }
    return {
      handle,
      open,
      focusTab,
      instance: { getSnapshot: () => state },
      seed: (layout, sessionId = 'sess-b') => { state = { bySession: { [sessionId]: { layout: clone(layout) } } } },
      layout: (sessionId = 'sess-b') => state.bySession[sessionId]?.layout,
    }
  }

  const guideTab = { id: 't1', kind: 'guide', contentId: 'sidebar://guide' }
  /** 终端页记录:contentId 带 UUID(`multiple: true` 页类型的上游形态)。 */
  const termTab = (id, uuid) => ({ id, kind: 'terminal', contentId: `sidebar://terminal/${uuid}` })
  /** 单面板布局:标签顺序 + 记录 + 当前标签(默认末个)。 */
  const singlePane = (ids, tabs, active = ids[ids.length - 1], over = {}) => ({
    rootId: 'pane-1',
    activePaneId: 'pane-1',
    expanded: true,
    nodes: { 'pane-1': { kind: 'pane', host: 'dock', id: 'pane-1', tabs: [...ids], activeTabId: active } },
    tabs,
    ...over,
  })
  const okBinding = (sessionId) => (sessionId === 'sess-b' ? { key: 'sess-b', ctx: {} } : undefined)
  /** rightbar.session 的假 slots:无 store 的干扰项 + 承载 store handle 的注册项。 */
  function terminalSlots(tabs) {
    return {
      entries: (key) => (key !== 'rightbar.session' ? [] : [{ select: () => ({}) }, { store: tabs.handle }]),
      resolveStore: (handle, binding) => {
        if (handle !== tabs.handle) throw new Error('resolved the wrong store handle')
        if (binding?.key !== 'sess-b') throw new Error(`bad scope binding: ${JSON.stringify(binding)}`)
        return tabs.instance
      },
    }
  }
  /** 装一个「右栏完整可用」的环境;openTab / focus / toggleExpanded 都落到假 store 上。 */
  function env(tabs, over = {}) {
    const opened = []
    const focused = []
    const toggled = []
    const press = loadPlugin({
      sessions: { ...sessions, binding: () => undefined },
      uiSession: { pendingInteractions: { getSnapshot: () => new Map() }, resolve: okBinding },
      workspaces: { list: { getSnapshot: () => ({ archivedSessionIds: [] }) } },
      slots: terminalSlots(tabs),
      sidebarRight: {
        toggleExpanded: () => {
          toggled.push(true)
          const layout = tabs.layout()
          if (layout !== undefined) layout.expanded = !layout.expanded
        },
        focus: (tabId) => { focused.push(tabId); tabs.focusTab(tabId) },
        openTab: (kind) => { opened.push(kind); tabs.open(kind) },
      },
      ...over,
    })
    return { press, opened, focused, toggled }
  }
  const combo = { key: 'l', code: 'KeyL', ctrlKey: true }

  // ① 没有终端页 → openTab('terminal') 新建;再按一次必须只聚焦、不新建(幂等)
  const fresh = makeTerminalStore()
  fresh.seed(singlePane(['t1'], { t1: guideTab }))
  const freshEnv = env(fresh)
  let event = freshEnv.press(combo)
  check('无终端页 → openTab("terminal") 新建', same(freshEnv.opened, ['terminal']), JSON.stringify(freshEnv.opened))
  check('无终端页 → 不调 focus', same(freshEnv.focused, []), JSON.stringify(freshEnv.focused))
  check('新建后 ⌘/Ctrl+L 被吞', event.propagationStopped === true)
  event = freshEnv.press(combo)
  check('再按一次 → 不再 openTab(不堆积终端)', same(freshEnv.opened, ['terminal']), JSON.stringify(freshEnv.opened))
  check('再按一次 → 只聚焦已有终端', same(freshEnv.focused, ['terminal-1']), JSON.stringify(freshEnv.focused))
  check('再按一次仍被吞', event.propagationStopped === true)

  // ② 已有终端(非当前标签)→ 只 focus,不 openTab、不重排、不动展开态
  const held = makeTerminalStore()
  held.seed(singlePane(['t1', 'term-2', 't3'], {
    t1: guideTab,
    'term-2': termTab('term-2', 'u2'),
    t3: { id: 't3', kind: 'text', contentId: 'dsh-resource://file/session/sess-b/a.ts' },
  }, 't1'))
  const heldEnv = env(held)
  event = heldEnv.press(combo)
  check('已有终端 → 不调 openTab(幂等)', same(heldEnv.opened, []), JSON.stringify(heldEnv.opened))
  check('已有终端 → focus("term-2")', same(heldEnv.focused, ['term-2']), JSON.stringify(heldEnv.focused))
  check('已有终端 → 标签顺序不变(不重排)', same(held.layout().nodes['pane-1'].tabs, ['t1', 'term-2', 't3']),
    JSON.stringify(held.layout().nodes['pane-1'].tabs))
  check('已展开 → 不调 toggleExpanded', same(heldEnv.toggled, []), JSON.stringify(heldEnv.toggled))
  check('已有终端被吞', event.propagationStopped === true)

  // ③ 面板内有多个终端且当前标签就是其中一个 → 聚焦当前这个(不把用户挪到别的终端)
  const multi = makeTerminalStore()
  multi.seed(singlePane(['term-a', 'term-b', 't1'], {
    'term-a': termTab('term-a', 'a'),
    'term-b': termTab('term-b', 'b'),
    t1: guideTab,
  }, 'term-b'))
  const multiEnv = env(multi)
  event = multiEnv.press(combo)
  check('多个终端 → 聚焦当前激活的那个', same(multiEnv.focused, ['term-b']), JSON.stringify(multiEnv.focused))
  check('多个终端 → 不调 openTab', same(multiEnv.opened, []), JSON.stringify(multiEnv.opened))

  // ④ 当前面板没有、别的停靠面板有 → 聚焦那个面板里的终端(不新建)
  const otherPane = makeTerminalStore()
  otherPane.seed({
    rootId: 'pane-1',
    activePaneId: 'pane-1',
    expanded: true,
    nodes: {
      'pane-1': { kind: 'pane', host: 'dock', id: 'pane-1', tabs: ['t1'], activeTabId: 't1' },
      'pane-2': { kind: 'pane', host: 'dock', id: 'pane-2', tabs: ['term-x'], activeTabId: 'term-x' },
    },
    tabs: { t1: guideTab, 'term-x': termTab('term-x', 'x') },
  })
  const otherEnv = env(otherPane)
  event = otherEnv.press(combo)
  check('别的停靠面板有终端 → focus("term-x")', same(otherEnv.focused, ['term-x']), JSON.stringify(otherEnv.focused))
  check('别的停靠面板有终端 → 不新建', same(otherEnv.opened, []), JSON.stringify(otherEnv.opened))
  check('跨面板定位被吞', event.propagationStopped === true)

  // ⑤ 只有浮窗里有终端 → 浮窗不参与认页 → 新建(浮窗里的 tab 原样保留)
  const floated = makeTerminalStore()
  floated.seed({
    rootId: 'pane-1',
    activePaneId: 'pane-1',
    expanded: true,
    floats: ['pane-f'],
    nodes: {
      'pane-1': { kind: 'pane', host: 'dock', id: 'pane-1', tabs: ['t1'], activeTabId: 't1' },
      'pane-f': { kind: 'pane', host: 'float', id: 'pane-f', tabs: ['term-float'], activeTabId: 'term-float' },
    },
    tabs: { t1: guideTab, 'term-float': termTab('term-float', 'f') },
  })
  const floatEnv = env(floated)
  event = floatEnv.press(combo)
  check('浮窗里的终端不算「已有」→ 新建', same(floatEnv.opened, ['terminal']), JSON.stringify(floatEnv.opened))
  check('浮窗里的终端不被聚焦', same(floatEnv.focused, []), JSON.stringify(floatEnv.focused))
  check('浮窗里的终端原样保留', same(floated.layout().nodes['pane-f'].tabs, ['term-float']),
    JSON.stringify(floated.layout().nodes['pane-f'].tabs))

  // ⑥ 右栏折叠着 + 已有终端 → 聚焦并补一步展开(focus 本身不动展开态)
  const collapsed = makeTerminalStore()
  collapsed.seed(singlePane(['t1', 'term-2'], { t1: guideTab, 'term-2': termTab('term-2', 'u2') }, 't1', { expanded: false }))
  const collapsedEnv = env(collapsed)
  event = collapsedEnv.press(combo)
  check('折叠 + 已有终端 → 先 focus', same(collapsedEnv.focused, ['term-2']), JSON.stringify(collapsedEnv.focused))
  check('折叠 + 已有终端 → toggleExpanded 展开', same(collapsedEnv.toggled, [true]), JSON.stringify(collapsedEnv.toggled))
  check('折叠 + 已有终端 → 展开态已翻转', collapsed.layout().expanded === true)
  check('折叠 + 已有终端 → 不新建', same(collapsedEnv.opened, []), JSON.stringify(collapsedEnv.opened))
  check('折叠 + 已有终端被吞', event.propagationStopped === true)

  // ⑦ expanded 读不到(既非 true 也非 false)→ 不动展开态(宁可少做,也不把开着的右栏关掉)
  const unknown = makeTerminalStore()
  unknown.seed(singlePane(['t1', 'term-2'], { t1: guideTab, 'term-2': termTab('term-2', 'u2') }, 't1', { expanded: undefined }))
  const unknownEnv = env(unknown)
  event = unknownEnv.press(combo)
  check('expanded 读不到 → 不 toggle(不猜状态)', same(unknownEnv.toggled, []), JSON.stringify(unknownEnv.toggled))
  check('expanded 读不到 → 仍 focus 并吞键', same(unknownEnv.focused, ['term-2']) && event.propagationStopped === true)

  // ⑧ 认页兼容「只有 contentId 前缀、没有 kind」的记录(防御上游记录形态)
  const byAddress = makeTerminalStore()
  byAddress.seed(singlePane(['t1', 'addr'], {
    t1: guideTab,
    addr: { id: 'addr', contentId: 'sidebar://terminal/uuid-addr' },
  }, 't1'))
  const byAddressEnv = env(byAddress)
  event = byAddressEnv.press(combo)
  check('凭 sidebar://terminal/<uuid> 地址认页 → focus', same(byAddressEnv.focused, ['addr']), JSON.stringify(byAddressEnv.focused))
  check('凭地址认页 → 不新建', same(byAddressEnv.opened, []), JSON.stringify(byAddressEnv.opened))

  // ⑨ 无降级:任一层不可用 / 上游抛错 → no-op 不吞键(已有终端而 focus 抛错时不得退化成再开一个)
  for (const [label, makeOver] of [
    ['sidebarRight 缺席', () => ({ sidebarRight: undefined })],
    ['sidebarRight 无 openTab(且无终端)', () => ({ sidebarRight: { toggleExpanded() {}, focus() {} } })],
    ['无挂载会话面(openTab 抛错)', () => ({ sidebarRight: { toggleExpanded() {}, focus() {}, openTab: () => { throw new Error('sidebarRight: no session surface is mounted') } } })],
    ['terminal 类型未注册(openTab 抛错)', () => ({ sidebarRight: { toggleExpanded() {}, focus() {}, openTab: () => { throw new Error('sidebarRight: no tab type is registered as "terminal"') } } })],
  ]) {
    const caseStore = makeTerminalStore()
    caseStore.seed(singlePane(['t1'], { t1: guideTab }))
    const caseEnv = env(caseStore, makeOver())
    event = caseEnv.press(combo)
    check(`${label} → 不崩、不吞键`, event.propagationStopped !== true)
  }
  // 已有终端但 focus 抛错(无挂载会话面)→ no-op 不吞键,且**不**退化成再开一个终端
  const focusThrowsOpened = []
  const focusThrows = makeTerminalStore()
  focusThrows.seed(singlePane(['t1', 'term-2'], { t1: guideTab, 'term-2': termTab('term-2', 'u2') }, 't1'))
  const focusThrowsEnv = env(focusThrows, {
    sidebarRight: {
      toggleExpanded() {},
      openTab: (kind) => { focusThrowsOpened.push(kind) },
      focus: () => { throw new Error('sidebarRight: no session surface is mounted') },
    },
  })
  event = focusThrowsEnv.press(combo)
  check('已有终端但 focus 抛错 → 不吞键', event.propagationStopped !== true)
  check('已有终端但 focus 抛错 → 不新建(不重复开终端)', same(focusThrowsOpened, []), JSON.stringify(focusThrowsOpened))
  // 已有终端但 sidebarRight 无 focus 面 → 不得退化成「再开一个终端」
  const noFocus = makeTerminalStore()
  noFocus.seed(singlePane(['t1', 'term-2'], { t1: guideTab, 'term-2': termTab('term-2', 'u2') }, 't1'))
  const noFocusOpened = []
  const noFocusEnv = env(noFocus, {
    sidebarRight: { toggleExpanded() {}, openTab: (kind) => { noFocusOpened.push(kind) } },
  })
  event = noFocusEnv.press(combo)
  check('已有终端但无 focus → 不吞键', event.propagationStopped !== true)
  check('已有终端但无 focus → 不新建(不重复开终端)', same(noFocusOpened, []), JSON.stringify(noFocusOpened))
  // 取数面不可用(无从判重)→ 退化为 openTab 新建:与上游 openTab 同一行为,且吞键
  const noSlots = makeTerminalStore()
  noSlots.seed(singlePane(['t1', 'term-2'], { t1: guideTab, 'term-2': termTab('term-2', 'u2') }, 't1'))
  const noSlotsEnv = env(noSlots, { slots: undefined })
  event = noSlotsEnv.press(combo)
  check('slots 缺席 → 无从判重,按 openTab 新建', same(noSlotsEnv.opened, ['terminal']), JSON.stringify(noSlotsEnv.opened))
  check('slots 缺席 → 吞键', event.propagationStopped === true)

  // ⑩ 无当前会话 / 该会话尚无面板 → 取不到布局,openTab 在无挂载会话面时抛错 → no-op 不吞键
  const noSession = makeTerminalStore()
  const noSessionEnv = env(noSession, {
    sessions: { ...sessions, list: { getSnapshot: () => ({ ...snapshot, current: undefined }) } },
  })
  event = noSessionEnv.press(combo)
  check('无当前会话 + 无面板 → 不吞键', event.propagationStopped !== true)

  // ⑪ card / editing 态同样生效(带修饰键的组合不与卡片的裸键、文本编辑冲突)
  const editable = makeTerminalStore()
  editable.seed(singlePane(['t1'], { t1: guideTab }))
  const editableEnv = env(editable)
  event = editableEnv.press({ ...combo, target: new FakeHTMLElement('TEXTAREA') })
  check('editing 态 ⌘/Ctrl+L 仍新建终端', same(editableEnv.opened, ['terminal']), JSON.stringify(editableEnv.opened))
  check('editing 态被吞', event.propagationStopped === true)

  const cardSearch = makeTerminalStore()
  cardSearch.seed(singlePane(['t1'], { t1: guideTab }))
  const cardSearchEnv = env(cardSearch, {
    uiSession: {
      pendingInteractions: { getSnapshot: () => new Map([['sess-b', { kind: 'question', key: 'question:22', sessionId: 'sess-b', questions: [{ id: 'q1', question: 'Q?', options: [{ label: 'A' }] }] }]]) },
      resolve: okBinding,
    },
  })
  event = cardSearchEnv.press(combo)
  check('card 态 ⌘/Ctrl+L 仍新建终端', same(cardSearchEnv.opened, ['terminal']), JSON.stringify(cardSearchEnv.opened))
  check('card 态被吞', event.propagationStopped === true)

  // ⑫ ⌘(metaKey)与 ⌃(ctrlKey)都归一化成同一个 mod 组合(macOS 上两者都能触发)
  const mac = makeTerminalStore()
  mac.seed(singlePane(['t1'], { t1: guideTab }))
  const macEnv = env(mac)
  event = macEnv.press({ key: 'l', code: 'KeyL', metaKey: true })
  check('⌘L 同样触发', same(macEnv.opened, ['terminal']), JSON.stringify(macEnv.opened))
  check('⌘L 被吞', event.propagationStopped === true)

  // ⑬ 裸 l 不触发(mod 才触发,不能抢文本输入)
  const bare = makeTerminalStore()
  bare.seed(singlePane(['t1'], { t1: guideTab }))
  const bareEnv = env(bare)
  event = bareEnv.press({ key: 'l', code: 'KeyL' })
  check('裸 l 不打开终端', same(bareEnv.opened, []), JSON.stringify(bareEnv.opened))
  check('裸 l 不吞键', event.propagationStopped !== true)

  // ⑭ 键位可独立覆盖(与右栏其它动作同一套 bindings 机制)
  storage.set('dsh-kbd-hotkeys:v1', JSON.stringify({ bindings: { 'sidebarRight.terminal': 'mod+alt+t' } }))
  const custom = makeTerminalStore()
  custom.seed(singlePane(['t1'], { t1: guideTab }))
  const customEnv = env(custom)
  event = customEnv.press(combo)
  check('覆盖键位后 ⌘/Ctrl+L 不再打开终端', same(customEnv.opened, []), JSON.stringify(customEnv.opened))
  check('覆盖键位后 ⌘/Ctrl+L 不吞键', event.propagationStopped !== true)
  event = customEnv.press({ key: 't', code: 'KeyT', ctrlKey: true, altKey: true })
  check('自定义 ⌘/Ctrl+Alt+T → 新建终端', same(customEnv.opened, ['terminal']), JSON.stringify(customEnv.opened))
  check('自定义键位被吞', event.propagationStopped === true)
  storage.delete('dsh-kbd-hotkeys:v1')

  // ⑮ ⌘/Ctrl+L 的元素级聚焦:上游 focus(tabId) 只聚焦标签,终端内容的 DOM 焦点由 TerminalBody 的
  //     [visible, state.writable] effect 完成;终端已是当前标签时该依赖不变、effect 不重跑,故插件按 store 的 paneId
  //     找 [data-dockkit-pane] 里的 textarea.xterm-helper-textarea 补一次聚焦(不遍历标签 / 不合成事件)。
  {
    /** 带属性与子树查询的假元素:模拟 dockkit 面板 + xterm 隐藏输入框。 */
    class FakeAttributedElement extends FakeHTMLElement {
      constructor(tag, attributes = {}, content = {}) {
        super(tag)
        this.attributes = attributes
        this.content = content
      }
      getAttribute(name) { return this.attributes[name] ?? null }
      querySelector(selector) { return this.content[selector] ?? null }
    }
    const makeTerminalDom = (paneId) => {
      const textarea = new FakeAttributedElement('TEXTAREA')
      const pane = new FakeAttributedElement('SECTION', { 'data-dockkit-pane': paneId }, {
        'textarea.xterm-helper-textarea': textarea,
      })
      return { pane, textarea }
    }

    // a) 终端就是当前标签(用户正看着终端、焦点却在别处)→ 聚焦 xterm,且不新建
    const shown = makeTerminalStore()
    shown.seed(singlePane(['t1', 'term-2'], { t1: guideTab, 'term-2': termTab('term-2', 'u2') }, 'term-2'))
    const shownEnv = env(shown)
    const shownDom = makeTerminalDom('pane-1')
    dockPanes = [shownDom.pane]
    event = shownEnv.press(combo)
    check('终端就是当前标签 → 聚焦 xterm', shownDom.textarea.focused === true)
    check('终端就是当前标签 → 只 focus 标签、不新建',
      same(shownEnv.focused, ['term-2']) && same(shownEnv.opened, []), JSON.stringify([shownEnv.focused, shownEnv.opened]))
    check('终端就是当前标签 → 吞键', event.propagationStopped === true)

    // b) 分屏:只碰 store 给出的**那个面板**(两个面板各有 xterm)
    const split = makeTerminalStore()
    split.seed({
      rootId: 'pane-1',
      activePaneId: 'pane-1',
      expanded: true,
      nodes: {
        'pane-1': { kind: 'pane', host: 'dock', id: 'pane-1', tabs: ['t1'], activeTabId: 't1' },
        'pane-2': { kind: 'pane', host: 'dock', id: 'pane-2', tabs: ['term-x'], activeTabId: 'term-x' },
      },
      tabs: { t1: guideTab, 'term-x': termTab('term-x', 'x') },
    })
    const splitEnv = env(split)
    const domOne = makeTerminalDom('pane-1')
    const domTwo = makeTerminalDom('pane-2')
    dockPanes = [domOne.pane, domTwo.pane]
    event = splitEnv.press(combo)
    check('分屏 → 只聚焦终端所在面板的 xterm',
      domTwo.textarea.focused === true && domOne.textarea.focused !== true)
    check('分屏 → 吞键', event.propagationStopped === true)

    // c) 终端**不是**当前标签:visible 会翻转,上游自己会聚焦 → 插件不代劳
    const notCurrent = makeTerminalStore()
    notCurrent.seed(singlePane(['t1', 'term-2'], { t1: guideTab, 'term-2': termTab('term-2', 'u2') }, 't1'))
    const notCurrentEnv = env(notCurrent)
    const notCurrentDom = makeTerminalDom('pane-1')
    dockPanes = [notCurrentDom.pane]
    event = notCurrentEnv.press(combo)
    check('终端不是当前标签 → 插件不抢上游的自动聚焦', notCurrentDom.textarea.focused !== true)
    check('终端不是当前标签 → 仍 focus 标签并吞键',
      same(notCurrentEnv.focused, ['term-2']) && event.propagationStopped === true)

    // d) 面板里还没有 xterm(未挂载 / 正在创建)→ 少这一步,不影响标签聚焦的返回值
    const noScreen = makeTerminalStore()
    noScreen.seed(singlePane(['t1', 'term-2'], { t1: guideTab, 'term-2': termTab('term-2', 'u2') }, 'term-2'))
    const noScreenEnv = env(noScreen)
    dockPanes = [new FakeAttributedElement('SECTION', { 'data-dockkit-pane': 'pane-1' })]
    event = noScreenEnv.press(combo)
    check('面板里没有 xterm → 不崩、仍吞键', event.propagationStopped === true)

    // e) xterm 的 focus() 抛错 → 兜住,不崩、不吞键之路不受影响
    const throwing = makeTerminalStore()
    throwing.seed(singlePane(['t1', 'term-2'], { t1: guideTab, 'term-2': termTab('term-2', 'u2') }, 'term-2'))
    const throwingEnv = env(throwing)
    const throwingDom = makeTerminalDom('pane-1')
    throwingDom.textarea.focus = () => { throw new Error('focus failed') }
    dockPanes = [throwingDom.pane]
    event = throwingEnv.press(combo)
    check('xterm 聚焦抛错 → no-op 不崩、仍吞键', event.propagationStopped === true)

    // f) 右栏折叠着(终端已是当前标签):展开会让 visible 翻转、上游自己聚焦 → 插件不在展开前抢这次聚焦
    const collapsedCurrent = makeTerminalStore()
    collapsedCurrent.seed(singlePane(['t1', 'term-2'], { t1: guideTab, 'term-2': termTab('term-2', 'u2') }, 'term-2', { expanded: false }))
    const collapsedCurrentEnv = env(collapsedCurrent)
    const collapsedDom = makeTerminalDom('pane-1')
    dockPanes = [collapsedDom.pane]
    event = collapsedCurrentEnv.press(combo)
    check('折叠 + 终端是当前标签 → 不抢上游的自动聚焦', collapsedDom.textarea.focused !== true)
    check('折叠 + 终端是当前标签 → 仍展开并吞键',
      same(collapsedCurrentEnv.toggled, [true]) && event.propagationStopped === true)

    // 注入的假面板只服务本组用例;清空后其余断言仍建立在「空 DOM」之上
    dockPanes = []
  }
}

// ---- 阶段 5(浮窗):⌘/Ctrl+K → 工作区浮窗(↑↓ 高亮 + Enter 切换) ----
// 列表 = workspaces.list 快照(宿主顺序,不重排);切换 = 公开的 uiWorkspace.openWorkspace(workspaceId)。
// ↑/↓ 只移动高亮、不触发导航;Esc / 同组合键关闭;浮层 DOM 由插件自建,这里只读它自己的子树。
console.log('\n--- ⌘/Ctrl+K → 工作区浮窗(↑↓ 选择 + Enter 切换) ---')
{
  const combo = { key: 'k', code: 'KeyK', ctrlKey: true }
  const item = (workspaceId, title, path, sessionIds = []) => ({
    workspaceId, title, path, sessionIds,
    createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z',
  })
  const items = [
    item('w1', 'alpha', '/work/alpha', ['sess-a']),
    item('w2', 'beta', '/work/beta', ['sess-b']),
    item('w3', '', '/work/gamma'), // 无 title → 回退路径末段
    item('w4', '', 'plain'), // 末段 = 原路径 → 次行省略
  ]
  const workspaces = { list: { getSnapshot: () => ({ items, archivedSessionIds: [], phase: 'ready' }) } }

  /** 假 uiWorkspace:记录 openWorkspace 调用;可配置同步抛错 / 异步拒绝。 */
  function makeUiWorkspace(mode = 'ok') {
    const calls = []
    return {
      calls,
      openWorkspace(workspaceId) {
        calls.push(workspaceId)
        if (mode === 'throw') throw new Error('uiWorkspace: no mounted session surface')
        if (mode === 'reject') return Promise.reject(new Error('uiWorkspace: connect failed'))
        return Promise.resolve()
      },
    }
  }
  /** 装配:默认「服务齐全、当前会话 sess-b(属于 w2)」。 */
  function env(over = {}) {
    const uiWorkspace = over.uiWorkspace !== undefined ? over.uiWorkspace : makeUiWorkspace(over.mode)
    // 显式传 { workspaces: undefined } 表示「服务缺席」,不能用 `=== undefined` 兜底
    const workspacesService = 'workspaces' in over ? over.workspaces : workspaces
    const press = loadPlugin({
      sessions: over.sessions ?? { ...sessions, binding: () => undefined },
      uiSession: { pendingInteractions: { getSnapshot: () => new Map() }, resolve: () => undefined },
      workspaces: workspacesService,
      uiWorkspace,
      ...over.extra,
    })
    return { press, uiWorkspace }
  }

  // ① 打开浮窗:列表按宿主顺序渲染,初始高亮 = 当前会话所属工作区(w2)
  const first = env()
  let event = first.press(combo)
  check('⌘/Ctrl+K 打开工作区浮窗并吞键', event.propagationStopped === true)
  check(
    '浮窗按宿主顺序渲染工作区行(标题 / 路径 / 当前标记 / 会话数)',
    same(pickerRows().map(nodeText), [
      'alpha /work/alpha 1 个会话',
      'beta /work/beta 当前 1 个会话',
      'gamma /work/gamma 0 个会话',
      'plain 0 个会话',
    ]),
    JSON.stringify(pickerRows().map(nodeText)),
  )
  check('初始高亮 = 当前会话所属工作区(第 2 行)', activeRowIndex() === 1, String(activeRowIndex()))

  // ② ↑ / ↓ 只移动高亮(不触发导航),Enter 才切换
  event = first.press({ key: 'ArrowDown', code: 'ArrowDown' })
  check('↓ 移动高亮到第 3 行', activeRowIndex() === 2, String(activeRowIndex()))
  check('↓ 被浮窗吞掉', event.propagationStopped === true)
  check('↓ 不触发切换(只有 Enter 才调 openWorkspace)', same(first.uiWorkspace.calls, []), JSON.stringify(first.uiWorkspace.calls))
  first.press({ key: 'ArrowUp', code: 'ArrowUp' })
  check('↑ 移回第 2 行', activeRowIndex() === 1, String(activeRowIndex()))
  first.press({ key: 'ArrowUp', code: 'ArrowUp' })
  first.press({ key: 'ArrowUp', code: 'ArrowUp' })
  check('首行 clamp(不循环,仍停在第 1 行)', activeRowIndex() === 0, String(activeRowIndex()))
  first.press({ key: 'ArrowDown', code: 'ArrowDown' })
  check('高亮回到当前工作区行', activeRowIndex() === 1, String(activeRowIndex()))
  event = first.press({ key: 'Enter', code: 'Enter' })
  check('Enter → uiWorkspace.openWorkspace(高亮工作区)', same(first.uiWorkspace.calls, ['w2']), JSON.stringify(first.uiWorkspace.calls))
  check('Enter 被吞', event.propagationStopped === true)
  check('切换后浮窗关闭(工作区行清空)', pickerRows().length === 0, String(pickerRows().length))
  event = first.press({ key: 'ArrowDown', code: 'ArrowDown' })
  check('浮窗关闭后裸 ↓ 不吞键', event.propagationStopped !== true)

  // ③ Esc 关闭 / 同组合键再按一次关闭(开关语义)/ ⌘/ 直接换成速查表
  first.press(combo)
  check('可再次打开', pickerRows().length === 4, String(pickerRows().length))
  first.press({ key: 'ArrowDown', code: 'ArrowDown' })
  event = first.press({ key: 'Escape', code: 'Escape' })
  check('Esc 关闭浮窗并吞键', event.propagationStopped === true && pickerRows().length === 0)
  first.press(combo)
  event = first.press(combo)
  check('再按一次 ⌘/Ctrl+K 关闭(开关语义)', pickerRows().length === 0, String(pickerRows().length))
  check('同组合键关闭被吞', event.propagationStopped === true)
  first.press(combo)
  event = first.press({ key: '/', code: 'Slash', ctrlKey: true })
  check('浮窗内按 ⌘/ 直接换成速查表(工作区行消失)', event.propagationStopped === true && pickerRows().length === 0)
  event = first.press({ key: '/', code: 'Slash', ctrlKey: true })
  check('速查表再按 ⌘/ 关闭', event.propagationStopped === true)

  // ④ 初始高亮:当前会话不属于任何工作区 → 首行;↑ 在首行 clamp
  const stray = env({
    sessions: { list: { getSnapshot: () => ({ ...snapshot, current: 'sess-x' }) }, open() {}, binding: () => undefined },
  })
  stray.press(combo)
  check('当前会话无归属 → 初始高亮第 1 行', activeRowIndex() === 0, String(activeRowIndex()))
  stray.press({ key: 'ArrowUp', code: 'ArrowUp' })
  check('首行再按 ↑ 仍停在第 1 行', activeRowIndex() === 0, String(activeRowIndex()))
  stray.press({ key: 'Enter', code: 'Enter' })
  check('Enter → openWorkspace(w1)', same(stray.uiWorkspace.calls, ['w1']), JSON.stringify(stray.uiWorkspace.calls))

  // ⑤ 空列表 / workspaces 服务缺席:浮窗照样打开(空态),Enter 不切换、不崩
  const empty = env({ workspaces: { list: { getSnapshot: () => ({ items: [], archivedSessionIds: [], phase: 'ready' }) } } })
  event = empty.press(combo)
  check('无工作区时仍打开浮窗(空态)并吞键', event.propagationStopped === true && pickerRows().length === 0)
  event = empty.press({ key: 'Enter', code: 'Enter' })
  check('空态 Enter 不触发 openWorkspace', same(empty.uiWorkspace.calls, []), JSON.stringify(empty.uiWorkspace.calls))
  check('空态 Enter 仍被模态吞掉', event.propagationStopped === true)
  empty.press({ key: 'Escape', code: 'Escape' })

  const noService = env({ workspaces: undefined })
  event = noService.press(combo)
  check('workspaces 服务缺席 → 浮窗空态、不崩、吞键', event.propagationStopped === true && pickerRows().length === 0)
  event = noService.press({ key: 'Enter', code: 'Enter' })
  check('workspaces 缺席时 Enter 不切换、不抛错', same(noService.uiWorkspace.calls, []), JSON.stringify(noService.uiWorkspace.calls))
  noService.press({ key: 'Escape', code: 'Escape' })

  // ⑥ uiWorkspace 缺席 / 抛错:浮窗照常开关,确认时 no-op(不崩、不回退 DOM)
  for (const [label, over] of [
    ['uiWorkspace 缺席', { uiWorkspace: null }],
    ['openWorkspace 同步抛错', { mode: 'throw' }],
    ['openWorkspace 异步拒绝', { mode: 'reject' }],
  ]) {
    const target = env(over)
    target.press(combo)
    target.press({ key: 'ArrowDown', code: 'ArrowDown' })
    event = target.press({ key: 'Enter', code: 'Enter' })
    check(`${label} → 确认时 no-op、不崩、浮窗关闭`, event.propagationStopped === true && pickerRows().length === 0)
    if (over.mode !== undefined) {
      check(`${label} → 仍如实调用了 openWorkspace`, target.uiWorkspace.calls.length === 1, JSON.stringify(target.uiWorkspace.calls))
    }
  }

  // ⑦ card / editing 态同样可用(带修饰键的组合不与卡片裸键、文本编辑冲突)
  const carded = env({
    extra: {
      uiSession: {
        pendingInteractions: {
          getSnapshot: () => new Map([['sess-b', { kind: 'question', key: 'question:9', sessionId: 'sess-b', questions: [{ id: 'q1', options: [{ label: 'A' }] }] }]]),
        },
        resolve: () => undefined,
      },
    },
  })
  event = carded.press(combo)
  check('card 态 ⌘/Ctrl+K 仍打开浮窗', event.propagationStopped === true && pickerRows().length === 4)
  carded.press({ key: 'Escape', code: 'Escape' })
  const editing = env()
  event = editing.press({ ...combo, target: new FakeHTMLElement('TEXTAREA') })
  check('editing 态 ⌘/Ctrl+K 仍打开浮窗', event.propagationStopped === true && pickerRows().length === 4)
  editing.press({ key: 'Escape', code: 'Escape' })

  // ⑧ 键位可独立覆盖(与其它动作同一套 bindings 机制)
  storage.set('dsh-kbd-hotkeys:v1', JSON.stringify({ bindings: { 'workspace.pick': 'mod+alt+9' } }))
  const custom = env()
  event = custom.press(combo)
  check('覆盖键位后 ⌘/Ctrl+K 不再打开', event.propagationStopped !== true && pickerRows().length === 0)
  event = custom.press({ key: '9', code: 'Digit9', ctrlKey: true, altKey: true })
  check('自定义 ⌘/Ctrl+Alt+9 打开浮窗并吞键', event.propagationStopped === true && pickerRows().length === 4)
  custom.press({ key: 'Enter', code: 'Enter' })
  check('自定义键位下 Enter 切换当前工作区', same(custom.uiWorkspace.calls, ['w2']), JSON.stringify(custom.uiWorkspace.calls))
  storage.delete('dsh-kbd-hotkeys:v1')
}

// ---- 阶段 6(浮窗):⌘/Ctrl+M 模型浮窗 + ⇧Tab 思考强度循环 ----
// 取数与提交都走上游同一 per-session 目录 ctx.modelDirectories.directoryFor(session)(与 /model 弹层同源)。
// 行的选择复刻上游 selectionOf;⇧Tab 候选复刻 effortChoices(有 defaultEffort 时不含 Default 档),
// 当前档 = current.reasoningEffort ?? reasoning.defaultEffort。
console.log('\n--- ⌘/Ctrl+M → 模型浮窗 + ⇧Tab 循环思考强度 ---')
{
  const combo = { key: 'm', code: 'KeyM', ctrlKey: true }
  const shiftTab = { key: 'Tab', code: 'Tab', shiftKey: true }
  /** 等一次宏任务:浮窗的列表是异步取的(先绘制「加载中」,落地后重画)。 */
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

  const groupHeadings = () =>
    collectNodes(globalThis.document.body, (el) => classHas(el, 'dsh-kbd-group')).map(nodeText)
  const currentLines = () =>
    collectNodes(globalThis.document.body, (el) => classHas(el, 'dsh-kbd-current')).map(nodeText)
  const emptyNotices = () =>
    collectNodes(globalThis.document.body, (el) => classHas(el, 'dsh-kbd-empty')).map(nodeText)
  const hintTexts = () =>
    collectNodes(globalThis.document.body, (el) => classHas(el, 'dsh-kbd-hint')).map(nodeText)

  /** 目录行夹具:两个提供方 / 三种模型(有默认档 / 无默认档 / 无推理元数据)。 */
  const groups = [
    {
      id: 'deepseek-official',
      name: 'DeepSeek',
      models: [
        {
          id: 'deepseek-v4-flash',
          name: 'DeepSeek V4 Flash',
          reasoning: { efforts: [{ id: 'off', name: 'Off' }, { id: 'low', name: 'Low' }, { id: 'high', name: 'High' }] },
        },
        {
          id: 'deepseek-v4-pro',
          name: 'DeepSeek V4 Pro',
          reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }], defaultEffort: 'high' },
        },
      ],
    },
    { id: 'other', name: 'Other Provider', models: [{ id: 'plain', name: 'Plain Model' }] },
  ]
  const proCurrent = { provider: 'deepseek-official', model: 'deepseek-v4-pro', reasoningEffort: 'high' }

  /** 假模型目录:复刻上游 ModelDirectory 的 store / load / select;select 成功换 current,失败 reject。 */
  function makeDirectory(over = {}) {
    const state = {
      current: over.current !== undefined ? over.current : proCurrent,
      routable: true,
      groups: over.groups !== undefined ? over.groups : groups,
      failures: over.failures !== undefined ? over.failures : [],
      status: 'ready',
      error: null,
    }
    const calls = []
    return {
      calls,
      state,
      store: { getSnapshot: () => state },
      load() {
        if (over.loadError !== undefined) return Promise.reject(new Error(over.loadError))
        return Promise.resolve(state)
      },
      select(selection) {
        calls.push({ ...selection })
        if (over.selectError !== undefined) return Promise.reject(new Error(over.selectError))
        state.current = { ...selection }
        return Promise.resolve()
      },
    }
  }

  /** 装配:默认「模型目录齐全、当前会话 sess-b」。 */
  function env(over = {}) {
    const directory = over.directory !== undefined ? over.directory : makeDirectory()
    const seen = []
    let resolver
    if ('modelDirectories' in over) resolver = over.modelDirectories
    else if (over.throwOnDirectory === true) {
      resolver = { directoryFor() { throw new Error('ui-model-selection: session resolved no scope') } }
    } else {
      resolver = { directoryFor(sessionId) { seen.push(sessionId); return directory } }
    }
    const press = loadPlugin({
      sessions: over.sessions ?? { ...sessions, binding: () => undefined },
      uiSession: over.uiSession ?? { pendingInteractions: { getSnapshot: () => new Map() } },
      modelDirectories: resolver,
      conversation: over.conversation,
    })
    return { press, directory, seen }
  }

  // ① 打开浮窗:先绘制加载态,异步落地后按宿主顺序渲染行 + 提供方分组标题
  const first = env()
  let event = first.press(combo)
  check('⌘/Ctrl+M 打开模型浮窗并吞键', event.propagationStopped === true)
  check('首次绘制 = 「正在加载模型目录…」', same(emptyNotices(), ['正在加载模型目录…']), JSON.stringify(emptyNotices()))
  await flush()
  check('目录按当前会话 id 取(directoryFor(sess-b))', same(first.seen, ['sess-b']), JSON.stringify(first.seen))
  check(
    '行按宿主顺序展开(模型名 / 提供方,当前行带标记)',
    same(pickerRows().map(nodeText), [
      'DeepSeek V4 Flash DeepSeek',
      'DeepSeek V4 Pro DeepSeek 当前',
      'Plain Model Other Provider',
    ]),
    JSON.stringify(pickerRows().map(nodeText)),
  )
  check('提供方分组标题按相邻同组行插入', same(groupHeadings(), ['DeepSeek', 'Other Provider']), JSON.stringify(groupHeadings()))
  check('「当前」行 = 当前模型 + 当前强度档', same(currentLines(), ['当前：DeepSeek V4 Pro · High']), JSON.stringify(currentLines()))
  check('初始高亮 = 当前选择所在行', activeRowIndex() === 1, String(activeRowIndex()))

  // ② ↑/↓ clamp + Enter 提交**完整**选择(无 defaultEffort 的模型省略 reasoningEffort)
  first.press({ key: 'ArrowUp', code: 'ArrowUp' })
  check('↑ 移到第 1 行', activeRowIndex() === 0, String(activeRowIndex()))
  first.press({ key: 'ArrowUp', code: 'ArrowUp' })
  check('首行 clamp(不循环)', activeRowIndex() === 0, String(activeRowIndex()))
  event = first.press({ key: 'Enter', code: 'Enter' })
  check(
    'Enter → directory.select(该行完整选择;无 defaultEffort 时不带 reasoningEffort)',
    same(first.directory.calls, [{ provider: 'deepseek-official', model: 'deepseek-v4-flash' }]),
    JSON.stringify(first.directory.calls),
  )
  check('确认后浮窗关闭', event.propagationStopped === true && pickerRows().length === 0)

  // ③ 重新打开:高亮跟随目录里的新 current(store 是唯一真源),↓ 到末行 clamp
  first.press(combo)
  await flush()
  check('重开后高亮 = 新 current 所在行', activeRowIndex() === 0, String(activeRowIndex()))
  check('重开后「当前」行 = 新模型(无 defaultEffort 时显示提供方默认档)', same(currentLines(), ['当前：DeepSeek V4 Flash · Default']), JSON.stringify(currentLines()))
  first.press({ key: 'ArrowDown', code: 'ArrowDown' })
  first.press({ key: 'ArrowDown', code: 'ArrowDown' })
  check('↓ 移到最后一行', activeRowIndex() === 2, String(activeRowIndex()))
  first.press({ key: 'ArrowDown', code: 'ArrowDown' })
  check('末行 clamp', activeRowIndex() === 2, String(activeRowIndex()))
  first.press({ key: 'Enter', code: 'Enter' })
  check(
    'Enter → 选中别的提供方的模型',
    same(first.directory.calls.at(-1), { provider: 'other', model: 'plain' }),
    JSON.stringify(first.directory.calls),
  )

  // ④ ⇧Tab 全局循环:有 defaultEffort 时候选 = efforts(不含 Default 档),循环回绕
  const cyc = env()
  event = cyc.press(shiftTab)
  check(
    '⇧Tab → 同模型的下一档(high → low)',
    same(cyc.directory.calls, [{ provider: 'deepseek-official', model: 'deepseek-v4-pro', reasoningEffort: 'low' }]),
    JSON.stringify(cyc.directory.calls),
  )
  check('⇧Tab 生效时吞键', event.propagationStopped === true)
  cyc.press(shiftTab)
  check(
    '再按 ⇧Tab 循环到末档后回到首档(low → high)',
    same(cyc.directory.calls[1], { provider: 'deepseek-official', model: 'deepseek-v4-pro', reasoningEffort: 'high' }),
    JSON.stringify(cyc.directory.calls),
  )

  // ⑤ 无 defaultEffort:候选首项是「提供方默认档」,故当前档缺席时从第一档开始
  const flash = env({ directory: makeDirectory({ current: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } }) })
  flash.press(shiftTab)
  check(
    '无 defaultEffort + 当前档缺席 → 切到第一档(Default → off)',
    same(flash.directory.calls, [{ provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'off' }]),
    JSON.stringify(flash.directory.calls),
  )
  flash.press(shiftTab)
  check('再按一次进入下一档(off → low)', flash.directory.calls[1]?.reasoningEffort === 'low', JSON.stringify(flash.directory.calls))

  // ⑥ no-op:模型无推理元数据 / 只有一档 → 不切换、不吞键(⇧Tab 交回页面)
  const plainDir = makeDirectory({ current: { provider: 'other', model: 'plain' } })
  const plain = env({ directory: plainDir })
  event = plain.press(shiftTab)
  check('模型无推理元数据 → ⇧Tab no-op 且不吞键', event.propagationStopped !== true && plainDir.calls.length === 0)
  const oneDir = makeDirectory({
    current: { provider: 'x', model: 'y', reasoningEffort: 'only' },
    groups: [{ id: 'x', name: 'X', models: [{ id: 'y', name: 'Y', reasoning: { efforts: [{ id: 'only', name: 'Only' }], defaultEffort: 'only' } }] }],
  })
  const one = env({ directory: oneDir })
  event = one.press(shiftTab)
  check('只有一档强度 → ⇧Tab no-op 且不吞键', event.propagationStopped !== true && oneDir.calls.length === 0)

  // ⑦ 无降级:服务 / 会话 / 子代理 / directoryFor 抛错 → 浮窗空态、⇧Tab no-op
  for (const [label, over] of [
    ['modelDirectories 服务缺席', { modelDirectories: undefined }],
    ['directoryFor 抛错(未知会话 / 无挂载会话面)', { throwOnDirectory: true }],
    ['无当前会话', { sessions: { list: { getSnapshot: () => ({ ...snapshot, current: undefined }) }, binding: () => undefined } }],
    [
      '被寻址的子代理会话',
      {
        sessions: {
          ...sessions,
          binding: () => undefined,
          subagentAddress: () => ({ mode: 'continuation', parentSessionId: 'sess-a', childSessionId: 'sess-b' }),
        },
      },
    ],
  ]) {
    const target = env(over)
    event = target.press(combo)
    await flush()
    check(`${label} → 浮窗显示空态、不崩、吞键`, event.propagationStopped === true && pickerRows().length === 0, JSON.stringify(emptyNotices()))
    check(`${label} → 空态文案 = 没有可切换模型的会话`, same(emptyNotices(), ['当前没有可切换模型的会话']), JSON.stringify(emptyNotices()))
    // 先关浮窗:浮窗打开时按 ⇧Tab 归浮层模态分发(见 ⑩),测的是浮窗外的全局行为
    target.press({ key: 'Escape', code: 'Escape' })
    event = target.press(shiftTab)
    check(`${label} → ⇧Tab no-op 且不吞键`, event.propagationStopped !== true)
  }

  // ⑧ load() 拒绝 / select() 拒绝:浮窗照常开关,失败只落在提示与 store 上
  const broken = env({ directory: makeDirectory({ loadError: 'host catalog unavailable' }) })
  event = broken.press(combo)
  await flush()
  check('load() 拒绝 → 浮窗仍打开并吞键(加载失败提示)', event.propagationStopped === true)
  check(
    'load() 拒绝 → 底部小字给出失败原因',
    hintTexts().some((text) => text.includes('模型目录加载失败：host catalog unavailable')),
    JSON.stringify(hintTexts()),
  )
  broken.press({ key: 'Escape', code: 'Escape' })
  const rejectSelect = env({ directory: makeDirectory({ selectError: 'session.selectModel failed' }) })
  rejectSelect.press(combo)
  await flush()
  event = rejectSelect.press({ key: 'Enter', code: 'Enter' })
  check('select() 拒绝 → 浮窗仍关闭、不崩、吞键', event.propagationStopped === true && pickerRows().length === 0)
  rejectSelect.press(shiftTab)
  check('select() 拒绝的 ⇧Tab 仍算已发出(吞键)', rejectSelect.press(shiftTab).propagationStopped === true)

  // ⑨ 失败提供方只做底部小字提示(不可选中,不占行)
  const withFailure = env({
    directory: makeDirectory({ failures: [{ id: 'broken-provider', name: 'Broken', message: 'unauthorized' }] }),
  })
  withFailure.press(combo)
  await flush()
  check('失败提供方不占行,只出现在底部小字', pickerRows().length === 3, String(pickerRows().length))
  check(
    '底部小字含失败提供方计数',
    hintTexts().some((text) => text.includes('1 个提供方的目录加载失败')),
    JSON.stringify(hintTexts()),
  )
  withFailure.press({ key: 'Escape', code: 'Escape' })

  // ⑩ 浮窗内按 ⇧Tab:提交切换并**原地**更新「当前」行(列表与高亮都不动)
  const inside = env()
  inside.press(combo)
  await flush()
  event = inside.press(shiftTab)
  check(
    '浮窗内 ⇧Tab → 提交切换并吞键',
    event.propagationStopped === true &&
      same(inside.directory.calls, [{ provider: 'deepseek-official', model: 'deepseek-v4-pro', reasoningEffort: 'low' }]),
    JSON.stringify(inside.directory.calls),
  )
  check('浮窗内 ⇧Tab 后「当前」行就地更新为 Low', same(currentLines(), ['当前：DeepSeek V4 Pro · Low']), JSON.stringify(currentLines()))
  check('浮窗内 ⇧Tab 不改变列表与高亮', pickerRows().length === 3 && activeRowIndex() === 1, String(activeRowIndex()))
  inside.press({ key: 'Escape', code: 'Escape' })

  // ⑪ ⇧Tab 的 editing 态门闸:只在 composer 自己的编辑区内接管
  const composerTarget = new FakeHTMLElement('DIV')
  composerTarget.isContentEditable = true
  const composerRoot = new FakeHTMLElement('DIV')
  composerRoot.contains = (node) => node === composerTarget
  const elsewhere = new FakeHTMLElement('TEXTAREA')
  const conversation = { input: { shell: () => ({ editor: { getRootElement: () => composerRoot } }) } }
  const gated = env({ conversation })
  event = gated.press({ ...shiftTab, target: composerTarget })
  check(
    'editing 态 + 焦点在 composer 内 → ⇧Tab 生效并吞键',
    event.propagationStopped === true && gated.directory.calls.length === 1,
    JSON.stringify(gated.directory.calls),
  )
  const outside = env({ conversation })
  event = outside.press({ ...shiftTab, target: elsewhere })
  check('editing 态 + 焦点在别处可编辑元素 → ⇧Tab 不吞键', event.propagationStopped !== true)
  check('editing 态 + 焦点在别处 → 不改模型强度', outside.directory.calls.length === 0)
  const noConversation = env()
  event = noConversation.press({ ...shiftTab, target: elsewhere })
  check('conversation 服务缺席 → editing 态 ⇧Tab no-op 不吞键', event.propagationStopped !== true && noConversation.directory.calls.length === 0)

  // ⑫ card 态:模型浮窗照开(带修饰键),⇧Tab 归卡片自己
  const cardEnv = env({
    uiSession: {
      pendingInteractions: {
        getSnapshot: () => new Map([['sess-b', { kind: 'question', key: 'question:9', sessionId: 'sess-b', questions: [{ id: 'q1', options: [{ label: 'A' }] }] }]]),
      },
    },
  })
  event = cardEnv.press(combo)
  await flush()
  check('card 态 ⌘/Ctrl+M 仍打开模型浮窗', event.propagationStopped === true && pickerRows().length === 3)
  cardEnv.press({ key: 'Escape', code: 'Escape' })
  event = cardEnv.press(shiftTab)
  check('card 态 ⇧Tab 不接管(交回卡片)', event.propagationStopped !== true && cardEnv.directory.calls.length === 0)

  // ⑬ 两个动作 id 的键位各自独立可覆盖
  storage.set('dsh-kbd-hotkeys:v1', JSON.stringify({ bindings: { 'model.pick': 'mod+alt+8', 'model.effortNext': 'mod+alt+u' } }))
  const custom = env()
  event = custom.press(combo)
  check('覆盖键位后 ⌘/Ctrl+M 不再打开', event.propagationStopped !== true && pickerRows().length === 0)
  event = custom.press({ key: '8', code: 'Digit8', ctrlKey: true, altKey: true })
  await flush()
  check('自定义 ⌘/Ctrl+Alt+8 打开模型浮窗并吞键', event.propagationStopped === true && pickerRows().length === 3)
  custom.press({ key: 'Escape', code: 'Escape' })
  event = custom.press(shiftTab)
  check('覆盖后 ⇧Tab 不再切换强度', event.propagationStopped !== true && custom.directory.calls.length === 0)
  event = custom.press({ key: 'u', code: 'KeyU', ctrlKey: true, altKey: true })
  check('自定义 ⌘/Ctrl+Alt+U → 切换强度并吞键', event.propagationStopped === true && custom.directory.calls.length === 1)
  storage.delete('dsh-kbd-hotkeys:v1')
}

// ---- 阶段 7(浮窗):⌘/Ctrl+I → 近期对话浮窗(按工作区分组 + ↑↓ 跨组选择 + Enter 打开) ----
// 列表 = sessions.list + workspaces.list 快照,由 recent-sessions.ts 派生:组序 = 宿主顺序、组内 = 最近更新在前、
// 空白 / 归档 / 子代理不列出、无归属落末尾空标题组;↑↓ 只移高亮(不打开会话),Enter / 点击行才打开(见 ③′)。
console.log('\n--- ⌘/Ctrl+I → 近期对话浮窗(按工作区分组 + ↑↓ 选择 + Enter 打开) ---')
{
  const combo = { key: 'i', code: 'KeyI', ctrlKey: true }
  const T = 1_700_000_000_000
  /** 会话摘要工厂(与上游 client SessionSummary 同形的最小子集)。 */
  const summary = (id, updatedAt, over = {}) => ({
    id, displayTitle: `会话 ${id}`, title: `会话 ${id}`,
    cwd: `/work/${id}`, running: false, completed: false, blank: false, updatedAt, ...over,
  })
  /** 夹具:两个工作区 + 无归属 + 空白 + 归档 + 子代理,覆盖全部派生规则。 */
  const sessionIds = ['a1', 'a2', 'b1', 'stray', 'blank', 'arch', 'sub']
  const byId = {
    a1: summary('a1', T - 1000),
    a2: summary('a2', T, { running: true }),
    b1: summary('b1', T - 500, { completed: true }),
    stray: summary('stray', T - 200),
    blank: summary('blank', T + 500, { blank: true }),
    arch: summary('arch', T + 900),
    sub: summary('sub', T + 1000, { origin: 'subagent' }),
  }
  const listSnapshot = (current) => ({ current, ids: sessionIds, byId, subagentsByParent: {} })
  const workspaceItems = [
    {
      workspaceId: 'w1', title: 'alpha', path: '/work/alpha', sessionIds: ['a1', 'a2', 'blank', 'arch'],
      createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z',
    },
    {
      workspaceId: 'w2', title: 'beta', path: '/work/beta', sessionIds: ['b1', 'sub'],
      createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z',
    },
  ]

  /** 装配:默认「两个工作区就绪、当前会话 = b1」;over.sessions 只替换列表快照,over.service 替换整个服务(undefined = 缺席)。
   * 录制用的 open 刻意写成读 this 的方法(真机 sessions.open 是原型方法,摘下来丢 this 抛 TypeError,这正是回归点)。 */
  function env(over = {}) {
    const opened = []
    let base
    if ('sessions' in over) {
      const given = over.sessions
      base = {
        list: { getSnapshot: () => given.list.getSnapshot() },
        open(id) {
          if (this.list === undefined) throw new Error('sessions.open lost its receiver')
          opened.push(id)
          const custom = given.open
          if (typeof custom === 'function') custom(id)
        },
        binding: () => undefined,
      }
    } else {
      base = {
        list: { getSnapshot: () => listSnapshot('b1') },
        open(id) {
          if (this.list === undefined) throw new Error('sessions.open lost its receiver')
          opened.push(id)
        },
        binding: () => undefined,
      }
    }
    const workspacesService = 'workspaces' in over
      ? over.workspaces
      : { list: { getSnapshot: () => ({ items: workspaceItems, archivedSessionIds: ['arch'], phase: 'ready' }) } }
    const press = loadPlugin({
      sessions: 'service' in over ? over.service : base,
      uiSession: { pendingInteractions: { getSnapshot: () => new Map() } },
      workspaces: workspacesService,
      ...over.extra,
    })
    return { press, opened }
  }

  // 近期对话行 / 分组标题:与工作区、模型浮窗的行类名不同,故互不干扰
  const sessionRows = () => collectNodes(globalThis.document.body, (el) => classHas(el, 'dsh-kbd-groupRow'))
  const groupHeadings = () => collectNodes(globalThis.document.body, (el) => classHas(el, 'dsh-kbd-group'))
  const activeSessionIndex = () => sessionRows().findIndex((el) => classHas(el, 'isActive'))
  /** 近期对话浮窗的 DOM 渲染快照(组标题 + 行的组合,按 DOM 顺序)。 */
  function rendered() {
    const out = []
    for (const child of (collectNodes(globalThis.document.body, (el) => classHas(el, 'dsh-kbd-list'))[0]?.children ?? [])) {
      if (classHas(child, 'dsh-kbd-group')) out.push(`[${nodeText(child)}]`)
      else if (classHas(child, 'dsh-kbd-groupRow')) out.push(nodeText(child))
    }
    return out
  }

  // ① 打开浮窗:按工作区分组渲染,组内最近更新在前,blank / 归档 / 子代理不列出
  const first = env()
  let event = first.press(combo)
  check('⌘/Ctrl+I 打开近期对话浮窗并吞键', event.propagationStopped === true)
  check(
    '按工作区分组渲染(组序 = 宿主顺序;组内 = 最近更新在前;末尾无归属组无标题)',
    same(rendered(), [
      '[alpha]',
      '会话 a2 /work/a2 运行中',
      '会话 a1 /work/a1',
      '[beta]',
      '会话 b1 /work/b1 完成 当前',
      '会话 stray /work/stray',
    ]),
    JSON.stringify(rendered()),
  )
  check('近期对话行不占用工作区 / 模型浮窗的行类名', pickerRows().length === 0, String(pickerRows().length))
  check('空白会话不列出', sessionRows().every((el) => !nodeText(el).includes('blank')) === true)
  check('子代理会话不列出', sessionRows().every((el) => !nodeText(el).includes('sub')) === true)
  check('归档会话不列出', sessionRows().every((el) => !nodeText(el).includes('arch')) === true)
  check('初始高亮 = 当前会话所在行(第 3 行)', activeSessionIndex() === 2, String(activeSessionIndex()))

  // ② ↑ / ↓ 跨组连续移动高亮且**不打开会话**;首尾 clamp(不循环)
  event = first.press({ key: 'ArrowDown', code: 'ArrowDown' })
  check('↓ 移入下一个工作区分组(跨组)', activeSessionIndex() === 3, String(activeSessionIndex()))
  check('↓ 被浮窗吞掉', event.propagationStopped === true)
  check('↑/↓ 不打开会话(只有 Enter 才调 sessions.open)', same(first.opened, []), JSON.stringify(first.opened))
  first.press({ key: 'ArrowUp', code: 'ArrowUp' })
  first.press({ key: 'ArrowUp', code: 'ArrowUp' })
  first.press({ key: 'ArrowUp', code: 'ArrowUp' })
  check('首行 clamp(不循环,仍停在第 1 行)', activeSessionIndex() === 0, String(activeSessionIndex()))
  first.press({ key: 'ArrowDown', code: 'ArrowDown' })
  first.press({ key: 'ArrowDown', code: 'ArrowDown' })
  first.press({ key: 'ArrowDown', code: 'ArrowDown' })
  check('末行 clamp(不循环,仍停在第 4 行)', activeSessionIndex() === 3, String(activeSessionIndex()))

  // ③ Enter → sessions.open(高亮会话)并关闭浮窗
  event = first.press({ key: 'Enter', code: 'Enter' })
  check('Enter → sessions.open(stray)', same(first.opened, ['stray']), JSON.stringify(first.opened))
  check('Enter 被吞', event.propagationStopped === true)
  check('打开后浮窗关闭(会话行清空)', sessionRows().length === 0, String(sessionRows().length))
  event = first.press({ key: 'ArrowDown', code: 'ArrowDown' })
  check('浮窗关闭后裸 ↓ 不吞键', event.propagationStopped !== true)

  // ③′ 确认路径:优先 uiWorkspace.openSession(= sessions.open + selectPanel(null)),缺席回退 sessions.open;
  //     两处都刻意用读 this 的类方法形态(摘下来丢 this 抛错,正是「Enter 不跳转」的回归点)。
  const wsOpened = []
  const viaWorkspace = env({
    extra: {
      uiWorkspace: {
        openSession(id) {
          if (wsOpened === undefined) throw new Error('uiWorkspace.openSession lost its receiver')
          wsOpened.push(id)
        },
      },
    },
  })
  viaWorkspace.press(combo)
  viaWorkspace.press({ key: 'Enter', code: 'Enter' })
  check('有 uiWorkspace.openSession → Enter 优先走它', same(wsOpened, ['b1']), JSON.stringify(wsOpened))
  check('走 openSession 时不再直接调 sessions.open', same(viaWorkspace.opened, []), JSON.stringify(viaWorkspace.opened))

  const wsNoMethod = env({ extra: { uiWorkspace: {} } })
  wsNoMethod.press(combo)
  wsNoMethod.press({ key: 'Enter', code: 'Enter' })
  check('uiWorkspace 无 openSession → 回退 sessions.open', same(wsNoMethod.opened, ['b1']), JSON.stringify(wsNoMethod.opened))

  const wsThrowing = env({ extra: { uiWorkspace: { openSession: () => { throw new Error('no mounted session surface') } } } })
  wsThrowing.press(combo)
  wsThrowing.press({ key: 'Enter', code: 'Enter' })
  check('openSession 抛错 → 回退 sessions.open 仍然打开', same(wsThrowing.opened, ['b1']), JSON.stringify(wsThrowing.opened))

  // ④ Esc 关闭 / 再按 ⌘/Ctrl+I 关闭(开关语义)/ ⌘/ 换成速查表
  first.press(combo)
  check('可再次打开', sessionRows().length === 4, String(sessionRows().length))
  first.press({ key: 'ArrowDown', code: 'ArrowDown' })
  event = first.press({ key: 'Escape', code: 'Escape' })
  check('Esc 关闭浮窗并吞键', event.propagationStopped === true && sessionRows().length === 0)
  first.press(combo)
  event = first.press(combo)
  check('再按一次 ⌘/Ctrl+I 关闭(开关语义)', sessionRows().length === 0, String(sessionRows().length))
  check('同组合键关闭被吞', event.propagationStopped === true)
  first.press(combo)
  event = first.press({ key: '/', code: 'Slash', ctrlKey: true })
  check('浮窗内按 ⌘/ 直接换成速查表(会话行消失)', event.propagationStopped === true && sessionRows().length === 0)
  event = first.press({ key: '/', code: 'Slash', ctrlKey: true })
  check('速查表再按 ⌘/ 关闭', event.propagationStopped === true)

  // ⑤ 当前会话不在列表里(空白会话 / 无 current)→ 初始高亮首行,Enter 打开首行
  const blankCurrent = env({ sessions: { list: { getSnapshot: () => listSnapshot('blank') } } })
  blankCurrent.press(combo)
  check('当前是空白会话(不列出)→ 初始高亮首行', activeSessionIndex() === 0, String(activeSessionIndex()))
  blankCurrent.press({ key: 'Enter', code: 'Enter' })
  check('Enter → sessions.open(a2)', same(blankCurrent.opened, ['a2']), JSON.stringify(blankCurrent.opened))

  const noCurrent = env({ sessions: { list: { getSnapshot: () => listSnapshot(undefined) } } })
  noCurrent.press(combo)
  check('无 current → 初始高亮首行', activeSessionIndex() === 0, String(activeSessionIndex()))
  noCurrent.press({ key: 'Escape', code: 'Escape' })
  // ⑥ sessions 服务缺席 / 快照缺 ids / open 缺失 / open 抛错:空态或 no-op,一律不崩
  const empty = env({
    sessions: { list: { getSnapshot: () => ({ current: 'x', ids: [], byId: {}, subagentsByParent: {} }) }, open() {}, binding: () => undefined },
  })
  event = empty.press(combo)
  check('无可用会话 → 浮窗打开为空态并吞键', event.propagationStopped === true && sessionRows().length === 0)
  check('空态给出提示文本', nodeText(globalThis.document.body).includes('当前没有可打开的对话'))
  event = empty.press({ key: 'Enter', code: 'Enter' })
  check('空态 Enter 不触发 sessions.open', same(empty.opened, []), JSON.stringify(empty.opened))
  check('空态 Enter 仍被模态吞掉', event.propagationStopped === true)
  empty.press({ key: 'Escape', code: 'Escape' })

  const noSessions = env({ service: undefined })
  event = noSessions.press(combo)
  check('sessions 服务缺席 → 浮窗空态、不崩、吞键', event.propagationStopped === true && sessionRows().length === 0)
  noSessions.press({ key: 'Escape', code: 'Escape' })

  const noIds = env({ sessions: { list: { getSnapshot: () => ({ current: 'a2', byId }) } } })
  event = noIds.press(combo)
  check('快照缺 ids → 浮窗空态、不崩', event.propagationStopped === true && sessionRows().length === 0)
  noIds.press({ key: 'Escape', code: 'Escape' })

  // open 缺失:整个服务换成一个只有 list 的壳(装配的录制 open 不参与)
  const noOpen = env({ service: { list: { getSnapshot: () => listSnapshot('a2') } } })
  event = noOpen.press(combo)
  check('open 缺失时浮窗照开', event.propagationStopped === true && sessionRows().length === 4)
  event = noOpen.press({ key: 'Enter', code: 'Enter' })
  check('open 缺失 → 确认时 no-op、不崩、浮窗关闭', event.propagationStopped === true && sessionRows().length === 0)

  const throwing = env({ sessions: { list: { getSnapshot: () => listSnapshot('a2') }, open: () => { throw new Error('unknown id') } } })
  throwing.press(combo)
  event = throwing.press({ key: 'Enter', code: 'Enter' })
  check('open 抛错 → 确认时 no-op、不崩、浮窗关闭', event.propagationStopped === true && sessionRows().length === 0)

  // ⑦ workspaces 服务缺席 / 快照缺 items → 全部会话落入无归属组(仍可用,不假装没有会话)
  const flat = env({
    workspaces: { list: { getSnapshot: () => ({ archivedSessionIds: ['arch'], phase: 'ready' }) } },
  })
  flat.press(combo)
  check('workspaces 无 items → 全部会话落在无标题组、按最近更新排序', same(rendered(), [
    '会话 a2 /work/a2 运行中',
    '会话 stray /work/stray',
    '会话 b1 /work/b1 完成 当前',
    '会话 a1 /work/a1',
  ]), JSON.stringify(rendered()))
  check('无归属组不渲染组标题', groupHeadings().length === 0, String(groupHeadings().length))
  check('无归属组仍排除归档 / 子代理 / 空白会话', sessionRows().length === 4, String(sessionRows().length))
  flat.press({ key: 'ArrowUp', code: 'ArrowUp' })
  flat.press({ key: 'ArrowUp', code: 'ArrowUp' })
  flat.press({ key: 'ArrowUp', code: 'ArrowUp' })
  flat.press({ key: 'ArrowUp', code: 'ArrowUp' })
  check('无归属组内首行 clamp', activeSessionIndex() === 0, String(activeSessionIndex()))
  flat.press({ key: 'Enter', code: 'Enter' })
  check('无归属组 Enter 仍打开会话', same(flat.opened, ['a2']), JSON.stringify(flat.opened))

  const noService = env({ workspaces: undefined })
  event = noService.press(combo)
  check('workspaces 服务缺席 → 同样退化为无归属组(不崩、不吞失败)', event.propagationStopped === true && sessionRows().length === 5)
  noService.press({ key: 'Escape', code: 'Escape' })

  // ⑦′ 全局条数上限:只列最近更新的 10 个(全局口径,不是每组 10 个);当前会话不在前 10 名时强制纳入并顶掉第 10 名。
  {
    const capIds = Array.from({ length: 13 }, (_, i) => `c${String(i + 1).padStart(2, '0')}`)
    const capById = {}
    capIds.forEach((id, i) => { capById[id] = summary(id, T + i) })
    // 空白会话 updatedAt 最高:它不可见,不得占用 10 个名额
    capById.blankTop = summary('blankTop', T + 99, { blank: true })
    const capWorkspaces = [
      {
        workspaceId: 'w1', title: 'one', path: '/work/one', sessionIds: capIds.slice(0, 5),
        createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z',
      },
      {
        workspaceId: 'w2', title: 'two', path: '/work/two', sessionIds: [...capIds.slice(5), 'blankTop'],
        createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z',
      },
    ]
    const capEnv = (current) => env({
      sessions: { list: { getSnapshot: () => ({ current, ids: [...capIds, 'blankTop'], byId: capById, subagentsByParent: {} }) } },
      workspaces: { list: { getSnapshot: () => ({ items: capWorkspaces, archivedSessionIds: [], phase: 'ready' }) } },
    })

    const capped = capEnv('c13')
    capped.press(combo)
    // 浮窗高度:面板带 --recent 修饰类,max-height 由 64vh 抬到 calc(88vh - 24px) 以容 10 行 + 组标题 + 页眉页脚;
    const panels = () => collectNodes(globalThis.document.body, (el) => classHas(el, 'dsh-kbd-panel'))
    const sheetText = () => (globalThis.document.head.children ?? [])
      .map((el) => (typeof el.textContent === 'string' ? el.textContent : '')).join('\n')
    const baseRule = /\.dsh-kbd-panel\{[^}]*?max-height:([^;}]+)/.exec(sheetText())
    const recentRule = /\.dsh-kbd-panel--recent\{max-height:([^}]+)\}/.exec(sheetText())
    check(
      '近期对话浮窗面板带 --recent 修饰类',
      panels().length === 1 && classHas(panels()[0], 'dsh-kbd-panel--recent'),
      JSON.stringify(panels().map((el) => el.className)),
    )
    check(
      '高度上限从 64vh 抬到 calc(88vh - 24px)',
      baseRule?.[1] === '64vh' && recentRule?.[1] === 'calc(88vh - 24px)',
      `${String(baseRule?.[1])} / ${String(recentRule?.[1])}`,
    )
    check('全局上限:13 个可见会话只渲染 10 行', sessionRows().length === 10, String(sessionRows().length))
    check(
      '上限 = 全局最近更新前 10(c01–c03 被裁掉),组序 / 组内序不变',
      same(rendered(), [
        '[one]',
        '会话 c05 /work/c05',
        '会话 c04 /work/c04',
        '[two]',
        '会话 c13 /work/c13 当前',
        '会话 c12 /work/c12',
        '会话 c11 /work/c11',
        '会话 c10 /work/c10',
        '会话 c09 /work/c09',
        '会话 c08 /work/c08',
        '会话 c07 /work/c07',
        '会话 c06 /work/c06',
      ]),
      JSON.stringify(rendered()),
    )
    check(
      '空白会话不占名额(updatedAt 最高也不进列表)',
      sessionRows().every((el) => !nodeText(el).includes('blankTop')) === true,
    )
    check('初始光标 = 当前会话 c13(组内第 3 行)', activeSessionIndex() === 2, String(activeSessionIndex()))
    capped.press({ key: 'Escape', code: 'Escape' })

    // 修饰类只属于近期对话浮窗:工作区浮窗的高度上限仍是基线 64vh
    capped.press({ key: 'k', code: 'KeyK', ctrlKey: true })
    check(
      '工作区浮窗不带 --recent(上限仍为 64vh)',
      panels().length === 1 && !classHas(panels()[0], 'dsh-kbd-panel--recent'),
      JSON.stringify(panels().map((el) => el.className)),
    )
    capped.press({ key: 'Escape', code: 'Escape' })

    const forced = capEnv('c01')
    forced.press(combo)
    check('当前会话不在前 10 名 → 强制纳入,行数仍为 10', sessionRows().length === 10, String(sessionRows().length))
    check('被顶掉的是原第 10 名 c04', sessionRows().every((el) => !nodeText(el).includes('会话 c04')) === true, JSON.stringify(rendered()))
    check('初始光标 = 被强制纳入的当前会话 c01(组内第 2 行)', activeSessionIndex() === 1, String(activeSessionIndex()))
    check(
      '强制纳入后组序 / 组内序仍按最近更新',
      same(rendered(), [
        '[one]',
        '会话 c05 /work/c05',
        '会话 c01 /work/c01 当前',
        '[two]',
        '会话 c13 /work/c13',
        '会话 c12 /work/c12',
        '会话 c11 /work/c11',
        '会话 c10 /work/c10',
        '会话 c09 /work/c09',
        '会话 c08 /work/c08',
        '会话 c07 /work/c07',
        '会话 c06 /work/c06',
      ]),
      JSON.stringify(rendered()),
    )
    forced.press({ key: 'Enter', code: 'Enter' })
    check('强制纳入的当前会话可被 Enter 打开', same(forced.opened, ['c01']), JSON.stringify(forced.opened))
  }

  // ⑧ card / editing 态同样可用(带修饰键的组合不与卡片裸键、文本编辑冲突)
  const carded = env({
    extra: {
      uiSession: {
        pendingInteractions: {
          getSnapshot: () => new Map([['b1', { kind: 'question', key: 'question:9', sessionId: 'b1', questions: [{ id: 'q1', options: [{ label: 'A' }] }] }]]),
        },
      },
    },
  })
  event = carded.press(combo)
  check('card 态 ⌘/Ctrl+I 仍打开浮窗', event.propagationStopped === true && sessionRows().length === 4)
  carded.press({ key: 'Escape', code: 'Escape' })
  const editing = env()
  event = editing.press({ ...combo, target: new FakeHTMLElement('TEXTAREA') })
  check('editing 态 ⌘/Ctrl+I 仍打开浮窗', event.propagationStopped === true && sessionRows().length === 4)
  editing.press({ key: 'Escape', code: 'Escape' })

  // ⑨ 键位可独立覆盖(与其它动作同一套 bindings 机制)
  storage.set('dsh-kbd-hotkeys:v1', JSON.stringify({ bindings: { 'session.recent': 'mod+alt+7' } }))
  const custom = env()
  event = custom.press(combo)
  check('覆盖键位后 ⌘/Ctrl+I 不再打开', event.propagationStopped !== true && sessionRows().length === 0)
  event = custom.press({ key: '7', code: 'Digit7', ctrlKey: true, altKey: true })
  check('自定义 ⌘/Ctrl+Alt+7 打开浮窗并吞键', event.propagationStopped === true && sessionRows().length === 4)
  event = custom.press({ key: 'Enter', code: 'Enter' })
  check('自定义键位下 Enter 打开高亮会话', same(custom.opened, ['b1']), JSON.stringify(custom.opened))
  storage.delete('dsh-kbd-hotkeys:v1')
}

console.log(`\n${failures === 0 ? 'ALL PASS' : `${String(failures)} FAILED`}`)
process.exitCode = failures === 0 ? 0 : 1
