/**
 * 侧栏可见顺序复刻:分组 + 组内本地顺序账号(slot store,root 作用域)+ 可见性;权威来源读不到即空轴(无降级)。
 */
import { compareRecency, sessionVisible } from './session-order.ts'
import type {
  Services,
  SessionListSnapshotLike,
  SessionSummaryLike,
  SlotEntryLike,
  SlotsLike,
  StoreHandleLike,
  StoreInstanceLike,
  WorkspaceItemLike,
  WorkspaceSnapshotLike,
  WorkspaceViewStateLike,
} from './types.ts'

/** 单列表模式的账号 key(上游 FLAT_SESSION_ORDER_KEY)。 */
const FLAT_ORDER_KEY = '__flat_session_order__'

/** 无归属桶的账号 key(上游 UNGROUPED_KEY)。 */
const UNGROUPED_KEY = ''

/** workspace 浏览器注册的 slot 名(注册项挂视图 store handle)。 */
const WORKSPACE_SLOT = 'sidebar.workspaces'

/** 侧栏渲染顺序下的可见会话 id(每次重新取数);权威来源不可读 → 空数组。 */
export function sidebarOrderedSessionIds(snapshot: SessionListSnapshotLike, services: Services): string[] {
  const view = readSidebarViewState(services)
  if (view === undefined) return []
  const workspaceSnapshot = readWorkspaceSnapshot(services)
  if (workspaceSnapshot === undefined) return []

  const byId = snapshot.byId ?? {}
  const current = snapshot.current
  const archived = new Set<string>(workspaceSnapshot.archivedSessionIds ?? [])
  const order = view.sessionOrderByAccount

  const visible = (id: string): boolean => {
    const summary = byId[id]
    return summary !== undefined && sessionVisible(summary, current, archived)
  }
  const recency = (a: string, b: string): number => compareRecency(a, b, byId)

  // flat:可见会话按最近更新排序,再与本地顺序对账
  if (view.groupBy === 'flat') {
    const base = (snapshot.ids ?? []).filter(visible)
    base.sort(recency)
    return reconcileOrder(base, order?.[FLAT_ORDER_KEY])
  }
  if (view.groupBy !== 'workspace') return []
  const items = workspaceSnapshot.items
  if (items === undefined) return []

  // 组按宿主顺序,组内先与本地顺序对账
  const ids: string[] = []
  const accounted = new Set<string>()
  for (const workspace of items) {
    for (const id of groupOrder(workspace, order)) {
      accounted.add(id)
      if (visible(id)) ids.push(id)
    }
  }

  // 无归属:有本地顺序按顺序(新增按最近更新追加),否则整体按最近更新
  const stray = (snapshot.ids ?? []).filter((id) => !accounted.has(id) && visible(id))
  const ungrouped = order?.[UNGROUPED_KEY]
  if (ungrouped === undefined) {
    stray.sort(recency)
    ids.push(...stray)
  } else {
    ids.push(...orderedUngrouped(stray, ungrouped, byId))
  }
  return ids
}

/** 读侧栏视图 store:slots.entries → resolveStore(handle, undefined) → 快照;任一环不可用 → undefined。 */
export function readSidebarViewState(services: Services): WorkspaceViewStateLike | undefined {
  const slots = services.slots
  if (slots === null || slots === undefined) return undefined
  if (typeof slots.entries !== 'function' || typeof slots.resolveStore !== 'function') return undefined
  for (const entry of entriesOf(slots)) {
    const handle = entry?.store
    if (handle === undefined || handle === null) continue
    const instance = liveInstance(slots, handle)
    const state = asViewState(instance?.getSnapshot?.())
    if (state !== undefined) return state
  }
  return undefined
}

/** 读 workspaces 快照(与 slots 分开读,浮窗只用它);不可用 → undefined。 */
export function readWorkspaceSnapshot(services: Services): WorkspaceSnapshotLike | undefined {
  let snapshot: unknown
  try {
    snapshot = services.workspaces?.list?.getSnapshot?.()
  } catch {
    return undefined
  }
  if (typeof snapshot !== 'object' || snapshot === null || Array.isArray(snapshot)) return undefined
  return snapshot as WorkspaceSnapshotLike
}

/** slot 注册项列表(调用抛错视为不可用)。 */
function entriesOf(slots: SlotsLike): readonly SlotEntryLike[] {
  try {
    const entries = slots.entries?.(WORKSPACE_SLOT)
    return Array.isArray(entries) ? entries : []
  } catch {
    return []
  }
}

/** 解析 handle 的活实例(root 作用域不传 binding)。 */
function liveInstance(slots: SlotsLike, handle: StoreHandleLike): StoreInstanceLike | undefined {
  try {
    return slots.resolveStore?.(handle, undefined)
  } catch {
    return undefined
  }
}

/** 形状校验:只接受普通对象。 */
function asViewState(raw: unknown): WorkspaceViewStateLike | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined
  return raw as WorkspaceViewStateLike
}

/** 组内顺序:本地顺序账号对账 sessionIds(上游 reconciledSessionOrder)。 */
function groupOrder(
  workspace: WorkspaceItemLike,
  order: Readonly<Record<string, readonly string[] | undefined>> | undefined,
): readonly string[] {
  const sessionIds = workspace.sessionIds ?? []
  return reconcileOrder(sessionIds, order?.[workspace.workspaceId])
}

/** 对账:账号内且在册的按账号序,其余按原序追加。 */
function reconcileOrder(ids: readonly string[], stored: readonly string[] | undefined): string[] {
  if (stored === undefined) return [...ids]
  const known = new Set(ids)
  const out: string[] = []
  const included = new Set<string>()
  for (const id of stored) {
    if (!known.has(id) || included.has(id)) continue
    out.push(id)
    included.add(id)
  }
  for (const id of ids) {
    if (included.has(id)) continue
    out.push(id)
  }
  return out
}

/** 无归属桶顺序:账号内在前,未记录的按最近更新追加。 */
function orderedUngrouped(
  ids: readonly string[],
  stored: readonly string[],
  byId: Readonly<Record<string, SessionSummaryLike>>,
): string[] {
  const known = new Set(ids)
  const out: string[] = []
  const included = new Set<string>()
  for (const id of stored) {
    if (!known.has(id) || included.has(id)) continue
    out.push(id)
    included.add(id)
  }
  const rest = ids.filter((id) => !included.has(id))
  rest.sort((a, b) => compareRecency(a, b, byId))
  return [...out, ...rest]
}
