/**
 * 浏览器半部的测试夹具：假工作区控制器、假客户端 ctx、假侧栏 DOM，以及可控的帧队列与时钟。
 *
 * 假控制器只复刻插件读的两件事：`list.getSnapshot()` 给出宿主权威顺序（快照里的 `items` 已按
 * 该顺序排好）与投影状态 `state`，`list.subscribe()` 在顺序、视图或状态变化后同步通知。假侧栏
 * 只复刻两个上游锚点（`[data-sidebar-list-area]` 滚动容器与 `[data-row-key^="workspace:"]`
 * 分组行）以及插件注册的 document 级拖拽监听。
 *
 * 帧队列把 `requestAnimationFrame` / `cancelAnimationFrame` 换成本地登记表，`Date.now` 换成可
 * 推进的假时钟：测试自己决定「排了一帧」「帧跑到」「拖拽结束后过了多久」三个时刻。
 */

/** 一份工作区视图：插件只读 `workspaceId`。 */
export function workspaceView(id) {
  return { workspaceId: id, path: `/work/${id}`, title: id, sessionIds: [], createdAt: '', updatedAt: '' }
}

/**
 * 假工作区控制器。
 * `setOrder` 模拟一次顺序增量；`notify` 模拟视图变化（顺序不变）；`setState` 模拟载体失联 /
 * 终止失败；`resync` 模拟断线恢复后整份替换投影。
 */
export function createWorkspaceSource(order = []) {
  let items = order.map(workspaceView)
  let state = 'idle'
  const listeners = new Set()
  const notify = () => {
    for (const listener of [...listeners]) listener()
  }
  const snapshot = () => ({
    items,
    archivedSessionIds: [],
    pinnedSessionIds: [],
    state,
    phase: 'ready',
    error: null,
  })
  return {
    list: {
      getSnapshot: snapshot,
      subscribe: (listener) => {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      },
    },
    /** 当前顺序（字符串 id）。 */
    get order() {
      return items.map((item) => String(item.workspaceId))
    },
    /** 当前投影状态。 */
    get state() {
      return state
    },
    /** 一次顺序变化：换掉快照再通知。 */
    setOrder(next) {
      items = next.map(workspaceView)
      notify()
    },
    /** 一次不改变顺序的通知（改名、视图字段更新）。 */
    notify,
    /** 一次投影状态变化（载体失联 `loading`、终止失败 `error`）。 */
    setState(next) {
      state = next
      notify()
    },
    /** 断线恢复：整份替换顺序并回到 `idle`。 */
    resync(next) {
      items = next.map(workspaceView)
      state = 'idle'
      notify()
    },
    /** 仍然挂着的订阅数（验证卸载退订）。 */
    listenerCount: () => listeners.size,
  }
}

/** 假客户端 ctx：只给插件用到的 `workspaces` 与 `effect`。 */
export function createClientContext(workspaces) {
  const disposers = []
  return {
    ctx: {
      workspaces,
      effect: (callback) => {
        const dispose = callback()
        if (typeof dispose === 'function') disposers.push(dispose)
        return dispose
      },
    },
    dispose: () => {
      for (const dispose of disposers.splice(0)) dispose()
    },
  }
}

/**
 * 假侧栏。
 * `workspaceRows` 为 false 模拟单列表视图 / 搜索中 / 收起成 rail：滚动容器还在，但没有分组行。
 */
export function createSidebarDom({ scrollTop = 240, workspaceRows = true, area = true } = {}) {
  const element = {
    scrollTop,
    querySelector: (selector) =>
      workspaceRows && selector === '[data-row-key^="workspace:"]' ? {} : null,
  }
  /** document 级监听：插件只挂拖拽相关事件。 */
  const listeners = new Map()
  const document = {
    querySelector: (selector) => (area && selector === '[data-sidebar-list-area]' ? element : null),
    addEventListener: (type, listener) => {
      const bucket = listeners.get(type) ?? new Set()
      bucket.add(listener)
      listeners.set(type, bucket)
    },
    removeEventListener: (type, listener) => {
      listeners.get(type)?.delete(listener)
    },
  }
  return {
    /** 滚动容器本身。 */
    area: element,
    document,
    /** 派发一次 document 级事件（只认插件注册过的监听器）。 */
    dispatch(type, event = {}) {
      for (const listener of [...(listeners.get(type) ?? [])]) listener(event)
    },
    /** 仍然挂着的 document 监听数（验证卸载移除）。 */
    listenerCount: () =>
      [...listeners.values()].reduce((total, bucket) => total + bucket.size, 0),
  }
}

/** 一次拖拽事件的起点：工作区分组行（`closest` 只认这个选择器）。 */
export function workspaceDragTarget() {
  return { closest: (selector) => (selector === '[data-row-key^="workspace:"]' ? {} : null) }
}

/** 一次拖拽事件的起点：不在工作区分组行里（例如会话行）。 */
export function otherDragTarget() {
  return { closest: () => null }
}

/**
 * 把 `document` / `requestAnimationFrame` / `cancelAnimationFrame` / `Date.now` 换成测试可控的
 * 版本。`doc` 为 `undefined` 时删掉全局 `document`，模拟非浏览器环境。
 * @returns 帧队列、假时钟操控面与还原函数。
 */
export function installFrameEnvironment(doc) {
  const saved = new Map()
  const define = (key, value) => {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  }
  const frames = new Map()
  let nextId = 1
  let now = 1_000
  if (doc === undefined) {
    saved.set('document', Object.getOwnPropertyDescriptor(globalThis, 'document'))
    delete globalThis.document
  } else {
    define('document', doc)
  }
  define('requestAnimationFrame', (callback) => {
    const id = nextId
    nextId += 1
    frames.set(id, callback)
    return id
  })
  define('cancelAnimationFrame', (id) => {
    frames.delete(id)
  })
  const realNow = Date.now
  saved.set('date.now', realNow)
  Date.now = () => now
  return {
    /** 已排上、还没跑的帧数。 */
    pending: () => frames.size,
    /** 跑掉当前排上的所有帧。 */
    flush() {
      const callbacks = [...frames.values()]
      frames.clear()
      for (const callback of callbacks) callback(0)
    },
    /** 把假时钟往前拨 `ms` 毫秒。 */
    advance(ms) {
      now += ms
    },
    restore() {
      for (const [key, descriptor] of saved) {
        if (key === 'date.now') Date.now = descriptor
        else if (descriptor === undefined) delete globalThis[key]
        else Object.defineProperty(globalThis, key, descriptor)
      }
      saved.clear()
    },
  }
}
