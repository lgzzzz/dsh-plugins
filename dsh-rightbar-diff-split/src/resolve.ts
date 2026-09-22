/** 三步取数层:entries → 会话作用域绑定 → resolveStore;任一步不可用即 undefined,**无降级**
 * (不回退 DOM、不新建实例 —— 绕过 renderer 缓存 create() 会铸出第二个实例)。
 *
 * 三份活实例(与渲染端同一份内存态):
 * - 布局 store('root',root 作用域):`layoutInfo.rightbarFullscreen` 是全屏真身;
 * - 右栏 store('rightbar.session',会话作用域):`bySession[id].layout` 给出当前面板的当前标签;
 * - 变更审阅视图 store('sidebar.right.pane.tab' 中 key = deliverables 的注册项,会话作用域):split 读写面。 */
import type {
  LayoutStoreSnapshotLike,
  ReviewActionsLike,
  ReviewStateLike,
  RightbarLayoutLike,
  RightbarStateLike,
  ScopeBindingLike,
  Services,
  SlotEntryLike,
  SlotsLike,
  StoreInstanceLike,
} from './types.ts'

/** 布局 store 挂在 root 注册项的 store 座上(ui-layout 的 root 注册自带 store 座)。 */
export const ROOT_SLOT = 'root'

/** 右栏会话级 store 座的 slot 名(sidebar-right 的 seat 注册)。 */
export const RIGHTBAR_SLOT = 'rightbar.session'

/** 右栏每种页 body 注册的 slot(变更审阅把视图 store 声明在注册项上)。 */
export const PANE_TAB_SLOT = 'sidebar.right.pane.tab'

/** 变更审阅页的注册项 key(注册项自己声明的实现身份)。 */
export const REVIEW_ENTRY_KEY = '@deepseek-ai/dsh-client-ui-deliverables'

/** 「变更审阅」标签的 kind。 */
export const CHANGES_REVIEW_KIND = 'changes-review'

/** 解析到的活实例与其形状校验后的快照。 */
export interface ResolvedStore<T> {
  readonly instance: StoreInstanceLike
  readonly snapshot: T
}

/** 解析到的变更审阅视图 store:除快照外还要动作面才能写。 */
export interface ResolvedReviewStore extends ResolvedStore<ReviewStateLike> {
  readonly actions: ReviewActionsLike
}

/** 当前面板的当前标签(id + 记录上的 kind)。 */
export interface ActiveTab {
  readonly id: string
  readonly kind: string | undefined
}

/** 当前会话 id:uiSession.current 绑定源的 key(缺席投影 / 服务不可读即 undefined)。 */
export function currentSessionId(services: Services): string | undefined {
  let snapshot: unknown
  try {
    snapshot = services.uiSession?.current?.getSnapshot?.()
  } catch {
    return undefined
  }
  if (typeof snapshot !== 'object' || snapshot === null) return undefined
  const key = (snapshot as ScopeBindingLike).key
  return typeof key === 'string' && key !== '' ? key : undefined
}

/** 某会话已物化的作用域绑定(带字符串 key);服务面缺一即 undefined。 */
export function sessionScopeBinding(services: Services, sessionId: string): ScopeBindingLike | undefined {
  const uiSession = services.uiSession
  const sessions = services.sessions
  if (uiSession === null || uiSession === undefined) return undefined
  if (sessions === null || sessions === undefined) return undefined
  const bindingSource = uiSession.bindingSource
  if (typeof bindingSource !== 'function') return undefined
  const owner = sessions.binding?.(sessionId)
  if (owner === null || owner === undefined) return undefined

  let source: unknown
  try {
    source = bindingSource.call(uiSession, { sessionId, binding: owner })
  } catch {
    return undefined
  }
  const getSnapshot = (source as StoreInstanceLike | undefined)?.getSnapshot
  if (typeof getSnapshot !== 'function') return undefined
  let binding: unknown
  try {
    binding = (getSnapshot as () => unknown).call(source)
  } catch {
    return undefined
  }
  if (typeof binding !== 'object' || binding === null) return undefined
  const key = (binding as ScopeBindingLike).key
  return typeof key === 'string' && key !== '' ? (binding as ScopeBindingLike) : undefined
}

