/**
 * dsh-kbd-hotkeys — 会话可见性、顺序与按键轴的**唯一**权威来源。
 *
 * 侧栏(workspace 浏览器)派生一行会话要回答两件事:哪些会话**可见**、组内按什么
 * **顺序**排。两条规则都由本模块给出,调用方各取所需:
 *
 * - `sessionRowVisible`  逐字复刻上游 `sessionVisible` 的**行**判定:子代理行
 *   (`origin === 'subagent'`)、归档行、非当前 blank 行都不渲染为顶层行;
 * - `sessionVisible`  在行判定之上再加一条**本插件的产品选择**:最近会话浮窗把
 *   `keepBlank` 置 false,连**当前**空白会话也一并裁掉。空白会话是「新会话」的
 *   占位行、不是对话,列进「近期对话」只会得到一个空壳落点(侧栏顺序仍按上游
 *   语义保留当前空白行,`keepBlank` 缺省即 true);
 * - `compareRecency` / `recencyOrder`  逐字复刻上游 `orderByRecency`:最近更新
 *   在前、id 升序决胜(确定性,连续按键时轴不抖动)。
 *
 * 这样侧栏顺序(sidebar-order.ts)与最近会话浮窗(recent-sessions.ts)共用同一份
 * 可见性 / 排序语义,不会各写一套而漂移。
 */
import type { SessionSummaryLike } from './types.ts'

/**
 * 一行的可见性判定,逐字复刻上游 workspace 浏览器 `sessionVisible` 的行规则:
 * 子代理行(`origin === 'subagent'`)、归档行、非当前 blank 行均不渲染为顶层行。
 */
export function sessionRowVisible(
  summary: SessionSummaryLike,
  current: string | undefined,
  archived: ReadonlySet<string>,
): boolean {
  return summary.origin !== 'subagent' && !archived.has(summary.id) && (!summary.blank || summary.id === current)
}

/**
 * 会话可见性判定(行规则 + 空白会话策略)。
 *
 * @param summary - 该会话的列表摘要。
 * @param current - 列表快照的当前会话 id。
 * @param archived - 归档会话 id 集合。
 * @param keepBlank - 是否保留**当前**空白会话(侧栏顺序要保留;最近会话浮窗不要)。
 */
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

/** 最近更新在前,id 升序决胜(上游 byRecency,确定性保证连续按键轴稳定)。 */
export function compareRecency(a: string, b: string, byId: Readonly<Record<string, SessionSummaryLike>>): number {
  const aUpdated = byId[a]?.updatedAt ?? Number.NEGATIVE_INFINITY
  const bUpdated = byId[b]?.updatedAt ?? Number.NEGATIVE_INFINITY
  if (bUpdated !== aUpdated) return bUpdated - aUpdated
  return a < b ? -1 : 1
}

/**
 * 按最近更新排序一串会话 id(`orderBy === 'updated'` 时上游的默认顺序;
 * 视图 store 的 `sessionOrderByAccount` 在切回 updated 时会被清空,故它就是
 * 默认轴)。
 *
 * @param ids - 待排序的会话 id。
 * @param byId - 会话摘要表(缺摘要的 id 排到最后,保持原有相对顺序)。
 * @returns 新的 id 数组(不修改入参)。
 */
export function recencyOrder(
  ids: readonly string[],
  byId: Readonly<Record<string, SessionSummaryLike>>,
): string[] {
  return ids
    .map((id, index) => ({ id, index }))
    .sort((a, b) => compareRecency(a.id, b.id, byId) || a.index - b.index)
    .map((entry) => entry.id)
}
