/** 工作区浮窗(⌘/Ctrl+K):列表取 workspaces.list 快照(宿主顺序),切换调 uiWorkspace.openWorkspace;无降级、不回退 DOM。 */
import type { Services, WorkspaceItemLike, WorkspaceRowLike } from './types.ts'

/** 取工作区候选行(宿主顺序,每次打开现取);服务缺席 / 缺 items → 空数组。 */
export function workspaceRows(services: Services): WorkspaceRowLike[] {
  const snapshot = services.workspaces?.list?.getSnapshot?.()
  const items = snapshot?.items
  if (!Array.isArray(items)) return []

  const current = services.sessions?.list?.getSnapshot?.()?.current
  const rows: WorkspaceRowLike[] = []
  for (const item of items) {
    if (item === null || item === undefined) continue
    const id = item.workspaceId
    if (typeof id !== 'string' || id === '') continue
    rows.push({
      workspaceId: id,
      label: workspaceLabel(item),
      detail: typeof item.path === 'string' ? item.path : '',
      sessionCount: item.sessionIds?.length ?? 0,
      current: current !== undefined && current !== '' && (item.sessionIds?.includes(current) ?? false),
    })
  }
  // 次行与主标签重复时置空
  for (const row of rows) {
    if (row.detail === row.label) row.detail = ''
  }
  return rows
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
