/**
 * 会话浮层的纯投影层:把上游会话目录投影成「左侧栏筛选条件为 单列表 / 最近更新 / 隐藏已归档」
 * 时的那一份顺序。
 *
 * 为什么不能直接照抄 `sessions.list` 的 `ids`:它是宿主的目录顺序(新建在前、含已归档与
 * subagent 子会话),左侧栏显示的却是另一套派生结果 ——
 *
 *   - **单列表**(`groupBy: 'flat'`):成员 = 目录里所有普通会话(排除 subagent 子会话;
 *     空白会话只保留当前主视图那一个);
 *   - **最近更新**(`orderBy: 'updated'`):成员按 `updatedAt` 倒序、同刻按 id 升序;当前
 *     空白会话提到最前;
 *   - **隐藏已归档**(`archivedFilter: 'default'`):渲染前把归档会话滤掉;
 *   - 渲染时置顶会话排在普通会话之前(它们保持上面的相对顺序)。
 *
 * 这一层的规则与上游 `ui-workspace` 的 `sessionMemberIds` / `orderByRecency` /
 * `pinCurrentBlank` / `deriveFlat` / `sectionMembers` 一一对应,而且都写成纯函数,测试可以
 * 直接喂快照断言顺序。
 *
 * 本文件不 import React、不碰 DOM、也不读任何服务:与 `palette.ts` 一样只做规则。
 */
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceSnapshot, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { PaletteRow } from './palette.ts'

/**
 * 会话浮层里的一行(就是 {@link PaletteRow} 的形状)。
 *
 * 第二行是「工作区 · 相对时间」;`badges` 按 置顶 / 进行中 的顺序给出角标。
 */
export interface SessionPaletteEntry extends PaletteRow {
  readonly sessionId: SessionId
  readonly updatedAt: number
  /** 所属工作区的显示名;不属于任何工作区时是 cwd 的末段(可能为空)。 */
  readonly workspace: string
}

/**
 * 会话行的取舍依据:置顶集合与归档集合。
 *
 * 直接取工作区快照上的两个集合;本地只留名字,不再重复字段定义。
 */
export type SessionRowState = Pick<WorkspaceSnapshot, 'archivedSessionIds' | 'pinnedSessionIds'>

/** 会话浮层的候选来源面:目录 + 工作区归属 + 置顶/归档集合。 */
export interface SessionCandidateSource {
  readonly sessions: SessionListState
  readonly workspaces: readonly WorkspaceView[]
  readonly rowState: SessionRowState
}

/** 左侧栏里空白会话的文案(与上游 `session.new` 一致)。 */
export const BLANK_SESSION_TITLE = '新会话'

/** 左侧栏里没有标题的会话文案(与上游 `session.untitled` 一致)。 */
export const UNTITLED_SESSION_TITLE = '未命名'

/** 置顶角标(左侧栏同一行的置顶标记)。 */
export const PINNED_BADGE = '置顶'

/** 进行中角标(左侧栏那一颗状态点)。 */
export const RUNNING_BADGE = '进行中'

/**
 * 主视图正在显示的会话 id。
 *
 * 上游用 `retainedBy.mainView > 0` 判定;这里只看第一个满足条件的 id(与左侧栏一致)。
 * @param list - 会话目录快照。
 * @returns 主视图会话 id;没有时 undefined。
 */
export function mainViewSessionId(list: SessionListState): SessionId | undefined {
  for (const id of list.ids) {
    const summary = list.byId[id]
    if (summary !== undefined && (summary.retainedBy?.mainView ?? 0) > 0) return summary.id
  }
  return undefined
}

/**
 * 一个会话在左侧栏一行里显示的名字。
 * @param session - 会话摘要。
 * @returns 「新会话」/「未命名」或持久标题。
 */
export function sessionDisplayTitle(session: SessionSummary): string {
  if (session.blank === true) return BLANK_SESSION_TITLE
  const title = session.title?.trim() ?? ''
  return title === '' ? UNTITLED_SESSION_TITLE : title
}

/**
 * 目录里的「单列表」成员:普通会话全部保留,subagent 子会话排除,空白会话只留当前那个。
 * @param list - 会话目录快照。
 * @param current - 主视图会话 id;空白会话只保留它。
 * @returns 成员摘要(按目录顺序)。
 */
export function flatMembers(list: SessionListState, current: SessionId | undefined): SessionSummary[] {
  const members: SessionSummary[] = []
  for (const id of list.ids) {
    const summary = list.byId[id]
    if (summary === undefined) continue
    if (summary.origin === 'subagent') continue
    if (summary.blank === true && summary.id !== current) continue
    members.push(summary)
  }
  return members
}

/**
 * 「最近更新」:按 `updatedAt` 倒序,同刻按 id 升序(与上游一致,保证顺序确定)。
 * @param members - 参与排序的成员。
 * @returns 排好序的新数组(不改入参)。
 */
export function orderByRecency(members: readonly SessionSummary[]): SessionSummary[] {
  return [...members].sort((a, b) => {
    if (a.updatedAt !== b.updatedAt) return b.updatedAt - a.updatedAt
    return a.id < b.id ? -1 : 1
  })
}

