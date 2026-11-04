/**
 * dsh-changes-review-wrap 行为测试的共享装置：断言与失败计数、假元素 / 假文档 / 假观察器、
 * 调度器与产物加载器。
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

/** 假元素：属性、按选择器查询、closest、fiber 与连接态。 */
export class FakeElement {
  constructor(options = {}) {
    this.attributes = new Map(Object.entries(options.attributes ?? {}))
    this.queryMap = options.queryMap ?? new Map()
    this.queryAllMap = options.queryAllMap ?? new Map()
    this.closestMap = options.closestMap ?? new Map()
    this.matchSelectors = options.matchSelectors ?? []
    this.isConnected = options.isConnected ?? true
    if (options.disabled !== undefined) this.disabled = options.disabled
    if (typeof options.handler === 'function') {
      this['__reactFiber$fake'] = { memoizedProps: { onClick: options.handler } }
    }
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
    return this.closestMap.get(selector) ?? null
  }

  querySelector(selector) {
    return this.queryMap.get(selector) ?? null
  }

  querySelectorAll(selector) {
    return this.queryAllMap.get(selector) ?? []
  }

  matches(selector) {
    return this.matchSelectors.includes(selector)
  }
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
    return selector === '[data-changes-review]' ? this.initialRoots : []
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
    drain(limit = 32) {
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
 * 搭一个审查标签页：根元素 + 工具栏换行按钮 + diff 正文 + 侧栏身份祖先。
 *
 * @param {object} options
 * @param {string|null} [options.occurrence] 占位实例 id；null 表示属性缺席。
 * @param {string|null} [options.tab] 标签页 id；null 表示属性缺席。
 * @param {string|null} [options.session] 会话 id；null 表示属性缺席。
 * @param {boolean} [options.wrap] 正文是否已是换行态。
 * @param {Function|null} [options.handler] 换行按钮的 onClick；null 表示 fiber 上没有 handler。
 * @param {boolean} [options.button] false 表示根里没有换行按钮。
 * @param {boolean} [options.connected] 根是否仍连接在文档上。
 */
export function makeReview(options = {}) {
  const calls = []
  const handler = options.handler === undefined
    ? () => {
        calls.push('wrap')
      }
    : options.handler

  const body = new FakeElement({
    attributes: options.wrap === true ? { 'data-review-wrap': 'true' } : {},
    matchSelectors: ['[data-review-view]'],
  })
  const button = options.button === false
    ? null
    : new FakeElement({
        attributes: { 'aria-pressed': options.wrap === true ? 'true' : 'false' },
        disabled: options.disabled,
        handler: handler === null ? undefined : handler,
      })

  const queryMap = new Map()
  if (button !== null) queryMap.set('[data-review-tool="wrap"]', button)
  queryMap.set('[data-review-view]', body)

  const closestMap = new Map()
  if (options.occurrence !== null) {
    closestMap.set('[data-sidebar-right-occurrence]', new FakeElement({
      attributes: { 'data-sidebar-right-occurrence': options.occurrence ?? 'occ-1' },
    }))
  }
  if (options.tab !== null) {
    closestMap.set('[data-sidebar-right-tab]', new FakeElement({
      attributes: { 'data-sidebar-right-tab': options.tab ?? 'tab2' },
    }))
  }
  if (options.session !== null) {
    closestMap.set('[data-sidebar-right-session]', new FakeElement({
      attributes: { 'data-sidebar-right-session': options.session ?? 'session-1' },
    }))
  }

  const root = new FakeElement({
    queryMap,
    closestMap,
    matchSelectors: ['[data-changes-review]'],
    isConnected: options.connected ?? true,
  })

  return { root, button, body, calls }
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
