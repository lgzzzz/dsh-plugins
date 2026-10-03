/**
 * 真实 cordis 集成测试：用 `new Context()` 起一个真正的宿主上下文，把注册表当成
 * 真服务 provide 进去，再按加载器的方式挂载插件（对象插件 + Config schema），
 * 走真实的事件总线。验证的是假 ctx 测不到的三件事：
 *
 *   1. `inject: ['workspaceRegistry']` 的等待语义——服务缺席时不运行，出现即运行；
 *   2. 导出形态就是 cordis 的 `{ name, inject, Config, apply }` 对象插件，
 *      并且 `{}` 配置会按 schema 展开成默认策略；
 *   3. 非法配置在加载期被拒绝，插件不会带着坏配置跑起来。
 *
 * 运行：`node test/cordis-integration.test.mjs`。
 */
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import plugin, { Config, apply, inject, name } from '../index.ts'
import { FakeRegistry, policy, settle, ws } from './helpers.mjs'

// ---- 导出形态 ----------------------------------------------------------------

assert.equal(plugin.name, name, '默认导出的 name 与具名导出一致')
assert.equal(plugin.apply, apply, '默认导出的 apply 与具名导出一致')
assert.deepEqual(plugin.inject, inject, '默认导出带 inject')
assert.equal(plugin.Config, Config, '默认导出带 Config schema')

// ---- 等待服务 + 真实事件总线 --------------------------------------------------

{
  const root = new Context()
  const registry = new FakeRegistry(
    [ws('c', 'gamma'), ws('a', 'Alpha'), ws('b', 'beta')],
    (change) => root.emit('domain/changed', change),
  )

  const fiber = root.plugin(plugin, { order: 'title-asc' })
  await settle()
  assert.deepEqual(registry.inserts, [], '注册表服务缺席时插件不运行')

  root.provide('workspaceRegistry', registry)
  await fiber
  await settle()
  assert.deepEqual(registry.order, ['a', 'b', 'c'], '真实 cordis 下挂载即按标题排序')

  await registry.insertBefore('a', undefined) // 真实事件总线上的手动拖拽
  await settle()
  assert.deepEqual(registry.order, ['a', 'b', 'c'], '真实事件总线下手动拖拽被自动归位')

  registry.add(ws('d', 'delta'))
  await settle()
  assert.deepEqual(registry.order, ['a', 'b', 'd', 'c'], '真实事件总线下新工作区落进排序位置（delta 在 gamma 前）')

  await fiber.dispose()
  await registry.insertBefore('a', undefined)
  const before = registry.inserts.length
  await settle()
  assert.equal(registry.inserts.length, before, '插件卸载后不再写入注册表')
  assert.deepEqual(registry.order, ['b', 'd', 'c', 'a'], '卸载后注册表保持拖拽后的样子')
  await root.fiber.dispose()
}

// ---- 空配置按 schema 展开为默认策略 ------------------------------------------

{
  const root = new Context()
  const registry = new FakeRegistry(
    [
      ws('a', 'Alpha', 'C:\\work\\a', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
      ws('b', 'beta', 'C:\\work\\b', '2026-01-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z'),
      ws('c', 'gamma', 'C:\\work\\c', '2026-01-01T00:00:00.000Z', '2026-03-01T00:00:00.000Z'),
    ],
    (change) => root.emit('domain/changed', change),
  )
  root.provide('workspaceRegistry', registry)
  await root.plugin(plugin, {})
  await settle()
  assert.deepEqual(
    registry.order,
    ['c', 'b', 'a'],
    '不写配置时按 updated-desc（最近改动的 c 在前，与 title-asc 的 a,b,c 不同）',
  )

  registry.touch('a', '2026-09-01T00:00:00.000Z') // 改名 / 新会话落到 a
  await settle()
  assert.deepEqual(registry.order, ['a', 'c', 'b'], '改动过的工作区上浮到首位')

  const settled = registry.inserts.length
  await settle(24)
  assert.equal(registry.inserts.length, settled, '排序写入不推进 updatedAt，收敛后不再写盘')
  await root.fiber.dispose()
}

// ---- 非法配置在加载期被拒绝 --------------------------------------------------

{
  const root = new Context()
  const registry = new FakeRegistry([ws('a', 'Alpha')], (change) => root.emit('domain/changed', change))
  root.provide('workspaceRegistry', registry)
  await assert.rejects(
    async () => {
      await root.plugin(plugin, { order: 'nonsense' })
    },
    '非法 order 取值让插件加载失败',
  )
  assert.deepEqual(registry.inserts, [], '加载失败时没有碰过注册表')
  await root.fiber.dispose()
}

// ---- 策略确实被采纳 ----------------------------------------------------------

{
  const root = new Context()
  const registry = new FakeRegistry(
    [ws('a', 'Alpha'), ws('b', 'beta'), ws('c', 'gamma')],
    (change) => root.emit('domain/changed', change),
  )
  root.provide('workspaceRegistry', registry)
  await root.plugin(plugin, { order: 'title-desc', pinned: ['gamma'] })
  await settle()
  assert.deepEqual(registry.order, ['c', 'b', 'a'], '置顶 + 降序按配置生效')
  await root.fiber.dispose()
}

console.log('cordis-integration checks passed')
