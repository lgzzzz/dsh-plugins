/**
 * 宿主挂载测试（假 ctx + 假会话）：验证插件形状、下游优先级、失败码判定、预算、
 * Retry-After、事件形状与卸载语义。
 *
 * 运行：`node test/plugin-apply.test.mjs`。
 */
import assert from 'node:assert/strict'
import * as plugin from '../index.ts'
import { DEFAULT_POLICY, normalizePolicy, policyKeyOf } from '../src/policy.ts'
import { FakeSession, createHarness, failurePayload, settle } from './helpers.mjs'

const { apply, inject, name } = plugin
/** 默认配置 + 压到 1ms 的等待；下面的断言按同一份配置算 policyKey。 */
const FAST = { initialDelayMs: 1, maxDelayMs: 1, jitterRatio: 0 }
const POLICY_KEY = policyKeyOf(normalizePolicy(FAST))

// 插件形状

assert.equal(name, 'dsh-agent-auto-retry', '导出 name 与包名一致')
assert.deepEqual(inject, ['sessionProjections'], '声明依赖会话投影服务')
assert.equal(typeof apply, 'function', '导出 apply')
assert.equal(plugin.default.name, name, '默认导出的 name 与具名导出一致')
assert.equal(plugin.default.apply, apply, '默认导出的 apply 与具名导出一致')
assert.deepEqual(plugin.default.inject, inject, '默认导出带 inject')
assert.equal(plugin.Config, undefined, '配置在 apply 里按字段校验，不导出 schema')

// 默认配置：可重试的失败在同一个回合里重试一次

{
  const harness = createHarness({ config: FAST })
  await harness.apply(plugin)
  assert.equal(harness.projections.registrations.length, 1, '挂载时注册一个投影单元')
  assert.equal(harness.projections.registrations[0].key, 'dshAgentAutoRetryChain')

  const session = new FakeSession('s-1')
  const decision = await harness.requestError(failurePayload(session))

  assert.deepEqual(decision, { kind: 'retry' }, '重试决定交给 agent loop')
  assert.equal(session.events.length, 2, '先写排定、再写开始，恰好两条事件')
  assert.equal(session.events[0].type, 'llm/retry')
  assert.equal(session.events[1].type, 'llm/retry-started')

  const scheduled = session.events[0].data
  assert.equal(scheduled.turn, 1)
  assert.equal(scheduled.step, 1)
  assert.equal(scheduled.provider, 'deepseek')
  assert.equal(scheduled.mode, 'normal', '本插件的重试始终有预算')
  assert.equal(scheduled.retry, 1, '第一次重试编号为 1')
  assert.equal(scheduled.maxRetries, normalizePolicy(FAST).maxRetries, '上限写进事件，客户端据此显示 n/m')
  assert.equal(scheduled.policyKey, POLICY_KEY, 'policyKey 是本插件的策略指纹')
  assert.equal(scheduled.delayMs, 1, '等待时长来自配置（测试压到 1ms）')
  assert.deepEqual(scheduled.failure, { message: 'upstream exploded', code: 'SERVER' }, '失败事实原样保留')
  assert.equal(typeof scheduled.retryId, 'string')
  assert.ok(scheduled.retryId.length > 0, 'retryId 非空；客户端按它把两次尝试串成一条链')

  assert.deepEqual(session.events[1].data, {
    retryId: scheduled.retryId,
    turn: 1,
    step: 1,
    retry: 1,
  })
  assert.deepEqual(harness.logs.warn, [], '正常重试不告警')
  assert.ok(harness.logs.debug.some((line) => line.includes('第 1/5 次重试')), '重试走 debug 日志')
  await harness.dispose()
}

// 下游恢复策略优先：它说重试就不重复排定

{
  const harness = createHarness()
  await harness.apply(plugin)
  const session = new FakeSession('s-2')
  const decision = await harness.requestError(failurePayload(session), () => Promise.resolve({ kind: 'retry' }))

  assert.deepEqual(decision, { kind: 'retry' }, '下游的重试决定原样放行')
  assert.deepEqual(session.events, [], '下游已经接手时本插件一条事件都不写')
  await harness.dispose()
}

// 下游抛错：仍可重试，并告警一次

