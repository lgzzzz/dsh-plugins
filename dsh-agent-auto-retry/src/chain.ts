/**
 * 重试链的持久计数：一条链由 `(turn, step, provider, policyKey)` 唯一标识。
 *
 * 计数必须来自会话日志而不是进程内变量：一次崩溃或 resume 之后，日志里已经排定的重试
 * 仍然有效，编号必须接着写，否则会话格式校验器会把这条链判成「跳号」并拒绝整份日志
 * （`llm/retry skips its policy attempt sequence`）。这里用一个宿主侧投影单元把日志折成
 * 「链 → 最近一次排定的重试」，与上游执行器的做法一致，只是键不同、折叠范围只限本插件的
 * 链。
 *
 * 事件按结构读取：`llm/retry` 由 `@deepseek-ai/dsh-llm-retry` 声明，本插件不安装它，
 * 所以不引入它的类型；形状对不上时宁可不判定（返回原状态），也不误记一条链。
 *
 * @module dsh-agent-auto-retry/chain
 */
import { z } from 'zod'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

/** 一条链上最近一次已排定的重试。 */
export interface ChainAttempt {
  /** 该链已排定到第几次重试（从 1 开始）。 */
  readonly retry: number
  /** 该链的稳定 id；同一条链的所有重试共用它。 */
  readonly retryId: string
}

/** 投影状态：链键 → 最近一次排定的重试。 */
export type ChainState = Readonly<Record<string, ChainAttempt>>

/** 空状态：没有排定过任何重试。 */
export const EMPTY_CHAIN_STATE: ChainState = Object.freeze({})

/** 校验持久化状态；形状不符的旧行会被丢弃并重新折叠日志。 */
export const chainStateSchema = z.record(
  z.string(),
  z.object({ retry: z.number().int().nonnegative(), retryId: z.string() }),
)

/** 投影单元键；带本插件的名字，与上游执行器的键互不覆盖。 */
export const CHAIN_PROJECTION_KEY = 'dshAgentAutoRetryChain'

/**
 * 一条重试链的键。
 * @param provider - 失败请求所属的提供方路由。
 * @param policyKey - 本插件的策略指纹。
 * @returns 可作对象键的稳定字符串。
 */
export function chainKey(provider: string, policyKey: string): string {
  return JSON.stringify([provider, policyKey])
}

/**
 * 折叠一个会话事件。
 *
 * 只认本插件的链（`policyKey` 相同）与其坐标（事件自带的 `turn` / `step`）：提供方自己的
 * 重试链、别的 step 留下的链都不会影响这里的预算。`step/start` 与 `turn/end` 关掉此前所有链，
 * 因此每个 step 都从一份新预算开始。
 * @param state - 此前所有事件折出的状态。
 * @param event - 下一条已提交的会话事件。
 * @param policyKey - 本插件的策略指纹。
 * @returns 新状态；与事件无关时返回同一引用。
 */
export function foldChain(state: ChainState, event: SessionEvent, policyKey: string): ChainState {
  const raw = event as unknown as { type: string; data?: unknown }
  if (raw.type === 'step/start' || raw.type === 'turn/end') {
    return Object.keys(state).length === 0 ? state : EMPTY_CHAIN_STATE
  }
  if (raw.type !== 'llm/retry') return state
  const scheduled = scheduledOf(raw.data, policyKey)
  if (scheduled === undefined) return state
  const key = chainKey(scheduled.provider, policyKey)
  const entry = state[key]
  if (entry?.retry === scheduled.retry && entry.retryId === scheduled.retryId) return state
  return { ...state, [key]: { retry: scheduled.retry, retryId: scheduled.retryId } }
}

/**
 * 读某条链已经排定到的位置。
 * @param state - 折叠后的状态。
 * @param provider - 提供方路由。
 * @param policyKey - 本插件的策略指纹。
 * @returns 最近一次排定的重试；该链还没排定过时为 undefined。
 */
export function previousAttempt(
  state: ChainState,
  provider: string,
  policyKey: string,
): ChainAttempt | undefined {
  return state[chainKey(provider, policyKey)]
}

/**
 * 从任意事件载荷里读出本插件关心的 `llm/retry` 字段。
 * @param data - 事件载荷（来自日志，可能是旧版本写下的）。
 * @param policyKey - 本插件的策略指纹；不是本插件的链时返回 undefined。
 * @returns 提供方与重试序号；字段不完整或不属于本插件时为 undefined。
 */
function scheduledOf(
  data: unknown,
  policyKey: string,
): { readonly provider: string; readonly retry: number; readonly retryId: string } | undefined {
  if (typeof data !== 'object' || data === null) return undefined
  const payload = data as Record<string, unknown>
  const { provider, retry, retryId, policyKey: key } = payload
  if (key !== policyKey) return undefined
  if (typeof provider !== 'string' || provider.length === 0) return undefined
  if (typeof retryId !== 'string' || retryId.length === 0) return undefined
  if (typeof retry !== 'number' || !Number.isSafeInteger(retry) || retry < 1) return undefined
  return { provider, retry, retryId }
}
