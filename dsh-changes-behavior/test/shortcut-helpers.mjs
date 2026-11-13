/**
 * 变更请求快捷键测试的共享装置：最小假 DOM / 假窗口、假快捷键服务、假右栏与假 Cordis 上下文。
 * 只保留 changes-open 桥用到的部分，不依赖 dsh-keyboard-shortcuts 的测试装置。
 */
import { normalizeBinding } from '@deepseek-ai/dsh-client-shortcuts/protocol'
import { installChangesOpenBridge } from '../src/changes-open.ts'

let failures = 0

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

export function finish() {
  console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`)
  process.exitCode = failures === 0 ? 0 : 1
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

export function gesture(code, overrides = {}) {
  return {
    code,
    secondCode: undefined,
    control: false,
    alt: false,
    shift: false,
    meta: false,
    repeat: false,
    composing: false,
    defaultPrevented: false,
    ...overrides,
  }
}

export function shortcutContext(overrides = {}) {
  return { modal: null, region: 'page', target: null, ...overrides }
}

/** 一个 keydown 固定输入 + 它的消费计数。 */
export function keydown(gestureValue, contextValue) {
  const consumed = { count: 0 }
  return {
    consumed,
    input: {
      type: 'keydown',
      gesture: gestureValue,
      context: contextValue,
      consume: () => { consumed.count += 1 },
    },
  }
}

function matchesSelector(node, selector) {
  if (selector.startsWith('.')) {
    const className = node.getAttribute?.('class') ?? ''
    return className.split(/\s+/).includes(selector.slice(1))
  }
  const groups = [...selector.matchAll(/\[([a-zA-Z-]+)(?:="([^"]*)")?\]/g)]
  if (groups.length > 0) {
    if (groups.map((group) => group[0]).join('') !== selector.replace(/\s/g, '')) return node.tag === selector
    return groups.every(([, name, value]) => (
      value === undefined ? node.hasAttribute?.(name) === true : node.getAttribute?.(name) === value
    ))
  }
  return node.tag === selector
}

export class FakeNode {
  constructor(tag = 'div', attrs = []) {
    this.tag = tag
    this.attrs = new Set(attrs)
    this.children = []
    this.parent = null
  }

  append(child) {
    child.parent = this
    this.children.push(child)
    return child
  }

  get parentElement() {
    return this.parent
  }

  hasAttribute(name) {
    return this.attrs.has(name)
  }

  closest(selector) {
    for (let node = this; node !== null; node = node.parent) {
      for (const part of selector.split(',')) {
        if (matchesSelector(node, part.trim())) return node
      }
    }
    return null
  }

  querySelectorAll(selector) {
    const found = []
    const parts = selector.split(',').map((part) => part.trim())
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
}

export class FakeElement extends FakeNode {
  constructor(tag = 'div', attributes = {}) {
    super(tag, Object.keys(attributes))
    this.values = new Map(Object.entries(attributes))
  }

  getAttribute(name) {
    return this.values.has(name) ? this.values.get(name) : null
  }

  setAttribute(name, value) {
    this.attrs.add(name)
    this.values.set(name, value)
  }

  removeAttribute(name) {
    this.attrs.delete(name)
    this.values.delete(name)
  }
}

/** 假 document：根级查询 + 当前焦点。 */
export function fakeDocument({ root, activeElement = null } = {}) {
  return {
    activeElement,
    querySelectorAll(selector) {
      return root === undefined ? [] : root.querySelectorAll(selector)
    },
    querySelector(selector) {
      return root === undefined ? null : root.querySelector(selector)
    },
  }
}

/** 假 window：登记捕获监听，`emit` 按类型派发。 */
export function fakeWindow() {
  const listeners = new Set()
  return {
    listeners,
    addEventListener(type, listener, options) {
      listeners.add({ type, listener, atCapture: options === true || options?.capture === true })
    },
    removeEventListener(type, listener) {
      for (const entry of [...listeners]) {
        if (entry.type === type && entry.listener === listener) listeners.delete(entry)
      }
    },
    emit(event, phase = 'capture') {
      for (const entry of [...listeners]) {
        if (entry.type === event.type && entry.atCapture === (phase === 'capture')) entry.listener(event)
      }
    },
  }
}

/** 置入假 document / 假 window，用完 `restore()` 还原。 */
export function withWindowDom({ root, activeElement = null } = {}) {
  const window = fakeWindow()
  const previousDocument = globalThis.document
  const previousWindow = globalThis.window
  globalThis.document = fakeDocument({ root, activeElement })
  globalThis.window = window
  return {
    window,
    restore() {
      if (previousDocument === undefined) delete globalThis.document
      else globalThis.document = previousDocument
      if (previousWindow === undefined) delete globalThis.window
      else globalThis.window = previousWindow
    },
  }
}

/** 假键盘事件。 */
export function fakeKeyEvent({
  path = [], type = 'keydown', code = '', key = code,
  ctrlKey = false, altKey = false, shiftKey = false, metaKey = false,
  repeat = false, isComposing = false,
} = {}) {
  const event = {
    type, code, key, ctrlKey, altKey, shiftKey, metaKey, repeat, isComposing,
    prevented: 0, stopped: 0,
    composedPath: () => path,
    preventDefault() { event.prevented += 1 },
    stopPropagation() { event.stopped += 1 },
  }
  return event
}

export function fakeShortcuts({ runtime = 'web', platform = 'windows', rows = [], fixedRows = [] } = {}) {
  const listeners = new Set()
  const fixed = fixedRows.map((row) => ({
    ...row,
    bindings: row.bindings.map((binding) => normalizeBinding(binding, platform)),
  }))
  const registrations = new Map()
  return {
    runtime,
    platform,
    catalog: { getSnapshot: () => rows },
    fixedCatalog: { getSnapshot: () => fixed },
    observeFixedInput(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    registerFixed(command) {
      if (registrations.has(command.id)) return () => {}
      const entry = {
        id: command.id,
        label: command.label(),
        keys: command.keys,
        group: command.group,
        bindings: command.bindings.map((binding) => normalizeBinding(binding, platform)),
      }
      registrations.set(command.id, entry)
      fixed.push(entry)
      return () => {
        if (registrations.get(command.id) !== entry) return
        registrations.delete(command.id)
        const index = fixed.indexOf(entry)
        if (index >= 0) fixed.splice(index, 1)
      }
    },
    emit(input) {
      for (const listener of [...listeners]) listener(input)
    },
    listenerCount: () => listeners.size,
  }
}

/** 打开变更请求要用的右栏假面。`sessionId: null` 表示没有屏幕会话。 */
export function fakeSidebar({
  sessionId = 's1', activeKind = 'forge-panel', expanded = true,
  target = { host: 'dock' }, current = true,
} = {}) {
  const sidebar = {
    mounted: { getSnapshot: () => (sessionId === null ? undefined : sessionId) },
    kinds: [],
    calls: [],
    targets: [],
    openTab(kind) {
      sidebar.kinds.push(kind)
    },
    active: () => (activeKind === null ? undefined : { kind: activeKind }),
    isExpanded: () => expanded,
    commandTarget: (element) => {
      sidebar.targets.push(element)
      return target
    },
    isTargetCurrent: () => current,
    toggleFullscreen: (value) => sidebar.calls.push(['fullscreen', value]),
  }
  return sidebar
}

/** 最小 Cordis 上下文：effect 立即执行并记录清理，inject 在依赖齐全时同步回调。 */
function fakeCtx({ shortcuts, sidebarRight }) {
  const services = { shortcuts, sidebarRight }
  const effects = []
  const reads = []
  const effect = (execute, label) => {
    const dispose = execute()
    effects.push({ label, dispose })
    return { dispose }
  }
  const ctx = {
    effects,
    reads,
    get(serviceName) {
      reads.push(serviceName)
      return services[serviceName]
    },
    effect,
    inject(deps, callback) {
      if (deps.some((serviceName) => services[serviceName] === undefined)) return undefined
      const scope = { get: ctx.get, effect, shortcuts, sidebarRight }
      callback(scope)
      return scope
    },
    disposeAll() {
      for (const entry of [...effects].reverse()) {
        if (typeof entry.dispose === 'function') entry.dispose()
      }
      effects.length = 0
    },
  }
  return ctx
}

/** 装配一次本桥，返回部件。 */
export function harness({ sessionId = 's1', platform = 'windows', ...sidebarOptions } = {}) {
  const shortcuts = fakeShortcuts({ platform })
  const sidebarRight = fakeSidebar({ sessionId, ...sidebarOptions })
  const ctx = fakeCtx({ shortcuts, sidebarRight })
  const warnings = captureWarnings(() => { installChangesOpenBridge(ctx) })
  return { ctx, shortcuts, sidebarRight, warnings }
}