/**
 * 解析布局 store(root 作用域不传 binding):root 上有多个注册项带 store(左栏偏好、问答草稿……),
 * 故按「layoutInfo.rightbarFullscreen 是布尔」的形状认布局 store。
 * @param services - 插件解析后的服务集合。
 * @returns 活实例与快照;链路任一步不可用即 undefined。
 */
export function resolveLayoutStore(services: Services): ResolvedStore<LayoutStoreSnapshotLike> | undefined {
  const slots = usableSlots(services)
  if (slots === undefined) return undefined
  for (const entry of entriesOf(slots, ROOT_SLOT)) {
    const handle = entry?.store
    if (handle === null || handle === undefined) continue
    const instance = resolveInstance(slots, handle, undefined)
    if (instance === undefined) continue
    const snapshot = snapshotOf(instance)
    if (!isLayoutSnapshot(snapshot)) continue
    return { instance, snapshot }
  }
  return undefined
}

/**
 * 解析当前会话的右栏布局 store(会话作用域,必须带绑定)。
 * @param services - 插件解析后的服务集合。
 * @param sessionId - 目标会话。
 * @returns 活实例与快照;链路任一步不可用即 undefined。
 */
export function resolveRightbarStore(services: Services, sessionId: string): ResolvedStore<RightbarStateLike> | undefined {
  const slots = usableSlots(services)
  if (slots === undefined) return undefined
  const binding = sessionScopeBinding(services, sessionId)
  if (binding === undefined) return undefined
  for (const entry of entriesOf(slots, RIGHTBAR_SLOT)) {
    const handle = entry?.store
    if (handle === null || handle === undefined) continue
    const instance = resolveInstance(slots, handle, binding)
    if (instance === undefined) continue
    const snapshot = snapshotOf(instance)
    if (!isRightbarSnapshot(snapshot)) continue
    return { instance, snapshot }
  }
  return undefined
}

/**
 * 解析当前会话的变更审阅视图 store:按 cell key 认注册项(slots 已按 priority 升序返回,故首个匹配即渲染胜出项),
 * 再经会话作用域绑定 resolveStore 到活实例。形状校验要求 `byTab` 是对象且实例带 `actions`。
 */
export function resolveReviewStore(services: Services, sessionId: string): ResolvedReviewStore | undefined {
  const slots = usableSlots(services)
  if (slots === undefined) return undefined
  const binding = sessionScopeBinding(services, sessionId)
  if (binding === undefined) return undefined
  for (const entry of entriesOf(slots, PANE_TAB_SLOT)) {
    if (entry === undefined || entry === null) continue
    if (entry.options?.key !== REVIEW_ENTRY_KEY) continue
    const handle = entry.store
    if (handle === null || handle === undefined) continue
    const instance = resolveInstance(slots, handle, binding)
    if (instance === undefined) continue
    const snapshot = snapshotOf(instance)
    if (!isReviewSnapshot(snapshot)) continue
    const actions = instance.actions
    if (typeof actions !== 'object' || actions === null) continue
    return { instance, snapshot, actions: actions as ReviewActionsLike }
  }
  return undefined
}

/** 某会话的布局:快照不可读 / 该会话尚无面板即 undefined。 */
export function layoutOf(state: RightbarStateLike, sessionId: string): RightbarLayoutLike | undefined {
  const surface = state.bySession?.[sessionId]
  if (typeof surface !== 'object' || surface === null) return undefined
  const layout = (surface as { layout?: unknown }).layout
  if (typeof layout !== 'object' || layout === null) return undefined
  return layout as RightbarLayoutLike
}

