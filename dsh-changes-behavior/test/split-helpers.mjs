/**
 * dsh-changes-behavior 行为测试的共享装置：断言与失败计数、假元素 / 假文档 / 假观察器、
 * 可控调度器与告警收集器，以及产物加载器。
 *
 * 跑全部请用 `node test/run-all.mjs`（或 pnpm test）。
 * 依赖 Node 22+ 的 Type Stripping 直接 import .ts。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { REVIEW_SELECTOR } from '../src/split-default.ts'

/** 本插件的包根目录（测试文件在 test/ 下，所以是上一级）。 */
export const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

export { REVIEW_SELECTOR }

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

/** 属性、结构、fiber 与连接态都可查询的假元素。 */
export class FakeElement {
  constructor(tag = 'div', attributes = {}, options = {}) {
    this.tag = tag
    this.attributes = new Map(Object.entries(attributes))
    this.parent = null
    this.children = []
    this.queryMap = options.queryMap ?? new Map()
    this.closestMap = options.closestMap ?? new Map()
    this.isConnected = options.isConnected ?? true
    this.disabled = options.disabled ?? false
    if (typeof options.handler === 'function') {
      this['__reactFiber$fake'] = { memoizedProps: { onClick: options.handler } }
    }
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

  matches(selector) {
    return matchesSelector(this, selector)
  }

  closest(selector) {
    if (this.closestMap.has(selector)) return this.closestMap.get(selector)
    for (let node = this; node !== null; node = node.parent) {
      if (matchesSelector(node, selector)) return node
    }
    return null
  }

  querySelector(selector) {
    if (this.queryMap.has(selector)) return this.queryMap.get(selector)
    return this.querySelectorAll(selector)[0] ?? null
  }

  querySelectorAll(selector) {
    const out = []
    const walk = (node) => {
      for (const child of node.children) {
        if (matchesSelector(child, selector)) out.push(child)
        walk(child)
      }
    }
    walk(this)
    return out
  }
}

/** 选择器只覆盖本插件用到的三种：`tag` / `[attr]` / `[attr="value"]`。 */
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

/** 记录 observe / disconnect 与回调的假 MutationObserver。 */
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

  /** 把一批变更记录交给回调。 */
  emit(records) {
    this.callback(records)
  }

  static last() {
    return FakeObserver.instances[FakeObserver.instances.length - 1]
  }

  static reset() {
    FakeObserver.instances = []
  }
}

/** 假文档：body / documentElement / 初始审查根 / window.MutationObserver。 */
export class FakeDocument {
  constructor(options = {}) {
    this.body = options.withBody === false ? undefined : new FakeElement()
    this.documentElement = new FakeRootElement()
    this.defaultView = options.withObserver === false ? {} : { MutationObserver: FakeObserver }
    this.initialRoots = options.roots ?? []
  }

  querySelectorAll(selector) {
    return selector === REVIEW_SELECTOR ? this.initialRoots : []
  }
}

/** 可控调度器：把回调排队，由测试决定何时、执行几次。 */
export function makeScheduler() {
  const queue = []
  return {
    schedule(callback) {
      queue.push(callback)
    },
    /** 依次执行排队的回调；返回执行次数。 */
    drain(limit = 64) {
      let ran = 0
      while (queue.length > 0 && ran < limit) {
        ran += 1
        queue.shift()()
      }
      return ran
    },
    get size() {
      return queue.length
    },
  }
}

/** 收集告警文本。 */
export function makeWarningSink() {
  const messages = []
  return {
    warn(message) {
      messages.push(message)
    },
    get messages() {
      return messages
    },
    get size() {
      return messages.length
    },
  }
}

/**
 * 搭一个审查标签页：面板根 + 审查根 + 工具栏分栏按钮 + 正文 + 侧栏身份祖先。
 *
 * @param {object} options
 * @param {'push'|'fullscreen'} [options.mode] 面板呈现方式。
 * @param {boolean} [options.pressed] 分栏按钮当前的 aria-pressed（true = 左右对比）。
 * @param {string|null} [options.occurrence] 占位实例 id；null 表示属性缺席。
 * @param {string|null} [options.tab] 标签页 id；null 表示属性缺席。
 * @param {string|null} [options.session] 会话 id；null 表示属性缺席。
 * @param {Function|null} [options.handler] 分栏按钮的 onClick；null 表示 fiber 上没有 handler。
 * @param {boolean} [options.button] false 表示根里没有分栏按钮。
 * @param {boolean} [options.connected] 根是否仍连接在文档上。
 */
export function makeReview(options = {}) {
  const calls = []
  const panel = new FakeElement('div', { 'data-sidebar-right-panel': options.mode ?? 'push' })

  const button = options.button === false
    ? null
    : new FakeElement('button', { 'aria-pressed': options.pressed === true ? 'true' : 'false' })

  // 默认 handler 模拟 React 的 toggle：翻转 aria-pressed，让连续调用与真实 store 一致。
  const handler = options.handler === undefined
    ? () => {
        const next = button.getAttribute('aria-pressed') !== 'true'
        button.setAttribute('aria-pressed', next ? 'true' : 'false')
        calls.push(next ? 'split' : 'unified')
      }
    : options.handler
  if (button !== null && handler !== null) {
    button['__reactFiber$fake'] = { memoizedProps: { onClick: handler } }
  }

  const body = new FakeElement('div', { 'data-review-view': options.pressed === true ? 'split' : 'unified' })
  const queryMap = new Map()
  if (button !== null) queryMap.set('[data-review-tool="split"]', button)
  queryMap.set('[data-review-view]', body)

  const closestMap = new Map()
  if (options.occurrence !== null) {
    closestMap.set('[data-sidebar-right-occurrence]', new FakeElement('span', {
      'data-sidebar-right-occurrence': options.occurrence ?? 'occ-1',
    }))
  }
  if (options.tab !== null) {
    closestMap.set('[data-sidebar-right-tab]', new FakeElement('div', {
      'data-sidebar-right-tab': options.tab ?? 'tab2',
    }))
  }
  if (options.session !== null) {
    closestMap.set('[data-sidebar-right-session]', new FakeElement('div', {
      'data-sidebar-right-session': options.session ?? 'session-1',
    }))
  }

  const root = new FakeElement('div', { 'data-changes-review': '' }, {
    queryMap,
    closestMap,
    isConnected: options.connected ?? true,
  })
  panel.append(root)

  return {
    panel,
    root,
    button,
    body,
    calls,
    setPressed(value) {
      button?.setAttribute('aria-pressed', value ? 'true' : 'false')
    },
    setMode(mode) {
      panel.setAttribute('data-sidebar-right-panel', mode)
    },
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
    // eslint-disable-next-line no-eval
    ;(0, eval)(readFileSync(join(pluginRoot, 'lib', 'client.js'), 'utf8'))
  } finally {
    if (previous === undefined) delete globalThis.window
    else globalThis.window = previous
  }
  return registration
}
