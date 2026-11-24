/**
 * 「这个会话是子智能体吗」的纯判定：只读会话快照上的 `subagent` 地址与会话列表行的
 * `origin`，两条依据任一成立就算。
 *
 * 两条都要：从子会话自己打开时快照带地址；页面重开后、或从侧栏会话列表直接打开子会话时
 * 只有列表行还记得 `origin: 'subagent'`。少一条就会在一半的打开路径上把子会话当成普通会话，
 * 于是该隐藏的 forge 连接行照旧出现。
 */
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SubagentAddress } from '@deepseek-ai/dsh-subagent/client'

/** 判定所需的三个事实。 */
export interface SubagentFacts {
  /** 当前会话身份；地址属于别的会话（页面里换过会话）时不能作数。 */
  readonly sessionId: SessionId
  /** 当前会话自己的 `subagent` 地址，不是子会话时为 null。 */
  readonly address: SubagentAddress | null | undefined
  /** 会话列表里这一行的 `origin`；列表还没到、或这一行不标时是 undefined。 */
  readonly origin: 'subagent' | undefined
}

/**
 * 判定一个会话是否是子智能体会话。
 *
 * @param facts - 会话身份、它的地址与会话列表行的 `origin`。
 * @returns 是子智能体会话时为 true。
 */
export function isSubagentSession(facts: SubagentFacts): boolean {
  const { sessionId, address, origin } = facts
  // 地址只在它点名了本会话时作数：换过会话后快照里的地址可能还是上一个子会话的。
  if (address !== null && address !== undefined && address.childSessionId === sessionId) return true
  return origin === 'subagent'
}
