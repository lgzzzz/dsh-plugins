/**
 * dsh-workspace-quick-switch 的测试装置:断言、假服务与假 Cordis 上下文、最小 document
 * 替身,以及包根路径。
 *
 * 浮层组件用**真的 React** 渲染(react-dom/server 的 `renderToStaticMarkup`),所以不需要
 * React 替身;浮层里的 `useEffect` 在服务端渲染下不会跑,测试就自己把 effect 拿出来跑,
 * 并收下它们交出的清理函数(往 `document` 上挂的监听由此撤掉)。
 *
 * 跑全部请用 `node test/run-all.mjs`。
 */
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { normalizeBinding } from '@deepseek-ai/dsh-client-shortcuts/protocol'

/** 本插件的包根目录(测试文件在 test/ 下)。 */
export const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

let failures = 0

/** 已失败的断言数。 */
export function failureCount() {
  return failures
}

/** 结构相等断言(JSON 比较)。 */
export function check(label, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  const ok = a === e
  if (!ok) failures += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : ` — 期望 ${e},实得 ${a}`}`)
}

/** 严格 true 断言。 */
export function checkTrue(label, actual) {
  const ok = actual === true
  if (!ok) failures += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : ` — 期望 true,实得 ${JSON.stringify(actual)}`}`)
}

