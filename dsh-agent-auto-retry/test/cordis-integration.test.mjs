/**
 * 真实 cordis 集成测试：用 `new Context()` 起宿主上下文，把会话投影注册表 provide 成真服务，
 * 以对象插件方式按加载器挂载，走真实事件总线与真实 waterfall 组合。
 *
 * 验证三件事：`inject: ['sessionProjections']` 的等待语义（服务缺席时不运行，出现即运行）、
 * 真实总线上的 `agent/request-error` 重试决定与两条同形事件，以及重试编号确实来自会话日志
 * 而不是进程内变量。
 *
 * 运行：`node test/cordis-integration.test.mjs`。
 */
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import plugin, { apply, inject, name } from '../index.ts'
import { normalizePolicy, policyKeyOf } from '../src/policy.ts'
import { FakeSession, settle } from './helpers.mjs'

/** 集成测试统一用的快速配置；policyKey 必须按同一份配置算。 */
const FAST = { initialDelayMs: 1, maxDelayMs: 1, jitterRatio: 0 }
const POLICY_KEY = policyKeyOf(normalizePolicy(FAST))

// 导出形态

assert.equal(plugin.name, name, '默认导出的 name 与具名导出一致')
assert.equal(plugin.apply, apply, '默认导出的 apply 与具名导出一致')
assert.deepEqual(plugin.inject, inject, '默认导出带 inject')

/** 最小投影注册表：与真服务同形的 `register()`，stateOf 折叠会话日志。 */
function projectionsService() {
  const definitions = new Map()
  let registrations = 0
  return {
    get registrations() {
      return registrations
    },
    async register(definition) {
      registrations += 1
      definitions.set(definition.key, definition)
      return {
        stateOf: (session) => {
          let state = definition.init()
          for (const event of session.events) state = definition.apply(state, event)
          return state
        },
        dispose: async () => {},
      }
    },
  }
}

/** 一次真实 waterfall 派发：载荷 + 默认的 `next`。 */
const dispatch = (root, payload, next = () => Promise.resolve(undefined)) =>
  root.waterfall('agent/request-error', payload, next)

/** 一条失败请求的载荷。 */
const payloadFor = (session, overrides = {}) => ({
  agent: { session },
  turn: 1,
  step: 1,
  provider: 'deepseek',
  failure: { message: 'upstream exploded', code: 'TIMEOUT' },
  retryPolicy: undefined,
  signal: new AbortController().signal,
  ...overrides,
})

// 等待服务 + 真实 waterfall

{
  const root = new Context()
  const projections = projectionsService()

  const fiber = root.plugin({ ...plugin, apply: (ctx) => apply(ctx, FAST) })
  await settle()
  const early = new FakeSession('s-early')
  assert.equal(await dispatch(root, payloadFor(early)), undefined, '投影服务缺席时插件不运行')
  assert.deepEqual(early.events, [])

  root.provide('sessionProjections', projections)
  await fiber
  await settle()
  assert.equal(projections.registrations, 1, '服务就绪后注册投影单元')

  const session = new FakeSession('s-live')
  assert.deepEqual(await dispatch(root, payloadFor(session)), { kind: 'retry' }, '真实总线上失败请求被重试')
  assert.deepEqual(session.events.map((event) => event.type), ['llm/retry', 'llm/retry-started'])
  assert.equal(session.retries()[0].retry, 1)

  // 下游（真实 waterfall 的后续监听器）说重试时不重复排定
  const downstream = root.plugin((ctx) => {
    ctx.on('agent/request-error', () => ({ kind: 'retry' }))
  })
  await downstream
  const delegated = new FakeSession('s-delegated')
  assert.deepEqual(await dispatch(root, payloadFor(delegated)), { kind: 'retry' })
  assert.deepEqual(delegated.events, [], '下游已经接手时不写本插件的事件')
  await downstream.dispose()

  // 编号来自日志：同一个 step 再失败一次，编号接着写
  assert.deepEqual(await dispatch(root, payloadFor(session)), { kind: 'retry' })
  assert.deepEqual(session.retries().map((item) => item.retry), [1, 2], '同一条链接着编号')
  assert.equal(session.retries()[0].retryId, session.retries()[1].retryId, '共用一个 retryId')

  // 冷启动：日志里已有的重试仍然计入预算（编号不从头开始）
  const resumed = new FakeSession('s-resumed')
  resumed.append('llm/retry', {
    retryId: 'r-old',
    turn: 1,
    step: 1,
    provider: 'deepseek',
    mode: 'normal',
    policyKey: POLICY_KEY,
    retry: 3,
    maxRetries: 5,
    delayMs: 1000,
    failure: { message: 'boom', code: 'SERVER' },
  })
  assert.deepEqual(await dispatch(root, payloadFor(resumed)), { kind: 'retry' })
  assert.equal(resumed.retries().at(-1).retry, 4, '接着日志里的编号，不跳号')
  assert.equal(resumed.retries().at(-1).retryId, 'r-old', '沿用同一条链的 retryId')

  await fiber.dispose()
  const after = new FakeSession('s-after')
  assert.equal(await dispatch(root, payloadFor(after)), undefined, '卸载后不再重试')
  assert.deepEqual(after.events, [])
  await root.fiber.dispose()
}

// 卸载会中断进行中的等待

{
  const root = new Context()
  const projections = projectionsService()
  root.provide('sessionProjections', projections)
  const fiber = root.plugin({ ...plugin, apply: (ctx) => apply(ctx, { initialDelayMs: 30_000, maxDelayMs: 30_000, jitterRatio: 0 }) })
  await fiber

  const session = new FakeSession('s-slow')
  const pending = dispatch(root, payloadFor(session))
  await settle(2)
  assert.equal(session.events.length, 1, '排定事件已持久化')
  await fiber.dispose()
  assert.equal(await pending, undefined, '卸载中断等待')
  assert.equal(session.events.length, 1, '卸载后不再写「重试已开始」')
  await root.fiber.dispose()
}

console.log('cordis-integration checks passed')
