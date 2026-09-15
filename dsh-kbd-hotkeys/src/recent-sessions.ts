/**
 * dsh-kbd-hotkeys — 近期对话浮窗(⌘/Ctrl+I)的数据面与打开落点。
 *
 * 两条服务级路径,均不触碰 DOM(浮窗本身的 DOM 在 overlay.ts):
 *
 * 1. **列表** = `sessions.list` 快照 + `workspaces.list` 快照,按**工作区分组**:
 *    - 分组与组序:workspaces 快照的宿主顺序(与侧栏工作区分组同源);
 *      不属于任何工作区的会话落在末尾的无归属桶(`workspaceId === ''`);
 *    - 组标题:工作区 `title` → 路径末段(逐字复刻上游 `workspaceTitleOf`,
 *      与工作区浮窗同一实现);无归属桶标题为空串(渲染端省略标题行);
 *    - 行:会话 `displayTitle`(上游投影:durable 标题 → 目录末段 → 会话 id,
 *      恒非空)+ 运行中 / 完成 / 待回应标记;次行 = 会话 `cwd`(与主标题相同时省略);
 *    - 组内顺序:最近更新在前(`orderBy === 'updated'` 的默认轴;上游切回
 *      `updated` 时会清空 `sessionOrderByAccount`,故这就是默认顺序),
 *      以 id 升序决胜,保证连续按键时轴不抖动;
 *    - 可见性:session-order.ts 的 `sessionVisible`,但 **`keepBlank = false`**
 *      ——空白会话(`blank`)不是「对话」,列进来只会得到一个空壳落点(当前
 *      空白会话同样不列);
 *    - 条数:**全局口径**最多 `RECENT_LIMIT`(10)行 —— 先把全部可见会话按
 *      最近更新排序取前 10 个,再按工作区分组渲染(所以列表恒不超过 10 行,
 *      工作区一多也不会撑爆浮窗;某个工作区可能因此整组不出现);
 *      当前会话必在列表里:它若不在前 10 名(例如刚切回一个很久没动的旧
 *      会话),就顶掉第 10 名,保证「初始光标落在当前会话」总有落点。
 *
 * 2. **打开** = `uiWorkspace.openSession(sessionId)`(侧栏点会话行、搜索结果行用的
 *    **同一条**公开服务调用;其实现 = `sessions.open(sessionId)` + `layout.
 *    selectPanel(null)`,即顺带把占着主区的全局主面板收掉、回到对话视图)。
 *    uiWorkspace 缺席 / 无 `openSession` 时回退 `sessions.open(sessionId)`
 *    (上游契约:未知 id 抛错,调用方兜住 → no-op)。两个动词都必须以**方法**
 *    形式调用——它们都是上游类实例的原型方法,摘下来会丢 `this` 并抛错。
 *
 * **无降级**:sessions 服务缺席 / 快照缺 `ids`/`byId` → 空列表
 * (浮窗显示空态);workspaces 服务缺席或快照缺 `items` → 全部会话落入无归属桶
 * (仍是可用的列表,不假装没有会话)。任何一环都不回退 DOM 查询。
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

/** 无归属会话桶的组 key(上游 UNGROUPED_KEY)。 */
const UNGROUPED_KEY = ''

/** 无行时的空态提示。 */
const EMPTY_NOTICE = '当前没有可打开的对话'

/**
 * 浮窗最多列出的会话数(**全局**口径:所有可见会话里取最近更新的前 10 个,
 * 再按工作区分组;不是「每个工作区各 10 个」)。
 */
const RECENT_LIMIT = 10

