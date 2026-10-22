/**
 * 折叠桥的测试装置：固定行 / 固定输入 / 捕获阶段按键 / 假 window 与假 Cordis 上下文。
 *
 * 只复刻本插件用到的能力：元素与文档树、平台化的固定行目录、一次性 keydown 投递、
 * 窗口捕获监听与 scope 生命周期。断言与基础假元素来自 `helpers.mjs`。
 */
import { normalizeBinding } from '@deepseek-ai/dsh-client-shortcuts/protocol'
import {
  captureWarnings,
  check,
  checkTrue,
  FakeElement,
  finish,
} from './helpers.mjs'

export { captureWarnings, check, checkTrue, FakeElement, finish }

/** 一次按键的物理事实。 */
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

/** 固定通道给出的归属上下文。 */
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
      consume: () => {
        consumed.count += 1
      },
    },
  }
}

/**
 * 假 window：登记捕获 / 冒泡阶段的任意事件监听，`emit` 按事件类型和 phase 调用对应那批。
 */
export function fakeWindow() {
  const listeners = new Set()
  const capture = (options) => options === true || (typeof options === 'object' && options !== null && options.capture === true)
  return {
    listeners,
    addEventListener(type, listener, options) {
      listeners.add({ type, listener, atCapture: capture(options) })
    },
    removeEventListener(type, listener) {
      for (const entry of [...listeners]) {
        if (entry.type === type && entry.listener === listener) listeners.delete(entry)
      }
    },
    emit(event, phase = 'capture') {
      this.emitType(event?.type ?? 'keydown', event, phase)
    },
    emitType(type, event = {}, phase = 'capture') {
      for (const entry of [...listeners]) {
        if (entry.type === type && entry.atCapture === (phase === 'capture')) entry.listener(event)
      }
    },
  }
}

/** 假 document：根树、当前焦点与选择查询。 */
export function fakeDocument({ root, activeElement = null } = {}) {
  return {
    activeElement,
    querySelectorAll(selector) {
      return root === undefined ? [] : root.querySelectorAll(selector)
    },
    querySelector(selector) {
      const found = root === undefined ? [] : root.querySelectorAll(selector)
      return found[0] ?? null
    },
  }
}

/** 置入假 document / 假 window（捕获监听就装在上面），用完 `restore()` 还原。 */
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

/** 假键盘事件：记录 preventDefault / stopPropagation 的调用次数。 */
export function fakeKeyEvent({
  path = [],
  type = 'keydown',
  code = '',
  key = code,
  ctrlKey = false,
  altKey = false,
  shiftKey = false,
  metaKey = false,
  repeat = false,
  isComposing = false,
} = {}) {
  const event = {
    type,
    code,
    key,
    ctrlKey,
    altKey,
    shiftKey,
    metaKey,
    repeat,
    isComposing,
    prevented: 0,
    stopped: 0,
    composedPath: () => path,
    preventDefault() {
      event.prevented += 1
    },
    stopPropagation() {
      event.stopped += 1
    },
  }
  return event
}

/** 假快捷键服务：固定行目录、固定输入观察者与固定行注册（按平台规范化绑定）。 */
export function fakeShortcuts({ platform = 'windows' } = {}) {
  const listeners = new Set()
  const fixed = []
  const registrations = new Map()
  return {
    platform,
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

/** 复刻 Cordis 的 effect / 等待式 inject；注入回调里的 effect 也登记到同一张表。 */
export class FakeCtx {
  constructor(services) {
    this.services = services
    this.effects = []
    this.pending = []
  }
  effect(execute, label) {
    const dispose = execute()
    this.effects.push({ label, dispose })
    return { dispose }
  }
  inject(deps, callback) {
    if (deps.some((name) => this.services[name] === undefined)) {
      this.pending.push({ deps, callback })
      return undefined
    }
    const scope = {
      get: (name) => this.services[name],
      effect: (execute, label) => {
        const dispose = execute()
        this.effects.push({ label, dispose })
        return { dispose }
      },
    }
    for (const [key, value] of Object.entries(this.services)) scope[key] = value
    callback(scope)
    return scope
  }
}
