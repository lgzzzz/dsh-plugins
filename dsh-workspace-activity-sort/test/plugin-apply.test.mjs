/**
 * 宿主挂载测试（假 ctx）：验证插件形状、会话活动上浮、新会话落位后上浮、
 * 拖拽与改名不被覆盖、注册表拒绝时的降级，以及卸载后停手。
 *
 * 运行：`node test/plugin-apply.test.mjs`。
 */
import assert from 'node:assert/strict'
import * as plugin from '../index.ts'
import { createHarness, sessionFixture, settle, ws } from './helpers.mjs'

const { apply, inject, name } = plugin

// 插件形状

assert.equal(name, 'dsh-workspace-activity-sort', '导出 name 与包名一致')
assert.deepEqual(inject, ['workspaceRegistry'], '声明依赖 Workspace 注册表')
assert.equal(typeof apply, 'function', '导出 apply')
assert.equal(plugin.default.name, name, '默认导出的 name 与具名导出一致')
assert.equal(plugin.default.apply, apply, '默认导出的 apply 与具名导出一致')
assert.deepEqual(plugin.default.inject, inject, '默认导出带 inject')
assert.equal(plugin.Config, undefined, '没有配置项：策略只有「会话活跃即上浮」这一条')

// 会话活动让工作区上浮

{
  const harness = createHarness({ entities: [ws('a', ['s-a']), ws('b', ['s-b']), ws('c', ['s-c'])] })
  harness.apply(plugin)
  await settle()
  assert.deepEqual(harness.registry.order, ['a', 'b', 'c'], '挂载本身不动顺序')
  assert.deepEqual(harness.registry.inserts, [], '挂载时不写盘')

  harness.activity('s-c')
  await settle()
  assert.deepEqual(harness.registry.order, ['c', 'a', 'b'], 'c 上浮到最前，其余相对顺序不变')
  assert.deepEqual(harness.registry.inserts, ['c→a前'], '一次上浮只写一次注册表')
  assert.ok(
    harness.logs.info.some((line) => line.includes('1 次移动')),
    '首次真实上浮打一条 info 日志',
  )
  assert.deepEqual(harness.logs.warn, [], '没有告警')
  harness.dispose()
}

// 已在最前 / Ungrouped 都不写盘

{
  const harness = createHarness({ entities: [ws('a', ['s-a']), ws('b', ['s-b'])] })
  harness.apply(plugin)
  await settle()
  harness.activity('s-a')
  await settle()
  assert.deepEqual(harness.registry.inserts, [], '已经在最前时一次写盘都不发生')

  harness.activity('s-ungrouped')
  await settle()
  assert.deepEqual(harness.registry.inserts, [], '不属于任何工作区的会话（Ungrouped）没有可上浮的分组')
  assert.deepEqual(harness.logs.warn, [], '没有告警')
  harness.dispose()
}

// 只有第一次上浮报 info

{
  const harness = createHarness({ entities: [ws('a', ['s-a']), ws('b', ['s-b']), ws('c', ['s-c'])] })
  harness.apply(plugin)
  await settle()
  harness.activity('s-c')
  await settle()
  harness.activity('s-a')
  await settle()
  assert.deepEqual(harness.registry.order, ['a', 'c', 'b'], '之后的活动继续上浮')
  assert.equal(harness.logs.info.length, 1, 'info 只报一次')
  assert.ok(harness.logs.debug.length >= 1, '之后的真实上浮降为 debug')
  harness.dispose()
}

// 新会话落位才上浮

{
  const harness = createHarness({ entities: [ws('a', ['s-a']), ws('b', [])] })
  harness.apply(plugin)
  await settle()
  harness.created(sessionFixture('s-new'))
  await settle()
  assert.deepEqual(harness.registry.inserts, [], '此刻注册表还没把新会话记到工作区账下，不上浮')

  harness.registry.attach('b', 's-new')
  await settle()
  assert.deepEqual(harness.registry.order, ['b', 'a'], '新会话落位后，它所属的工作区上浮')
  assert.deepEqual(harness.registry.inserts, ['b→a前'])
  assert.deepEqual(harness.logs.warn, [], '没有告警')
  harness.dispose()
}

