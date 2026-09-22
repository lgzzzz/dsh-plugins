/**
 * 诊断脚本共享基座(非插件产物):最小 DOM 桩 + `__ModuleLoader__` 桩载入 lib/client.js、
 * 断言工具与各用例共用的夹具(视图层两源 / 会话快照 / 草稿 store / 浮层观察工具)。
 *
 * `test/*.mjs` 按被测功能拆分,各自 `import` 本文件后只跑自己的用例;本文件本身不执行任何用例。
 * 桩里上游方法须写成读 this 的类方法形态(摘下来丢 this 会抛错,回归才测得出),DOM 桩的
 * querySelector 恒空 —— 业务代码只走服务面。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

// ---- 最小 DOM 桩:不提供任何卡片元素,仅记录浮层自建的 DOM 子树 ----
class FakeNode {}
export class FakeHTMLElement extends FakeNode {
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
/** 可注入的假停靠面板:仅 ⌘/Ctrl+L 的元素级聚焦需要 DOM(见 test/rightbar-terminal.mjs),默认空。 */
let dockPanes = []
/** 注入假停靠面板列表(仅 xterm 聚焦用例需要);用完须 `setDockPanes([])` 复位。 */
export const setDockPanes = (panes) => { dockPanes = panes }
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
export const storage = new Map()
globalThis.localStorage = {
  getItem: (k) => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => storage.set(k, String(v)),
}
let registration = null
globalThis.window = { __ModuleLoader__: { load: (reg) => { registration = reg } } }

const source = readFileSync(join(here, '..', 'lib', 'client.js'), 'utf8')

// ---- 断言工具 -------------------------------------------------------------
let failures = 0
export function check(label, condition, detail) {
  const ok = condition === true
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || detail === undefined ? '' : `  → ${detail}`}`)
}
export const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
export const clone = (value) => JSON.parse(JSON.stringify(value))
/** 汇总并置退出码;由 test-services.mjs(或单独直跑某个用例文件时)收尾调用一次。 */
export function report() {
  console.log(`\n${failures === 0 ? 'ALL PASS' : `${String(failures)} FAILED`}`)
  process.exitCode = failures === 0 ? 0 : 1
}
/** 直接 `node test/xxx.mjs` 运行时为 true;被 test-services.mjs import 时为 false。 */
export function isMain(metaUrl) {
  const entry = process.argv[1]
  if (entry === undefined) return false
  const self = fileURLToPath(metaUrl)
  if (resolve(entry) === self) return true
  return process.platform === 'win32' && resolve(entry).toLowerCase() === self.toLowerCase()
}

// ---- 视图层两源 + 会话作用域绑定(alpha.2 契约) --------------------------------
// 0.1.6-alpha.2 起 sessions.list 快照不再带 current / summary.completed:
// 当前会话在 uiSession.current(绑定源),完成未读在 uiSession.sessionStatus(completionUnread)。
// 用例通过 `view.current` / `view.completionUnread` 控制这两个源;`withView` 把它们补进每处 uiSession 桩。
export const view = {
  /** 当前会话 id(undefined / '' = 无当前会话)。 */
  current: 'sess-b',
  /** 带「完成未读」标记的会话 id 集合。 */
  completionUnread: new Set(),
}
const currentSource = () => ({
  getSnapshot: () => (view.current === undefined || view.current === '' ? undefined : { key: view.current }),
})
const statusSource = () => ({
  getSnapshot: () => new Map([...view.completionUnread].map((id) => [id, { completionUnread: true }])),
})
/** 会话作用域绑定:0.1.6-alpha.2 起 uiSession.resolve(sessionId) 已删除,改由 bindingSource(reference) 物化,
 * reference = { sessionId, binding: sessions.binding(sessionId) };桩复刻上游的身份校验(不同一即缺席投影)。 */
const bindingSourceStub = (sessions) => (reference) => ({
  getSnapshot: () => {
    const owner = sessions?.binding?.(reference?.sessionId)
    if (owner === undefined || owner !== reference?.binding) return undefined
    return { key: reference.sessionId, ctx: owner.ctx }
  },
})
/** 补视图层两源;未显式声明 bindingSource 的桩由本函数按上游契约补上(声明 undefined 即模拟该面缺席)。 */
const withView = (uiSession, services) => {
  const stub = uiSession ?? {}
  return {
    current: currentSource(),
    sessionStatus: statusSource(),
    ...stub,
    ...(Object.hasOwn(stub, 'bindingSource') ? {} : { bindingSource: bindingSourceStub(services?.sessions) }),
  }
}

// ---- 浮层观察工具(只读插件自建子树) ----------------------------------------
/** 深度优先收集满足条件的元素。 */
export function collectNodes(node, predicate, out = []) {
  for (const child of node.children ?? []) {
    if (predicate(child)) out.push(child)
    collectNodes(child, predicate, out)
  }
  return out
}
export const classHas = (el, name) => typeof el.className === 'string' && el.className.split(' ').includes(name)
/** 当前浮层渲染的工作区 / 模型行(按 DOM 顺序)。 */
export const pickerRows = () => collectNodes(globalThis.document.body, (el) => classHas(el, 'dsh-kbd-row'))
/** 高亮行下标(-1 = 无高亮)。 */
export const activeRowIndex = () => pickerRows().findIndex((el) => classHas(el, 'isActive'))
/** 一行/一个节点的全部文本(自带 textContent + 子树,压缩空白)。 */
export function nodeText(node) {
  const own = typeof node.textContent === 'string' ? node.textContent : ''
  return [own, ...(node.children ?? []).map(nodeText)].join(' ').replace(/\s+/g, ' ').trim()
}

// ---- 通用装配 -------------------------------------------------------------
/** 载入产物并 apply;返回「按键函数」(target 默认非可编辑 DIV,即 browse 态)。 */
export function loadPlugin(services) {
  globalThis.document = new FakeDocument()
  registration = null
  ;(0, eval)(source)
  if (registration === null) throw new Error('bundle did not register')
  const plugin = registration.factory(() => { throw new Error('unexpected external require') })
  const ctx = {
    // uiSession 桩统一补上视图层两源与 bindingSource(真实上游由 dsh-client-ui-session 提供)
    get: (name) => (name === 'uiSession' ? withView(services[name], services) : services[name]),
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

// ---- 会话快照夹具 ----------------------------------------------------------
const now = Date.now()
export const snapshot = {
  ids: ['sess-a', 'sess-b'],
  byId: {
    'sess-a': { id: 'sess-a', running: false, blank: false, updatedAt: now - 1000 },
    'sess-b': { id: 'sess-b', running: true, blank: false, updatedAt: now },
  },
  projectionsBySession: {},
}
/** 会话绑定对象(SessionBinding):作用域绑定的物化只认 sessions.binding(id) 返回的这一个身份。 */
const sessionOwner = { ctx: {} }
export const sessions = {
  list: { getSnapshot: () => snapshot },
  binding: (id) => (id === 'sess-b' ? sessionOwner : undefined),
}

/** 假草稿 store:复刻上游 replace(覆盖 requestKey + progress)/ clear(仅 requestKey 匹配时清空)。 */
export function makeDraftStore() {
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
export function composerSlots(draft) {
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
