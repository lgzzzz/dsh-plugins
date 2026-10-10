/**
 * dsh-ui-chat-fold-anchor 测试的共享装置：断言与失败计数、够用的假 DOM（元素树 / 内联样式 /
 * MutationObserver / rAF 队列），以及产物加载器。
 *
 * 假 DOM 只实现本插件真正用到的那部分语义：`[attr]` / `[attr="value"]` 选择器、
 * `dataset` 与属性表的双向映射、`style` 写入触发 `style` 属性记录、
 * `scrollTop` 按 `[0, scrollHeight - clientHeight]` 夹取，以及由测试显式推进的
 * `MutationObserver` / `ResizeObserver` 通知。
 *
 * 跑全部请用 `node test/run-all.mjs`（或 pnpm test）。
 * 依赖 Node 22+ 的 Type Stripping 直接 import .ts。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

/** 本插件的包根目录（测试文件在 test/ 下，所以是上一级）。 */
export const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

let failures = 0

/** 已失败的断言数。 */
export function failureCount() {
  return failures
}

export function check(label, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  const ok = a === e
  if (!ok) failures += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : ` — 期望 ${e},实得 ${a}`}`)
}

export function checkTrue(label, actual) {
  const ok = actual === true
  if (!ok) failures += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : ` — 期望 true,实得 ${JSON.stringify(actual)}`}`)
}

export function checkFalse(label, actual) {
  const ok = actual === false
  if (!ok) failures += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : ` — 期望 false,实得 ${JSON.stringify(actual)}`}`)
}

/** 对象同一性断言（null / undefined / 函数用）。 */
export function checkSame(label, actual, expected) {
  const ok = Object.is(actual, expected)
  if (!ok) failures += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : ' — 期望同一个值'}`)
}

