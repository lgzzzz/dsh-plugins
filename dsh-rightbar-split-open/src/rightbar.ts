/**
 * dsh-rightbar-split-open — 右栏会话级 store 的取数与观察层。
 *
 * ## 取数(AGENTS.md 的 slot store 三步范式)
 *
 * 1. `slots.entries('rightbar.session')` → 注册项;带 `store` 的那一项即
 *    `createSidebarRightStore()` 的 handle;
 * 2. `uiSession.resolve(sessionId)` → 该会话**已物化的作用域绑定**(其内部就调了
 *    `slots.bindStoreScope`);
 * 3. `slots.resolveStore(handle, binding)` → **活实例**(`getSnapshot` / `actions` /
 *    `subscribe`),与 seat 正在画的那份内存态是同一份。
 *
 * **无降级**:任一环不可用(服务缺失、slot 未注册、注册项无 store、作用域绑定缺 key、
 * `resolveStore` 抛 `store handle is not registered`)一律 no-op —— 不猜布局、
 * 不触碰 DOM、也不在插件内镜像一份面板状态。
 *
 * ## 接线:为什么挂在 `uiSession.resolve` 上
 *
 * 「某个会话的右栏 store 何时可解析」这件事,上游唯一的公开信号就是
 * 「`uiSession.resolve(sessionId)` 何时被调用」(渲染端物化会话作用域时调用它,
 * 其内部随即 `bindStoreScope`)。因此本插件在这一层取**一次**会话 id,再在
 * `resolve` 返回之后(微任务里)解析 store 并订阅 —— 不在 `resolve` 内部同步解析
 * (此时物化尚未收尾),也不做任何轮询。
 *
 * 观察面用 store 自己的 `subscribe`:每次提交都同步通知,因此「文件树里点开文件」
 * 在本插件读到新布局时已经落地,可以立刻改造它。
 *
 * 本模块只**读**与**报告**,不含任何写动作:改造的执行在 session-split.ts
 * (那里才需要 `sidebarRight` 与 store 动作面),这样「判定 → 执行」两层都能单独
 * 单测,且本模块不依赖 DOM。
 */
import { planSplitOpen, type SplitOpenPlan } from './split-open.ts'
import type { LayoutStateLike, RightbarStoreLike, SlotsLike, UiSessionLike } from './types.ts'

/** 右栏面板 seat 注册的会话级 slot 名(其 store handle 挂在这一项上)。 */
export const RIGHTBAR_SLOT = 'rightbar.session'

/** 在 `uiSession` 上安装接线的标记(避免热重载重复包装)。 */
const WIRED = Symbol.for('dsh-rightbar-split-open.wired')

/**
 * 会话物化后解析 store 的最大尝试次数(每次让出一个微任务)。
 * 覆盖「`resolve` 返回后渲染端还要再走一小段物化」这一档;有界、无定时器、无轮询。
 */
const WIRE_ATTEMPTS = 6

/**
 * sidebarRight 控制器里本插件用到的公开面。
 *
 * `split(paneId?)` 是本插件唯一带**实测可行性判定**的入口(空间不够 / 面板预算已满 /
 * 目标面板为空时返回 `undefined`),所以分栏必须走它而不是直接写 store 动作:宁可退回
 * 上游默认行为(文件就地留在树面板),也不制造一个放不下的分栏。
 */
export interface SidebarRightSplitLike {
  split?(paneId?: string): string | undefined
}

/** 一次「文件树里点开文件」的观察结果(交给执行层改造)。 */
export interface SplitOpenEvent {
  readonly sessionId: string
  /** 观察时刻的 store 活实例(改造要写的就是这一份)。 */
  readonly store: RightbarStoreLike
  /** 观察时刻的布局(权威快照;执行层据此定位面板与分栏)。 */
  readonly layout: LayoutStateLike
  /** 判定结果:树面板 / 新文件标签 / 已有的文件面板。 */
  readonly plan: SplitOpenPlan
}

/** 接线所需的两个服务面(缺任一即整体 no-op)。 */
export interface RightbarHostServices {
  readonly uiSession: UiSessionLike | undefined
  readonly slots: SlotsLike | undefined
}

/** 一次性安装结果:卸载函数。 */
export interface SessionWiringHandle {
  dispose(): void
}

