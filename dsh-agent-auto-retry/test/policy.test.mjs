/**
 * 纯策略测试：失败码判定、指数退避、Retry-After 与 policyKey。
 *
 * 运行：`node test/policy.test.mjs`。
 */
import assert from 'node:assert/strict'
import {
  DEFAULT_POLICY,
  isRetryable,
  localDelay,
  normalizePolicy,
  planDelay,
  policyKeyOf,
} from '../src/policy.ts'

// 默认策略：除永久性失败之外都重试

assert.equal(isRetryable(DEFAULT_POLICY, 'SERVER'), true, '服务端错误值得重试')
assert.equal(isRetryable(DEFAULT_POLICY, 'TIMEOUT'), true, '超时值得重试')
assert.equal(isRetryable(DEFAULT_POLICY, 'TRANSPORT'), true, '传输错误值得重试')
assert.equal(isRetryable(DEFAULT_POLICY, 'RATE_LIMIT'), true, '限流值得重试')
assert.equal(isRetryable(DEFAULT_POLICY, 'EMPTY_RESPONSE'), true, '空回复值得重试')
assert.equal(isRetryable(DEFAULT_POLICY, 'HTTP_503'), true, '未知的临时码也重试（通配）')
assert.equal(isRetryable(DEFAULT_POLICY, 'UNKNOWN'), true, '通配覆盖未知码')

assert.equal(isRetryable(DEFAULT_POLICY, 'AUTH'), false, '认证失败不重试')
assert.equal(isRetryable(DEFAULT_POLICY, 'QUOTA'), false, '配额耗尽不重试')
assert.equal(isRetryable(DEFAULT_POLICY, 'CONTEXT_WINDOW_EXCEEDED'), false, '上下文超限交给 compaction')
assert.equal(isRetryable(DEFAULT_POLICY, 'IMAGE_OFFLOAD_REQUIRED'), false, '图片卸载有别的恢复者')
assert.equal(isRetryable(DEFAULT_POLICY, 'INVALID_REQUEST'), false, '请求不合法重试无用')
assert.equal(isRetryable(DEFAULT_POLICY, 'ABORTED'), false, '被取消的请求不重试')
assert.equal(isRetryable(DEFAULT_POLICY, 'MISSING_CREDENTIAL'), false, '缺凭据要用户先配')

// 永久性判定先于通配

{
  const policy = { ...DEFAULT_POLICY, retryableCodes: ['*'], permanentCodes: ['AUTH'] }
  assert.equal(isRetryable(policy, 'AUTH'), false, '永久码即便在通配集合里也排除')
  assert.equal(isRetryable(policy, 'SERVER'), true)
}

// 白名单模式

{
  const policy = { ...DEFAULT_POLICY, retryableCodes: ['RATE_LIMIT'], permanentCodes: [] }
  assert.equal(isRetryable(policy, 'RATE_LIMIT'), true)
  assert.equal(isRetryable(policy, 'SERVER'), false, '白名单之外不重试')
}

// 空列表 = 关闭

{
  const policy = { ...DEFAULT_POLICY, retryableCodes: [], permanentCodes: [] }
  assert.equal(isRetryable(policy, 'SERVER'), false, '空列表什么都不重试')
}

// 本地指数退避

{
  const policy = { ...DEFAULT_POLICY, initialDelayMs: 1000, maxDelayMs: 8000, jitterRatio: 0 }
  const noJitter = () => 0.5
  assert.equal(localDelay(policy, 1, noJitter), 1000, '首次等待等于基准')
  assert.equal(localDelay(policy, 2, noJitter), 2000, '第二次翻倍')
  assert.equal(localDelay(policy, 3, noJitter), 4000)
  assert.equal(localDelay(policy, 4, noJitter), 8000)
  assert.equal(localDelay(policy, 5, noJitter), 8000, '到达上限后不再增长')
  assert.equal(localDelay(policy, 100, noJitter), 8000, '很久以后仍是上限')
  assert.equal(localDelay(policy, 2000, noJitter), 8000, '指数不会溢出到 Infinity')
}

// 抖动幅度：random=0 时取下界，random→1 时取上界

{
  const policy = { ...DEFAULT_POLICY, initialDelayMs: 1000, maxDelayMs: 10000, jitterRatio: 0.5 }
  assert.equal(localDelay(policy, 1, () => 0), 500, 'random=0 取下界')
  assert.ok(
    Math.abs(localDelay(policy, 1, () => 0.999999) - 1500) < 0.01,
    'random≈1 取上界附近',
  )
  assert.equal(localDelay(policy, 1, () => 0.5), 1000, 'random=0.5 不加不减')
}

