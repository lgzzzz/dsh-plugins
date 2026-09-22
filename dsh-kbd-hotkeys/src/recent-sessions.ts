/** 近期对话浮窗(⌘/Ctrl+I)的数据面与打开落点(浮窗 DOM 在 overlay.ts)。
 * 列表按工作区分组、全局最多 10 行、当前会话强制纳入、归档会话恒不列出;
 * 初始落点优先当前会话所在行,当前是新建空白会话等不列出的情形落**同工作区**第一行;
 * 打开只走 uiWorkspace.openSession(方法形式调用);无降级。 */
import { recencyOrder, sessionVisible } from './session-order.ts'
import { completionUnread, currentSessionId } from './session-view.ts'
import { readWorkspaceSnapshot } from './sidebar-order.ts'
import { pathBasename } from './workspace-switcher.ts'
import type {
  RecentSessionGroupLike,
  RecentSessionRowLike,
  RecentSessionsViewLike,
  Services,
  SessionSummaryLike,
  WorkspaceItemLike,
  WorkspaceSnapshotLike,
} from './types.ts'

/** 无归属会话桶的组 key。 */
const UNGROUPED_KEY = ''

const EMPTY_NOTICE = '当前没有可打开的对话'

/** 浮窗最多列出的会话数（全局口径）。 */
const RECENT_LIMIT = 10

/** 读取近期对话浮窗的渲染数据（每次打开现取）。 */
export function recentSessionsView(services: Services): RecentSessionsViewLike {
  const snapshot = services.sessions?.list?.getSnapshot?.()
  const byId = snapshot?.byId
  const ids = snapshot?.ids
  if (byId === undefined || byId === null || !Array.isArray(ids) || ids.length === 0) {
    return emptyView()
  }

  // 当前会话来自视图层(0.1.6-alpha.2 起 sessions.list 快照不再带 current)
  const current = currentSessionId(services)
  const pending = pendingSessionIds(services)
  const workspaceSnapshot = readWorkspaceSnapshot(services)
  const archived = new Set<string>(workspaceSnapshot?.archivedSessionIds ?? [])
  // 归档会话恒不列出（不跟随侧栏 archivedFilter）：本浮窗只用于「打开」，列出不可打开的行
  // 只会得到「关窗无反馈」的死行；取消归档后自然回到列表。
  const visible = (id: string): boolean => {
    const summary = byId[id]
    return summary !== undefined && sessionVisible(summary, current, archived, 'default', false)
  }

  const rows: RecentSessionRowLike[] = []
  const groups: RecentSessionGroupLike[] = []
  const accounted = new Set<string>()
  const buckets: { workspaceId: string; label: string; members: string[] }[] = []
  const all: string[] = []
  for (const item of workspaceSnapshot?.items ?? []) {
    if (item === null || item === undefined) continue
    const workspaceId = item.workspaceId
    if (typeof workspaceId !== 'string' || workspaceId === '') continue
    const members = (item.sessionIds ?? []).filter(visible)
    for (const id of members) accounted.add(id)
    if (members.length === 0) continue
    buckets.push({ workspaceId, label: workspaceLabel(item), members })
    all.push(...members)
  }

  // 无归属会话（不属于任何工作区 / 快照缺 items）：末尾单独一组。
  const stray = ids.filter((id) => !accounted.has(id) && visible(id))
  if (stray.length > 0) {
    buckets.push({ workspaceId: UNGROUPED_KEY, label: '', members: stray })
    all.push(...stray)
  }

  // 全局裁剪：所有可见会话按最近更新排序，只留前 RECENT_LIMIT 个。
  const order = recencyOrder(all, byId)
  const kept = new Set(order.slice(0, RECENT_LIMIT))
  // 当前会话不在前 10 名时顶掉第 10 名，保证初始光标有落点。
  if (
    current !== undefined &&
    current !== '' &&
    kept.size === RECENT_LIMIT &&
    !kept.has(current) &&
    visible(current)
  ) {
    kept.delete(order[RECENT_LIMIT - 1])
    kept.add(current)
  }

  // 仍按工作区分组：整组被裁掉的工作区不出现（不留空标题）。
  for (const bucket of buckets) {
    const members = bucket.members.filter((id) => kept.has(id))
    if (members.length === 0) continue
    const groupRows = recencyOrder(members, byId).map((id) => sessionRow(id, byId[id], current, pending, services))
    groups.push({ workspaceId: bucket.workspaceId, label: bucket.label, rows: groupRows })
    rows.push(...groupRows)
  }

  if (rows.length === 0) return emptyView()
  return {
    groups,
    rows,
    initialIndex: initialIndex(rows, groups, current, currentWorkspaceKey(workspaceSnapshot, current)),
    notice: '',
  }
}

