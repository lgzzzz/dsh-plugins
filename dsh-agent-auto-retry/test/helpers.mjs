/**
 * 测试共用的夹具：假会话、假 sessionProjections、假 ctx，以及等待插件异步重试收尾的 `settle()`。
 *
 * 假会话只复刻插件用到的两点：`id` 与 `append()`；append 把事件同步记进日志，假投影据此折叠，
 * 于是「重试编号必须接在日志之后」这条不变量在测试里真的会被执行到，而不是靠内部变量自说自话。
 */

import { foldChain, EMPTY_CHAIN_STATE, CHAIN_PROJECTION_KEY } from '../src/chain.ts'

/** 一份假会话：记录 append 的事件，供假投影折叠。 */
export class FakeSession {
  constructor(id) {
    this.id = id
    this.events = []
    this.failAppend = false
  }

  append(type, data) {
    if (this.failAppend) throw new Error('append refused by test harness')
    const event = { type, data, seq: this.events.length }
    this.events.push(event)
    return event
  }

  /** 只取 `llm/retry` 事件。 */
  retries() {
    return this.events.filter((event) => event.type === 'llm/retry').map((event) => event.data)
  }
}

/**
 * 假 `sessionProjections`：`register()` 保留定义并返回一个 handle，
 * `handle.stateOf(session)` 用同一份 `apply` 折叠假会话的日志。
 */
export class FakeProjections {
  constructor() {
    this.definitions = new Map()
    this.registrations = []
  }

  async register(definition) {
    this.definitions.set(definition.key, definition)
    this.registrations.push(definition)
    return {
      stateOf: (session) => {
        let state = definition.init()
        for (const event of session.events) state = definition.apply(state, event)
        return state
      },
      dispose: async () => {},
    }
  }

  /** 直接在当前日志上折一次，供断言使用。 */
  stateOf(session, key = CHAIN_PROJECTION_KEY) {
    const definition = this.definitions.get(key)
    if (definition === undefined) return EMPTY_CHAIN_STATE
    let state = definition.init()
    for (const event of session.events) state = definition.apply(state, event)
    return state
  }
}

/**
 * 装配一套新的假 ctx 并挂载插件。
 * `config` 会原样交给 `apply`；重试等待默认压到 1ms，测试才不会真的等两秒。
 */
export function createHarness({ config = { initialDelayMs: 1, maxDelayMs: 1, jitterRatio: 0 } } = {}) {
  const listeners = new Map()
  const disposers = []
  const logs = { info: [], debug: [], warn: [] }
  const projections = new FakeProjections()
  const emit = (event, ...args) => {
    for (const listener of listeners.get(event) ?? []) listener(...args)
  }
  const ctx = {
    sessionProjections: projections,
    logger: {
      info: (message) => logs.info.push(String(message)),
      debug: (message) => logs.debug.push(String(message)),
      warn: (message) => logs.warn.push(String(message)),
      error: (message) => logs.warn.push(String(message)),
    },
    effect: (callback) => {
      const dispose = callback()
      if (typeof dispose === 'function') disposers.push(dispose)
      return dispose
    },
    on: (event, listener) => {
      const bucket = listeners.get(event) ?? []
      bucket.push(listener)
      listeners.set(event, bucket)
      return () => {
        const index = bucket.indexOf(listener)
        if (index >= 0) bucket.splice(index, 1)
      }
    },
  }

  return {
    ctx,
    projections,
    logs,
    listeners,
    /** 挂载插件；返回 apply 的 promise。 */
    apply: (plugin) => plugin.apply(ctx, config),
    /** 触发一次失败的模型请求，返回 waterfall 的决定。 */
    requestError: async (payload, next = () => Promise.resolve(undefined)) => {
      let result
      for (const listener of listeners.get('agent/request-error') ?? []) {
        result = await listener(payload, next)
      }
      return result
    },
    dispose: async () => {
      for (const dispose of disposers) await dispose()
      disposers.length = 0
    },
  }
}

/** 一条 `agent/request-error` 的载荷（字段与上游一致，多余的字段测试用不到）。 */
export function failurePayload(session, overrides = {}) {
  return {
    agent: { session },
    turn: 1,
    step: 1,
    provider: 'deepseek',
    failure: { message: 'upstream exploded', code: 'SERVER' },
    retryPolicy: undefined,
    signal: new AbortController().signal,
    ...overrides,
  }
}

/** 让插件的异步重试跑完（它不把 promise 交给调用方）。 */
export async function settle(rounds = 24) {
  for (let index = 0; index < rounds; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

/** 供测试直接断言折叠逻辑。 */
export { foldChain, EMPTY_CHAIN_STATE, CHAIN_PROJECTION_KEY }
