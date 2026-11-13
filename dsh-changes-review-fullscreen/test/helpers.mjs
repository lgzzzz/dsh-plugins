/**
 * dsh-changes-review-fullscreen 行为测试的共享装置：断言与失败计数、假元素 / 假文档 / 假右栏面、
 * 可控调度器，以及产物加载器。
 *
 * 跑全部请用 `node test/run-all.mjs`（或 pnpm test）。
 * 依赖 Node 22+ 的 Type Stripping 直接 import .ts。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  CARD_SELECTOR,
  FULLSCREEN_PANEL_SELECTOR,
  MARKER_ATTRIBUTE,
  PUSH_PANEL_SELECTOR,
  REVIEW_KIND,
} from '../src/fullscreen.ts'

/** 本插件的包根目录（测试文件在 test/ 下，所以是上一级）。 */
export const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

export { CARD_SELECTOR, FULLSCREEN_PANEL_SELECTOR, MARKER_ATTRIBUTE, PUSH_PANEL_SELECTOR, REVIEW_KIND }

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

  closest(selector) {
    for (let node = this; node !== null; node = node.parent) {
      if (matchesSelector(node, selector)) return node
    }
    return null
  }
}

/** 选择器只覆盖本插件用到的三种：`button` / `[attr]` / `[attr="value"]`。 */
function matchesSelector(node, selector) {
  const valued = selector.match(/^\[([a-zA-Z-]+)="([^"]*)"\]$/)
  if (valued !== null) return node.getAttribute(valued[1]) === valued[2]
  const present = selector.match(/^\[([a-zA-Z-]+)\]$/)
  if (present !== null) return node.hasAttribute(present[1])
  return node.tag === selector
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

/** 记录捕获监听与面板呈现方式的假文档。`hiddenMode` 模拟另一个保留在 DOM 里的会话视图。 */
export class FakeDocument {
  constructor({ mode = 'push', hiddenMode = 'none' } = {}) {
    this.mode = mode
    this.hiddenMode = hiddenMode
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

  querySelector(selector) {
    const wanted = selector.includes('"fullscreen"') ? 'fullscreen'
      : selector.includes('"push"') ? 'push'
        : null
    if (wanted === null) return null
    // 带 `:not([hidden])` 的是当前会话视图，只回答本视图的呈现方式。
    if (selector.includes(':not([hidden])')) return this.mode === wanted ? { tag: 'panel' } : null
    if (this.mode === wanted) return { tag: 'panel' }
    return this.hiddenMode === wanted ? { tag: 'hidden-panel' } : null
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

/** 假 click 事件：`composedPath` 返回点击目标本身。 */
export function clickEvent(target) {
  return {
    target,
    composedPath() {
      return [target]
    },
  }
}

/** 假右栏面：记录 `toggleFullscreen` 调用与 `commandTarget` 的入参。 */
export function fakeSidebar({
  activeKind = REVIEW_KIND,
  expanded = true,
  target = { host: 'dock' },
  current = true,
} = {}) {
  const sidebar = {
    calls: [],
    commandTargets: [],
    active: () => (activeKind === null ? undefined : { kind: activeKind }),
    commandTarget: (element) => {
      sidebar.commandTargets.push(element)
      return target
    },
    isExpanded: () => expanded,
    isTargetCurrent: () => current,
    toggleFullscreen: (value) => sidebar.calls.push(['fullscreen', value]),
  }
  return sidebar
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
