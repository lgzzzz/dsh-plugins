/**
 * dsh-turn-process-open 的测试装置：断言、假元素 / 假 document、fiber 链构造与产物加载器。
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
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : ` — 期望 ${e}，实得 ${a}`}`)
}

export function checkTrue(label, actual) {
  const ok = actual === true
  if (!ok) failures += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : ` — 期望 true，实得 ${JSON.stringify(actual)}`}`)
}

export function checkFalse(label, actual) {
  const ok = actual === false
  if (!ok) failures += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : ` — 期望 false，实得 ${JSON.stringify(actual)}`}`)
}

/** 收集 console.warn 的文本（期间替换实现，不打印原文）。 */
export function captureWarnings(run) {
  const warnings = []
  const original = console.warn
  console.warn = (...args) => warnings.push(args.map(String).join(' '))
  try {
    run()
  } finally {
    console.warn = original
  }
  return warnings
}

/** 打印本文件的结论并设置退出码。每个测试文件末尾调用一次。 */
export function finish() {
  console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`)
  process.exitCode = failures === 0 ? 0 : 1
}

/**
 * 只支持本插件用到的选择器子集：逗号分组、可选标签前缀、若干 `[attr]` / `[attr="value"]`
 * 谓词，以及 `tag[attr]`。不实现后代 / 子代组合器。
 */
function matchesSelector(element, selector) {
  const part = selector.trim()
  if (part === '') return false
  const tag = /^([a-zA-Z][\w-]*)/.exec(part)?.[1] ?? null
  if (tag !== null && element.tag !== tag) return false
  const predicates = [...part.matchAll(/\[([a-zA-Z0-9_-]+)(?:="([^"]*)")?\]/g)]
  if (predicates.length === 0) return tag !== null && element.tag === tag
  return predicates.every(([, name, value]) => {
    if (!element.hasAttribute(name)) return false
    return value === undefined || element.getAttribute(name) === value
  })
}

/** 假元素：属性、子树、点击与焦点计数。 */
export class FakeElement {
  constructor(tag = 'div', attributes = {}) {
    this.tag = tag
    this.parent = null
    this.children = []
    this.attrs = new Map(Object.entries(attributes))
    this.dataset = {}
    this.textContent = ''
    this.clicks = 0
    this.focusCount = 0
    this.removed = false
  }

  append(child) {
    child.parent = this
    this.children.push(child)
    return child
  }

  remove() {
    this.removed = true
    if (this.parent !== null && Array.isArray(this.parent.children)) {
      this.parent.children = this.parent.children.filter((child) => child !== this)
    }
  }

  getAttribute(name) {
    return this.attrs.has(name) ? this.attrs.get(name) : null
  }

  hasAttribute(name) {
    return this.attrs.has(name)
  }

  setAttribute(name, value) {
    this.attrs.set(name, String(value))
  }

  removeAttribute(name) {
    this.attrs.delete(name)
  }

  closest(selector) {
    for (let node = this; node !== null; node = node.parent) {
      for (const part of selector.split(',')) {
        if (matchesSelector(node, part)) return node
      }
    }
    return null
  }

  querySelectorAll(selector) {
    const parts = selector.split(',').map((part) => part.trim())
    const found = []
    const walk = (node) => {
      for (const child of node.children) {
        if (parts.some((part) => matchesSelector(child, part))) found.push(child)
        walk(child)
      }
    }
    walk(this)
    return found
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null
  }

  click() {
    this.clicks += 1
    this.onClick?.(this)
  }

  focus() {
    this.focusCount += 1
  }
}

/** 把若干组 props 串成一条 fiber 父链挂到元素上（最近的祖先 props 在前）。 */
export function attachFiber(element, ...propsList) {
  const root = { memoizedProps: {}, return: null }
  let tail = root
  for (const props of propsList) {
    tail.return = { memoizedProps: props, return: null }
    tail = tail.return
  }
  element['__reactFiber$test'] = root
  return element
}

/** 一个带 `turnProcess` prop 的标题后代链。 */
export function turnProcessProps({ turn = 1, answerStep = 0, setOpen } = {}) {
  return {
    turnProcess: {
      spec: { turn, answerStep },
      foldable: true,
      hasContent: true,
      open: true,
      setOpen,
    },
  }
}

/** 一个带 `actions.setTurnProcessOpen` 的祖先 props。 */
export function actionsProps(record) {
  return { actions: { setTurnProcessOpen: record } }
}

/** 记录 MutationObserver 的假实现。 */
export class FakeObserver {
  static instances = []

  constructor(callback) {
    this.callback = callback
    this.observed = []
    this.disconnected = false
    FakeObserver.instances.push(this)
  }

  observe(target, options) {
    this.observed.push({ target, options })
  }

  disconnect() {
    this.disconnected = true
  }

  emit() {
    this.callback([])
  }

  static last() {
    return FakeObserver.instances[FakeObserver.instances.length - 1]
  }

  static reset() {
    FakeObserver.instances = []
  }
}

/** 假 document：根树、样式表容器、捕获监听与可选的 observer 实现。 */
export class FakeDocument {
  constructor({ root = new FakeElement('html'), withObserver = false } = {}) {
    this.documentElement = root
    this.head = {
      nodes: [],
      append: (node) => {
        this.head.nodes.push(node)
        node.parent = this.head
      },
    }
    this.listeners = []
    this.defaultView = withObserver ? { MutationObserver: FakeObserver } : {}
  }

  createElement(tag) {
    return new FakeElement(tag)
  }

  querySelectorAll(selector) {
    return this.documentElement.querySelectorAll(selector)
  }

  querySelector(selector) {
    return this.documentElement.querySelector(selector)
  }

  addEventListener(type, listener, capture) {
    this.listeners.push({ type, listener, capture })
  }

  removeEventListener(type, listener, capture) {
    this.listeners = this.listeners.filter((item) => item.type !== type || item.listener !== listener || item.capture !== capture)
  }

  /** 只派发给捕获阶段监听。 */
  dispatch(type, event) {
    for (const item of this.listeners) {
      if (item.type === type && item.capture === true) item.listener(event)
    }
  }
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
    ;(0, eval)(readFileSync(join(pluginRoot, 'lib', 'client.js'), 'utf8'))
  } finally {
    if (previous === undefined) delete globalThis.window
    else globalThis.window = previous
  }
  return registration
}
