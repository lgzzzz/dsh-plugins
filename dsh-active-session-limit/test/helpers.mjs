/**
 * 测试装置：假时钟 + 假队列定时器（给纯状态机），以及假 ctx（给插件接线）。
 *
 * 纯状态机的测试用 `createLimiterHarness()`：`advance(ms)` 逐毫秒推进假时钟，按到期顺序
 * 触发 `schedule()` 排下的回调，不依赖真实计时器。
 *
 * 插件接线的测试用 `createPluginHarness()`：暴露 `ctx` 上注册的 `agent/pre-step` 等监听器，
 * 以及 `startRun()` / `finishRun()` 两个动作，用来模拟「会话开始跑任务」与「会话转空闲」。
 * 这里的冷却用真实 `setTimeout`，所以测试里把 `cooldownMs` 调小（默认 40 ms）。
 */
import { apply } from '../index.ts'
import { SessionLimiter } from '../src/limiter.ts'

/** 让出事件循环一轮，观察 Promise 是否已经兑现。 */
export function flush() {
  return new Promise(resolve => { setImmediate(resolve) })
}

/** 睡 ms 毫秒（真实计时器，只用于插件接线测试的小冷却）。 */
export function delay(ms) {
  return new Promise(resolve => { setTimeout(resolve, ms) })
}

/** 假时钟 + 定时器 + 日志。 */
export function createLimiterHarness({ maxActive = 3, cooldownMs = 5000, startAt = 1_000_000 } = {}) {
  let now = startAt
  let timers = []
  const logs = []
  const host = {
    now: () => now,
    schedule(callback, delayMs) {
      const timer = { at: now + Math.max(0, delayMs), callback, cancelled: false }
      timers.push(timer)
      return () => { timer.cancelled = true }
    },
    info: message => { logs.push({ level: 'info', message }) },
    debug: message => { logs.push({ level: 'debug', message }) },
  }
  const limiter = new SessionLimiter({ maxActive, cooldownMs, host })

  /** 推进假时钟，并按到期顺序触发所有到期回调（回调可能再排新定时器）。 */
  const advance = (ms) => {
    const deadline = now + ms
    for (;;) {
      const due = timers
        .filter(timer => !timer.cancelled && timer.at <= deadline)
        .sort((left, right) => left.at - right.at)
      if (due.length === 0) break
      const timer = due[0]
      timers = timers.filter(entry => entry !== timer)
      timer.cancelled = true
      now = Math.max(now, timer.at)
      timer.callback()
    }
    now = deadline
  }

  return { limiter, advance, logs, host, now: () => now }
}

/** 假智能体：只带状态机与接线真正读到的字段。 */
export function createAgent({ id, status = 'idle', lastTurn = 0, origin, parentSession } = {}) {
  return {
    id,
    status,
    session: {
      id,
      lastTurn,
      header: { id, lastTurn, ...(origin === undefined ? {} : { origin }), ...(parentSession === undefined ? {} : { parentSession }) },
    },
  }
}

/** 包装一条日志消息的格式化结果（插件用 `ctx.logger.info('%s', message)`）。 */
function formatLog(format, args) {
  let index = 0
  return format.replace(/%s/g, () => String(args[index++]))
}

/** 假 ctx：`apply()` 真正会碰到的四个面（logger / agents / on / effect）。 */
export function createPluginHarness({ maxActive = 3, cooldownMs = 40, agents = [] } = {}) {
  const listeners = new Map()
  const logs = []
  const cleanups = []
  const live = new Map(agents.map(agent => [agent.id, agent]))

  const record = (level) => (format, ...args) => { logs.push({ level, message: formatLog(format, args) }) }

  const ctx = {
    logger: { info: record('info'), debug: record('debug') },
    agents: {
      list: () => [...live.values()],
      get: id => live.get(id),
      turnBoundaryOf: session => ({ lastTurn: session.lastTurn ?? 0, openTurnStartSeq: null }),
    },
    on(event, callback) {
      if (!listeners.has(event)) listeners.set(event, [])
      listeners.get(event).push(callback)
      return () => {}
    },
    effect(callback) {
      const dispose = callback()
      if (typeof dispose === 'function') cleanups.push(dispose)
      return () => {}
    },
  }

  apply(ctx, { maxActive, cooldownMs })

  const emit = (event, payload) => {
    for (const callback of listeners.get(event) ?? []) callback(payload)
  }

  /**
   * 模拟一次「开始跑任务」：调用第一个 `agent/pre-step` 监听器。
   * @returns `{ promise, abort, entered() }`；`promise` 在闸门放行后跑完 `next()`。
   */
  const startRun = (agent, { turn = 1 } = {}) => {
    let entered = 0
    const controller = new AbortController()
    const callback = listeners.get('agent/pre-step')?.[0]
    if (callback === undefined) throw new Error('agent/pre-step 监听器未注册')
    const promise = Promise.resolve(callback(
      {
        agent,
        messages: [],
        turn,
        step: 1,
        signal: controller.signal,
        modelSelection: { provider: 'test', model: 'test' },
      },
      async () => {
        entered += 1
        return { kind: 'enter', messages: [] }
      },
    ))
    return { promise, abort: (reason) => controller.abort(reason), entered: () => entered }
  }

  /** 模拟一段运行结束：发 `agent/status` idle。 */
  const finishRun = (agent) => {
    agent.status = 'idle'
    emit('agent/status', { agent, status: 'idle' })
  }

  /** 模拟宿主创建一个新会话。 */
  const createSession = (agent) => {
    live.set(agent.id, agent)
    emit('agent/created', { agent, source: 'startup' })
  }

  /** 模拟宿主销毁一个会话。 */
  const disposeSession = (agent) => {
    live.delete(agent.id)
    emit('agent/disposed', { agent })
  }

  /** 卸载插件：跑 `ctx.effect` 收集到的清理函数。 */
  const unload = async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup()
  }

  return {
    ctx,
    logs,
    emit,
    startRun,
    finishRun,
    createSession,
    disposeSession,
    unload,
    live,
    logged: prefix => logs.filter(entry => entry.message.includes(prefix)),
  }
}
