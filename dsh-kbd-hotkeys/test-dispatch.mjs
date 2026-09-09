/**
 * 临时诊断脚本(非插件产物):用最小 DOM 桩加载 lib/client.js,
 * 验证 Ctrl+Alt+↑/↓ 的分发链路是否能把按键送进 openNeighborSession。
 * 用法: node test-dispatch.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

// ---- 最小 DOM 桩 ----------------------------------------------------------
class FakeNode {}
class FakeHTMLElement extends FakeNode {
  constructor(tag = 'DIV') {
    super()
    this.tagName = tag
    this.isContentEditable = false
    this.disabled = false
  }
  focus() {}
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

// ---- 模块加载器桩 ---------------------------------------------------------
let registration = null
globalThis.window = {
  __ModuleLoader__: {
    load: (reg) => { registration = reg },
  },
}

const source = readFileSync(join(here, 'lib', 'client.js'), 'utf8')
// eslint-disable-next-line no-eval
;(0, eval)(source)
if (registration === null) throw new Error('bundle did not register')
const plugin = registration.factory(() => { throw new Error('unexpected external require') })
console.log('plugin name:', plugin.name, '| inject:', JSON.stringify(plugin.inject))

// ---- 会话快照桩:两个活跃会话 + 一个当前会话 -------------------------------
const now = Date.now()
const snapshot = {
  current: 'sess-b',
  ids: ['sess-a', 'sess-b', 'sess-c'],
  byId: {
    'sess-a': { id: 'sess-a', running: false, completed: false, blank: false, updatedAt: now - 1000 },
    'sess-b': { id: 'sess-b', running: true, completed: false, blank: false, updatedAt: now },
    'sess-c': { id: 'sess-c', running: false, completed: true, blank: false, updatedAt: now - 2000 },
  },
  subagentsByParent: {},
}
const opened = []
const sessions = {
  list: { getSnapshot: () => snapshot },
  open: (id) => { opened.push(id) },
  binding: () => undefined,
}
const services = {
  sessions,
  uiSession: { pendingInteractions: { getSnapshot: () => new Map() } },
  layout: { toggleSidebar() {} },
  workspaces: { list: { getSnapshot: () => ({ archivedSessionIds: [] }) } },
}
const ctx = {
  get: (name) => services[name],
  effect: (cb) => { const d = cb(); if (typeof d === 'function') d() },
}

plugin.apply(ctx)

const handler = document.listeners.get('keydown')?.[0]?.fn
if (handler === undefined) throw new Error('no keydown listener installed')

function press(init) {
  const event = new FakeKeyboardEvent(init)
  handler(event)
  return event
}

console.log('\n--- dispatch probes ---')
for (const [label, init] of [
  ['Ctrl+Alt+ArrowUp   ', { key: 'ArrowUp', code: 'ArrowUp', ctrlKey: true, altKey: true }],
  ['Ctrl+Alt+ArrowDown ', { key: 'ArrowDown', code: 'ArrowDown', ctrlKey: true, altKey: true }],
  ['Ctrl+Alt+ArrowLeft ', { key: 'ArrowLeft', code: 'ArrowLeft', ctrlKey: true, altKey: true }],
  ['Ctrl+Alt+ArrowRight', { key: 'ArrowRight', code: 'ArrowRight', ctrlKey: true, altKey: true }],
]) {
  const before = opened.length
  const event = press(init)
  console.log(`${label} -> opened=${JSON.stringify(opened.slice(before))} swallowed=${event.propagationStopped === true}`)
}
