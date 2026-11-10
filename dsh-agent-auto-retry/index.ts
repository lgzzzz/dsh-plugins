/**
 * 宿主半部：模型请求失败、且所有下游恢复策略都放弃之后，自动重试，不结束回合。
 *
 * 接线位置是 agent loop 的 `agent/request-error` waterfall（`@deepseek-ai/dsh-agent`
 * 声明的「一次失败请求是重试还是关闭」扩展点）。本插件在该 waterfall 里先 `next()` 把
 * 决定权交给下游——compaction 的上下文超限压缩、图片卸载这类恢复比盲目重打更有价值——
 * 下游返回 `{ kind: 'retry' }` 时照办；下游放弃（`undefined`）或抛错时才自己接手。
 *
 * 接手后写的是上游同形的两个事件：等待前先持久地追加 `llm/retry`（客户端据此显示
 * 「等待重试模型请求（n/m）· Xs」，会话格式校验器据此校验编号连续性），等待结束、
 * 下一次请求开始前追加 `llm/retry-started`（token 计量据此关闭上一次尝试的用量槽）。
 * 策略与判定见 `src/policy.ts`，链的编号与持久化见 `src/chain.ts`。
 *
 * 为什么不用 `@deepseek-ai/dsh-llm-retry`：那是「执行提供方 `retryPolicy`」的执行器，
 * 只在提供方注册了策略、且失败码落在该策略集合内时才重试；提供方配的是 `normal` 且
 * 预算耗尽（或没配策略）时，它就把失败原样交回、回合终止。本插件是补在它之后的策略层，
 * 不安装它、也不改它，两套链各用各的 `policyKey`，互不覆盖。
 *
 * 挂载与验证命令、触发条件与已知边界见 docs/dsh-agent-auto-retry.md。
 *
 * @module dsh-agent-auto-retry
 */
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, RequestErrorAction } from '@deepseek-ai/dsh-agent'
// 空类型导入：加载 `@deepseek-ai/dsh-agent` 对 cordis Events 的类型增强
// （`agent/request-error`），让下面 ctx.on 的回调参数有类型；不引入运行时导入。
import type {} from '@deepseek-ai/dsh-agent'
import type { ProjectionHandle } from '@deepseek-ai/dsh-session-projection'
import { CHAIN_PROJECTION_KEY, EMPTY_CHAIN_STATE, chainStateSchema, foldChain, previousAttempt } from './src/chain.ts'
import type { AutoRetryStartedEvent, AutoRetryScheduledEvent } from './src/events.ts'
import { isRetryable, normalizePolicy, planDelay, policyKeyOf } from './src/policy.ts'
import type { AutoRetryPolicy } from './src/policy.ts'

/** 插件标识（日志名，与包名一致）。 */
export const name = 'dsh-agent-auto-retry'

/** 依赖的宿主服务：重试编号要从会话投影里读，注册表就绪前不挂载。 */
export const inject = ['sessionProjections']

/** 插件卸载时中断进行中的重试等待，用于让 `await` 立即返回。 */
const DISPOSE_CAUSE = 'dsh-agent-auto-retry: 插件已卸载'

/** 「已经告警过」集合的上限：超出就清空，代价是极端长跑时可能重复报一次。 */
const MAX_REPORTED_KEYS = 1024

/** 写出上游同形事件所需的最小会话视图。 */
interface RetryEventWriter {
  append(type: 'llm/retry', data: AutoRetryScheduledEvent): unknown
  append(type: 'llm/retry-started', data: AutoRetryStartedEvent): unknown
}

/**
 * 挂载自动重试。
 * @param ctx - 拥有监听器与重试等待的插件上下文。
 * @param rawConfig - 可选的策略覆盖；缺省字段取默认值，未知键在挂载时直接报错。
 */
