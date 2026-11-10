/**
 * 重试链折叠测试：只认本插件的链、按坐标隔离、边界清空。
 *
 * 运行：`node test/chain.test.mjs`。
 */
import assert from 'node:assert/strict'
import {
  CHAIN_PROJECTION_KEY,
  EMPTY_CHAIN_STATE,
  chainKey,
  chainStateSchema,
  foldChain,
  previousAttempt,
} from '../src/chain.ts'
import { policyKeyOf, DEFAULT_POLICY } from '../src/policy.ts'

const POLICY_KEY = policyKeyOf(DEFAULT_POLICY)

/** 一条 `llm/retry` 事件。 */
const retry = (provider, policyKey, retry, retryId = 'r-1', overrides = {}) => ({
  type: 'llm/retry',
  data: {
    retryId,
    turn: 1,
    step: 1,
    provider,
    mode: 'normal',
    policyKey,
    retry,
    maxRetries: 5,
    delayMs: 1000,
    failure: { code: 'SERVER', message: 'boom' },
    ...overrides,
  },
})

/** 一条 `step/start`。 */
const stepStart = (turn = 1, step = 1) => ({ type: 'step/start', data: { turn, step } })

// 键与空状态

assert.equal(CHAIN_PROJECTION_KEY, 'dshAgentAutoRetryChain', '投影键带本插件的名字')
assert.notEqual(chainKey('deepseek', POLICY_KEY), chainKey('qoder', POLICY_KEY), '不同提供方是不同链')
assert.equal(chainKey('deepseek', POLICY_KEY), chainKey('deepseek', POLICY_KEY), '同样的输入折出同样的键')
assert.deepEqual(EMPTY_CHAIN_STATE, {}, '空状态就是空对象')
assert.deepEqual(chainStateSchema.parse({}), {}, '空状态通过校验')
assert.deepEqual(
  chainStateSchema.parse({ k: { retry: 1, retryId: 'x' } }),
  { k: { retry: 1, retryId: 'x' } },
  '合法状态通过校验',
)
assert.throws(() => chainStateSchema.parse({ k: { retry: -1, retryId: 'x' } }), '负的重试序号被拒绝')
assert.throws(() => chainStateSchema.parse({ k: { retry: 1 } }), '缺 retryId 被拒绝')

// 无关事件返回同一引用

{
  const state = EMPTY_CHAIN_STATE
  assert.equal(foldChain(state, { type: 'turn/start', data: { turn: 1 } }, POLICY_KEY), state, '无关事件不换引用')
  assert.equal(foldChain(state, { type: 'assistant/message', data: {} }, POLICY_KEY), state)
  assert.equal(foldChain(state, { type: 'llm/retry-started', data: {} }, POLICY_KEY), state, '重试开始不推进链')
}

// 记录本插件的链

{
  let state = foldChain(EMPTY_CHAIN_STATE, retry('deepseek', POLICY_KEY, 1, 'r-1'), POLICY_KEY)
  assert.deepEqual(previousAttempt(state, 'deepseek', POLICY_KEY), { retry: 1, retryId: 'r-1' }, '记下第 1 次重试')
  state = foldChain(state, retry('deepseek', POLICY_KEY, 2, 'r-1'), POLICY_KEY)
  assert.deepEqual(previousAttempt(state, 'deepseek', POLICY_KEY), { retry: 2, retryId: 'r-1' }, '同一条链接着编号')
  assert.equal(previousAttempt(state, 'qoder', POLICY_KEY), undefined, '别的提供方还没有链')
}

// 重复事件不换引用（幂等折叠）

{
  const first = retry('deepseek', POLICY_KEY, 1, 'r-1')
  const state = foldChain(EMPTY_CHAIN_STATE, first, POLICY_KEY)
  assert.equal(foldChain(state, first, POLICY_KEY), state, '同一个事件折两次结果不变，引用也不变')
}

// 不认别人的链

{
  const other = { ...retry('deepseek', POLICY_KEY, 1, 'r-1'), data: { ...retry('deepseek', POLICY_KEY, 1, 'r-1').data, policyKey: '["provider-own-key"]' } }
  assert.equal(foldChain(EMPTY_CHAIN_STATE, other, POLICY_KEY), EMPTY_CHAIN_STATE, 'policyKey 不同就不记')
  assert.equal(previousAttempt(foldChain(EMPTY_CHAIN_STATE, other, POLICY_KEY), 'deepseek', POLICY_KEY), undefined)
}

// 形状不完整的载荷不记

{
  const malformed = [
    { type: 'llm/retry' },
    { type: 'llm/retry', data: null },
    retry('deepseek', POLICY_KEY, 0, 'r-1'),
    retry('deepseek', POLICY_KEY, 1, ''),
    retry('deepseek', POLICY_KEY, 1, 'r-1', { provider: '' }),
    { ...retry('deepseek', POLICY_KEY, 1, 'r-1'), data: { ...retry('deepseek', POLICY_KEY, 1, 'r-1').data, retry: 1.5 } },
    { ...retry('deepseek', POLICY_KEY, 1, 'r-1'), data: { ...retry('deepseek', POLICY_KEY, 1, 'r-1').data, retry: '2' } },
  ]
  for (const event of malformed) {
    assert.equal(foldChain(EMPTY_CHAIN_STATE, event, POLICY_KEY), EMPTY_CHAIN_STATE, `不完整载荷不记: ${JSON.stringify(event)}`)
  }
}

// step / turn 边界清空

{
  const state = foldChain(EMPTY_CHAIN_STATE, retry('deepseek', POLICY_KEY, 3, 'r-1'), POLICY_KEY)
  assert.equal(foldChain(state, stepStart(), POLICY_KEY), EMPTY_CHAIN_STATE, '新 step 从零开始计预算')
  assert.deepEqual(foldChain(state, EMPTY_CHAIN_STATE, POLICY_KEY), state, '空状态上再折空状态不变')
  assert.equal(foldChain(state, { type: 'turn/end', data: { turn: 1, reason: { kind: 'error' } } }, POLICY_KEY), EMPTY_CHAIN_STATE, '回合结束清空')
  assert.equal(
    foldChain(EMPTY_CHAIN_STATE, stepStart(), POLICY_KEY),
    EMPTY_CHAIN_STATE,
    '本来就是空状态时返回同一引用（不制造无谓的下游计算）',
  )
}

// 跨 step 同提供方不会串号

{
  let state = foldChain(EMPTY_CHAIN_STATE, retry('deepseek', POLICY_KEY, 1, 'r-1'), POLICY_KEY)
  state = foldChain(state, stepStart(1, 2), POLICY_KEY)
  assert.equal(previousAttempt(state, 'deepseek', POLICY_KEY), undefined, 'step 变了，预算重来')
}

console.log('chain checks passed')
