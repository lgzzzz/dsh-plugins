/**
 * 活跃会话上限：全进程同时最多 3 个会话在跑任务（含子智能体），新会话错开 5 秒启动。
 *
 * 三条通路各管一段，判定与计数全在 `src/limiter.ts` 的纯状态机里：
 *
 *   - `agent/pre-step`（waterfall）：一段运行里提出的第一个 step 是一次**准入请求**。名额空
 *     且冷却已过时立即放行，否则在宿主日志里留一行、把这一 step 挡在装配之后（agent 仍是
 *     `running`，界面上就是「运行中」），放行后再交给后续监听器；同一段运行里后续的 step
 *     直接通过。取消时等待随之结束，不再占名额。
 *   - `agent/status` → `idle`：一段运行结束，交回名额，并从这一刻开始 5 秒冷却。
 *   - `agent/created` / `agent/disposed`：登记「新会话」（还没跑过回合的会话，只有它的首次
 *     准入要等冷却）与清理已销毁会话的登记。
 *
 * 口径与取舍：
 *
 *   - 「活跃」按运行计，不按会话是否存在计。Web 里会话通常整进程存活，按存在计会让名额
 *     永久占满。
 *   - 只有新会话等冷却；已有会话继续对话只受名额限制（在已有会话里回一句话不会被拖 5 秒）。
 *   - 子智能体会话属于「新会话」，所以每次新派活也受同一条冷却与名额约束。
 *   - 名额占满而等待者是某个活跃会话的后代时，让祖先的名额临时给后代（`suspend`），否则
 *     「父会话等子会话、子会话等名额」会互相卡死；父会话下一次提出 step 时再重新排队。
 *   - 只统计本进程内的智能体；进程外的子智能体提供方（external provider）不经过这里的
 *     `agent/*` 事件，不计入。
 *   - 插件激活时已经在跑的会话按「占着名额」接管，等它们转空闲时释放。
 *
 * 不登记的注册项：`ctx.on` 挂在本插件 fiber 上、插件卸载时自动移除；队列与定时器由
 * `ctx.effect` 的清理函数统一收尾（等待者会被放行，而不是被永远挂着）。
 */
import z from '@deepseek-ai/schemastery'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionLimiter } from './src/limiter.ts'

/** 插件标识（与包名、patch id、patch name 一致）。 */
export const name = 'dsh-active-session-limit'

/** 需要宿主服务：会话准入与接管都读 `ctx.agents`。 */
export const inject = ['agents']

/** 本插件的配置。 */
export interface Config {
  /** 同时活跃的会话上限，含子智能体。 */
  maxActive: number
  /** 上一个会话结束后，新会话要再等的毫秒数。 */
  cooldownMs: number
}

/**
 * 配置 schema：两个数都在 `cordis.patch.yml` 里改，用户补丁层在升级后仍然有效。
 *
 * 默认值与需求一致：上限 3、冷却 5000 ms。冷却设 0 只保留名额限制。
 */
export const Config: z<Config> = z.object({
  maxActive: z.number().step(1).min(1).max(256).default(3),
  cooldownMs: z.number().step(1).min(0).max(600_000).default(5000),
})

/**
 * 读出某个智能体仍活着的上级链（由近到远），用于名额接管。
 *
 * 只有子智能体会话有上级（`origin === 'subagent'`）；普通 fork 的 `parentSession` 不算。
 * 上级一旦不在活动注册表里就停下 —— 只有活着的祖先才可能正占着名额。
 * @param ctx - 承载 `agents` 服务的宿主 Context。
 * @param agent - 请求准入的智能体。
 * @returns 会话 id 列表，最近的一级在前。
 */
function liveAncestors(ctx: Context, agent: Agent): string[] {
  if (agent.session.header.origin !== 'subagent') return []
  const chain: string[] = []
  const visited = new Set<string>()
  let parentId = agent.session.header.parentSession
  while (parentId !== undefined && !visited.has(parentId)) {
    visited.add(parentId)
    chain.push(parentId)
    const parent = ctx.agents.get(parentId)
    if (parent === undefined) break
    parentId = parent.session.header.parentSession
  }
  return chain
}

/**
 * 装配三条通路：准入闸门、结束释放、新会话与销毁登记。
 * @param ctx - 宿主 Context（`inject` 已保证 `agents` 就绪）。
 * @param config - 已按 {@link Config} 解析好的配置。
 */
export function apply(ctx: Context, config: Config): void {
  const limiter = new SessionLimiter({
    maxActive: config.maxActive,
    cooldownMs: config.cooldownMs,
    host: {
      now: () => Date.now(),
      schedule: (callback, delayMs) => {
        // 冷却唤醒只是队列的补泵，不该把进程留住。
        const timer = setTimeout(callback, delayMs)
        timer.unref()
        return () => { clearTimeout(timer) }
      },
      info: message => { ctx.logger.info('%s', message) },
      debug: message => { ctx.logger.debug('%s', message) },
    },
  })

  /** 把一个智能体登记进状态机：在跑的接管名额，还没跑过回合的记为「新会话」。 */
  const register = (agent: Agent): void => {
    if (agent.status === 'running') limiter.adopt(agent.id)
    if (ctx.agents.turnBoundaryOf(agent.session).lastTurn === 0) limiter.markNew(agent.id)
  }

  // 插件激活时可能已经有会话在跑（例如刚装完插件、或 HMR 重载）：先接管现有状态。
  for (const agent of ctx.agents.list()) register(agent)

  ctx.on('agent/created', ({ agent }) => {
    register(agent)
    return undefined
  })

  ctx.on('agent/status', ({ agent, status }) => {
    if (status === 'idle') limiter.release(agent.id)
  })

  ctx.on('agent/disposed', ({ agent }) => { limiter.forget(agent.id) })

  // 闸门放在装配之后：被挡住的会话仍显示运行中，但不会进入这一步的模型请求。
  ctx.on('agent/pre-step', async (payload, next) => {
    await limiter.acquire({ id: payload.agent.id, ancestors: liveAncestors(ctx, payload.agent) }, payload.signal)
    // 等待期间被取消时，按宿主的取消语义结束这一轮，不再进入后续监听器。
    payload.signal.throwIfAborted()
    return await next()
  })

  ctx.effect(() => () => { limiter.dispose() }, `${name}: admission queue`)
}