export async function apply(ctx: Context, rawConfig?: unknown): Promise<void> {
  const policy = normalizePolicy(rawConfig)
  const policyKey = policyKeyOf(policy)
  const handle = await ctx.sessionProjections.register({
    key: CHAIN_PROJECTION_KEY,
    stateVersion: 1,
    stateSchema: chainStateSchema,
    init: () => EMPTY_CHAIN_STATE,
    apply: (state, event) => foldChain(state, event, policyKey),
  })

  const lifetime = new AbortController()
  const active = new Set<Promise<unknown>>()
  /** 已经告警过的链键：同一条链只报一次，避免每次失败都刷一行。 */
  const reported = new Set<string>()

  /** 让插件卸载时能等到所有进行中的重试收尾。 */
  const track = <T>(operation: Promise<T>): Promise<T> => {
    const tracked = operation.finally(() => active.delete(tracked))
    active.add(tracked)
    return tracked
  }

  /** 同一条链只告警一次；键里带会话与坐标，攒到上限就整体清空，避免长跑时无界增长。 */
  const warnOnce = (key: string, message: string): void => {
    if (reported.has(key)) return
    if (reported.size >= MAX_REPORTED_KEYS) reported.clear()
    reported.add(key)
    ctx.logger.warn(message)
  }

  /**
   * 处理一次失败的模型请求。
   *
   * 顺序是刻意的：先让下游恢复，再判断本插件要不要接手。下游的重试决定优先于本插件，
   * 因为它带着上下文压缩之类的状态变更；本插件只在请求原样重打仍然合理时接手。
   */
  const recover = async (
    agent: Agent,
    turn: number,
    step: number,
    provider: string,
    failure: { code: string; message: string; providerRetryAfterMs?: number },
    signal: AbortSignal,
    next: () => Promise<RequestErrorAction>,
  ): Promise<RequestErrorAction> => {
    if (signal.aborted) return next()
    const downstream = await settleDownstream(next)
    if (signal.aborted || lifetime.signal.aborted) return decisionOf(downstream)
    if (downstream.kind === 'decision' && downstream.decision?.kind === 'retry') return downstream.decision
    if (downstream.kind === 'error') {
      warnOnce(
        'downstream',
        `dsh-agent-auto-retry: 下游恢复策略抛错，改由本插件判定重试: ${String(downstream.error)}`,
      )
    }
    const fallback = decisionOf(downstream)
    if (policy.maxRetries <= 0) return fallback
    if (!isRetryable(policy, failure.code)) return fallback

    let previous: ReturnType<typeof previousAttempt>
    try {
      previous = previousAttempt(handle.stateOf(agent.session), provider, policyKey)
    } catch (error) {
      warnOnce(`state:${provider}`, `dsh-agent-auto-retry: 读取重试链失败，本次不重试: ${String(error)}`)
      return fallback
    }
    const alreadyRetried = previous?.retry ?? 0
    if (alreadyRetried >= policy.maxRetries) {
      warnOnce(
        `budget:${agent.session.id}:${turn}:${step}`,
        `dsh-agent-auto-retry: 本 step 已重试 ${alreadyRetried} 次（上限 ${policy.maxRetries}），失败原样上报: ${failure.code}`,
      )
      return fallback
    }
    const retry = alreadyRetried + 1
    const plan = planDelay(policy, failure, retry, Math.random)
    if (plan.kind === 'give-up') {
      warnOnce(
        `retry-after:${agent.session.id}:${turn}:${step}`,
        `dsh-agent-auto-retry: 提供方要求的等待超过 maxRetryAfterMs（${policy.maxRetryAfterMs}ms），本次不重试`,
      )
      return fallback
    }
    const retryId = previous?.retryId ?? randomUUID()
    const writer = agent.session as unknown as RetryEventWriter

    try {
      writer.append('llm/retry', {
        retryId,
        turn,
        step,
        provider,
        mode: 'normal',
        policyKey,
        retry,
        maxRetries: policy.maxRetries,
        delayMs: plan.delayMs,
        failure,
      })
    } catch (error) {
      warnOnce(
        `append:${agent.session.id}:${turn}:${step}`,
        `dsh-agent-auto-retry: 无法记录排定的重试，本次不重试: ${String(error)}`,
      )
      return fallback
    }
    ctx.logger.debug(
      `dsh-agent-auto-retry: 第 ${retry}/${policy.maxRetries} 次重试（${provider}，${failure.code}），等待 ${Math.round(plan.delayMs)}ms`,
    )

    // 等待可被两件事打断：回合被取消（signal），或插件被卸载（lifetime）。
    const fused = AbortSignal.any([signal, lifetime.signal])
    if (!(await cancellableDelay(plan.delayMs, fused))) return undefined

    try {
      writer.append('llm/retry-started', { retryId, turn, step, retry })
    } catch (error) {
      warnOnce(
        `started:${agent.session.id}:${turn}:${step}`,
        `dsh-agent-auto-retry: 无法记录重试开始，本次不重试: ${String(error)}`,
      )
      return fallback
    }
    return { kind: 'retry' }
  }

  const listener = ctx.on('agent/request-error', ({ agent, turn, step, provider, failure, signal }, next) => {
    if (lifetime.signal.aborted) return next()
    return track(recover(agent, turn, step, provider, failure, signal, next))
  })

  ctx.effect(() => async () => {
    // 先摘监听器，再中断等待并等它们收尾：卸载之后不会再排定新的重试。
    listener()
    lifetime.abort(new Error(DISPOSE_CAUSE))
    await Promise.allSettled([...active])
  }, 'dsh-agent-auto-retry: abort and drain retries')
}

/** 下游 waterfall 的两种结果：给了一个决定，或抛了错。 */
type Downstream =
  | { readonly kind: 'decision'; readonly decision: RequestErrorAction }
  | { readonly kind: 'error'; readonly error: unknown }

/**
 * 结算下游 waterfall，把抛错也变成一个可判定的结果。
 *
 * 下游抛错不能让本插件失去判断机会，也不能把它的错误吞掉：调用方会记一条告警，再按本插件
 * 自己的策略决定是否重试；决定不重试时最终上报的仍是原始失败。
 */
async function settleDownstream(next: () => Promise<RequestErrorAction>): Promise<Downstream> {
  try {
    return { kind: 'decision', decision: await next() }
  } catch (error) {
    return { kind: 'error', error }
  }
}

/** 下游的决定；抛错时没有决定，按「放弃」处理。 */
function decisionOf(downstream: Downstream): RequestErrorAction {
  return downstream.kind === 'decision' ? downstream.decision : undefined
}

/**
 * 可中断的等待。
 * @param delayMs - 等待时长（毫秒）。
 * @param signal - 取消信号；已取消时立即返回 false。
 * @returns 等满了为 true，被取消为 false。
 */
function cancellableDelay(delayMs: number, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false)
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve(true)
    }, delayMs)
    function onAbort(): void {
      clearTimeout(timer)
      resolve(false)
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/** 供测试与文档引用：默认策略已在挂载时解析，这里只导出类型。 */
export type { AutoRetryPolicy }

export default { name, inject, apply }