/** 一个会话的接线记录(供安装方登记待执行任务;本模块自身不改布局)。 */
export interface SessionWiring {
  readonly sessionId: string
  /** 当前订阅的 store 活实例。 */
  readonly store: RightbarStoreLike
  /** 退订函数(store 换实例时替换)。 */
  unsubscribe?: () => void
  /**
   * 上一次观察到的布局(基线),订阅时立即读一次建立。
   * 基线表达的是「已经看过」,不表达任何意图:`observe` 每次都先比基线再更新它,
   * 因此插件装载**之前**就开着的文件不会被误判成「刚点开」。
   */
  baseline?: LayoutStateLike
  /** 该会话的接线是否已作废(插件卸载 / store 换实例)。 */
  disposed?: boolean
}

/**
 * 在 `uiSession` 上安装会话物化钩子,并在卸载时拆除全部订阅。
 *
 * @param services - 已解析的服务集合(判空后传入)。
 * @param onOpen - 观察到「文件树里点开文件」时调用(执行层负责分栏 / 搬移 / 调比例)。
 * @returns 已安装时的 `{ dispose }`;`uiSession.resolve` 不可用或已安装过时返回
 *   `undefined`(调用方只记一条 warning,不做任何降级)。
 */
export function installSessionWiring(
  services: RightbarHostServices,
  onOpen: (event: SplitOpenEvent) => void,
): SessionWiringHandle | undefined {
  const uiSession = services.uiSession
  if (uiSession === null || uiSession === undefined) return undefined
  const original = uiSession.resolve
  if (typeof original !== 'function') return undefined
  if ((uiSession as Record<symbol, unknown>)[WIRED] === true) return undefined

  const records = new Map<string, SessionWiring>()
  let installed = true

  /**
   * 为一个刚物化的会话解析 store 并订阅。
   *
   * **为什么要重试**:`resolve` 返回后,渲染端可能还要再走一小段物化(store 句柄的
   * 作用域注册紧随其后)。这里用**有界微任务重试**({@link WIRE_ATTEMPTS} 次、无定时器、
   * 无轮询)覆盖那一小段;成功一次即停,失败了也不会留下半个订阅。
   */
  const wire = (sessionId: string, binding: unknown, attempt: number): void => {
    if (!installed) return
    const existing = records.get(sessionId)
    if (existing !== undefined && existing.disposed !== true) return
    if (wireSession(records, services.slots, sessionId, binding, onOpen)) return
    if (attempt + 1 >= WIRE_ATTEMPTS) return
    scheduleMicrotask(() => { wire(sessionId, binding, attempt + 1) })
  }

  const wrapped = (sessionId: unknown): unknown => {
    const result = (original as (id: unknown) => unknown).call(uiSession, sessionId)
    // 会话作用域刚物化完(其内部已 bindStoreScope);排到微任务再解析 store,
    // 避免在物化调用栈内再去解析同一份作用域。
    if (installed && typeof sessionId === 'string' && sessionId !== '') {
      const binding: unknown = result
      scheduleMicrotask(() => { wire(sessionId, binding, 0) })
    }
    return result
  }

  try {
    Object.defineProperty(uiSession, 'resolve', {
      value: wrapped,
      writable: true,
      configurable: true,
      enumerable: false,
    })
    ;(uiSession as Record<symbol, unknown>)[WIRED] = true
  } catch {
    return undefined
  }

  return {
    dispose(): void {
      installed = false
      for (const record of records.values()) {
        record.disposed = true
        record.unsubscribe?.()
      }
      records.clear()
      try {
        Object.defineProperty(uiSession, 'resolve', {
          value: original,
          writable: true,
          configurable: true,
          enumerable: false,
        })
        delete (uiSession as Record<symbol, unknown>)[WIRED]
      } catch {
        // 还原失败不致命:包装本身只是纯观察层(它只转发,并在微任务里读快照)。
      }
    },
  }
}

/**
 * 为一个刚物化的会话解析 store 并订阅它的提交。
 *
 * store 实例身份不变时**不重复订阅**(渲染端每次物化都会调 `resolve`);
 * 身份变了(例如 seat 重挂载换来新实例)则退旧订新。
 *
 * @returns 是否成功落到一个已订阅的 store(重试逻辑据此决定要不要再来一次)。
 */
