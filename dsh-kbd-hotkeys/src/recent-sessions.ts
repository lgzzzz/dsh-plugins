/** dsh-kbd-hotkeys — 近期对话浮窗（⌘/Ctrl+I）的数据面与打开落点（浮窗 DOM 在 overlay.ts）。
 * 列表按工作区分组、全局最多 10 行、当前会话强制纳入；打开走 uiWorkspace.openSession（回退 sessions.open，均以方法形式调用）；无降级。
 */
import { recencyOrder, sessionVisible } from './session-order.ts'
import { readWorkspaceSnapshot } from './sidebar-order.ts'
import { pathBasename } from './workspace-switcher.ts'
import type {
  RecentSessionGroupLike,
  RecentSessionRowLike,
  RecentSessionsViewLike,
  Services,
  SessionSummaryLike,
  WorkspaceItemLike,
} from './types.ts'

/** 无归属会话桶的组 key。 */
const UNGROUPED_KEY = ''

/** 空态提示。 */
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

  const current = snapshot?.current
  const pending = pendingSessionIds(services)
  const workspaceSnapshot = readWorkspaceSnapshot(services)
  const archived = new Set<string>(workspaceSnapshot?.archivedSessionIds ?? [])
  const visible = (id: string): boolean => {
    const summary = byId[id]
    return summary !== undefined && sessionVisible(summary, current, archived, false)
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
    const groupRows = recencyOrder(members, byId).map((id) => sessionRow(id, byId[id], current, pending))
    groups.push({ workspaceId: bucket.workspaceId, label: bucket.label, rows: groupRows })
    rows.push(...groupRows)
  }

  if (rows.length === 0) return emptyView()
  return {
    groups,
    rows,
    initialIndex: initialIndex(rows, current),
    notice: '',
  }
}

/** 任意态；打开选中的会话：优先 uiWorkspace.openSession，缺失 / 抛错则回退 sessions.open。
 * 两者都是上游类实例的原型方法，必须以方法形式调用（摘下丢 this 会抛 TypeError）。
 */
export function openRecentSession(services: Services, sessionId: string): boolean {
  if (typeof sessionId !== 'string' || sessionId === '') return false
  const uiWorkspace = services.uiWorkspace
  const openSession = uiWorkspace?.openSession
  if (uiWorkspace !== null && uiWorkspace !== undefined && typeof openSession === 'function') {
    try {
      // 与侧栏点会话行同一路径（含 layout.selectPanel(null)）。
      openSession.call(uiWorkspace, sessionId)
      return true
    } catch {
    }
  }
  const sessions = services.sessions
  const open = sessions?.open
  if (sessions === null || sessions === undefined || typeof open !== 'function') return false
  try {
    open.call(sessions, sessionId)
    return true
  } catch {
    return false
  }
}

/** 空态（无可用会话）。 */
function emptyView(): RecentSessionsViewLike {
  return { groups: [], rows: [], initialIndex: 0, notice: EMPTY_NOTICE }
}

/** 初始高亮：当前会话所在行，否则首行。 */
function initialIndex(rows: readonly RecentSessionRowLike[], current: string | undefined): number {
  if (current === undefined || current === '') return 0
  const index = rows.findIndex((row) => row.sessionId === current)
  return index < 0 ? 0 : index
}

/** 一行会话的展示数据。 */
function sessionRow(
  id: string,
  summary: SessionSummaryLike | undefined,
  current: string | undefined,
  pending: ReadonlySet<string>,
): RecentSessionRowLike {
  const label = titleOf(summary, id)
  const cwd = typeof summary?.cwd === 'string' ? summary.cwd.trim() : ''
  return {
    sessionId: id,
    label,
    detail: cwd === label ? '' : cwd,
    current: id === current,
    running: summary?.running === true,
    completed: summary?.completed === true,
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
