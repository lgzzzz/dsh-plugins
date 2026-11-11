/**
 * dsh-model-quick-switch 的测试装置：断言、假服务、假 Cordis 上下文、最小 document / window 替身。
 *
 * 浮层与设置页用**真的 React** 渲染（react-dom/server 的 `renderToStaticMarkup`），所以不需要
 * React 替身；组件里的 `useEffect` 在服务端渲染下不会跑，涉及按键 / 滚轮的用例单独驱动
 * `installPaletteKeys` / `installPaletteWheel`。
 *
 * 跑全部请用 `node test/run-all.mjs`。
 */
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

/** 本插件的包根目录（测试文件在 test/ 下）。 */
export const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

let failures = 0

/** 已失败的断言数。 */
export function failureCount() {
  return failures
}

/** 结构相等断言（JSON 比较）。 */
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

/** 等几拍微任务（异步确认动作 / 目录加载 / 状态通知都排在微任务里）。 */
export async function tick(times = 4) {
  for (let index = 0; index < times; index += 1) await Promise.resolve()
}

//#region vdom 元素读数（真 React 元素）

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

/** 从容器元素里取出宿主组件元素（props 带 store 的那个）。 */
export function findHost(containerElement) {
  if (containerElement?.props?.store !== undefined) return containerElement
  return findNode(containerElement?.props?.children, (node) => node.props?.store !== undefined)
}

//#endregion

//#region 假服务与假上下文

/** 造一个假的设置表单（同一命名空间的读写与订阅）。 */
export function fakeConfigForm({ value = { models: [] }, status = 'ready', writable = true, accept = true } = {}) {
  let current = value
  let currentStatus = status
  let currentWritable = writable
  const listeners = new Set()
  const calls = []
  const form = {
    getSnapshot: () => ({ status: currentStatus, value: current, writable: currentWritable }),
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    async mutate(ops, expectedRevision) {
      calls.push({ ops, expectedRevision })
      if (!accept) return false
      let next = current
      for (const op of ops) {
        if (op.op !== 'set' || op.path.length !== 1 || op.path[0] !== 'models') continue
        next = { ...next, models: op.value }
      }
      current = next
      for (const listener of [...listeners]) listener()
      return true
    },
    /** 换一份值并像真实表单那样通知订阅者。 */
    setValue(next, { status: nextStatus = currentStatus, writable: nextWritable = currentWritable } = {}) {
      current = next
      currentStatus = nextStatus
      currentWritable = nextWritable
      for (const listener of [...listeners]) listener()
    },
    calls,
    listenerCount: () => listeners.size,
  }
  return form
}

/** 造一个假的 configForms 服务。 */
export function fakeConfigForms(form) {
  const requested = []
  return {
    get(entryId) {
      requested.push(entryId)
      return form
    },
    requested,
  }
}

/**
 * 造一个假的会话目录：`ids` / `byId` 快照、主视图会话与它的 `modelSelection` 投影。
 *
 * @param options - `{ current, byId, modelSelection }`。
 */
export function fakeSessions({ current, byId = {}, modelSelection = null } = {}) {
  const listeners = new Set()
  let main = current
  let selection = modelSelection
  let rows = { ...byId }
  const notify = () => {
    for (const listener of [...listeners]) listener()
  }
  const snapshot = () => {
    const all = { ...rows }
    if (main !== undefined) {
      all[main] = {
        ...(all[main] ?? {}),
        retainedBy: { mainView: 1 },
        projectionValues: { modelSelection: selection },
      }
    }
    const ids = Object.keys(all)
    return {
      ids,
      byId: Object.fromEntries(ids.map((id) => [id, {
        retainedBy: { mainView: 0 },
        ...all[id],
      }])),
      phase: 'ready',
    }
  }
  const list = {
    getSnapshot: snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    /** 换一个主视图会话（真实目录会推快照）。 */
    setCurrent(id) {
      main = id
      notify()
    },
    /** 换当前会话的 `modelSelection` 投影。 */
    setSelection(next) {
      selection = next
      notify()
    },
    /** 换整份会话目录。 */
    setRows(next) {
      rows = { ...next }
      notify()
    },
    listenerCount: () => listeners.size,
  }
  return { list }
}

/** 造一个假的远程服务：模型目录 + 模型选择。 */
export function fakeRemote({ catalog, selectResult } = {}) {
  const catalogCalls = []
  const selectCalls = []
  const defaultCatalog = {
    ok: true,
    value: {
      default: { provider: 'deepseek', model: 'deepseek-chat' },
      groups: [
        { id: 'deepseek', name: 'DeepSeek', models: [{ id: 'deepseek-chat', name: 'DeepSeek Chat' }] },
      ],
      failures: [],
    },
  }
  return {
    session: {
      async modelCatalog() {
        catalogCalls.push(undefined)
        return catalog ?? defaultCatalog
      },
      async selectModel(request) {
        selectCalls.push(request)
        if (selectResult !== undefined) return selectResult
        const { sessionId, ...selected } = request
        return { ok: true, value: { selected } }
      },
    },
    catalogCalls,
    selectCalls,
  }
}

