/**
 * dsh-keyboard-shortcuts 的测试装置：断言、假官方快捷键服务与假 window。
 *
 * 假服务提供 `registerFixed()` / `observeFixedInput()` 与内部 `registry.invoke()`；
 * 测试验证插件只注册固定行、只调官方命令 id，不执行任何业务动作。
 */

let failures = 0

/** 递归排序对象键，避免对象字面量的键顺序影响比较。 */
function stable(value) {
  if (Array.isArray(value)) return value.map(stable)
  if (value !== null && typeof value === 'object') {
    const out = {}
    for (const key of Object.keys(value).sort()) out[key] = stable(value[key])
    return out
  }
  return value
}

/** 结构相等断言（对象键无序的 JSON 比较）。 */
export function check(label, actual, expected) {
  const a = JSON.stringify(stable(actual))
  const e = JSON.stringify(stable(expected))
  const ok = a === e
  if (!ok) failures += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : ` — 期望 ${e}，实得 ${a}`}`)
}

/** 严格 true 断言。 */
export function checkTrue(label, actual) {
  const ok = actual === true
  if (!ok) failures += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : ` — 期望 true，实得 ${JSON.stringify(actual)}`}`)
}

/** 严格 false 断言。 */
export function checkFalse(label, actual) {
  const ok = actual === false
  if (!ok) failures += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : ` — 期望 false，实得 ${JSON.stringify(actual)}`}`)
}

/** 严格 undefined 断言。 */
export function checkUndefined(label, actual) {
  const ok = actual === undefined
  if (!ok) failures += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : ` — 期望 undefined，实得 ${JSON.stringify(actual)}`}`)
}

/** 收集 console.warn 输出。 */
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