// 重新打开旧会话（resume）不是新建

{
  const harness = createHarness({ entities: [ws('a', ['s-a']), ws('b', ['s-old']), ws('c', ['s-c'])] })
  harness.apply(plugin)
  await settle()
  harness.created(sessionFixture('s-old'))
  await settle()
  assert.deepEqual(harness.registry.inserts, [], '打开旧会话不会让它所属的工作区上浮')

  harness.activity('s-c')
  await settle()
  assert.deepEqual(harness.registry.order, ['c', 'a', 'b'], '随后的活动仍然只上浮真正活跃的工作区')
  harness.dispose()
}

// subagent 子会话不参与

{
  const harness = createHarness({ entities: [ws('a', ['s-a']), ws('b', [])] })
  harness.apply(plugin)
  await settle()
  harness.created(sessionFixture('s-child', { origin: 'subagent' }))
  harness.registry.attach('b', 's-child')
  await settle()
  assert.deepEqual(harness.registry.inserts, [], 'subagent 子会话既不算新建也不上浮')
  harness.dispose()
}

// 手动拖拽被保留到下一次活动

{
  const harness = createHarness({ entities: [ws('a', ['s-a']), ws('b', ['s-b']), ws('c', ['s-c'])] })
  harness.apply(plugin)
  await settle()
  await harness.registry.drag('a', undefined) // 用户把 a 拖到末尾
  await settle()
  assert.deepEqual(harness.registry.order, ['b', 'c', 'a'], '平时不动手动顺序')
  assert.deepEqual(harness.registry.inserts, ['a→末尾'], '只发生拖拽自己那一次写入')

  harness.activity('s-a')
  await settle()
  assert.deepEqual(harness.registry.order, ['a', 'b', 'c'], '下一次活动把活跃的工作区拉回最前')
  harness.dispose()
}

// 改名、新建 / 删除工作区都不重排

{
  const harness = createHarness({ entities: [ws('a', ['s-a']), ws('b', ['s-b'])] })
  harness.apply(plugin)
  await settle()
  harness.registry.rename('b', 'renamed')
  await settle()
  assert.deepEqual(harness.registry.order, ['a', 'b'], '改名不是会话活动，不重排')
  assert.deepEqual(harness.registry.inserts, [], '改名不触发任何写入')

  harness.registry.add(ws('c', ['s-c']))
  await settle()
  assert.deepEqual(harness.registry.order, ['c', 'a', 'b'], '新建工作区保持注册表自己的落位')
  harness.dispose()
}

// 突发活动：最后一次停在最前，写入次数等于上浮次数

{
  const harness = createHarness({
    entities: [ws('a', ['s-a']), ws('b', ['s-b']), ws('c', ['s-c']), ws('d', ['s-d'])],
  })
  harness.apply(plugin)
  await settle()
  harness.activity('s-b')
  harness.activity('s-c')
  harness.activity('s-d')
  await settle()
  assert.deepEqual(harness.registry.order, ['d', 'c', 'b', 'a'], '同一批活动按到达顺序逐个上浮')
  assert.equal(harness.registry.inserts.length, 3, '三次上浮三次写入，没有额外放大')
  assert.deepEqual(harness.logs.warn, [], '没有告警')
  harness.dispose()
}

// 新会话落位与活动同一轮：较晚的活动停在最前

{
  const harness = createHarness({ entities: [ws('a', ['s-a']), ws('b', [])] })
  harness.apply(plugin)
  await settle()
  harness.created(sessionFixture('s-new-b'))
  harness.registry.attach('b', 's-new-b')
  harness.activity('s-a')
  await settle()
  assert.deepEqual(harness.registry.order, ['a', 'b'], '同一轮里较晚的会话活动压过新会话落位')
  harness.dispose()
}

// 两个新会话：登记更晚的停在最前