/**
 * 把当前空白会话提到最前(它已经在成员里时;不在就原样返回)。
 * @param ordered - 已按「最近更新」排好的成员。
 * @param current - 主视图会话 id。
 * @returns 新数组。
 */
export function pinCurrentBlank(ordered: readonly SessionSummary[], current: SessionId | undefined): SessionSummary[] {
  if (current === undefined) return [...ordered]
  const picked = ordered.find((session) => session.id === current && session.blank === true)
  if (picked === undefined) return [...ordered]
  return [picked, ...ordered.filter((session) => session.id !== current)]
}

/**
 * 渲染顺序:空白会话在前,其次置顶且未归档的会话,最后是其余会话;
 * 三个分区内部都保持传入顺序(与上游 `sectionMembers` 一致)。
 * @param members - 已按选中顺序排好、且已滤掉归档会话的成员。
 * @param pinned - 置顶集合。
 * @param archived - 归档集合(置顶的归档会话不算置顶行)。
 * @returns 渲染顺序的成员。
 */
export function sectionMembers(
  members: readonly SessionSummary[],
  pinned: ReadonlySet<string>,
  archived: ReadonlySet<string>,
): SessionSummary[] {
  const blanks: SessionSummary[] = []
  const leading: SessionSummary[] = []
  const rest: SessionSummary[] = []
  for (const member of members) {
    if (member.blank === true) blanks.push(member)
    else if (!archived.has(member.id) && pinned.has(member.id)) leading.push(member)
    else rest.push(member)
  }
  return [...blanks, ...leading, ...rest]
}

/**
 * 工作区归属标签:会话所属工作区的显示名;不属于任何工作区时退回 cwd 的末段。
 * @param workspaces - 工作区(带 `sessionIds`)。
 * @param session - 会话摘要。
 * @returns 显示名,可能为空串(既无归属又无 cwd)。
 */
export function workspaceLabel(
  workspaces: readonly WorkspaceView[],
  session: SessionSummary,
): string {
  const owner = workspaces.find((workspace) => workspace.sessionIds?.includes(session.id) === true)
  if (owner !== undefined) return owner.title
  return pathBasename(session.cwd)
}

/**
 * 路径末段(POSIX 与 Windows 分隔符都认);没有末段时返回原值。
 * @param path - 目录路径。
 * @returns 末段。
 */
export function pathBasename(path: string | undefined): string {
  if (path === undefined || path === '') return ''
  const trimmed = path.replace(/[/\\]+$/, '')
  const separator = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return trimmed.slice(separator + 1)
}

/**
 * 相对时间文案(左侧栏会话行右侧那一列的中文口径)。
 *
 * 只用于会话行的第二行提示,不参与排序;`updatedAt` 不是有限数时返回空串。
 * @param updatedAt - 最近更新时间(毫秒)。
 * @param now - 当前时间(毫秒)。
 * @returns 「刚刚」「3分钟前」之类的文案。
 */
export function relativeTimeLabel(updatedAt: number, now: number): string {
  if (!Number.isFinite(updatedAt) || !Number.isFinite(now)) return ''
  const distance = now - updatedAt
  if (distance < 60_000) return '刚刚'
  const minutes = Math.floor(distance / 60_000)
  if (minutes < 60) return `${minutes}分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}小时前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}天前`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}个月前`
  return `${Math.floor(months / 12)}年前`
}

/**
 * 投影会话浮层的候选:顺序与左侧栏「单列表 + 最近更新 + 隐藏已归档」一致。
 *
 * 以 `ui-workspace` 的派生链为准:成员 → 最近更新排序 → 当前空白会话提前 → 滤掉归档 →
 * 空白 / 置顶 / 其余分三段渲染。
 * @param source - 会话目录、工作区归属与置顶/归档集合。
 * @returns 浮层候选行(全量、不截断)。
 */
export function sessionPaletteEntries(source: SessionCandidateSource, now: number = Date.now()): SessionPaletteEntry[] {
  const { sessions, workspaces, rowState } = source
  const archived = new Set(rowState.archivedSessionIds ?? [])
  const pinned = new Set(rowState.pinnedSessionIds ?? [])
  const current = mainViewSessionId(sessions)
  const ordered = pinCurrentBlank(orderByRecency(flatMembers(sessions, current)), current)
  // 「隐藏已归档」只影响渲染:归档会话在排序里仍占位,但不会出现在候选里。
  const visible = ordered.filter((session) => !archived.has(session.id))
  return sectionMembers(visible, pinned, archived).map((session) => {
    const label = workspaceLabel(workspaces, session)
    const time = relativeTimeLabel(session.updatedAt, now)
    const pinnedRow = pinned.has(session.id) && !archived.has(session.id)
    const badges: string[] = []
    if (pinnedRow) badges.push(PINNED_BADGE)
    if (session.running === true) badges.push(RUNNING_BADGE)
    return {
      key: session.id,
      sessionId: session.id,
      title: sessionDisplayTitle(session),
      workspace: label,
      updatedAt: session.updatedAt,
      subtitle: label === '' ? time : time === '' ? label : `${label} · ${time}`,
      ...session.id === current ? { current: true } : {},
      ...badges.length > 0 ? { badges } : {},
    }
  })
}