/** 严格 undefined 断言。 */
export function checkUndefined(label, actual) {
  const ok = actual === undefined
  if (!ok) failures += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : ` — 期望 undefined,实得 ${JSON.stringify(actual)}`}`)
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

//#region vdom 元素读数(真 React 元素)

/** 深度优先找出满足条件的第一个节点。 */
export function findNode(node, predicate) {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findNode(child, predicate)
      if (found !== undefined) return found
    }
    return undefined
  }
  if (node === null || node === undefined || typeof node !== 'object') return undefined
  if (predicate(node)) return node
  return findNode(node.props?.children, predicate)
}

/** 深度优先找出所有满足条件的节点。 */
export function findAll(node, predicate, out = []) {
  if (Array.isArray(node)) {
    for (const child of node) findAll(child, predicate, out)
    return out
  }
  if (node === null || node === undefined || typeof node !== 'object') return out
  if (predicate(node)) out.push(node)
  findAll(node.props?.children, predicate, out)
  return out
}

/** 从容器元素里取出宿主组件元素(props 带 store 的那个)。 */
export function findHost(containerElement) {
  if (containerElement?.props?.store !== undefined) return containerElement
  return findNode(containerElement?.props?.children, (node) => node.props?.store !== undefined)
}

/** 从渲染结果里取所有候选行元素。 */
export function optionNodes(tree) {
  return findAll(tree, (node) => node.props?.['data-workspace-quick-switch-option'] === '')
}

/** 从渲染结果里读候选行(标题、是否当前、是否选中)。 */
export function optionRows(tree) {
  return optionNodes(tree).map((node) => ({
    title: findNode(node, (child) => child.props?.className === 'dsh-workspace-quick-switch-name')?.props?.children,
    current: findNode(node, (child) => child.props?.className === 'dsh-workspace-quick-switch-current') !== undefined,
    selected: node.props['aria-selected'],
  }))
}

//#endregion

//#region 假服务与假上下文

/** 造一个假的工作区快照源(订阅会立即送一次当前值,与工作区控制器一致)。 */
export function fakeWorkspaces(items) {
  const listeners = new Set()
  let current = items
  const list = {
    getSnapshot: () => ({ items: current }),
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    set(next) {
      current = next
      for (const listener of [...listeners]) listener()
    },
    listenerCount: () => listeners.size,
  }
  return list
}

/** 造一个假的会话目录(只有本插件读的字段 + `ObservableSnapshot` 的订阅面)。 */
export function fakeSessions({ current, byId = {} } = {}) {
  const listeners = new Set()
  let mainView = current
  const summaries = { ...byId }
  const list = {
    getSnapshot() {
      const rows = { ...summaries }
      if (mainView !== undefined) rows[mainView] = { ...(rows[mainView] ?? {}), retainedBy: { mainView: 1 } }
      return { ids: Object.keys(rows), byId: rows }
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    /** 换一个主视图会话(真实目录里这会推一次快照)。 */
    setCurrent(id) {
      mainView = id
      for (const listener of [...listeners]) listener()
    },
    listenerCount: () => listeners.size,
  }
  return { list }
}

/**
 * 造一个假的快捷键目录:固定行登记 + 观察者,可按固定通道派发输入。
 *
 * `platform` 默认取 Windows/Linux 口径,固定行的逻辑 `primary` 按它展开成物理键位 ——
 * 与真实注册表 `registerFixed` 一致。
 * @param platform - 收窄到本插件认的三种平台。
 */
export function fakeShortcuts({ platform = 'windows' } = {}) {
  const commands = []
  const observers = new Set()
  const catalog = []
  let consumeCalls = 0
  const face = {
    platform,
    registerFixed(command) {
      commands.push(command)
      catalog.push({
        id: command.id,
        bindings: command.bindings.map((binding) => normalizeBinding(binding, platform)),
      })
      return () => {
        const index = commands.indexOf(command)
        if (index >= 0) commands.splice(index, 1)
        const row = catalog.findIndex((candidate) => candidate.id === command.id)
        if (row >= 0) catalog.splice(row, 1)
      }
    },
    observeFixedInput(listener) {
      observers.add(listener)
      return () => observers.delete(listener)
    },
    fixedCatalog: { getSnapshot: () => catalog },
    /**
     * 派发一次固定输入,照上游 `ShortcutsService.fixedInput` 的规矩来:每个观察者拿到的是一份
     * 带 `consume` 的读数,谁调了 `consume`,后面的观察者就会看到 `defaultPrevented` —— 于是
     * 「谁先认领这次按键」在夹具里也能被断言。
     *
     * 形如 `{ type: 'reset' }` 或根本没有 `gesture` 的读数原样转发(上游对 reset 也是原样)。
     * @param input - 固定输入读数。
     * @returns 这次输入是否被消费。
     */
    fire(input) {
      let consumed = false
      for (const observer of [...observers]) {
        // 观察者可能在派发途中退订(上游同款保护)。
        if (!observers.has(observer)) continue
        if (input.type === 'reset' || input.gesture === undefined) {
          observer(input)
          continue
        }
        observer({
          ...input,
          gesture: { ...input.gesture, defaultPrevented: input.gesture.defaultPrevented === true || consumed },
          consume: () => {
            consumed = true
          },
        })
      }
      if (consumed) consumeCalls += 1
      return consumed
    },
    commands,
    observerCount: () => observers.size,
    /** 有多少次派发被观察者消费过(`consume()` 至少被调用一次)。 */
    consumeCalls: () => consumeCalls,
    /** 让本插件那条固定行从目录里消失(模拟被别的注册者挤掉):按键随即「无主」。 */
    dropFixed(id) {
      const index = commands.findIndex((command) => command.id === id)
      if (index >= 0) commands.splice(index, 1)
      const row = catalog.findIndex((row) => row.id === id)
      if (row >= 0) catalog.splice(row, 1)
    },
  }
  return face
}

/**
 * 断言调用者就是槽位服务对象本身。
 *
 * 真实的 `SlotRegistry.register` / `inject` 都用 `this`(第一步就是读 `this.ctx`),只有以服务
 * 对象为接收者调用时,Cordis 的服务代理才会把 `this.ctx` 换成调用方 scope;bind/apply 到别的
 * 对象上时上游抛的正是下面这条。假服务照抄这条约束,错误接收者就不会再蒙混过关。
 * @param face - 槽位服务对象。
 * @param receiver - 这次调用实际的 `this`。
 */
function requireSlotsReceiver(face, receiver) {
  if (receiver !== face) throw new Error('cannot get property "ctx" without inject')
}

/**
 * 断言交出去的是组件本体。
 *
 * 真实渲染器对每个条目做的是 `jsx(entry.component, props)`,React 对元素/普通对象会抛
 * `Element type is invalid ... but got: object`。假服务照抄这条,传元素就不再算通过。
 * @param component - 注册的第二个参数。
 */
function requireComponent(component) {
  if (typeof component === 'function' || typeof component === 'string') return
  const kind = component === null ? 'null' : Array.isArray(component) ? 'array' : typeof component
  throw new Error(`Element type is invalid: expected a string (for built-in components) or a class/function (for composite components) but got: ${kind}.`)
}

/**
 * 按真实渲染器的方式渲染一个槽位注册项:`jsx(component, {...inject(), ...ownerProps})`。
 *
 * 业务 props 只从 inject 交出来(真实渲染器按条目缓存那一次调用;真实条目把 inject 放在
 * `entry.inject` 上,本假服务的条目则是原样记下调用方传的 `entry.options`);owner props 覆盖它。
 * @param entry - `fakeSlots().registered` 里的一个条目(或真实 `slots.entries(...)` 的元素)。
 * @param ownerProps - 槽位拥有者传下来的 props(可省略)。
 * @returns 静态渲染出的 HTML;没有条目时为空串。
 */
export function renderSlotEntry(entry, ownerProps = {}) {
  if (entry === undefined) return ''
  const inject = entry.inject ?? entry.options?.inject
  const injected = typeof inject === 'function' ? inject() : {}
  return renderToStaticMarkup(createElement(entry.component, { ...injected, ...ownerProps }))
}

/** 造一个假的槽位表:记录注册的槽、注册项与注入回调。 */
export function fakeSlots() {
  const injected = []
  const registered = []
  const disposers = []
  const face = {
    inject(key, callback) {
      requireSlotsReceiver(face, this)
      injected.push(key)
      const disposer = callback()
      if (typeof disposer === 'function') disposers.push(disposer)
      return () => disposer?.()
    },
    register(options, component) {
      requireSlotsReceiver(face, this)
      requireComponent(component)
      registered.push({ options, component })
      return () => {
        const index = registered.findIndex((entry) => entry.options === options)
        if (index >= 0) registered.splice(index, 1)
      }
    },
    injected,
    registered,
    /** 跑一遍注入回调交出来的清理函数(浮层注册项的卸载)。 */
    disposeAll: () => {
      for (const disposer of [...disposers].reverse()) disposer()
    },
  }
  return face
}

/**
 * 造一个假 Cordis 上下文。
 *
 * 与真实 fiber 一致:
 *   - `ctx.inject(names, setup)` 在 names 全部可解析时立即跑 setup;
 *   - `scope.effect(callback, label)` **立即执行回调并收下它交出来的清理函数**;
 *   - `scope.get(name)` 只认识传进来的服务表;
 *   - `scope.inject(names, setup)` 是**子 fiber**:服务齐了才跑,服务缺席时先排队,之后
 *     `provide` 补上再跑;换实现时先卸载(跑掉子 fiber 里登记的清理函数)再重跑;
 *     卸载时子 fiber 先于父 scope 的 effect 退场。
 *
 * `provide(name, value)` 就是那条「服务晚到」的通路 —— 真实 Web 启动里 `workspaces` /
 * `sessions` 经远程链路提供,正是这么晚才出现的。
 * @param services - 一开始就存在的服务表。
 */
export function fakeCtx(services) {
  const registry = { ...services }
  const effects = []
  const cleanups = []
  const children = []

  const scopeOf = (owner) => ({
    get: (name) => registry[name],
    effect: (callback, label) => {
      const cleanup = callback()
      owner.effects.push({ label, cleanup })
      if (typeof cleanup === 'function') owner.cleanups.push(cleanup)
      return () => {}
    },
    inject(names, setup) {
      const child = { names, setup, effects: [], cleanups: [], running: false }
      children.push(child)
      runChild(child)
      return child
    },
  })

  /** 子 fiber 的挂载:依赖齐了就跑一次。 */
  const runChild = (child) => {
    if (child.running) return
    if (child.names.some((name) => registry[name] === undefined)) return
    child.running = true
    child.setup(scopeOf(child))
  }

  /** 子 fiber 的卸载:按登记逆序跑掉它自己的清理函数。 */
  const stopChild = (child) => {
    if (!child.running) return
    child.running = false
    for (const cleanup of [...child.cleanups].reverse()) cleanup()
    child.cleanups.length = 0
    child.effects.length = 0
  }

  const root = { effects, cleanups }
  const scope = scopeOf(root)
  const ctx = {
    inject(names, setup) {
      ctx.requested = names
      const missing = names.filter((name) => registry[name] === undefined)
      if (missing.length > 0) {
        ctx.missing = missing
        return
      }
      ctx.scope = scope
      setup(scope)
    },
    /** 让一个服务在此刻出现(或换实现):排队的子 fiber 补跑、已挂的先卸载再重跑。 */
    provide(name, value) {
      const replaced = registry[name] !== undefined
      registry[name] = value
      for (const child of children) {
        if (!child.names.includes(name)) continue
        if (replaced) stopChild(child)
        runChild(child)
      }
    },
    scope,
    effects,
    children,
    /** 按登记逆序跑一遍清理函数(真实 fiber 的卸载顺序:先子 fiber,后本 scope)。 */
    dispose() {
      for (const child of [...children].reverse()) stopChild(child)
      for (const cleanup of [...cleanups].reverse()) cleanup()
      cleanups.length = 0
      effects.length = 0
    },
    requested: [],
    missing: [],
  }
  return ctx
}

/** 造一条固定输入通道的 keydown 读数(Windows/Linux 口径:`Ctrl+Alt+M`)。 */
export function fixedKeydown(overrides = {}) {
  return {
    type: 'keydown',
    gesture: {
      code: 'KeyM',
      control: true,
      alt: true,
      shift: false,
      meta: false,
      repeat: false,
      composing: false,
      defaultPrevented: false,
      ...overrides,
    },
  }
}

/** 造一条 macOS 口径的固定输入读数(`⌘⌥M`)。 */
export function fixedMacKeydown(overrides = {}) {
  return fixedKeydown({ control: false, meta: true, ...overrides })
}

/** 造一个宿主工作区。 */
export function workspace(id, title, extra = {}) {
  return { workspaceId: id, title, path: `/projects/${id}`, sessionIds: [], ...extra }
}

//#endregion

//#region 最小 document 替身

/**
 * 装一个最小的 document 与 window:document 上的捕获阶段 keydown 监听(浮层内的按键)、
 * window 上的捕获阶段 keydown 监听(终端内的打开键),以及样式表注入。
 * @returns 派发按键的 `pressKey` / `pressWindowKey`、监听者集合、注入过的样式表与卸载函数。
 */
export function installDom() {
  const listeners = new Set()
  const styles = []
  const head = {
    appendChild(node) {
      styles.push(node)
      return node
    },
  }
  const document = {
    head,
    createElement(tag) {
      const node = {
        tag,
        dataset: {},
        textContent: '',
        remove() {
          const index = styles.indexOf(node)
          if (index >= 0) styles.splice(index, 1)
        },
      }
      return node
    },
    addEventListener(type, listener) {
      if (type === 'keydown') listeners.add(listener)
    },
    removeEventListener(type, listener) {
      if (type === 'keydown') listeners.delete(listener)
    },
    listenerCount: () => listeners.size,
  }
  globalThis.document = document
  // window 上的捕获监听是终端那条通路挂的(见 `client.ts` 的 quick switch terminal capture),
  // 所以这里给 window 一份真的监听登记表,`pressWindowKey` 按捕获阶段的顺序派发。
  const windowListeners = new Set()
  const window = {
    addEventListener(type, listener) {
      if (type === 'keydown') windowListeners.add(listener)
    },
    removeEventListener(type, listener) {
      if (type === 'keydown') windowListeners.delete(listener)
    },
    listenerCount: () => windowListeners.size,
  }
  globalThis.window = window
  /** 造一个原生 keydown 事实(带 `composedPath`,终端判定要读它)。 */
  const keyEvent = (overrides = {}) => {
    const event = {
      type: 'keydown',
      code: '',
      key: '',
      repeat: false,
      isComposing: false,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      metaKey: false,
      defaultPrevented: false,
      stopped: false,
      path: [],
      composedPath() {
        return event.path
      },
      preventDefault() {
        event.defaultPrevented = true
      },
      stopPropagation() {
        event.stopped = true
      },
      ...overrides,
    }
    return event
  }
  const api = {
    document,
    window,
    listeners,
    styles,
    /** 造一个 keydown 事实并派发给捕获阶段监听者。 */
    pressKey(key, overrides = {}) {
      const event = keyEvent({ key, ...overrides })
      for (const listener of [...listeners]) listener(event)
      return event
    },
    /** 造一个 keydown 事实并派发给 window 捕获阶段的监听者(终端内那一按走这条)。 */
    pressWindowKey(overrides = {}) {
      const event = keyEvent(overrides)
      for (const listener of [...windowListeners]) listener(event)
      return event
    },
    windowListenerCount: () => windowListeners.size,
    uninstall() {
      delete globalThis.document
      delete globalThis.window
    },
  }
  return api
}

//#endregion