{
  const harness = createHarness({ entities: [ws('a', []), ws('b', []), ws('c', [])] })
  harness.apply(plugin)
  await settle()
  harness.created(sessionFixture('s-1'))
  harness.created(sessionFixture('s-2'))
  harness.registry.attach('b', 's-1')
  harness.registry.attach('c', 's-2')
  await settle()
  assert.deepEqual(harness.registry.order, ['c', 'b', 'a'], '后登记的新会话停得更前')
  harness.dispose()
}

// 一直不落位的登记会到点放弃

{
  const harness = createHarness({ entities: [ws('a', ['s-a']), ws('b', [])] })
  harness.apply(plugin)
  await settle()
  const realNow = Date.now
  let clock = realNow()
  Date.now = () => clock
  try {
    harness.created(sessionFixture('s-orphan'))
    await settle()
    clock += 60_000
    harness.activity('s-a') // 触发一轮：过期的登记在这里被丢掉
    await settle()
    assert.deepEqual(harness.registry.inserts, [], '没有归属的新会话到点后被放弃，也不上浮')

    harness.registry.attach('b', 's-orphan')
    await settle()
    assert.deepEqual(harness.registry.inserts, [], '放弃之后即使落位也不再补一次上浮')
    assert.deepEqual(harness.registry.order, ['a', 'b'])
  } finally {
    Date.now = realNow
  }
  harness.dispose()
}

// 会话被销毁：登记一并作废

{
  const harness = createHarness({ entities: [ws('a', []), ws('b', [])] })
  harness.apply(plugin)
  await settle()
  const orphan = sessionFixture('s-orphan')
  harness.created(orphan)
  harness.disposed(orphan)
  harness.registry.attach('b', 's-orphan')
  await settle()
  assert.deepEqual(harness.registry.inserts, [], '已销毁的会话不再参与上浮')
  harness.dispose()
}

// 注册表拒绝重排：告警但不崩，之后仍能工作

{
  const harness = createHarness({ entities: [ws('a', ['s-a']), ws('b', ['s-b'])], insertFails: true })
  harness.apply(plugin)
  await settle()
  harness.activity('s-b')
  await settle()
  assert.ok(
    harness.logs.warn.some((line) => line.includes('上浮失败')),
    '注册表拒绝时记一条告警',
  )
  assert.deepEqual(harness.registry.order, ['a', 'b'], '失败时顺序保持原样')

  harness.registry.failInserts = false
  harness.activity('s-b')
  await settle()
  assert.deepEqual(harness.registry.order, ['b', 'a'], '恢复后下一次活动照常上浮')
  harness.dispose()
}

// 一批里只有个别工作区被拒绝：其余照常上浮

{
  const harness = createHarness({
    entities: [ws('a', ['s-a']), ws('b', ['s-b']), ws('c', ['s-c'])],
    insertFails: ['c'],
  })
  harness.apply(plugin)
  await settle()
  harness.activity('s-c')
  harness.activity('s-b')
  await settle()
  assert.deepEqual(harness.registry.order, ['b', 'a', 'c'], '被拒绝的工作区只丢它自己那一次上浮')
  assert.ok(
    harness.logs.warn.some((line) => line.includes('上浮失败（c）')),
    '告警点名是哪个工作区',
  )
  harness.dispose()
}

// 卸载后停手

{
  const harness = createHarness({ entities: [ws('a', ['s-a']), ws('b', ['s-b'])] })
  harness.apply(plugin)
  await settle()
  harness.dispose()
  harness.activity('s-b')
  await settle()
  assert.deepEqual(harness.registry.inserts, [], '卸载后不再写入注册表')
  assert.deepEqual(harness.registry.order, ['a', 'b'], '卸载后顺序保持不变')
}

{
  const harness = createHarness({ entities: [ws('a', ['s-a']), ws('b', ['s-b'])] })
  harness.apply(plugin)
  await settle()
  harness.activity('s-b')
  harness.dispose() // 已经排队但还没跑的那一轮
  await settle()
  assert.deepEqual(harness.registry.inserts, [], '卸载会取消已经排队的一轮')
  assert.deepEqual(harness.registry.order, ['a', 'b'])
}

console.log('plugin-apply checks passed')