/**
 * 读取「近期对话」浮窗的渲染数据(每次打开浮窗时重新取数)。
 *
 * @param services - 已解析服务集合。
 * @returns 分组 + 键盘轴 + 初始高亮;无可用会话时 `rows` 为空并带 `notice`。
 */
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

  // 无归属会话(不属于任何工作区,或快照缺 items):末尾单独一组。
  const stray = ids.filter((id) => !accounted.has(id) && visible(id))
  if (stray.length > 0) {
    buckets.push({ workspaceId: UNGROUPED_KEY, label: '', members: stray })
    all.push(...stray)
  }

  // 全局口径裁剪:所有可见会话按最近更新排序,只留前 RECENT_LIMIT 个。
  const order = recencyOrder(all, byId)
  const kept = new Set(order.slice(0, RECENT_LIMIT))
  // 当前会话必在列表里:不在前 10 名(刚切回一个很久没动的旧会话)时顶掉第
  // 10 名——「初始光标落在当前正在交互的会话」需要一个确定的落点,而不是被
  // 条数上限裁掉后悄悄退回首行。
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

  // 仍按工作区分组渲染:组序 = 宿主顺序,组内 = 最近更新在前;整组被裁掉的
  // 工作区不出现(不留空标题)。
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

/**
 * 打开选中的会话:优先走上游 `uiWorkspace.openSession(sessionId)`,回退
 * `sessions.open(sessionId)`。
 *
 * 为什么优先 uiWorkspace:侧栏点会话行(工作区浏览器 / 搜索结果行)用的就是
 * `uiWorkspace.openSession`,其实现逐字为 `sessions.open(sessionId)` **加**
 * `layout.selectPanel(null)`——后者把一个占着主区的全局主面板(设置等)收掉、
 * 回到对话视图。只调 `sessions.open` 时当前会话确实换了,但若此时有主面板占着
 * 主区,画面不会切回对话,看起来就是「按 Enter 没反应」。
 *
 * **必须以方法形式调用**:两个动词都是上游类实例的原型方法(`sessions.open`
 * 内部读 `this.manager`、`uiWorkspace.openSession` 读 `this.sessions` /
 * `this.ctx.layout`),把方法摘下来(`const open = …; open(id)`)会丢 `this`
 * 并抛 TypeError——曾因此让浮窗的 Enter 静默变成 no-op。
 *
 * @returns 是否已发出打开调用(服务缺席 / 动词缺失 / id 非法 / 抛错时为 false)。
 */
export function openRecentSession(services: Services, sessionId: string): boolean {
  if (typeof sessionId !== 'string' || sessionId === '') return false
  const uiWorkspace = services.uiWorkspace
  const openSession = uiWorkspace?.openSession
  if (uiWorkspace !== null && uiWorkspace !== undefined && typeof openSession === 'function') {
    try {
      // 与侧栏点会话行逐字同一条路径(含 layout.selectPanel(null))。
      openSession.call(uiWorkspace, sessionId)
      return true
    } catch {
      // 未知 id 会抛;掉到下面的 sessions.open 再兜一次(同样会抛 → false)。
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

/** 空态(无可用会话)。 */
function emptyView(): RecentSessionsViewLike {
  return { groups: [], rows: [], initialIndex: 0, notice: EMPTY_NOTICE }
}

/** 初始高亮:当前会话所在行(它必在列表里,见 `recentSessionsView` 的强制纳入);不在列表里 → 首行。 */
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

/** 行主标签:上游投影的 `displayTitle`,缺失时回退会话 id(保证恒非空)。 */
function titleOf(summary: SessionSummaryLike | undefined, id: string): string {
  const display = typeof summary?.displayTitle === 'string' ? summary.displayTitle.trim() : ''
  if (display !== '') return display
  const title = typeof summary?.title === 'string' ? summary.title.trim() : ''
  return title !== '' ? title : id
}

/** 组标题:工作区 title → 路径末段(上游 workspaceTitleOf);两者都空则为空串。 */
function workspaceLabel(item: WorkspaceItemLike): string {
  const title = typeof item.title === 'string' ? item.title.trim() : ''
  if (title !== '') return title
  const path = typeof item.path === 'string' ? item.path : ''
  return pathBasename(path)
}

/**
 * 有待处理交互的会话 id 集合(公开面 `pendingInteractions.getSnapshot()`,
 * 私有字段 `pendingSnapshot` 仅作兼容回退;取不到即空集,不影响列表可用性)。
 */
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
