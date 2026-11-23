/**
 * 上级链的纯计算：从 Client 的会话列表与投影里找出当前会话的父会话，再逐级向上。
 *
 * 找父会话的三种依据按可信度依次尝试，与上游会话标题栏的血缘切换器一致：
 *   1. 当前会话自己的 `subagent` 地址——从子会话打开时由会话历史带上，最直接；
 *   2. 任一已持有会话的 `subagentCatalog` 投影里点名本会话——父会话的目录事件；
 *   3. Host 会话列表行上的 `origin: 'subagent'` 与 `parentId`——页面重开后只剩这一条。
 * 三条都不成立就停：宁可不显示这一栏，也不猜一个会跳错的会话。
 */
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SubagentAddress } from '@deepseek-ai/dsh-subagent/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** 向上最多追这么多级：真实嵌套远小于它，只是给脏数据里的环一个出口。 */
export const MAX_ANCESTORS = 16

/** 「主智能体」一栏里的一行。 */
export interface AncestorRow {
  /** 这一节上级会话的 id；点这一行就切到它。 */
  readonly sessionId: SessionId
  /** 会话标题；会话列表里没有这一行时退回会话 id。 */
  readonly title: string
  /** 该会话此刻是否在运行；拿不到它的列表行时为 false。 */
  readonly running: boolean
  /** 是否是链首，也就是最顶层的主智能体。 */
  readonly root: boolean
}

/** 计算上级链所需的全部输入。 */
export interface LineageInput {
  /** 当前会话。 */
  readonly sessionId: SessionId
  /** 当前会话的 `subagent` 地址（不是子会话时为空）。 */
  readonly address: SubagentAddress | null | undefined
  /** 会话列表行，按 id 索引。 */
  readonly summaries: SessionListState['byId']
  /** 已持有会话的投影快照，按父会话 id 索引。 */
  readonly projections: SessionListState['projectionsBySession']
}

/**
 * 在已持有的投影里找点名了该会话的父会话：父会话一旦记下 `subagent/catalog`，
 * 它的 `subagentCatalog` 投影里就有这一行。
 *
 * @param projections - 已持有会话的投影快照。
 * @param sessionId - 要找父会话的子会话。
 * @returns 父会话 id，或 undefined。
 */
function catalogParentOf(
  projections: LineageInput['projections'],
  sessionId: SessionId,
): SessionId | undefined {
  for (const [parentId, snapshot] of Object.entries(projections)) {
    if (snapshot.values.subagentCatalog?.some(entry => entry.id === sessionId) === true) {
      return parentId as SessionId
    }
  }
  return undefined
}

/**
 * 找一个会话的直接父会话。
 *
 * @param sessionId - 要向上看的会话。
 * @param address - 仅当这个会话自己带地址时传入；逐级向上时传 undefined。
 * @param summaries - 会话列表行。
 * @param projections - 已持有会话的投影快照。
 * @returns 父会话 id，或 undefined（根会话、或本机拿不到任何依据）。
 */
export function parentOf(
  sessionId: SessionId,
  address: SubagentAddress | null | undefined,
  summaries: LineageInput['summaries'],
  projections: LineageInput['projections'],
): SessionId | undefined {
  // 地址只认子会话对得上的那一个：页面里换过会话时它可能还是别的会话的。
  if (address !== null && address !== undefined && address.childSessionId === sessionId) {
    return address.parentSessionId
  }
  const fromCatalog = catalogParentOf(projections, sessionId)
  if (fromCatalog !== undefined) return fromCatalog
  const summary: SessionSummary | undefined = summaries[sessionId]
  return summary?.origin === 'subagent' ? summary.parentId : undefined
}

/**
 * 从当前会话向上走完整条上级链，按从上到下的顺序交出行：链首是最顶层的主智能体，
 * 末行是直接上级。根会话（没有任何上级）交出空数组。
 *
 * @param input - 当前会话、它的地址、会话列表行与投影快照。
 * @returns 上级行，从上到下；没有上级时为空数组。
 */
export function ancestorRows(input: LineageInput): readonly AncestorRow[] {
  const seen = new Set<SessionId>([input.sessionId])
  const chain: SessionId[] = []
  let current = input.sessionId
  let address: SubagentAddress | null | undefined = input.address
  while (chain.length < MAX_ANCESTORS) {
    const parent = parentOf(current, address, input.summaries, input.projections)
    // 地址只属于输入的会话，往上走的每一级都从列表 / 投影重新认。
    address = undefined
    if (parent === undefined || seen.has(parent)) break
    chain.push(parent)
    seen.add(parent)
    current = parent
  }
  chain.reverse()
  return chain.map((sessionId, index) => {
    const summary = input.summaries[sessionId]
    return {
      sessionId,
      title: summary?.displayTitle ?? sessionId,
      running: summary?.running === true,
      root: index === 0,
    }
  })
}