{
  const harness = createHarness()
  await harness.apply(plugin)
  const session = new FakeSession('s-3')
  const boom = () => Promise.reject(new Error('downstream exploded'))
  const decision = await harness.requestError(failurePayload(session), boom)
  assert.deepEqual(decision, { kind: 'retry' }, '下游抛错不应剥夺本插件的判断机会')
  assert.equal(session.events.length, 2)
  assert.ok(
    harness.logs.warn.some((line) => line.includes('下游恢复策略抛错')),
    '下游抛错要留下痕迹',
  )

  const again = new FakeSession('s-3b')
  await harness.requestError(failurePayload(again), boom)
  assert.equal(
    harness.logs.warn.filter((line) => line.includes('下游恢复策略抛错')).length,
    1,
    '同一类告警只报一次',
  )
  await harness.dispose()
}

// 永久性失败码不重试

{
  const harness = createHarness()
  await harness.apply(plugin)
  for (const code of ['AUTH', 'QUOTA', 'CONTEXT_WINDOW_EXCEEDED', 'INVALID_REQUEST', 'ABORTED']) {
    const session = new FakeSession(`s-${code}`)
    const decision = await harness.requestError(failurePayload(session, { failure: { message: 'nope', code } }))
    assert.equal(decision, undefined, `${code} 不应重试`)
    assert.deepEqual(session.events, [], `${code} 不写任何事件`)
  }
  await harness.dispose()
}

// 预算：到上限后原样上报

{
  const harness = createHarness({ config: { maxRetries: 2, initialDelayMs: 1, maxDelayMs: 1, jitterRatio: 0 } })
  await harness.apply(plugin)
  const session = new FakeSession('s-4')
  assert.deepEqual(await harness.requestError(failurePayload(session)), { kind: 'retry' }, '第 1 次')
  assert.deepEqual(await harness.requestError(failurePayload(session)), { kind: 'retry' }, '第 2 次')
  const third = await harness.requestError(failurePayload(session))
  assert.equal(third, undefined, '第 3 次超出预算，失败原样上报')
  assert.equal(session.retries().length, 2, '只排定两次')
  assert.deepEqual(session.retries().map((item) => item.retry), [1, 2], '编号连续')
  assert.equal(session.retries()[0].retryId, session.retries()[1].retryId, '同一条链共用一个 retryId')
  assert.ok(
    harness.logs.warn.some((line) => line.includes('已重试 2 次（上限 2）')),
    '预算耗尽要留下可诊断的一行',
  )
  await harness.dispose()
}

// maxRetries: 0 = 关闭

{
  const harness = createHarness({ config: { maxRetries: 0 } })
  await harness.apply(plugin)
  const session = new FakeSession('s-5')
  assert.equal(await harness.requestError(failurePayload(session)), undefined, '关闭时不重试')
  assert.deepEqual(session.events, [])
  await harness.dispose()
}

// 白名单：只重试列出的码

{
  const harness = createHarness({ config: { retryableCodes: ['RATE_LIMIT'] } })
  await harness.apply(plugin)
  const allowed = new FakeSession('s-6a')
  assert.deepEqual(
    await harness.requestError(failurePayload(allowed, { failure: { message: 'slow down', code: 'RATE_LIMIT' } })),
    { kind: 'retry' },
  )
  const denied = new FakeSession('s-6b')
  assert.equal(
    await harness.requestError(failurePayload(denied, { failure: { message: 'boom', code: 'SERVER' } })),
    undefined,
    '白名单之外不重试',
  )
  await harness.dispose()
}

// 回合被取消：不写事件、立即返回

{
  const harness = createHarness()
  await harness.apply(plugin)
  const session = new FakeSession('s-7')
  const controller = new AbortController()
  controller.abort()
  const decision = await harness.requestError(failurePayload(session, { signal: controller.signal }))
  assert.equal(decision, undefined, '已取消的回合不再排定重试')
  assert.deepEqual(session.events, [])
  await harness.dispose()
}

// 等待期间被取消：排定已写入，但不会再开始