function wireSession(
  records: Map<string, SessionWiring>,
  slots: SlotsLike | undefined,
  sessionId: string,
  binding: unknown,
  onOpen: (event: SplitOpenEvent) => void,
): boolean {
  const store = resolveStore(slots, binding)
  if (store === undefined) return false
  const existing = records.get(sessionId)
  if (existing !== undefined && existing.store === store && existing.disposed !== true) return true
  if (existing !== undefined) {
    existing.disposed = true
    existing.unsubscribe?.()
  }

  const record: SessionWiring = { sessionId, store }
  records.set(sessionId, record)
  if (typeof store.subscribe !== 'function') return true
  const commit = (): void => {
    if (record.disposed === true) return
    observe(record, onOpen)
  }
  try {
    record.unsubscribe = store.subscribe(commit)
  } catch {
    record.unsubscribe = undefined
  }
  // 订阅**不会**为当前快照回调一次(上游 defineStore 只在下一次提交时通知),
  // 所以基线要在这里主动读一次:否则「插件装载瞬间的布局」会被当成第一次提交,
  // 而真正的第一次提交反而成了基线 —— 那一点开文件就永远不触发改造。
  record.baseline = readLayout(store, sessionId)
  return true
}

/**
 * 一次提交:与基线比出「文件树里刚点开的文件」。
 *
 * 无论是否命中,都把基线推到最新布局 —— 基线只记「已看过」,不表达任何意图。
 */
function observe(record: SessionWiring, onOpen: (event: SplitOpenEvent) => void): void {
  const next = readLayout(record.store, record.sessionId)
  if (next === undefined) return
  const previous = record.baseline
  record.baseline = next
  if (previous === undefined) return
  const plan = planSplitOpen(previous, next)
  if (plan === undefined) return
  onOpen({ sessionId: record.sessionId, store: record.store, layout: next, plan })
}

/** 读某会话的布局(快照缺席 / 该会话尚无停靠面 / 形状不符时 undefined)。 */
export function readLayout(store: RightbarStoreLike, sessionId: string): LayoutStateLike | undefined {
  if (typeof store.getSnapshot !== 'function') return undefined
  let snapshot: unknown
  try {
    snapshot = store.getSnapshot()
  } catch {
    return undefined
  }
  if (typeof snapshot !== 'object' || snapshot === null) return undefined
  const bySession = (snapshot as { bySession?: unknown }).bySession
  if (typeof bySession !== 'object' || bySession === null) return undefined
  const surface = (bySession as Record<string, unknown>)[sessionId]
  if (typeof surface !== 'object' || surface === null) return undefined
  const layout = (surface as { layout?: unknown }).layout
  if (typeof layout !== 'object' || layout === null) return undefined
  return layout as LayoutStateLike
}

/** 三步范式的第 3 步:`slots.resolveStore(handle, binding)` → 活实例。 */
export function resolveStore(slots: SlotsLike | undefined, binding: unknown): RightbarStoreLike | undefined {
  if (slots === null || slots === undefined) return undefined
  if (typeof slots.entries !== 'function' || typeof slots.resolveStore !== 'function') return undefined
  if (typeof binding !== 'object' || binding === null) return undefined
  if (typeof (binding as { key?: unknown }).key !== 'string') return undefined

  let entries: readonly unknown[]
  try {
    const found = slots.entries(RIGHTBAR_SLOT)
    entries = Array.isArray(found) ? found : []
  } catch {
    return undefined
  }
  for (const entry of entries) {
    const handle = (entry as { store?: unknown } | undefined)?.store
    if (handle === undefined || handle === null) continue
    let instance: unknown
    try {
      // 会话级 store 必须带作用域绑定解析(渲染端同一句 resolveStore)。
      instance = slots.resolveStore(handle, binding)
    } catch {
      // 'store handle is not registered' / 作用域不匹配 → 换下一个注册项。
      continue
    }
    const store = asStore(instance)
    if (store !== undefined) return store
  }
  return undefined
}

/** 活实例形状校验:必须能 `getSnapshot()`;动作面可选(缺它只影响改造,不影响读)。 */
function asStore(instance: unknown): RightbarStoreLike | undefined {
  if (typeof instance !== 'object' || instance === null) return undefined
  if (typeof (instance as { getSnapshot?: unknown }).getSnapshot !== 'function') return undefined
  return instance as RightbarStoreLike
}

/** 排一个微任务(环境无 `queueMicrotask` 时退化为 Promise 微任务)。 */
function scheduleMicrotask(task: () => void): void {
  if (typeof queueMicrotask === 'function') {
    queueMicrotask(task)
    return
  }
  void Promise.resolve().then(task)
}