/** 造一个假的快捷键目录：固定行登记 + 观察者，可按固定通道派发输入。 */
export function fakeShortcuts({ platform = 'windows' } = {}) {
  const commands = []
  const observers = new Set()
  const catalog = []
  let consumeCalls = 0
  const face = {
    platform,
    registerFixed(command) {
      commands.push(command)
      catalog.push({ id: command.id, bindings: command.bindings })
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
     * 派发一次固定输入，照上游 `ShortcutsService.fixedInput` 的规矩来：每个观察者拿到的是一份
     * 带 `consume` 的读数，谁调了 `consume`，后面的观察者就会看到 `defaultPrevented`。
     */
    fire(input) {
      let consumed = false
      for (const observer of [...observers]) {
        if (!observers.has(observer)) continue
        if (input.type === 'reset' || input.gesture === undefined) {
          observer(input)
          continue
        }
        observer({
          ...input,
          gesture: {
            ...input.gesture,
            defaultPrevented: input.gesture.defaultPrevented === true || consumed,
          },
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
    consumeCalls: () => consumeCalls,
    /** 让本插件那条固定行从目录里消失（模拟被别的注册者挤掉）。 */
    dropFixed(id) {
      const index = commands.findIndex((command) => command.id === id)
      if (index >= 0) commands.splice(index, 1)
      const row = catalog.findIndex((entry) => entry.id === id)
      if (row >= 0) catalog.splice(row, 1)
    },
  }
  return face
}

/** 断言调用者就是槽位服务对象本身（上游 `register` / `inject` 都读 `this.ctx`）。 */
function requireSlotsReceiver(face, receiver) {
  if (receiver !== face) throw new Error('cannot get property "ctx" without inject')
}

/** 断言交出去的是组件本体（上游渲染器对条目做 `jsx(entry.component, props)`）。 */
function requireComponent(component) {
  if (typeof component === 'function' || typeof component === 'string') return
  const kind = component === null ? 'null' : Array.isArray(component) ? 'array' : typeof component
  throw new Error(`Element type is invalid: expected a string or a class/function but got: ${kind}.`)
}

/** 按真实渲染器的方式渲染一个槽位注册项。 */
export function renderSlotEntry(entry, ownerProps = {}) {
  if (entry === undefined) return ''
  const inject = entry.inject ?? entry.options?.inject
  const injected = typeof inject === 'function' ? inject() : {}
  return renderToStaticMarkup(createElement(entry.component, { ...injected, ...ownerProps }))
}

/** 造一个假的槽位表。 */
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
    disposeAll: () => {
      for (const disposer of [...disposers].reverse()) disposer()
    },
  }
  return face
}

/**
 * 造一个假 Cordis 上下文：与真实 fiber 一致地处理 `inject` / `effect` / 等待子 fiber。
 *
 * `provide(name, value)` 就是「服务晚到」的通路。
 * @param services - 一开始就存在的服务表。
 */
export function fakeCtx(services) {
  const registry = { ...services }
  const effects = []
  const cleanups = []
  const children = []

  // 真实上下文里 `ctx.remote.session` 是生成出来的命名空间服务：只 provide 了 `remote`
  // 时，`remote.session` 也必须可以按名字等到，否则声明 `inject: ['remote.session']` 的
  // 子 fiber 会永远不启动。
  const syncRemoteSession = () => {
    const remote = registry.remote
    if (remote !== undefined && remote.session !== undefined) registry['remote.session'] = remote.session
    else delete registry['remote.session']
  }
  syncRemoteSession()

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

  const runChild = (child) => {
    if (child.running) return
    if (child.names.some((name) => registry[name] === undefined)) return
    child.running = true
    child.setup(scopeOf(child))
  }

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
    provide(name, value) {
      const replaced = registry[name] !== undefined
      registry[name] = value
      syncRemoteSession()
      for (const child of children) {
        if (!child.names.includes(name)) continue
        if (replaced) stopChild(child)
        runChild(child)
      }
    },
    scope,
    effects,
    children,
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

/** 造一条固定输入通道的 keydown 读数（本插件占用的 `Ctrl+Alt+U`）。 */
export function fixedKeydown(overrides = {}) {
  return {
    type: 'keydown',
    gesture: {
      code: 'KeyU',
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

/** 造一条 macOS 上的固定输入读数（`primary+alt+U` 在 macOS 展开成 `⌘⌥U`）。 */
export function fixedMacKeydown(overrides = {}) {
  return fixedKeydown({ control: false, meta: true, ...overrides })
}

/** 造一个 Host 模型目录响应（按传入的 provider/model 列表）。 */
export function catalogOf(models, { failures = [], defaultSelection } = {}) {
  return {
    ok: true,
    value: {
      default: defaultSelection ?? { provider: models[0]?.provider ?? 'deepseek', model: models[0]?.model ?? 'deepseek-chat' },
      groups: [...new Set(models.map((entry) => entry.provider))].map((provider) => ({
        id: provider,
        name: provider === 'deepseek' ? 'DeepSeek' : provider,
        models: models
          .filter((entry) => entry.provider === provider)
          .map((entry) => ({
            id: entry.model,
            name: entry.name ?? entry.model,
            ...entry.badge === undefined ? {} : { badge: entry.badge },
            ...entry.efforts === undefined && entry.defaultEffort === undefined
              ? {}
              : { reasoning: { efforts: entry.efforts ?? [], ...entry.defaultEffort === undefined ? {} : { defaultEffort: entry.defaultEffort } } },
          })),
      })),
      failures,
    },
  }
}

//#endregion

//#region 最小 document / window 替身

/**
 * 装一个最小的 document 与 window：document 上的捕获阶段 keydown 监听（浮层内的按键）、
 * window 上的捕获阶段 keydown 监听（终端内的打开键），以及样式表注入。
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
    pressKey(key, overrides = {}) {
      const event = keyEvent({ key, ...overrides })
      for (const listener of [...listeners]) listener(event)
      return event
    },
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