/** 任意态;打开选中会话:只走 uiWorkspace.openSession(与侧栏点会话行同一路径);
 * 是上游类实例原型方法,必须以方法形式调用(摘下丢 this 抛 TypeError);不可用即 no-op。
 * 归档会话拒绝打开:列表已恒不列出归档行,此处只是与上游 `guardedOpen` 对齐的防御
 * (`uiWorkspace.openSession` 本身不设门闸),覆盖「列出行后被归档」的竞态。 */
export function openRecentSession(services: Services, sessionId: string): boolean {
  if (typeof sessionId !== 'string' || sessionId === '') return false
  const archived = new Set<string>(readWorkspaceSnapshot(services)?.archivedSessionIds ?? [])
  if (archived.has(sessionId)) return false
  const uiWorkspace = services.uiWorkspace
  const openSession = uiWorkspace?.openSession
  if (uiWorkspace === null || uiWorkspace === undefined || typeof openSession !== 'function') return false
  try {
    // 与侧栏点会话行同一路径（含 layout.selectPanel(null)）。
    openSession.call(uiWorkspace, sessionId)
    return true
  } catch {
    return false
  }
}

function emptyView(): RecentSessionsViewLike {
  return { groups: [], rows: [], initialIndex: 0, notice: EMPTY_NOTICE }
}

/** 初始高亮：当前会话所在行。当前会话**不列出**（新建空白会话、归档等被可见性裁掉）时，
 *  落**同工作区**的第一行（⌘/Ctrl+I 的邻域是当前工作区，而非整份列表的榜首）；
 *  无当前会话、归属组未上榜才退回首行。 */
function initialIndex(
  rows: readonly RecentSessionRowLike[],
  groups: readonly RecentSessionGroupLike[],
  current: string | undefined,
  currentWorkspace: string | undefined,
): number {
  if (current === undefined || current === '') return 0
  const index = rows.findIndex((row) => row.sessionId === current)
  if (index >= 0) return index
  if (currentWorkspace === undefined) return 0
  let offset = 0
  for (const group of groups) {
    if (group.workspaceId === currentWorkspace) return group.rows.length > 0 ? offset : 0
    offset += group.rows.length
  }
  return 0
}

/** 当前会话的归属工作区（复刻上游 `owningGroupKey`）：无当前会话 → undefined；
 *  快照缺 items / 没有任何工作区登记该会话 → 无归属桶（与列表末尾的无标题组同 key）。 */
function currentWorkspaceKey(
  snapshot: WorkspaceSnapshotLike | undefined,
  current: string | undefined,
): string | undefined {
  if (current === undefined || current === '') return undefined
  for (const item of snapshot?.items ?? []) {
    if (item === null || item === undefined) continue
    if (item.sessionIds?.includes(current) !== true) continue
    const workspaceId = item.workspaceId
    if (typeof workspaceId === 'string' && workspaceId !== '') return workspaceId
  }
  return UNGROUPED_KEY
}

function sessionRow(
  id: string,
  summary: SessionSummaryLike | undefined,
  current: string | undefined,
  pending: ReadonlySet<string>,
  services: Services,
): RecentSessionRowLike {
  const label = titleOf(summary, id)
  const cwd = typeof summary?.cwd === 'string' ? summary.cwd.trim() : ''
  return {
    sessionId: id,
    label,
    detail: cwd === label ? '' : cwd,
    current: id === current,
    running: summary?.running === true,
    // 完成未读来自 uiSession.sessionStatus(替代已删除的 summary.completed)
    completed: completionUnread(services, id),
    pending: pending.has(id),
  }
}

/** 行主标签：displayTitle，缺失回退 title / 会话 id（恒非空）。 */
function titleOf(summary: SessionSummaryLike | undefined, id: string): string {
  const display = typeof summary?.displayTitle === 'string' ? summary.displayTitle.trim() : ''
  if (display !== '') return display
  const title = typeof summary?.title === 'string' ? summary.title.trim() : ''
  return title !== '' ? title : id
}

/** 组标题：工作区 title → 路径末段。 */
function workspaceLabel(item: WorkspaceItemLike): string {
  const title = typeof item.title === 'string' ? item.title.trim() : ''
  if (title !== '') return title
  const path = typeof item.path === 'string' ? item.path : ''
  return pathBasename(path)
}

/** 有待处理交互的会话 id 集合（取不到即空集）。 */
function pendingSessionIds(services: Services): ReadonlySet<string> {
  const uiSession = services.uiSession
  let map: ReadonlyMap<string, unknown> | undefined
  try {
    map = uiSession?.pendingInteractions?.getSnapshot?.()
  } catch {
    map = undefined
  }
  if (map === undefined || map === null) {
    try {
      map = uiSession?.pendingSnapshot
    } catch {
      map = undefined
    }
  }
  if (map === undefined || map === null) return new Set()
  const ids = new Set<string>()
  for (const [id, interaction] of map) {
    if (interaction === null || interaction === undefined) continue
    if (typeof id === 'string' && id !== '') ids.add(id)
  }
  return ids
}
