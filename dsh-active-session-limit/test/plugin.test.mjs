/**
 * 插件接线：`apply()` 是否按设计挂上四条 `agent/*` 通路、接管在跑的会话、
 * 挡住超额会话、在结束后（并等满冷却）放行，以及取消 / 卸载 / 销毁时的收尾。
 *
 * 冷却用真实计时器，所以这里设成 30 ms；其余断言都靠 `agent/created`、`agent/status`、
 * `agent/pre-step` 三个事件模拟宿主行为。
 * 运行：`node test/plugin.test.mjs`（或 pnpm test 跑全部）。
 */
import assert from 'node:assert/strict'
import { Config, apply, inject, name } from '../index.ts'
import { createAgent, createPluginHarness, delay, flush } from './helpers.mjs'

/** 超时保护：插件没放行时让测试失败，而不是挂住。 */
function withTimeout(promise, milliseconds, label) {
  return Promise.race([
    promise,
    delay(milliseconds).then(() => { throw new Error(`等待超时：${label}`) }),
  ])
}

// ---- 1. 插件形状与配置默认值 ----
assert.equal(name, 'dsh-active-session-limit')
assert.deepEqual(inject, ['agents'], '声明依赖 agents 服务')
assert.equal(typeof apply, 'function')
assert.deepEqual(Config({}), { maxActive: 3, cooldownMs: 5000 }, '默认上限 3、冷却 5000 ms')
assert.deepEqual(Config({ maxActive: 1, cooldownMs: 0 }), { maxActive: 1, cooldownMs: 0 })
assert.throws(() => Config({ maxActive: 0 }), /maxActive/, '上限至少 1')

// ---- 2. 插件激活时接管已经在跑的会话，名额照样算 ----
{
  const running = createAgent({ id: 'running', status: 'running', lastTurn: 2 })
  const harness = createPluginHarness({ agents: [running] })
  assert.equal(harness.logged('already running').length, 1, '接管的会话写一行日志')

  const a = createAgent({ id: 'a' })
  const b = createAgent({ id: 'b' })
  const c = createAgent({ id: 'c' })
  await harness.startRun(a).promise
  await harness.startRun(b).promise
  const runC = harness.startRun(c)
  await flush()
  assert.equal(runC.entered(), 0, '接管后只剩两个名额')

  harness.finishRun(running)
  await withTimeout(runC.promise, 500, '接管会话结束后放行第三个')
  assert.equal(runC.entered(), 1)
}

// ---- 3. 新会话要等「上一个会话结束满 5 秒」，已有会话只受名额限制 ----
{
  const harness = createPluginHarness({ cooldownMs: 30 })
  const a = createAgent({ id: 'a' })
  await harness.startRun(a).promise

  harness.finishRun(a) // 冷却从这里起算

  // 已有会话（有历史回合）：名额空着就立即放行。
  const existing = createAgent({ id: 'existing', lastTurn: 3 })
  harness.createSession(existing)
  const runExisting = harness.startRun(existing, { turn: 4 })
  await withTimeout(runExisting.promise, 500, '已有会话放行')
  assert.equal(runExisting.entered(), 1)

  // 新会话：即使名额空着，也要等冷却。
  const fresh = createAgent({ id: 'fresh', lastTurn: 0 })
  harness.createSession(fresh)
  const runFresh = harness.startRun(fresh)
  await flush()
  assert.equal(runFresh.entered(), 0, '新会话在冷却里等待')
  await delay(10)
  await flush()
  assert.equal(runFresh.entered(), 0, '冷却未满不放行')
  await withTimeout(runFresh.promise, 500, '新会话冷却期满放行')
  assert.equal(runFresh.entered(), 1)
  assert.equal(harness.logged('waiting for a free slot').length >= 1, true, '等待写进宿主日志')
}

// ---- 4. 名额占满时子会话接管在跑的父会话名额 ----
{
  const harness = createPluginHarness()
  const parent = createAgent({ id: 'parent', lastTurn: 4 })
  const b = createAgent({ id: 'b' })
  const c = createAgent({ id: 'c' })
  harness.createSession(parent)
  await harness.startRun(parent).promise
  await harness.startRun(b).promise
  await harness.startRun(c).promise

  const child = createAgent({ id: 'child', origin: 'subagent', parentSession: 'parent', lastTurn: 0 })
  harness.createSession(child)
  const runChild = harness.startRun(child)
  await withTimeout(runChild.promise, 500, '子会话接管名额')
  assert.equal(runChild.entered(), 1)
  assert.equal(harness.logged('released its slot').length, 1, '父会话暂停并写一行日志')

  // 子会话结束、名额空出后，父会话下一次提 step 直接通过。
  harness.finishRun(child)
  const runParent = harness.startRun(parent, { turn: 5 })
  await withTimeout(runParent.promise, 500, '父会话重新拿到名额')
  assert.equal(runParent.entered(), 1)
}

// ---- 5. 排队期间被取消：不占名额，这一轮按取消结束 ----
{
  const harness = createPluginHarness({ maxActive: 2 })
  await harness.startRun(createAgent({ id: 'a' })).promise
  await harness.startRun(createAgent({ id: 'b' })).promise

  const runC = harness.startRun(createAgent({ id: 'c' }))
  await flush()
  assert.equal(runC.entered(), 0)
  runC.abort()
  await assert.rejects(runC.promise, error => error?.name === 'AbortError', '取消以 AbortError 结束')
  assert.equal(runC.entered(), 0, '被取消的会话没有进入 step')
  assert.equal(harness.logged('waiting for a free slot').length, 1)
}

// ---- 6. 排队中销毁的会话不再占队列 ----
{
  const harness = createPluginHarness({ maxActive: 1 })
  const a = createAgent({ id: 'a' })
  await harness.startRun(a).promise
  const b = createAgent({ id: 'b' })
  const runB = harness.startRun(b)
  await flush()
  assert.equal(runB.entered(), 0)

  harness.disposeSession(b)
  harness.disposeSession(a)
  await withTimeout(runB.promise, 500, '销毁排队会话后等待结束')
  assert.equal(runB.entered(), 1)
}

// ---- 7. 卸载插件：放行所有等待者，并把清理函数跑掉 ----
{
  const harness = createPluginHarness({ maxActive: 1 })
  await harness.startRun(createAgent({ id: 'a' })).promise
  const runB = harness.startRun(createAgent({ id: 'b' }))
  await flush()
  assert.equal(runB.entered(), 0)

  await harness.unload()
  await withTimeout(runB.promise, 500, '卸载后放行等待者')
  assert.equal(runB.entered(), 1)
}

console.log('plugin: 7 组断言全部通过')
