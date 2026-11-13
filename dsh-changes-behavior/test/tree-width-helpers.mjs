/**
 * dsh-changes-behavior 文件树宽度记忆的测试装置：假元素 / 假文档 / 假观察器 / 假存储、
 * 带 React fiber 宽度 state 的假文件树，以及调度器与告警收集。
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

/** 支持标签名 / 若干属性片段的选择器匹配（如 `[role="separator"][aria-controls]`）。 */
export function matchesSelector(node, selector) {
  const tokens = selector.match(/\[[^\]]+\]|[a-zA-Z][\w-]*/g) ?? []
  return tokens.every((token) => {
    if (!token.startsWith('[')) return node.tag === token
    const valued = token.match(/^\[([\w-]+)="([^"]*)"\]$/)
    if (valued !== null) return node.getAttribute(valued[1]) === valued[2]
    const present = token.match(/^\[([\w-]+)\]$/)
    return present !== null && node.hasAttribute(present[1])
  })
}

/** 属性、父子关系与查询都支持的假元素。 */
export class FakeElement {
  constructor(tag = 'div', attributes = {}) {
    this.tag = tag
    this.attributes = new Map(Object.entries(attributes))
    this.parent = null
    this.children = []
    this.isConnected = true
  }

  append(child) {
    child.parent = this
    this.children.push(child)
    return child
  }

  get parentElement() {
    return this.parent
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

  matches(selector) {
    return matchesSelector(this, selector)
  }

  querySelector(selector) {
    for (const child of this.children) {
      if (matchesSelector(child, selector)) return child
      const nested = child.querySelector(selector)
      if (nested !== null) return nested
    }
    return null
  }

  querySelectorAll(selector) {
    const found = []
    const visit = (node) => {
      if (matchesSelector(node, selector)) found.push(node)
      for (const child of node.children ?? []) visit(child)
    }
    for (const child of this.children) visit(child)
    return found
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

/** 假存储：记录读写，可配置抛错。 */
export class FakeStorage {
  constructor(options = {}) {
    this.values = new Map(Object.entries(options.values ?? {}))
    this.failGet = options.failGet === true
    this.failSet = options.failSet === true
    this.sets = []
  }

  getItem(key) {
    if (this.failGet) throw new Error('storage disabled')
    return this.values.has(key) ? this.values.get(key) : null
  }

  setItem(key, value) {
    if (this.failSet) throw new Error('quota exceeded')
    this.values.set(key, value)
    this.sets.push([key, value])
  }
}

/** 假文档：body / documentElement / window（MutationObserver + localStorage）/ 监听登记。 */
export class FakeDocument {
  constructor(options = {}) {
    this.body = new FakeElement('body')
    this.documentElement = new FakeRootElement()
    this.defaultView = options.withObserver === false
      ? { localStorage: options.storage ?? new FakeStorage() }
      : { MutationObserver: FakeObserver, ...(options.storage === undefined ? {} : { localStorage: options.storage }) }
    this.listeners = new Map()
    this.mounted = []
    this.initialRoots = options.roots ?? []
  }

  /** 把一棵假 DOM 树挂到文档上。 */
  mount(...nodes) {
    for (const node of nodes) {
      this.body.append(node)
      this.mounted.push(node)
    }
    return nodes[0]
  }

  querySelectorAll(selector) {
    const all = [...this.initialRoots]
    for (const root of this.mounted) {
      all.push(root)
      for (const nested of root.querySelectorAll(selector)) all.push(nested)
    }
    return all.filter((node) => matchesSelector(node, selector))
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

  /** 派发给全部监听器：捕获阶段先执行，冒泡阶段后执行。 */
  dispatch(type, event) {
    const list = this.listeners.get(type) ?? []
    for (const item of list) if (item.capture === true) item.listener(event)
    for (const item of list) if (item.capture !== true) item.listener(event)
  }

  /** 当前有监听的类型。 */
  get types() {
    return [...this.listeners.keys()]
  }
}

/** 可控调度器：把回调排队，由测试决定何时执行。 */
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

/** 拼一条 React hook 链。 */
function hookChain(hooks) {
  for (let index = 0; index < hooks.length - 1; index += 1) hooks[index].next = hooks[index + 1]
  return hooks[0]
}

/**
 * 搭一棵假文件树，并（默认）挂上与真实 React fiber 形状一致的宽度 state：
 * 分隔条宿主 fiber（tag 5）→ pane 宿主 fiber（tag 5）→ FileTreePane 函数 fiber（tag 0），
 * hook 顺序是 `useRef` × 2、宽度 `useState`、`maximum useState`、两个 `useLayoutEffect`。
 *
 * @param {object} options
 * @param {number} [options.width] 分隔条 `aria-valuenow` 的初始值。
 * @param {number} [options.state] 宽度 state 的初始值。
 * @param {number} [options.maximum] 可用最大宽度的 state。
 * @param {boolean} [options.fiber] false 表示分隔条没有 React fiber。
 * @param {boolean} [options.dispatchThrows] 宽度 setter 抛错。
 * @param {boolean} [options.connected] pane 是否仍连接。
 * @param {string} [options.kind] 根元素的 `data-forge-changes` 值。
 */
export function makeTree(options = {}) {
  const calls = []
  const root = new FakeElement('div', { 'data-forge-changes': options.kind ?? 'local' })
  const pane = new FakeElement('div', { 'data-position': 'left' })
  pane.isConnected = options.connected ?? true
  const separator = pane.append(new FakeElement('div', {
    role: 'separator',
    'aria-controls': options.id ?? 'tree-1',
    'aria-valuenow': String(options.width ?? 240),
  }))
  if (options.withPane !== false) root.append(pane)
  if (options.controls === false) separator.removeAttribute('aria-controls')
  if (options.valuenow === false) separator.removeAttribute('aria-valuenow')

  const widthHook = {
    memoizedState: options.state ?? 240,
    queue: {
      dispatch(value) {
        calls.push(value)
        if (options.dispatchThrows === true) throw new Error('setState failed')
        separator.setAttribute('aria-valuenow', String(Math.min(value, options.maximum ?? 600)))
      },
    },
  }
  const maximumHook = { memoizedState: options.maximum ?? 600, queue: { dispatch() {} } }
  const ref1 = { memoizedState: { current: null } }
  const ref2 = { memoizedState: { current: null } }
  const effect1 = { memoizedState: { tag: 5 } }
  const effect2 = { memoizedState: { tag: 5 } }
  const componentFiber = {
    tag: 0,
    memoizedState: hookChain([ref1, ref2, widthHook, maximumHook, effect1, effect2]),
    memoizedProps: {
      position: options.position ?? 'left',
      id: options.id ?? 'tree-1',
      onWidth: 'onWidth' in options ? options.onWidth : () => {},
    },
  }
  const paneFiber = { tag: 5, memoizedState: {}, return: componentFiber }
  const hostFiber = { tag: 5, memoizedState: {}, return: paneFiber }

  /** 把宽度 setter 所用 fiber 挂到分隔条上；[options.fiber] 为 false 时测试可稍后调用。 */
  function attachFiber() {
    separator['__reactFiber$fake'] = hostFiber
  }
  if (options.fiber !== false) attachFiber()

  return { root, pane, separator, calls, attachFiber }
}

/** 假指针事件。 */
export function pointerEvent(target, extra = {}) {
  return {
    target,
    composedPath() {
      return [target]
    },
    ...extra,
  }
}

/** 假键盘事件。 */
export function keyEvent(target, key) {
  return {
    target,
    key,
    composedPath() {
      return [target]
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