/** 打印本文件的结论并设置退出码。每个测试文件末尾调用一次。 */
export function finish() {
  console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`)
  process.exitCode = failures === 0 ? 0 : 1
}

/** 模型选择器：只认本插件用到的 `[attr]` 与 `[attr="value"]`。 */
function matches(element, selector) {
  const match = /^\[([a-z-]+)(?:="([^"]*)")?\]$/.exec(selector)
  if (match === null) throw new Error(`假 DOM 不支持的选择器: ${selector}`)
  const [, name, value] = match
  const actual = element.attributes.get(name)
  if (actual === undefined) return false
  return value === undefined || actual === value
}

/** 属性名 → `dataset` 键（`data-chat-anchor-key` → `chatAnchorKey`）。 */
function dataKey(attribute) {
  return attribute.replace(/^data-/, '').replace(/-([a-z])/g, (_all, letter) => letter.toUpperCase())
}

/** `dataset` 键 → 属性名（`chatAnchorKey` → `data-chat-anchor-key`）。 */
function dataAttribute(key) {
  return `data-${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`
}

/** 一条可记录/可通知的 DOM 变更；真实 DOM 里「属性此前不存在」的 oldValue 是 null。 */
function attributeRecord(target, name, oldValue) {
  return { type: 'attributes', target, attributeName: name, oldValue: oldValue ?? null }
}

/** 假元素：够本插件用的树、属性表、内联样式与几何。 */
export class FakeElement {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase()
    this.attributes = new Map()
    this.children = []
    this.parentElement = null
    this.isConnected = true
    /** 折叠前、内容坐标下的顶边与高度；已隐藏的元素高度按 0 计。 */
    this.contentTop = 0
    this.height = 0
    /** 自己就是滚动口时使用的视口高度，以及它之前已有的内容高度。 */
    this.clientHeight = 0
    this.contentBase = 0
    this.isScroller = false
    this.observers = []
    this.resizeObservers = []
    this._scrollTop = 0
    this.style = new Proxy({}, {
      set: (props, key, value) => {
        if (props[key] === value) return true
        props[key] = value
        this.notifyAttribute('style', undefined)
        return true
      },
      get: (props, key) => props[key] ?? '',
    })
    this.dataset = new Proxy({}, {
      set: (_props, key, value) => {
        this.setAttribute(dataAttribute(key), String(value))
        return true
      },
      get: (_props, key) => this.attributes.get(dataAttribute(key)),
      has: (_props, key) => this.attributes.has(dataAttribute(key)),
    })
  }

  /** 真实 DOM 里没有前一个兄弟节点时返回 null（占位元素的前一个兄弟就是流程列）。 */
  get previousElementSibling() {
    const parent = this.parentElement
    if (parent === null) return null
    const index = parent.children.indexOf(this)
    return index > 0 ? parent.children[index - 1] : null
  }

  get scrollTop() {
    return this._scrollTop
  }

  set scrollTop(value) {
    const max = Math.max(0, this.scrollHeight - this.clientHeight)
    this._scrollTop = Math.min(Math.max(0, value), max)
  }

  append(child) {
    child.parentElement = this
    child.setConnected(this.isConnected)
    this.children.push(child)
    // 近似 `subtree: true`：子节点变动通知直接父元素与声明了 subtree 的祖先。
    const record = { type: 'childList', target: this, attributeName: undefined }
    for (let node = this; node !== null; node = node.parentElement) {
      for (const observer of [...node.observers]) {
        if (node === this || observer.options?.subtree === true) observer.notify([record])
      }
    }
    return child
  }

  /** 连同子树一起标记连接状态（挂载/卸载用）。 */
  setConnected(value) {
    this.isConnected = value
    for (const child of this.children) child.setConnected(value)
  }

  setAttribute(name, value) {
    const oldValue = this.attributes.get(name)
    this.attributes.set(name, String(value))
    this.notifyAttribute(name, oldValue)
  }

  /** 属性变化通知自己与声明了 `subtree` 的祖先（近似真实的子树观察）。 */
  notifyAttribute(name, oldValue) {
    const record = attributeRecord(this, name, oldValue)
    for (let node = this; node !== null; node = node.parentElement) {
      for (const observer of [...node.observers]) {
        if (node === this || observer.options?.subtree === true) observer.notify([record])
      }
    }
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null
  }

  hasAttribute(name) {
    return this.attributes.has(name)
  }

  removeAttribute(name) {
    const oldValue = this.attributes.get(name)
    this.attributes.delete(name)
    this.notifyAttribute(name, oldValue)
  }

  /** 触发登记在本元素上的 ResizeObserver（真实环境里由布局变化触发）。 */
  notifyResize() {
    for (const observer of [...this.resizeObservers]) observer.callback([], observer)
  }

  /** 本元素或祖先是滚动口时返回它。 */
  scrollerAncestor() {
    for (let node = this; node !== null; node = node.parentElement) {
      if (node.isScroller) return node
    }
    return null
  }

  /**
   * 本元素当前实际占的高度：自己或任一祖先是 `hidden` 时归零（真实 DOM 里隐藏的元素
   * 不参与布局，子树整体不占高度），折叠动画期间由 `collapseTo` 给出中间值。
   */
  collapsedHeight() {
    if (this.isHiddenByAncestorOrSelf()) return 0
    return this.collapseTo ?? this.height
  }

  /** 自己或任一祖先带 `hidden` 属性。 */
  isHiddenByAncestorOrSelf() {
    for (let node = this; node !== null; node = node.parentElement) {
      if (node.hasAttribute('hidden')) return true
    }
    return false
  }

  /** 自己在内容坐标里被上移了多少：所有「在它上方、收矮了」的行收掉的高度之和。 */
  foldedShift() {
    const scroller = this.scrollerAncestor()
    if (scroller === null) return 0
    let shift = 0
    for (const row of scroller.querySelectorAll('[data-chat-anchor-key]')) {
      if (row === this) continue
      if (row.contentTop + row.height > this.contentTop) continue
      shift += row.height - row.collapsedHeight()
    }
    return shift
  }

  /** 滚动口的可滚动高度：已有内容 + 各行的当前高度 + 尾部占位元素的高度。 */
  get scrollHeight() {
    let total = this.contentBase
    for (const row of this.querySelectorAll('[data-chat-anchor-key]')) total += row.collapsedHeight()
    const spacer = this.querySelector('[data-chat-turn-spacer]')
    if (spacer !== null) total += Number.parseFloat(spacer.style.height) || 0
    return total
  }

  getBoundingClientRect() {
    if (this.isScroller) return { top: 0, bottom: this.clientHeight, height: this.clientHeight }
    const scrollTop = this.scrollerAncestor()?.scrollTop ?? 0
    const height = this.collapsedHeight()
    const top = this.contentTop - this.foldedShift() - scrollTop
    return { top, bottom: top + height, height }
  }

  contains(node) {
    if (node === null) return false
    for (const child of this.children) {
      if (child === node || child.contains(node)) return true
    }
    return false
  }

  matches(selector) {
    return matches(this, selector)
  }

  closest(selector) {
    for (let node = this; node !== null; node = node.parentElement) {
      if (matches(node, selector)) return node
    }
    return null
  }

  querySelectorAll(selector) {
    const found = []
    const walk = (node) => {
      for (const child of node.children) {
        if (matches(child, selector)) found.push(child)
        walk(child)
      }
    }
    walk(this)
    return found
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null
  }
}

/** 假文档：`body` 为根，`querySelectorAll` 覆盖整棵树。 */
export class FakeDocument {
  constructor() {
    this.body = new FakeElement('body')
  }

  querySelectorAll(selector) {
    return this.body.querySelectorAll(selector)
  }
}

/** 假 MutationObserver：`observe` 把回调登记到元素上，测试用 `setAttribute` / `style` 写入触发。 */
export class FakeMutationObserver {
  static instances = []

  constructor(callback) {
    this.callback = callback
    this.options = null
    FakeMutationObserver.instances.push(this)
  }

  observe(target, options) {
    this.options = options
    this.target = target
    target.observers.push(this)
  }

  disconnect() {
    this.options = null
    if (this.target !== undefined) this.target.observers = this.target.observers.filter((item) => item !== this)
  }

  /** 按 `attributeFilter` 过滤属性记录后交给回调（子节点记录不受该过滤影响）。 */
  notify(records) {
    if (this.options === null) return
    const filter = this.options.attributeFilter
    const delivered = filter === undefined
      ? records
      : records.filter((record) => record.type !== 'attributes' || filter.includes(record.attributeName))
    if (delivered.length > 0) this.callback(delivered, this)
  }
}

/** 假 ResizeObserver：`observe` 把回调登记到元素上，测试用 `notifyResize()` 触发。 */
export class FakeResizeObserver {
  constructor(callback) {
    this.callback = callback
  }

  observe(target) {
    this.target = target
    target.resizeObservers.push(this)
  }

  disconnect() {
    if (this.target !== undefined) {
      this.target.resizeObservers = this.target.resizeObservers.filter((item) => item !== this)
    }
  }
}

/** 假 rAF：登记回调，由 `flushFrame()` 手动推进一帧。 */
export class FakeFrames {
  constructor() {
    this.pending = new Map()
    this.nextHandle = 1
  }

  request = (callback) => {
    const handle = this.nextHandle
    this.nextHandle += 1
    this.pending.set(handle, callback)
    return handle
  }

  cancel = (handle) => {
    this.pending.delete(handle)
  }

  /** 推进当前这一帧的全部回调（回调新排的帧留到下一次）。 */
  flush() {
    const current = [...this.pending.values()]
    this.pending.clear()
    for (const callback of current) callback()
  }

  /** 待推进的帧数。 */
  get size() {
    return this.pending.size
  }
}

/**
 * 在假 DOM 环境里跑一段代码：安装 `document` / `MutationObserver` / `requestAnimationFrame`
 * 全局，跑完还原。
 *
 * @param run - 使用安装好的全局。
 * @returns `run` 的返回值。
 */
export function withFakeDom(run) {
  const doc = new FakeDocument()
  const frames = new FakeFrames()
  const previous = {
    document: globalThis.document,
    MutationObserver: globalThis.MutationObserver,
    ResizeObserver: globalThis.ResizeObserver,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    cancelAnimationFrame: globalThis.cancelAnimationFrame,
  }
  globalThis.document = doc
  globalThis.MutationObserver = FakeMutationObserver
  globalThis.ResizeObserver = FakeResizeObserver
  globalThis.requestAnimationFrame = frames.request
  globalThis.cancelAnimationFrame = frames.cancel
  try {
    return run({ doc, frames })
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key]
      else globalThis[key] = value
    }
  }
}

/**
 * 建一个聊天滚动口：滚动口（可选外层）→ 列表 → 过程组（内含折叠体）+ 回答行 + 占位元素。
 *
 * 布局（内容坐标）：垫高行 850..900（供折叠收尾的收矮用）、过程组 900..1200、回答行
 * 1200..1400；滚动位置 1000 时阅读线落在过程组底部与回答行顶部的交界上，回答行的视觉顶边是 200。
 *
 * @param options.shared - true 时按共享滚动模式多建一层 `[data-conversation-scroll]` 祖先。
 */
export function buildChat({ shared = false } = {}) {
  const outer = new FakeElement('div')
  outer.isScroller = true
  outer.clientHeight = 400
  outer.contentBase = 900
  if (shared) outer.setAttribute('data-conversation-scroll', '')

  const list = new FakeElement('div')
  outer.append(list)

  const column = new FakeElement('div')
  column.setAttribute('data-chat-flow', '')
  list.append(column)

  const filler = new FakeElement('div')
  filler.dataset.chatAnchorKey = 'filler:9'
  filler.contentTop = 850
  filler.height = 50
  column.append(filler)

  const group = new FakeElement('div')
  group.dataset.chatAnchorKey = 'group:9'
  group.contentTop = 900
  group.height = 300
  const body = new FakeElement('div')
  body.contentTop = 900
  body.height = 300
  group.append(body)
  column.append(group)

  const answer = new FakeElement('div')
  answer.dataset.chatAnchorKey = 'answer:9'
  answer.contentTop = 1200
  answer.height = 200
  column.append(answer)

  const spacer = new FakeElement('div')
  spacer.setAttribute('data-chat-turn-spacer', '')
  list.append(spacer)

  if (!shared) {
    list.isScroller = true
    list.clientHeight = 400
    list.contentBase = 900
  }
  return { outer, list, column, filler, group, body, answer, spacer, scroller: shared ? outer : list }
}

/**
 * 打上折叠标记：ui-chat 在写折叠窗口信号（`overflow-anchor: none`）**之前**就打了这个标记，
 * 此时几何还没变——选锚点就发生在这一刻。
 */
export function markCollapsing(chat) {
  chat.body.dataset.chatMotion = 'collapse'
}

/** 折叠动画让几何真的变：折叠体收成 0，它下方的内容按模型自动整体上移同高。 */
export function moveUpForFold(chat) {
  chat.group.collapseTo = 0
}

/** 以假 `window.__ModuleLoader__` 载入构建产物，返回注册对象。 */
export function loadClientArtifact() {
  let registration = null
  const previous = globalThis.window
  globalThis.window = {
    __ModuleLoader__: {
      load: (value) => {
        registration = value
      },
    },
  }
  try {
    // eslint-disable-next-line no-eval
    ;(0, eval)(readFileSync(join(pluginRoot, 'lib', 'client.js'), 'utf8'))
  } finally {
    if (previous === undefined) delete globalThis.window
    else globalThis.window = previous
  }
  return registration
}