/** 当前面板的当前标签(id + 记录上的 kind);布局 / 面板 / 标签记录任一层不可用即 undefined。 */
export function activeTabOf(layout: RightbarLayoutLike): ActiveTab | undefined {
  const paneId = layout.activePaneId
  if (typeof paneId !== 'string' || paneId === '') return undefined
  const node = layout.nodes?.[paneId]
  // 上游不变量:layout.nodes[activePaneId].kind === 'pane'(sidebar-right 的布局校验同此判据)
  if (typeof node !== 'object' || node === null || node.kind !== 'pane') return undefined
  const tabId = node.activeTabId
  if (typeof tabId !== 'string' || tabId === '') return undefined
  const record = layout.tabs?.[tabId]
  if (typeof record !== 'object' || record === null) return undefined
  return { id: tabId, kind: typeof record.kind === 'string' ? record.kind : undefined }
}

/** 某标签当前是否左右对比:桶缺席即 undefined,split 不是布尔也返回 undefined(状态未知,不猜)。 */
export function splitOf(state: ReviewStateLike, tabId: string): boolean | undefined {
  const bucket = bucketOf(state, tabId)
  if (bucket === undefined) return undefined
  const split = (bucket as { split?: unknown }).split
  return typeof split === 'boolean' ? split : undefined
}

/** 某标签的视图状态桶(缺席 / 形状不符即 undefined)。 */
export function bucketOf(state: ReviewStateLike, tabId: string): Record<string, unknown> | undefined {
  const bucket = state.byTab?.[tabId]
  if (typeof bucket !== 'object' || bucket === null || Array.isArray(bucket)) return undefined
  return bucket as Record<string, unknown>
}

/** slots 服务可用的最小面(entries / resolveStore 都是函数)。 */
function usableSlots(services: Services): SlotsLike | undefined {
  const slots = services.slots
  if (slots === null || slots === undefined) return undefined
  if (typeof slots.entries !== 'function' || typeof slots.resolveStore !== 'function') return undefined
  return slots
}

/** slot 注册项列表(调用抛错视为空)。 */
function entriesOf(slots: SlotsLike, key: string): readonly SlotEntryLike[] {
  try {
    const entries = slots.entries?.(key)
    return Array.isArray(entries) ? entries : []
  } catch {
    return []
  }
}

/** resolveStore(以 handle 对象标识查表,必须原样回传注册项上的那个对象);抛错即不可用。 */
function resolveInstance(slots: SlotsLike, handle: unknown, binding: unknown): StoreInstanceLike | undefined {
  try {
    const instance = slots.resolveStore?.(handle, binding)
    if (typeof instance !== 'object' || instance === null) return undefined
    if (typeof instance.getSnapshot !== 'function') return undefined
    return instance
  } catch {
    return undefined
  }
}

/** 读快照(调用抛错即不可用)。 */
function snapshotOf(instance: StoreInstanceLike): unknown {
  try {
    return instance.getSnapshot?.()
  } catch {
    return undefined
  }
}

/** 布局 store 判定:`layoutInfo.rightbarFullscreen` 是布尔。 */
function isLayoutSnapshot(snapshot: unknown): snapshot is LayoutStoreSnapshotLike {
  if (!isPlainObject(snapshot)) return false
  const info = snapshot.layoutInfo
  if (!isPlainObject(info)) return false
  return typeof info.rightbarFullscreen === 'boolean'
}

/** 右栏 store 判定:快照带 `bySession` 对象。 */
function isRightbarSnapshot(snapshot: unknown): snapshot is RightbarStateLike {
  if (!isPlainObject(snapshot)) return false
  return isPlainObject(snapshot.bySession)
}

/** 变更审阅 store 判定:快照带 `byTab` 对象。 */
function isReviewSnapshot(snapshot: unknown): snapshot is ReviewStateLike {
  if (!isPlainObject(snapshot)) return false
  return isPlainObject(snapshot.byTab)
}

/** 普通对象判定(排除 null 与数组)。 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
