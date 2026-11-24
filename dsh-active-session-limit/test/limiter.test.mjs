/**
 * 名额与冷却状态机的行为：准入、排队、冷却、取消、名额接管、销毁清理。
 *
 * 全部用假时钟驱动（`createLimiterHarness().advance(ms)`），不碰真实计时器。
 * 运行：`node test/limiter.test.mjs`（或 pnpm test 跑全部）。
 */
import assert from 'node:assert/strict'
import { createLimiterHarness, flush } from './helpers.mjs'

/** 观察一个准入 Promise 有没有兑现（不 await，避免测试被挂住）。 */
function track(promise) {
  const state = { settled: false }
  state.promise = promise.then(() => { state.settled = true })
  return state
}

const openSignal = () => new AbortController().signal

// ---- 1. 名额未满：直接放行，不排队 ----
{
  const { limiter } = createLimiterHarness()
  await limiter.acquire({ id: 'a' }, openSignal())
  await limiter.acquire({ id: 'b' }, openSignal())
  await limiter.acquire({ id: 'c' }, openSignal())
  assert.equal(limiter.activeCount, 3, '三个会话同时活跃')
  assert.equal(limiter.waitingCount, 0, '没有排队')
  assert.deepEqual([...limiter.snapshot().active].sort(), ['a', 'b', 'c'])
}

// ---- 2. 名额占满：后到的现有会话排队，名额一空出立即放行（不受冷却影响） ----
{
  const { limiter } = createLimiterHarness()
  for (const id of ['a', 'b', 'c']) await limiter.acquire({ id }, openSignal())
  const queued = track(limiter.acquire({ id: 'd' }, openSignal()))
  await flush()
  assert.equal(queued.settled, false, '第四个会话在排队')
  assert.deepEqual(limiter.snapshot().waiting, ['d'])

  limiter.release('a')
  await flush()
  assert.equal(queued.settled, true, '名额空出后立即放行')
  assert.equal(limiter.isActive('d'), true, 'd 占住空出的名额')
  assert.equal(limiter.isActive('a'), false)
}

// ---- 3. 新会话：名额闲置也要等上一个会话结束满 5 秒 ----
{
  const { limiter, advance } = createLimiterHarness()
  await limiter.acquire({ id: 'a' }, openSignal())
  limiter.markNew('n')
  limiter.release('a')

  const queued = track(limiter.acquire({ id: 'n' }, openSignal()))
  await flush()
  assert.equal(queued.settled, false, '名额空着，但冷却未满')

  advance(4999)
  await flush()
  assert.equal(queued.settled, false, '差 1 毫秒也不放行')
  assert.equal(limiter.waitingCount, 1)

  advance(1)
  await flush()
  assert.equal(queued.settled, true, '冷却期满由定时器放行')
  assert.equal(limiter.isActive('n'), true)
}

// ---- 4. 新会话在任何会话结束之前启动，不需要等冷却 ----
{
  const { limiter } = createLimiterHarness()
  limiter.markNew('n')
  await limiter.acquire({ id: 'n' }, openSignal())
  assert.equal(limiter.isActive('n'), true, '没有结束记录时冷却为 0')
}

// ---- 5. 排队期间被取消：不占名额，队列里也不留痕 ----
{
  const { limiter } = createLimiterHarness()
  for (const id of ['a', 'b', 'c']) await limiter.acquire({ id }, openSignal())
  const controller = new AbortController()
  const queued = track(limiter.acquire({ id: 'd' }, controller.signal))
  await flush()
  assert.equal(queued.settled, false)

  controller.abort()
  await flush()
  assert.equal(queued.settled, true, '取消后等待结束')
  assert.equal(limiter.isActive('d'), false, '取消不占名额')
  assert.equal(limiter.waitingCount, 0, '队列里不留痕')
  assert.equal(limiter.activeCount, 3, '原有三个名额不受影响')
}

// ---- 6. 名额占满时，子会话接管父会话的名额；父会话之后重新排队 ----
{
  const { limiter } = createLimiterHarness()
  for (const id of ['parent', 'b', 'c']) await limiter.acquire({ id }, openSignal())

  const child = track(limiter.acquire({ id: 'child', ancestors: ['parent'] }, openSignal()))
  await flush()
  assert.equal(child.settled, true, '子会话立即接管名额')
  assert.equal(limiter.isActive('child'), true)
  assert.equal(limiter.isActive('parent'), false, '父会话暂停')
  assert.deepEqual(limiter.snapshot().suspended, ['parent'])
  assert.equal(limiter.activeCount, 3, '上限仍然成立')

  limiter.release('child')
  const parent = track(limiter.acquire({ id: 'parent', ancestors: [] }, openSignal()))
  await flush()
  assert.equal(parent.settled, true, '父会话下一次提 step 时重新拿到名额')
}