/** 让终端捕获等同步桥接跑完。 */
export async function settle() {
  for (let index = 0; index < 5; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

/** 一个最小的 ObservableSnapshot。 */
export function observable(initial) {
  let value = initial
  const listeners = new Set()
  return {
    getSnapshot: () => value,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    set(next) {
      value = next
      for (const listener of [...listeners]) listener()
    },
  }
}

/** 官方命令的本地化标签（目录行只用于固定行名称）。 */
export const OFFICIAL_LABELS = {
  'session.new': '新会话',
  'sidebar.left.toggle': '展开／收起左侧栏',
  'workspace.openLocal': '在本地打开',
  'sidebar.right.toggle': '展开／收起右侧栏',
  'workspace.files': '工作区文件',
  'terminal.new': '新建终端',
  'pane.fullscreen.toggle': '面板全屏／退出全屏',
  'page.close': '关闭当前页面／窗口',
}

/** 官方目录行（只含本插件读取的字段）。 */
export function officialRows() {
  return Object.entries(OFFICIAL_LABELS).map(([id, label]) => ({ id, label }))
}

/** 一次手势；默认没有修饰键。 */
export function gesture(code, overrides = {}) {
  return {
    code,
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

/** 固定输入读数。 */
export function fixedKeydown(code, overrides = {}) {
  const { context, ...gestureOverrides } = overrides
  return {
    type: 'keydown',
    gesture: gesture(code, gestureOverrides),
    context: { region: 'page', modal: null, target: null, ...context },
    consumed: false,
    consume() {
      this.consumed = true
    },
  }
}

/** 假官方快捷键服务。 */
export function fakeShortcuts({
  platform = 'linux',
  runtime = 'web',
  rows = officialRows(),
  withRegistry = true,
} = {}) {
  const commands = []
  const invocations = []
  let listener
  const catalog = observable(rows)
  const service = {
    platform,
    runtime,
    catalog,
    commands,
    invocations,
    registry: withRegistry
      ? {
          invoke(id, context) {
            invocations.push({ id, context })
          },
        }
      : undefined,
    registerFixed(command) {
      commands.push(command)
      return () => {
        const index = commands.indexOf(command)
        if (index >= 0) commands.splice(index, 1)
      }
    },
    observeFixedInput(callback) {
      listener = callback
      return () => {
        if (listener === callback) listener = undefined
      }
    },
    fire(input) {
      if (listener !== undefined) listener(input)
    },
    hasObserver() {
      return listener !== undefined
    },
    setRows(next) {
      catalog.set(next)
    },
  }
  return service
}

/** 假 Cordis 上下文：effect 立即执行并记录清理函数，inject 按服务可用性同步回调。 */
export function fakeCtx({ shortcuts, sidebarRight }) {
  const cleanups = []
  const context = {
    shortcuts,
    sidebarRight,
    cleanups,
    effect(callback) {
      const dispose = callback()
      if (typeof dispose === 'function') cleanups.push(dispose)
      return dispose
    },
    inject(deps, callback) {
      const available = deps.every((dep) => dep === 'shortcuts' || (dep === 'sidebarRight' && sidebarRight !== undefined))
      if (!available) return
      callback({ shortcuts, sidebarRight, effect: context.effect })
    },
    disposeAll() {
      for (const dispose of cleanups.reverse()) dispose()
      cleanups.length = 0
    },
  }
  return context
}

/** 假右侧栏服务：只实现面板全屏桥读取的方法。 */
export function fakeSidebar(overrides = {}) {
  const target = {
    sessionId: 'session',
    paneId: 'pane',
    host: 'dock',
    tabId: 'tab',
    occurrence: {},
    navigationRevision: 0,
  }
  const state = {
    expanded: true,
    focused: undefined,
    target,
    current: true,
    ...overrides,
  }
  const calls = { focused: [], command: [], current: [], toggle: [] }
  return {
    state,
    calls,
    isExpanded: () => state.expanded,
    focusedTarget(element) {
      calls.focused.push(element)
      return state.focused
    },
    commandTarget(element) {
      calls.command.push(element)
      return state.target
    },
    isTargetCurrent(candidate) {
      calls.current.push(candidate)
      return state.current
    },
    toggleFullscreen(candidate) {
      calls.toggle.push(candidate)
    },
  }
}

/** 假 window：记录监听器。 */
export function fakeWindow() {
  const listeners = new Map()
  const fake = {
    addEventListener(type, listener, capture) {
      const key = `${type}:${capture === true ? 'capture' : 'bubble'}`
      const list = listeners.get(key) ?? []
      list.push(listener)
      listeners.set(key, list)
    },
    removeEventListener(type, listener, capture) {
      const key = `${type}:${capture === true ? 'capture' : 'bubble'}`
      const list = listeners.get(key) ?? []
      const index = list.indexOf(listener)
      if (index >= 0) list.splice(index, 1)
    },
    dispatch(type, event, capture = true) {
      const key = `${type}:${capture === true ? 'capture' : 'bubble'}`
      for (const listener of [...(listeners.get(key) ?? [])]) listener(event)
    },
    listenerCount() {
      let count = 0
      for (const list of listeners.values()) count += list.length
      return count
    },
  }
  return fake
}

/** 终端内键盘事件；composedPath() 的第一个元素 closest('.xterm') 命中。 */
export function terminalKeydown(code, overrides = {}) {
  const element = {
    closest(selector) {
      return selector === '.xterm' ? {} : null
    },
  }
  const event = {
    type: 'keydown',
    code,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    repeat: false,
    isComposing: false,
    defaultPrevented: false,
    preventDefault() {
      event.defaultPrevented = true
    },
    stopPropagation() {
      event.stopped = true
    },
    composedPath() {
      return [element, {}]
    },
    ...overrides,
  }
  return event
}

/** 普通键盘事件（落点不在终端）。 */
export function pageKeydown(code, overrides = {}) {
  const element = {
    closest() {
      return null
    },
  }
  return {
    type: 'keydown',
    code,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    repeat: false,
    isComposing: false,
    defaultPrevented: false,
    preventDefault() {},
    stopPropagation() {},
    composedPath() {
      return [element]
    },
    ...overrides,
  }
}