// 抖动不会越过上限

{
  const policy = { ...DEFAULT_POLICY, initialDelayMs: 1000, maxDelayMs: 1000, jitterRatio: 1 }
  assert.ok(localDelay(policy, 1, () => 0.999999) <= 1000, '抖动后仍不超过 maxDelayMs')
}

// Retry-After 优先

{
  const policy = { ...DEFAULT_POLICY, initialDelayMs: 1000, maxDelayMs: 60000, maxRetryAfterMs: 30000 }
  assert.deepEqual(
    planDelay(policy, { providerRetryAfterMs: 7000 }, 1, () => 0.5),
    { kind: 'wait', delayMs: 7000 },
    '服从提供方的 Retry-After',
  )
  assert.deepEqual(
    planDelay(policy, { providerRetryAfterMs: 30000 }, 1, () => 0.5),
    { kind: 'wait', delayMs: 30000 },
    '恰好等于上限仍然服从',
  )
  assert.deepEqual(
    planDelay(policy, { providerRetryAfterMs: 30001 }, 1, () => 0.5),
    { kind: 'give-up', reason: 'retry-after' },
    '超过上限就放弃，不擅自缩短',
  )
  assert.deepEqual(
    planDelay(policy, {}, 1, () => 0.5),
    { kind: 'wait', delayMs: 1000 },
    '没有 Retry-After 时走本地退避',
  )
  assert.deepEqual(
    planDelay(policy, { providerRetryAfterMs: 0 }, 1, () => 0.5),
    { kind: 'wait', delayMs: 1000 },
    '非正的 Retry-After 视为没有',
  )
  assert.deepEqual(
    planDelay(policy, { providerRetryAfterMs: Number.NaN }, 1, () => 0.5),
    { kind: 'wait', delayMs: 1000 },
    'NaN 视为没有',
  )
}

// 配置解析

{
  assert.equal(normalizePolicy(undefined), DEFAULT_POLICY, '没有配置就用默认策略')
  assert.equal(normalizePolicy(null), DEFAULT_POLICY, 'null 视为没有配置')

  const custom = normalizePolicy({ maxRetries: 2 })
  assert.equal(custom.maxRetries, 2)
  assert.equal(custom.initialDelayMs, DEFAULT_POLICY.initialDelayMs, '缺省字段取默认值')
  assert.throws(() => normalizePolicy({ maxRetires: 2 }), /未知配置项 "maxRetires"/, '拼错的键报错而不是静默忽略')
  assert.throws(() => normalizePolicy({ maxRetries: -1 }), /"maxRetries"/)
  assert.throws(() => normalizePolicy({ maxRetries: 1.5 }), /"maxRetries"/)
  assert.throws(() => normalizePolicy({ initialDelayMs: 0 }), /"initialDelayMs"/)
  assert.throws(() => normalizePolicy({ jitterRatio: 2 }), /"jitterRatio"/)
  assert.throws(() => normalizePolicy({ retryableCodes: 'SERVER' }), /"retryableCodes"/)
  assert.throws(() => normalizePolicy({ retryableCodes: [''] }), /"retryableCodes"/)
  assert.throws(() => normalizePolicy([]), /必须是一个对象/)
  assert.equal(normalizePolicy({ maxRetries: 0 }).maxRetries, 0, '0 允许：表示关闭')
}

// policyKey：稳定、可比较、带本插件前缀

{
  const left = policyKeyOf(DEFAULT_POLICY)
  const right = policyKeyOf({ ...DEFAULT_POLICY, retryableCodes: [...DEFAULT_POLICY.retryableCodes] })
  assert.equal(left, right, '同样的策略折出同样的键')
  assert.ok(left.includes('dsh-agent-auto-retry'), '键带本插件前缀，与提供方策略键永不冲突')
  assert.notEqual(left, policyKeyOf({ ...DEFAULT_POLICY, maxRetries: 6 }), '策略变了键就变')
  assert.equal(
    policyKeyOf({ ...DEFAULT_POLICY, retryableCodes: ['A', 'B'] }),
    policyKeyOf({ ...DEFAULT_POLICY, retryableCodes: ['B', 'A'] }),
    '集合成员顺序不影响键',
  )
}

console.log('policy checks passed')
