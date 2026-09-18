/** 工作区浮窗(⌘/Ctrl+K)的数据面:按组内最近会话更新时间取前 10、当前会话所属工作区强制保留;
 * 切换调 uiWorkspace.openWorkspace;无降级、不回退 DOM。 */
import { sessionVisible } from './session-order.ts'
import { currentSessionId } from './session-view.ts'
import { readWorkspaceSnapshot } from './sidebar-order.ts'
import type { Services, SessionSummaryLike, WorkspaceItemLike, WorkspaceRowLike } from './types.ts'

/** 浮窗最多列出的工作区数(全局口径)。 */
const WORKSPACE_LIMIT = 10

/** 一行工作区 + 活跃度与宿主下标(排序用)。 */
interface RankedWorkspace {
  item: WorkspaceItemLike
  workspaceId: string
  /** 组内可见会话里最新的 updatedAt;无可见会话为 -Infinity。 */
  activity: number
  /** 宿主顺序下标(同活跃度的稳定决胜)。 */
  index: number
}

/** 取工作区候选行(活跃度降序、最多 WORKSPACE_LIMIT 行,每次打开现取);服务缺席 / 缺 items → 空数组。 */
export function workspaceRows(services: Services): WorkspaceRowLike[] {
  const snapshot = readWorkspaceSnapshot(services)
  const items = snapshot?.items
  if (!Array.isArray(items)) return []

  // 当前会话来自视图层(0.1.6-alpha.2 起 sessions.list 快照不再带 current)
  const current = currentSessionId(services)
  const byId: Readonly<Record<string, SessionSummaryLike>> = services.sessions?.list?.getSnapshot?.()?.byId ?? {}
  const archived = new Set<string>(snapshot?.archivedSessionIds ?? [])

  const entries: RankedWorkspace[] = []
  items.forEach((item, index) => {
    if (item === null || item === undefined) return
    const workspaceId = item.workspaceId
    if (typeof workspaceId !== 'string' || workspaceId === '') return
    entries.push({ item, workspaceId, activity: workspaceActivity(item, byId, current, archived), index })
  })

  // 活跃度降序;同活跃度保持宿主顺序(确定性,连续打开轴稳定)
  const ordered = entries.sort((a, b) => b.activity - a.activity || a.index - b.index)

  // 全局裁剪到最近活跃的 10 个;当前会话所属工作区掉出榜单时顶掉第 10 名(与近期对话强制纳入当前会话同口径)。
  const kept = ordered.slice(0, WORKSPACE_LIMIT)
  const currentWorkspaceId = workspaceIdOfSession(entries, current)
  if (currentWorkspaceId !== undefined && kept.length === WORKSPACE_LIMIT) {
    if (!kept.some((entry) => entry.workspaceId === currentWorkspaceId)) {
      const forced = ordered.find((entry) => entry.workspaceId === currentWorkspaceId)
      if (forced !== undefined) kept[WORKSPACE_LIMIT - 1] = forced
    }
  }

  const rows: WorkspaceRowLike[] = kept.map((entry) => ({
    workspaceId: entry.workspaceId,
    label: workspaceLabel(entry.item),
    detail: typeof entry.item.path === 'string' ? entry.item.path : '',
    sessionCount: entry.item.sessionIds?.length ?? 0,
    current: current !== undefined && current !== '' && (entry.item.sessionIds?.includes(current) ?? false),
  }))
  // 次行与主标签重复时置空
  for (const row of rows) {
    if (row.detail === row.label) row.detail = ''
  }
  return rows
}

/** 活跃度 = 组内可见会话里最新的 updatedAt;无可见会话 / 会话目录不可读 → -Infinity(沉底,仍按宿主顺序)。 */
function workspaceActivity(
  item: WorkspaceItemLike,
  byId: Readonly<Record<string, SessionSummaryLike>>,
  current: string | undefined,
  archived: ReadonlySet<string>,
): number {
  let latest = Number.NEGATIVE_INFINITY
  for (const id of item.sessionIds ?? []) {
    const summary = byId[id]
    if (summary === undefined) continue
    // 子代理 / 归档 / 空白会话不算活跃(与浮窗可见性同一判据)
    if (!sessionVisible(summary, current, archived, false)) continue
    const updatedAt = summary.updatedAt
    if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt)) continue
    if (updatedAt > latest) latest = updatedAt
  }
  return latest
}

/** 当前会话所属工作区(在册且 id 合法才返回);无归属 / 无当前会话 → undefined。 */
function workspaceIdOfSession(entries: readonly RankedWorkspace[], current: string | undefined): string | undefined {
  if (current === undefined || current === '') return undefined
  for (const entry of entries) {
    if (entry.item.sessionIds?.includes(current) === true) return entry.workspaceId
  }
  return undefined
}

/** 切换工作区(uiWorkspace.openWorkspace);服务 / 动词缺失、id 非法或抛错 → false。 */
export function switchWorkspace(services: Services, workspaceId: string): boolean {
  const uiWorkspace = services.uiWorkspace
  if (uiWorkspace === null || uiWorkspace === undefined) return false
  if (typeof uiWorkspace.openWorkspace !== 'function') return false
  if (typeof workspaceId !== 'string' || workspaceId === '') return false
  try {
    void Promise.resolve(uiWorkspace.openWorkspace(workspaceId)).catch(() => {})
    return true
  } catch {
    return false
  }
}

/** 工作区行主标签:title → 路径末段 → 原路径。 */
function workspaceLabel(item: WorkspaceItemLike): string {
  const title = typeof item.title === 'string' ? item.title.trim() : ''
  if (title !== '') return title
  const path = typeof item.path === 'string' ? item.path : ''
  const base = pathBasename(path)
  return base !== '' ? base : path
}

/** 路径末段(复刻上游):去尾部斜杠后取最后一个 / 或 \ 之后的部分。 */
export function pathBasename(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, '')
  const separator = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return trimmed.slice(separator + 1)
}
