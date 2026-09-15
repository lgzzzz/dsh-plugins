/**
 * dsh-kbd-hotkeys — 工作区浮窗(⌘/Ctrl+K)的数据面与切换动作。
 *
 * 两条服务级路径,均不触碰 DOM(浮窗本身的 DOM 在 overlay.ts):
 *
 * 1. **列表** = `workspaces.list.getSnapshot().items`,按宿主顺序原样展开——
 *    与侧栏 workspace 浏览器的工作区分组顺序**同源**(dsh-client-ui-workspace 的
 *    `groupByWorkspace` 逐项遍历同一份 `items`,不重排)。行为:
 *    - 主标签 = 工作区 `title`;title 为空时回退路径末段(复刻上游
 *      `workspaceTitleOf` 的「最后一个非空路径段」,同时接受 `/` 与 `\`),再回退
 *      原路径;
 *    - 次行 = 工作区规范路径(与主标签相同时省略);
 *    - `当前` 标记 = 当前会话(`sessions.list.current`)在该工作区的
 *      `sessionIds` 名下——与侧栏高亮当前会话所属分组同一判据;
 *    - 会话数 = `sessionIds.length`(宿主账号顺序里的全部会话,不做可见性裁剪:
 *      浮窗列的是**工作区**,不是会话行)。
 *
 * 2. **切换** = `uiWorkspace.openWorkspace(workspaceId)`——「连接工作区」的规范
 *    路径(与侧栏工作区分组上的「+」新建会话、首屏工作区导航同一条代码路径):
 *    复用该工作区已有的空白会话,没有就 `sessions.create({ workspaceId })` 新建
 *    一个再打开,调用方拿到的是该工作区的可输入会话。异步拒绝与同步抛错一律
 *    吞掉(未知 workspaceId / 无挂载会话面会抛),**不回退 DOM 点击侧栏分组**。
 *
 * **无降级**:workspaces 服务缺席 / 快照缺 `items` → 空列表(浮窗显示空态);
 * uiWorkspace 缺席或动词缺失 → 切换返回 false(不吞键的真源在 overlay.ts:
 * 浮窗已开时按键仍由浮窗消费,这里只表示「没有切成功」)。
 */
import type { Services, WorkspaceItemLike, WorkspaceRowLike } from './types.ts'

/**
 * 读取工作区浮窗的候选行(按宿主顺序;每次打开浮窗时重新取数)。
 *
 * @param services - 已解析服务集合。
 * @returns 工作区行;`workspaces` 服务缺席 / 快照缺 `items` 时返回空数组(无降级)。
 */
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
  // label 与 detail 相同(工作区无 title、路径本身即末段)时次行冗余,置空
  for (const row of rows) {
    if (row.detail === row.label) row.detail = ''
  }
  return rows
}

/**
 * 切换工作区:调用公开的 `uiWorkspace.openWorkspace(workspaceId)`。
 *
 * @returns 是否已发出导航调用(服务缺席 / 动词缺失 / workspaceId 非法时为 false)。
 */
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

/** 工作区行主标签:title → 路径末段(上游 workspaceTitleOf)→ 原路径。 */
function workspaceLabel(item: WorkspaceItemLike): string {
  const title = typeof item.title === 'string' ? item.title.trim() : ''
  if (title !== '') return title
  const path = typeof item.path === 'string' ? item.path : ''
  const base = pathBasename(path)
  return base !== '' ? base : path
}

/**
 * 路径末段,逐字复刻上游 `workspaceTitleOf`:先去掉尾部所有分隔符,
 * 再取最后一个 `/` 或 `\` 之后的部分(纯分隔符路径得到空串)。
 * 工作区浮窗与最近会话浮窗的工作区分组标题同用这一个实现。
 */
export function pathBasename(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, '')
  const separator = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return trimmed.slice(separator + 1)
}
