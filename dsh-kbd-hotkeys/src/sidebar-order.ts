/**
 * 侧栏可见顺序复刻:分组 + 组内本地顺序账号(slot store,root 作用域)+ 可见性 + 置顶/归档语义;
 * 权威来源读不到即空轴(无降级)。逐条对齐上游 workspace 浏览器 0.1.7-alpha.1:
 * 成员集取宿主全量(含归档,上游 sessionMemberIds)、可见性走 archivedFilter、
 * 渲染顺序再经 sectionMembers(blank → 置顶 → 其余),组内/降级桶与上游同序。
 */
import {
  normalizeArchivedFilter,
  pinCurrentBlank,
  recencyOrder,
  reconcileOrder,
  sectionMembers,
  sessionRowVisible,
  type ArchivedFilter,
} from './session-order.ts'
import { currentSessionId } from './session-view.ts'
import type {
  RowStateLike,
  Services,
  SessionListSnapshotLike,
  SessionSummaryLike,
  SlotEntryLike,
  SlotsLike,
  StoreHandleLike,
  StoreInstanceLike,
  WorkspaceSnapshotLike,
  WorkspaceViewStateLike,
} from './types.ts'

/** 单列表模式的账号 key(上游 FLAT_SESSION_ORDER_KEY)。 */
const FLAT_ORDER_KEY = '__flat_session_order__'

/** 无归属桶的账号 key(上游 UNGROUPED_KEY)。 */
const UNGROUPED_KEY = ''

/** workspace 浏览器注册的 slot 名(注册项挂视图 store handle)。 */
const WORKSPACE_SLOT = 'sidebar.workspaces'

/**
 * 侧栏渲染顺序下的可见会话 id(每次重新取数);权威来源不可读 → 空数组。
 * 复刻上游:成员集(含归档)→ 序(orderBy=manual 走对账,否则最近更新)→ pinCurrentBlank →
 * 可见性(archivedFilter)→ sectionMembers(blank → 置顶 → 其余)。
 */
export function sidebarOrderedSessionIds(snapshot: SessionListSnapshotLike, services: Services): string[] {
  const view = readSidebarViewState(services)
  if (view === undefined) return []
  const workspaceSnapshot = readWorkspaceSnapshot(services)
  if (workspaceSnapshot === undefined) return []

  const byId = snapshot.byId ?? {}
  const ids = snapshot.ids ?? []
  // 当前会话来自视图层(0.1.6-alpha.2 起 sessions.list 快照不再带 current);读不到即 undefined
  const current = currentSessionId(services)
  const archived = new Set<string>(workspaceSnapshot.archivedSessionIds ?? [])
  const pinned = new Set<string>(workspaceSnapshot.pinnedSessionIds ?? [])
  const archivedFilter = normalizeArchivedFilter(view.archivedFilter)
  const rowState: RowStateLike = {
    archivedSessionIds: [...archived],
    pinnedSessionIds: [...pinned],
  }
  const manual = view.orderBy === 'manual'
  const order = view.sessionOrderByAccount
  const currentBlank = current !== undefined && byId[current]?.blank === true ? current : undefined

  /** 账号内顺序:对账(manual)或最近更新(updated),再把选中空白会话顶到最前。 */
  const accountOrder = (memberIds: readonly string[], key: string | undefined): string[] => {
    const base = manual
      ? reconcileOrder(memberIds, key === undefined ? undefined : order?.[key], byId, rowState)
      : recencyOrder(memberIds, byId)
    const blank = currentBlank !== undefined && memberIds.includes(currentBlank) ? currentBlank : undefined
    return pinCurrentBlank(base, blank)
  }
  /** 渲染顺序:可见性过滤 → sectionMembers 分区。 */
  const render = (orderedIds: readonly string[]): string[] => {
    const members: SessionSummaryLike[] = []
    for (const id of orderedIds) {
      const summary = byId[id]
      if (summary === undefined || summary === null) continue
      if (!sessionRowVisible(summary, current, archived, archivedFilter)) continue
      members.push(summary)
    }
    return sectionMembers(members, pinned, archived).map((member) => member.id)
  }

  // flat:成员集取上游 sessionMemberIds(含归档、排除子代理与非当前 blank),再按账号顺序渲染
  if (view.groupBy === 'flat') {
    const members = ids.filter((id) => {
      const summary = byId[id]
      return summary !== undefined && summary !== null && sessionRowVisible(summary, current, new Set<string>(), 'show')
    })
    return render(accountOrder(members, FLAT_ORDER_KEY))
  }
  if (view.groupBy !== 'workspace') return []
  const items = workspaceSnapshot.items
  if (items === undefined) return []

  // 组按宿主顺序,组内先定序再分区
  const idsOut: string[] = []
  const accounted = new Set<string>()
  for (const workspace of items) {
    const memberIds = workspace.sessionIds ?? []
    for (const id of memberIds) accounted.add(id)
    idsOut.push(...render(accountOrder(memberIds, workspace.workspaceId)))
  }

  // 无归属:成员=未归属全量(上游 pinOrderSource 的 "" 桶),再走同一可见性/分区
  const ungrouped = ids.filter((id) => !accounted.has(id) && byId[id] !== undefined)
  idsOut.push(...render(accountOrder(ungrouped, UNGROUPED_KEY)))
  return idsOut
}

/** 读侧栏视图 store 的归档筛选:读不到按 default(与上游 store 默认一致)。 */
export function readArchivedFilter(services: Services): ArchivedFilter {
  return normalizeArchivedFilter(readSidebarViewState(services)?.archivedFilter)
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
