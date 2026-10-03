/**
 * 宿主挂载测试（假 ctx）：验证插件形状、挂载即排序、已就位不写盘、手动拖拽会被
 * 自动归位、新工作区落进排序位置、置顶、卸载后停手，以及自写入触发的重入不会
 * 变成写盘风暴。真实框架下的挂载见 cordis-integration.test.mjs。
 *
 * 运行：`node test/plugin-apply.test.mjs`。
 */
import assert from 'node:assert/strict'
import { Config, apply, inject, name } from '../index.ts'
import { FakeRegistry, policy, settle, ws } from './helpers.mjs'

/** 假 ctx：只实现插件用到的四件事（inject / on / effect / logger）+ 注册表。 */
function createHarness(entries) {
  const registry = new FakeRegistry(entries)
  const disposers = []
  const logs = { info: [], warn: [], debug: [] }
  const ctx = {
    workspaceRegistry: registry,
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
    on: (_event, listener) => {
      registry.listeners.push(listener)
      return () => {}
    },
    inject: (_dependencies, callback) => {
      callback(ctx)
      return () => {}
    },
  }
  return {
    ctx,
    registry,
    logs,
    dispose: () => {
      for (const dispose of disposers) dispose()
    },
  }
}

// ---- 插件形状 ----------------------------------------------------------------

assert.equal(name, 'dsh-workspace-auto-sort', '导出 name 与包名一致')
assert.deepEqual(inject, ['workspaceRegistry'], '声明依赖 Workspace 注册表')
assert.equal(typeof apply, 'function', '导出 apply')

{
  const resolved = Config({})
  assert.equal(resolved.order, 'updated-desc', '默认排序依据是 updated-desc（最近改动的排最前）')
  assert.deepEqual([...resolved.pinned], [], '默认没有置顶项')
  assert.equal(resolved.caseSensitive, false, '默认不区分大小写')
  assert.equal(Config({ order: 'path-desc' }).order, 'path-desc', '接受合法的排序依据')
}

// ---- 挂载即排序 --------------------------------------------------------------

{
  const harness = createHarness([ws('c', 'gamma'), ws('a', 'Alpha'), ws('b', 'beta')])
  apply(harness.ctx, policy())
  await settle()
  assert.deepEqual(harness.registry.order, ['a', 'b', 'c'], '挂载后立刻按标题排序')
  assert.ok(
    harness.logs.info.some((line) => line.includes('title-asc')),
    '首次真实重排打一条 info 日志',
  )
  assert.deepEqual(harness.logs.warn, [], '没有告警')
  harness.dispose()
}

{
  const harness = createHarness([ws('a', 'Alpha'), ws('b', 'beta')])
  apply(harness.ctx, policy())
  await settle()
  assert.deepEqual(harness.registry.inserts, [], '已就位时一次写入也不发生')
  harness.dispose()
}

// ---- 手动拖拽与新工作区都被拉回排序 ------------------------------------------

{
  const harness = createHarness([ws('a', 'Alpha'), ws('b', 'beta'), ws('c', 'gamma')])
  apply(harness.ctx, policy())
  await settle()
  const before = harness.registry.inserts.length
  await harness.registry.insertBefore('a', undefined) // 用户把 Alpha 拖到末尾
  await settle()
  assert.deepEqual(harness.registry.order, ['a', 'b', 'c'], '手动拖拽后自动归位')
  assert.ok(harness.registry.inserts.length > before, '归位确实写进了注册表')
  assert.deepEqual(harness.logs.warn, [], '没有告警')
  harness.dispose()
}

{
  const harness = createHarness([ws('b', 'beta'), ws('c', 'gamma')])
  apply(harness.ctx, policy())
  await settle()
  harness.registry.add(ws('a', 'Alpha')) // 新工作区默认插到最前
  await settle()
  assert.deepEqual(harness.registry.order, ['a', 'b', 'c'], '新工作区落进排序位置')
  harness.dispose()
}

// ---- 置顶 --------------------------------------------------------------------

{
  const harness = createHarness([ws('c', 'gamma'), ws('a', 'Alpha'), ws('b', 'beta')])
  apply(harness.ctx, policy({ pinned: ['gamma'] }))
  await settle()
  assert.deepEqual(harness.registry.order, ['c', 'a', 'b'], '置顶项留在最前，其余仍有序')
  harness.dispose()
}

// ---- 按最近改动（updated-desc）排序 -------------------------------------------

{
  const harness = createHarness([
    ws('a', 'Alpha', 'C:\\work\\a', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
    ws('b', 'beta', 'C:\\work\\b', '2026-01-01T00:00:00.000Z', '2026-05-01T00:00:00.000Z'),
  ])
  apply(harness.ctx, policy({ order: 'updated-desc' }))
  await settle()
  assert.deepEqual(harness.registry.order, ['b', 'a'], '最近改动的工作区排最前')

  const before = harness.registry.inserts.length
  harness.registry.touch('a', '2026-09-01T00:00:00.000Z') // 相当于改名 / 新会话落到 a
  await settle()
  assert.deepEqual(harness.registry.order, ['a', 'b'], '被改动的工作区上浮到首位')
  assert.ok(harness.registry.inserts.length > before, '上浮确实写进了注册表')

  const settled = harness.registry.inserts.length
  await settle(24)
  assert.equal(harness.registry.inserts.length, settled, '自己写入的排序不推进 updatedAt，不会自我追逐')
  assert.deepEqual(harness.logs.warn, [], '没有告警')
  harness.dispose()
}

// ---- 重入不放大 --------------------------------------------------------------

{
  const entries = [5, 4, 3, 2, 1].map((index) => ws(`w${index}`, `project${index}`))
  const harness = createHarness(entries)
  apply(harness.ctx, policy())
  await settle(24)
  assert.deepEqual(
    harness.registry.order,
    ['w1', 'w2', 'w3', 'w4', 'w5'],
    '完全逆序也收敛到排序结果',
  )
  assert.ok(harness.registry.inserts.length <= 4, '移动次数不超过 n-1（自己写入触发的第二轮不写盘）')
  assert.deepEqual(harness.logs.warn, [], '没有写盘风暴告警')
  harness.dispose()
}

// ---- 卸载后停手 --------------------------------------------------------------

{
  const harness = createHarness([ws('a', 'Alpha'), ws('b', 'beta')])
  apply(harness.ctx, policy())
  await settle()
  harness.dispose()
  await harness.registry.insertBefore('a', undefined)
  const before = harness.registry.inserts.length
  await settle()
  assert.equal(harness.registry.inserts.length, before, '卸载后不再写入注册表')
  assert.deepEqual(harness.registry.order, ['b', 'a'], '卸载后注册表保持拖拽后的样子')
  harness.dispose()
}

// ---- 服务缺失 ----------------------------------------------------------------

{
  const requested = []
  const ctx = {
    inject: (dependencies, _callback) => {
      requested.push(dependencies)
      return () => {}
    },
  }
  assert.doesNotThrow(() => apply(ctx, policy()), '注册表缺席时挂载不抛错')
  assert.deepEqual(requested, [['workspaceRegistry']], '只请求注册表这一个服务')
}

console.log('plugin-apply checks passed')
