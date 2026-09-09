/**
 * dsh-kbd-hotkeys — 侧栏(workspace 浏览器)可见顺序复刻。
 *
 * 会话跳转(`⌘/Ctrl+Alt+↑/↓`)必须沿**左侧侧栏里看到的顺序**走,否则
 * 「下一个活跃会话」与用户眼中的下一行不一致。侧栏顺序**不是**全局
 * `updatedAt` 排序,而是由 dsh-client-ui-workspace 的 WorkspaceBrowser 派生:
 *
 * 1. 分组:`groupBy==='workspace'` 时按 workspaces 快照的宿主顺序逐组渲染
 *    (组内会话来自该工作区的 `sessionIds`),无归属会话落在末尾的 Ungrouped 桶;
 *    `groupBy==='flat'` 时是单列表。
 * 2. 组内顺序:由浏览器本地视图 store 的 `sessionOrderByAccount[组 key]` 决定
 *    (手动拖拽结果 / `orderBy==='updated'` 的活跃提升结果),再用
 *    `reconciledSessionOrder` 与会话账号对账(新增会话追加到末尾)。
 *    该 store 通过 slots 注册项的 `store` handle 暴露(`sidebar.workspaces`,
 *    scope `root`),本模块用 `slots.resolveStore(handle, undefined)` 取活实例。
 * 3. 可见性:复刻上游 `sessionVisible`——剔除子代理行(origin==='subagent')、
 *    归档行、非当前空白行。
 *
 * **无降级**:顺序只有上述这一个权威来源(侧栏视图 store + workspaces 快照)。
 * 任一项读不到(服务缺失、slot 未注册、store 未创建、`groupBy` 非已知值、
 * workspaces 快照缺 `items`)一律返回空轴,调用方 no-op——宁可不动,
 * 也不按猜测的顺序跳转。
 *
 * 说明:上游还会按分组展开态(`groupExpansion`)与每组 5 行的折叠上限
 * (`COLLAPSED_SESSION_LIMIT`)隐藏行。本模块**只取顺序、不按折叠裁剪**——
 * 折叠组/超限行里的会话仍有确定的顺序位置,若一并裁掉就会变成「跳不到」,
 * 反而破坏导航可用性。
 *
 * 每次调用都重新读取快照与视图 store(不缓存),即「每按一次都重新取一次
 * 活跃会话与顺序」。
 */
import type {
  Services,
  SessionListSnapshotLike,
  SessionSummaryLike,
  SlotEntryLike,
  SlotsLike,
  StoreHandleLike,
  StoreInstanceLike,
  WorkspaceItemLike,
  WorkspaceViewStateLike,
} from './types.ts'

/** 单列表模式在 sessionOrderByAccount 里的账号 key(上游 FLAT_SESSION_ORDER_KEY)。 */
const FLAT_ORDER_KEY = '__flat_session_order__'

/** 无归属会话桶在 sessionOrderByAccount 里的账号 key(上游 UNGROUPED_KEY)。 */
const UNGROUPED_KEY = ''

/** workspace 浏览器注册的 slot 名(其注册项挂载视图 store handle)。 */
const WORKSPACE_SLOT = 'sidebar.workspaces'

/**
 * 侧栏顺序的会话 id 轴(每次调用重新取数)。
 *
 * @param snapshot - `sessions.list` 当前快照。
 * @param services - 已解析服务集合。
 * @returns 按侧栏渲染顺序排列的可见会话 id;权威来源不可读时返回空数组(no-op)。
 */