// ---- 7. 暂停中的会话自己结束，同样开始 5 秒冷却 ----
{
  const { limiter, advance } = createLimiterHarness()
  for (const id of ['parent', 'b', 'c']) await limiter.acquire({ id }, openSignal())
  await limiter.acquire({ id: 'child', ancestors: ['parent'] }, openSignal())

  limiter.markNew('n')
  limiter.release('parent') // 暂停中的 parent 结束
  const queued = track(limiter.acquire({ id: 'n' }, openSignal()))
  await flush()
  assert.equal(queued.settled, false, '没有名额空出来，且冷却开始了')
  assert.equal(limiter.snapshot().cooldownRemainingMs > 4900, true, '冷却从 parent 结束起算')
  advance(5000)
  // child、b、c 仍占满名额，冷却期满也不该放行。
  await flush()
  assert.equal(queued.settled, false, '名额仍满，继续排队')

  limiter.release('b')
  await flush()
  assert.equal(queued.settled, false, 'b 的结束重新起算冷却')
  advance(5000)
  await flush()
  assert.equal(queued.settled, true, '名额空出且冷却期满后放行')
}

// ---- 8. 销毁的会话被彻底忘掉 ----
{
  const { limiter } = createLimiterHarness()
  for (const id of ['a', 'b', 'c']) await limiter.acquire({ id }, openSignal())
  limiter.markNew('d')
  const queued = track(limiter.acquire({ id: 'd' }, openSignal()))
  await flush()

  limiter.forget('d')
  await flush()
  assert.equal(queued.settled, true, '排队中销毁：等待结束')
  assert.equal(limiter.waitingCount, 0)

  limiter.forget('a')
  assert.equal(limiter.isActive('a'), false, '在跑时销毁：名额交回')
}

// ---- 9. 插件激活时接管正在跑的会话，名额照样算 ----
{
  const { limiter } = createLimiterHarness()
  limiter.adopt('x')
  limiter.adopt('y')
  limiter.adopt('z')
  assert.equal(limiter.activeCount, 3)

  const queued = track(limiter.acquire({ id: 'w' }, openSignal()))
  await flush()
  assert.equal(queued.settled, false, '接管的名额同样占位')

  limiter.release('x')
  await flush()
  assert.equal(queued.settled, true)
}

// ---- 10. 卸载：放行所有等待者，不再保留状态 ----
{
  const { limiter } = createLimiterHarness()
  for (const id of ['a', 'b', 'c']) await limiter.acquire({ id }, openSignal())
  const queued = track(limiter.acquire({ id: 'd' }, openSignal()))
  await flush()
  assert.equal(queued.settled, false)

  limiter.dispose()
  await flush()
  assert.equal(queued.settled, true, '卸载后等待者被放行')
  assert.equal(limiter.activeCount, 0)
  assert.equal(limiter.waitingCount, 0)
}

// ---- 11. 日志：只有真的排过队才记「等待 / 等后放行」 ----
{
  const { limiter, logs } = createLimiterHarness()
  for (const id of ['a', 'b', 'c']) await limiter.acquire({ id }, openSignal())
  const queued = track(limiter.acquire({ id: 'd' }, openSignal()))
  await flush()
  const waitingLogs = logs.filter(entry => entry.message.includes('waiting for a free slot'))
  assert.equal(waitingLogs.length, 1)
  assert.match(waitingLogs[0].message, /3\/3 active/)
  assert.equal(logs.filter(entry => entry.message.includes('d" admitted')).length, 0)

  limiter.release('a')
  await flush()
  const admittedLogs = logs.filter(entry => entry.message.includes('admitted after waiting'))
  assert.equal(admittedLogs.length, 1, '放行时补一条等待时长')
  assert.match(admittedLogs[0].message, /session "d"/)
}

// ---- 12. maxActive = 1：串行放行 ----
{
  const { limiter } = createLimiterHarness({ maxActive: 1 })
  await limiter.acquire({ id: 'a' }, openSignal())
  const second = track(limiter.acquire({ id: 'b' }, openSignal()))
  await flush()
  assert.equal(second.settled, false)
  limiter.release('a')
  await flush()
  assert.equal(second.settled, true)
  assert.equal(limiter.activeCount, 1)
}

// ---- 13. cooldownMs = 0：只保留名额限制 ----
{
  const { limiter } = createLimiterHarness({ cooldownMs: 0 })
  await limiter.acquire({ id: 'a' }, openSignal())
  limiter.markNew('n')
  limiter.release('a')
  const queued = track(limiter.acquire({ id: 'n' }, openSignal()))
  await flush()
  assert.equal(queued.settled, true, '冷却为 0 时新会话直接放行')
}

console.log('limiter: 13 组断言全部通过')
