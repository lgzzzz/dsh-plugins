/**
 * 会话可见性与顺序的唯一权威(侧栏顺序与近期对话浮窗共用);浮窗传 keepBlank=false,连当前空白会话也裁掉。
 * 全量复刻上游 workspace 浏览器 0.1.7-alpha.1 的 sessionVisible / reconcileManualOrder / sectionMembers /
 * pinCurrentBlank;`archivedFilter` 由调用方选择:侧栏与工作区浮窗跟随侧栏视图筛选,
 * 近期对话浮窗恒传 default(归档会话一律打不开,列出即死行)。
 */
import type { RowStateLike, SessionSummaryLike } from './types.ts'

/** 归档筛选:default 隐藏归档 / show 一并显示 / only 仅显示归档(上游闭集)。 */
export type ArchivedFilter = 'default' | 'show' | 'only'

/** 视图值的宽松归一:只接受 'show' / 'only',其余(含缺席)按 default。 */
export function normalizeArchivedFilter(value: unknown): ArchivedFilter {
  return value === 'show' || value === 'only' ? value : 'default'
}

/**
 * 行可见性(复刻上游 sessionVisible 0.1.7-alpha.1):子代理不渲染;blank 行仅当前会话渲染;
 * 归档行按 archivedFilter 决定(default 隐藏 / show 显示 / only 仅归档)。
 */
export function sessionRowVisible(
  summary: SessionSummaryLike,
  current: string | undefined,
  archived: ReadonlySet<string>,
  archivedFilter: ArchivedFilter = 'default',
): boolean {
  if (summary.origin === 'subagent') return false
  if (summary.blank === true && summary.id !== current) return false
  if (archivedFilter === 'show') return true
  if (archivedFilter === 'only') return archived.has(summary.id)
  return !archived.has(summary.id)
}

/** 行可见性 + 空白会话策略:keepBlank=false 时连当前空白行也剔除(浮窗用)。 */
export function sessionVisible(
  summary: SessionSummaryLike,
  current: string | undefined,
  archived: ReadonlySet<string>,
  archivedFilter: ArchivedFilter = 'default',
  keepBlank = true,
): boolean {
  if (!sessionRowVisible(summary, current, archived, archivedFilter)) return false
  if (summary.blank === true && !keepBlank) return false
  return true
}

/** 最近更新在前、id 升序决胜(确定性,连续按键轴稳定)。 */
export function compareRecency(a: string, b: string, byId: Readonly<Record<string, SessionSummaryLike>>): number {
  const aUpdated = byId[a]?.updatedAt ?? Number.NEGATIVE_INFINITY
  const bUpdated = byId[b]?.updatedAt ?? Number.NEGATIVE_INFINITY
  if (bUpdated !== aUpdated) return bUpdated - aUpdated
  return a < b ? -1 : 1
}

/** 按最近更新排序 id;缺摘要成员**剔除**(与上游 orderByRecency 一致:摘要未到的成员不参与定序)。 */
export function recencyOrder(
  ids: readonly string[],
  byId: Readonly<Record<string, SessionSummaryLike>>,
): string[] {
  return ids
    .filter((id) => byId[id] !== undefined)
    .map((id, index) => ({ id, index }))
    .sort((a, b) => compareRecency(a.id, b.id, byId) || a.index - b.index)
    .map((entry) => entry.id)
}

/**
 * 对账(复刻上游 reconcileManualOrder 0.1.7-alpha.1):
 * 存档序保持相对位置 → 置顶(未归档且有摘要)前置 → 其余普通行按最近更新 → 归档行沉底(同理按最近更新);
 * 缺摘要成员(摘要未到)不参与定序,与上游 orderByRecency 一致;
 * 随后把「新增的普通 fork」插到其源会话之前(不改动其余相对顺序)。
 * rowState 缺席时等同「无置顶、无归档」。
 */
export function reconcileOrder(
  memberIds: readonly string[],
  savedOrder: readonly string[] | undefined,
  byId: Readonly<Record<string, SessionSummaryLike>>,
  rowState?: RowStateLike,
): string[] {
  const members = new Map(memberIds.map((id) => [id, id]))
  const included = new Set<string>()
  const ordered: string[] = []
  for (const key of savedOrder ?? []) {
    const id = members.get(key)
    if (id === undefined || included.has(key)) continue
    ordered.push(id)
    included.add(key)
  }

  const archived = new Set<string>(rowState?.archivedSessionIds ?? [])
  const pins: string[] = []
  for (const sessionId of rowState?.pinnedSessionIds ?? []) {
    const id = members.get(sessionId)
    if (id === undefined || included.has(id) || archived.has(id) || byId[id] === undefined) continue
    pins.push(id)
    included.add(id)
  }

  const ordinary: string[] = []
  const archives: string[] = []
  // 缺摘要成员剔除:上游把该步交给 orderByRecency,而保留它们会让 placeFork 的
  // `result.includes(parentId)` 误判为真、把可见 fork 重定位(与上游可观察偏离)。
  const rest = [...members.values()].filter((id) => !included.has(id) && byId[id] !== undefined)
  rest.sort((a, b) => compareRecency(a, b, byId))
  for (const id of rest) {
    if (archived.has(id)) archives.push(id)
    else ordinary.push(id)
  }

  const result = [...pins, ...ordered, ...ordinary, ...archives]
  const pending = new Set(ordinary)
  const placeFork = (id: string): void => {
    if (!pending.delete(id)) return
    const parentId = byId[id]?.parentId
    if (parentId === undefined || parentId === id || !result.includes(parentId)) return
    placeFork(parentId)
    result.splice(result.indexOf(id), 1)
    result.splice(result.indexOf(parentId), 0, id)
  }
  for (const id of [...ordinary].reverse()) placeFork(id)
  return result
}

/**
 * 分区(复刻上游 sectionMembers 0.1.7-alpha.1):blank 行在前 → 置顶且未归档行殿其后 → 其余;
 * 三段各自保持入参相对顺序(blank 行由调用方先行可见性过滤,通常只剩当前空白会话)。
 */
export function sectionMembers(
  members: readonly SessionSummaryLike[],
  pinned: ReadonlySet<string>,
  archived: ReadonlySet<string>,
): SessionSummaryLike[] {
  const placeholders: SessionSummaryLike[] = []
  const leading: SessionSummaryLike[] = []
  const rest: SessionSummaryLike[] = []
  for (const member of members) {
    if (member.blank === true) placeholders.push(member)
    else if (!archived.has(member.id) && pinned.has(member.id)) leading.push(member)
    else rest.push(member)
  }
  return [...placeholders, ...leading, ...rest]
}

/** 把选中的空白新会话顶到最前(上游 pinCurrentBlank);缺席则原样复制。 */
export function pinCurrentBlank(order: readonly string[], currentBlank: string | undefined): string[] {
  if (currentBlank === undefined) return [...order]
  return [currentBlank, ...order.filter((id) => id !== currentBlank)]
}