export function sidebarOrderedSessionIds(snapshot: SessionListSnapshotLike, services: Services): string[] {
  const view = readSidebarViewState(services)
  if (view === undefined) return []
  const workspaceSnapshot = services.workspaces?.list?.getSnapshot?.()
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

  // 单列表模式:全量可见会话按最近更新排序,再与本地顺序账号对账。
  if (view.groupBy === 'flat') {
    const base = (snapshot.ids ?? []).filter(visible)
    base.sort(recency)
    return reconcileOrder(base, order?.[FLAT_ORDER_KEY])
  }
  if (view.groupBy !== 'workspace') return []
  const items = workspaceSnapshot.items
  if (items === undefined) return []

  // 按工作区分组:组按宿主顺序,组内按本地顺序账号对账后的 sessionIds 顺序。
  const ids: string[] = []
  const accounted = new Set<string>()
  for (const workspace of items) {
    for (const id of groupOrder(workspace, order)) {
      accounted.add(id)
      if (visible(id)) ids.push(id)
    }
  }

  // 无归属会话:有本地顺序时按该顺序(新会话按最近更新追加),否则整体按最近更新。
  const stray = (snapshot.ids ?? []).filter((id) => !accounted.has(id) && visible(id))
  const ungrouped = order?.[UNGROUPED_KEY]
  if (ungrouped === undefined) {
    stray.sort(recency)
    ids.push(...stray)
  } else {
    ids.push(...orderedUngrouped(stray, ungrouped, recency))
  }
  return ids
}

/**
 * 读侧栏视图 store 状态(**唯一来源**)。
 *
 * `slots.entries('sidebar.workspaces')` → 注册项上的 store handle →
 * `slots.resolveStore(handle, undefined)` 取活实例 → `getSnapshot()`,
 * 与侧栏渲染同一份内存态(实例未创建时由上游 store 自行从持久化副本水合)。
 *
 * @returns 视图状态;任一环节不可用即 undefined(调用方 no-op)。
 */
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

/** slots 注册项列表(服务异常/形状不符时视为不可用)。 */
function entriesOf(slots: SlotsLike): readonly SlotEntryLike[] {
  try {
    const entries = slots.entries?.(WORKSPACE_SLOT)
    return Array.isArray(entries) ? entries : []
  } catch {
    return []
  }
}

/** 经 slots 解析 handle 的活实例(root 作用域无需 scopeBinding)。 */
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

/**
 * 一个工作区组内的会话 id 顺序:本地顺序账号对账 `sessionIds`
 * (复刻上游 `reconciledSessionOrder`——账号里有的按账号序,其余按 `sessionIds` 序追加)。
 */
function groupOrder(
  workspace: WorkspaceItemLike,
  order: Readonly<Record<string, readonly string[] | undefined>> | undefined,
): readonly string[] {
  const sessionIds = workspace.sessionIds ?? []
  return reconcileOrder(sessionIds, order?.[workspace.workspaceId])
}

/** 对账本地顺序与当前账号(上游 reconciledSessionOrder)。 */
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

/**
 * 无归属桶的本地顺序(上游 orderedUngrouped):账号内顺序在前,
 * 账号未记录的会话按最近更新追加(与工作区分组的 `sessionIds` 追加语义不同)。
 */
function orderedUngrouped(
  ids: readonly string[],
  stored: readonly string[],
  recency: (a: string, b: string) => number,
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
  rest.sort(recency)
  return [...out, ...rest]
}

/** 最近更新在前,id 升序决胜(上游 byRecency,确定性保证连续按键轴稳定)。 */
function compareRecency(
  a: string,
  b: string,
  byId: Readonly<Record<string, SessionSummaryLike>>,
): number {
  const aUpdated = byId[a]?.updatedAt ?? Number.NEGATIVE_INFINITY
  const bUpdated = byId[b]?.updatedAt ?? Number.NEGATIVE_INFINITY
  if (bUpdated !== aUpdated) return bUpdated - aUpdated
  return a < b ? -1 : 1
}

/**
 * 可见性判定,逐字复刻上游 workspace 浏览器 `sessionVisible`:
 * 子代理行(origin==='subagent')、归档行、非当前 blank 行均不渲染为顶层行。
 */
function sessionVisible(
  summary: SessionSummaryLike,
  current: string | undefined,
  archived: ReadonlySet<string>,
): boolean {
  return summary.origin !== 'subagent' && !archived.has(summary.id) && (!summary.blank || summary.id === current)
}
