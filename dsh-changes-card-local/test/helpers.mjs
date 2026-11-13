/**
 * dsh-changes-card-local 行为测试的共享装置：断言与失败计数、假元素 / 假文档 / 假事件、
 * 假右栏 / 假标签注册表 / 假上下文菜单 / 假 locale，以及产物加载器。
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

/** 打印本文件的结论并设置退出码。每个测试文件末尾调用一次。 */
export function finish() {
  console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`)
  process.exitCode = failures === 0 ? 0 : 1
}

/** 属性与结构都可查询的假元素。 */
export class FakeElement {
  constructor(tag = 'div', attributes = {}) {
    this.tag = tag
    this.attributes = new Map(Object.entries(attributes))
    this.parent = null
    this.children = []
    this.disabled = false
  }

  append(child) {
    child.parent = this
    this.children.push(child)
    return child
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null
  }

  setAttribute(name, value) {
    this.attributes.set(name, value)
  }

  removeAttribute(name) {
    this.attributes.delete(name)
  }

  hasAttribute(name) {
    return this.attributes.has(name)
  }

  getBoundingClientRect() {
    return { left: 24, bottom: 120, top: 100, right: 240 }
  }

  closest(selector) {
    for (let node = this; node !== null; node = node.parent) {
      if (matchesSelector(node, selector)) return node
    }
    return null
  }
}

/** 选择器只覆盖本插件用到的三种：`button` / `li` / `[attr]` / `[attr="value"]`。 */
function matchesSelector(node, selector) {
  const valued = selector.match(/^\[([a-zA-Z-]+)="([^"]*)"\]$/)
  if (valued !== null) return node.getAttribute(valued[1]) === valued[2]
  const present = selector.match(/^\[([a-zA-Z-]+)\]$/)
  if (present !== null) return node.hasAttribute(present[1])
  return node.tag === selector
}

/** 把一份 React `onClick` 挂到元素上，模拟 fiber 上的 `memoizedProps`。 */
export function attachClickHandler(element, handler) {
  element['__reactFiber$test'] = { memoizedProps: { onClick: handler } }
  return element
}

/** 文档根元素的假替身：记录 data-* 标记。 */
export class FakeRootElement {
  constructor() {
    this.attributes = new Map()
  }

  setAttribute(name, value) {
    this.attributes.set(name, value)
  }

  removeAttribute(name) {
    this.attributes.delete(name)
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null
  }

  hasAttribute(name) {
    return this.attributes.has(name)
  }
}

/** 记录捕获监听的假文档。 */
export class FakeDocument {
  constructor() {
    this.listeners = new Map()
    this.documentElement = new FakeRootElement()
  }

  addEventListener(type, listener, capture) {
    const list = this.listeners.get(type) ?? []
    list.push({ listener, capture })
    this.listeners.set(type, list)
  }

  removeEventListener(type, listener, capture) {
    const list = (this.listeners.get(type) ?? []).filter(
      (item) => item.listener !== listener || item.capture !== capture,
    )
    if (list.length === 0) this.listeners.delete(type)
    else this.listeners.set(type, list)
  }

  /** 只派发给捕获阶段监听器（本插件只挂捕获阶段）。 */
  dispatch(type, event) {
    for (const item of this.listeners.get(type) ?? []) {
      if (item.capture === true) item.listener(event)
    }
  }

  /** 当前有监听的类型。 */
  get types() {
    return [...this.listeners.keys()]
  }
}

/** 假事件：记录 preventDefault / stopPropagation 的调用。 */
export function pointerEvent(target, extra = {}) {
  const event = {
    target,
    defaultPrevented: false,
    prevented: 0,
    stopped: 0,
    composedPath() {
      return [target]
    },
    preventDefault() {
      event.prevented += 1
      event.defaultPrevented = true
    },
    stopPropagation() {
      event.stopped += 1
    },
    ...extra,
  }
  return event
}

/** 假右栏面：记录 `openResource` 的地址。 */
export function fakeSidebar({ sessionId = 'session-1', signedOut = false, fail = false } = {}) {
  const sidebar = {
    opened: [],
    mounted: { getSnapshot: () => (signedOut ? undefined : sessionId) },
    openResource(address) {
      if (fail) throw new Error('sidebar unloaded')
      sidebar.opened.push(address)
    },
  }
  return sidebar
}

/** 假标签注册表：`claimable=false` 时模拟「本地变更」类型没注册。 */
export function fakeTabs({ claimable = true } = {}) {
  const tabs = {
    claimed: [],
    claim(address) {
      if (!claimable) throw new Error(`no type claims ${address}`)
      tabs.claimed.push(address)
      return { contentId: address }
    },
  }
  return tabs
}

/** 假上下文菜单：记录注册与打开，并暴露最近一次解析出的动作。 */
export function fakeMenus() {
  const menus = {
    registered: [],
    opened: [],
    disposed: false,
    register(contribution) {
      menus.registered.push(contribution)
      return () => { menus.disposed = true }
    },
    open(target, point) {
      menus.opened.push({ target, point })
    },
  }
  return menus
}

/** 假 locale：`bind` 返回按命名空间注册的中文字典。 */
export function fakeLocale(dictionaries = {}) {
  const locale = {
    registered: [],
    register(namespace, entries) {
      locale.registered.push({ namespace, entries })
      dictionaries[namespace] = entries
      return () => {}
    },
    bind(namespace) {
      const entries = dictionaries[namespace]?.zh ?? {}
      return (key) => entries[key] ?? key
    },
  }
  return locale
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