{
  const harness = createHarness({ config: { initialDelayMs: 50, maxDelayMs: 50, jitterRatio: 0 } })
  await harness.apply(plugin)
  const session = new FakeSession('s-8')
  const controller = new AbortController()
  const pending = harness.requestError(failurePayload(session, { signal: controller.signal }))
  await settle(2)
  assert.equal(session.events.length, 1, '等待开始前已经持久化排定事件')
  controller.abort()
  assert.equal(await pending, undefined, '取消后不重试')
  assert.equal(session.events.length, 1, '取消后不再写「重试已开始」')
  await harness.dispose()
}

// Retry-After：在上限内服从，超过上限放弃

{
  const harness = createHarness({ config: { maxRetryAfterMs: 5000 } })
  await harness.apply(plugin)
  const honored = new FakeSession('s-9a')
  assert.deepEqual(
    await harness.requestError(
      failurePayload(honored, { failure: { message: 'slow down', code: 'RATE_LIMIT', providerRetryAfterMs: 3000 } }),
    ),
    { kind: 'retry' },
  )
  assert.equal(honored.retries()[0].delayMs, 3000, '按提供方要求等待')

  const refused = new FakeSession('s-9b')
  assert.equal(
    await harness.requestError(
      failurePayload(refused, { failure: { message: 'slow down', code: 'RATE_LIMIT', providerRetryAfterMs: 60000 } }),
    ),
    undefined,
    '超过上限就放弃，而不是擅自缩短',
  )
  assert.deepEqual(refused.events, [])
  assert.ok(harness.logs.warn.some((line) => line.includes('maxRetryAfterMs')))
  await harness.dispose()
}

// 事件写不进去就不重试（宁可保持原样，也不留下不可重建的重试）

{
  const harness = createHarness()
  await harness.apply(plugin)
  const session = new FakeSession('s-10')
  session.failAppend = true
  assert.equal(await harness.requestError(failurePayload(session)), undefined, '记录失败时不重试')
  assert.ok(harness.logs.warn.some((line) => line.includes('无法记录排定的重试')))
  await harness.dispose()
}

// 新 step 重新给预算

{
  const harness = createHarness({ config: { maxRetries: 1, initialDelayMs: 1, maxDelayMs: 1, jitterRatio: 0 } })
  await harness.apply(plugin)
  const session = new FakeSession('s-11')
  assert.deepEqual(await harness.requestError(failurePayload(session)), { kind: 'retry' })
  assert.equal(await harness.requestError(failurePayload(session)), undefined, '同一 step 预算用完')

  session.append('step/start', { turn: 1, step: 2 })
  assert.deepEqual(
    await harness.requestError(failurePayload(session, { step: 2 })),
    { kind: 'retry' },
    '新 step 拿到新预算',
  )
  await harness.dispose()
}

// 不同提供方各自一条链

{
  const harness = createHarness({ config: { maxRetries: 1, initialDelayMs: 1, maxDelayMs: 1, jitterRatio: 0 } })
  await harness.apply(plugin)
  const session = new FakeSession('s-12')
  assert.deepEqual(await harness.requestError(failurePayload(session)), { kind: 'retry' })
  assert.deepEqual(
    await harness.requestError(failurePayload(session, { provider: 'qoder' })),
    { kind: 'retry' },
    '另一个提供方的链还没用掉预算',
  )
  assert.equal(new Set(session.retries().map((item) => item.retryId)).size, 2, '两条链各有自己的 retryId')
  await harness.dispose()
}

// 卸载：等待中的重试立即结束，之后不再排定

{
  const harness = createHarness({ config: { initialDelayMs: 10_000, maxDelayMs: 10_000, jitterRatio: 0 } })
  await harness.apply(plugin)
  const session = new FakeSession('s-13')
  const pending = harness.requestError(failurePayload(session))
  await settle(2)
  assert.equal(session.events.length, 1, '排定事件已经写入')
  await harness.dispose()
  assert.equal(await pending, undefined, '卸载会中断等待，让重试立即结束')
  assert.equal(session.events.length, 1, '卸载后不再写「重试已开始」')

  const after = new FakeSession('s-14')
  assert.equal(await harness.requestError(failurePayload(after)), undefined, '卸载后监听器已摘掉')
  assert.deepEqual(after.events, [])
}

console.log('plugin-apply checks passed')
