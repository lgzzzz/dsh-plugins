/** 会话可见性与顺序的唯一权威(侧栏顺序与近期对话浮窗共用);浮窗传 keepBlank=false,连当前空白会话也裁掉。 */
import type { SessionSummaryLike } from './types.ts'

/** 顶层行可见性(复刻上游):子代理、归档、非当前 blank 行都不渲染。 */
export function sessionRowVisible(
  summary: SessionSummaryLike,
  current: string | undefined,
  archived: ReadonlySet<string>,
): boolean {
  return summary.origin !== 'subagent' && !archived.has(summary.id) && (!summary.blank || summary.id === current)
}

/** 行可见性 + 空白会话策略:keepBlank=false 时连当前空白行也剔除。 */
export function sessionVisible(
  summary: SessionSummaryLike,
  current: string | undefined,
  archived: ReadonlySet<string>,
  keepBlank = true,
): boolean {
  if (!sessionRowVisible(summary, current, archived)) return false
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

/** 按最近更新排序 id;缺摘要的排到最后且保持原相对顺序(不修改入参)。 */
export function recencyOrder(
  ids: readonly string[],
  byId: Readonly<Record<string, SessionSummaryLike>>,
): string[] {
  return ids
    .map((id, index) => ({ id, index }))
    .sort((a, b) => compareRecency(a.id, b.id, byId) || a.index - b.index)
    .map((entry) => entry.id)
}
