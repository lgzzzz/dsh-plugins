/**
 * 真实 cordis 集成测试：用 `new Context()` 起宿主上下文，把注册表 provide 成真服务，
 * 以对象插件方式按加载器挂载，走真实事件总线。验证两件事：`inject: ['workspaceRegistry']`
 * 的等待语义（服务缺席时不运行，出现即运行），以及三条事件（`api-session/activity`、
 * `session/created` + `domain/changed`、`session/disposed`）确实驱动上浮。
 *
 * 运行：`node test/cordis-integration.test.mjs`。
 */
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import plugin, { apply, inject, name } from '../index.ts'
import { FakeRegistry, sessionFixture, settle, ws } from './helpers.mjs'

// 导出形态

assert.equal(plugin.name, name, '默认导出的 name 与具名导出一致')
assert.equal(plugin.apply, apply, '默认导出的 apply 与具名导出一致')
assert.deepEqual(plugin.inject, inject, '默认导出带 inject')
assert.equal(plugin.Config, undefined, '没有配置 schema：插件不接受配置')

// 等待服务 + 真实事件总线上的活动

{
  const root = new Context()
  const registry = new FakeRegistry(
    [ws('a', ['s-a']), ws('b', ['s-b'])],
    (change) => root.emit('domain/changed', change),
  )

  const fiber = root.plugin(plugin)
  await settle()
  assert.deepEqual(registry.inserts, [], '注册表服务缺席时插件不运行')

  root.provide('workspaceRegistry', registry)
  await fiber
  await settle()
  assert.deepEqual(registry.inserts, [], '挂载本身不改顺序')

  root.emit('api-session/activity', 's-b', Date.now())
  await settle()
  assert.deepEqual(registry.order, ['b', 'a'], '真实事件总线下：会话活动让工作区上浮')

  await registry.drag('b', undefined) // 用户在真实总线上把 b 拖到末尾
  await settle()
  assert.deepEqual(registry.order, ['a', 'b'], '插件不覆盖手动拖拽')

  await fiber.dispose()
  root.emit('api-session/activity', 's-a', Date.now())
  await settle()
  assert.deepEqual(registry.order, ['a', 'b'], '卸载后不再重排')
  await root.fiber.dispose()
}

// 真实事件总线上的新会话落位

{
  const root = new Context()
  const registry = new FakeRegistry(
    [ws('a', ['s-a']), ws('b', [])],
    (change) => root.emit('domain/changed', change),
  )
  root.provide('workspaceRegistry', registry)
  const fiber = root.plugin(plugin)
  await settle()

  root.emit('session/created', sessionFixture('s-new'))
  await settle()
  assert.deepEqual(registry.inserts, [], '新会话此刻还没有工作区归属')
  assert.deepEqual(registry.order, ['a', 'b'])

  registry.attach('b', 's-new') // 工作区表的持久写入，经真实总线到达插件
  await settle()
  assert.deepEqual(registry.order, ['b', 'a'], '真实事件总线下：新会话落位后其上浮')
  assert.deepEqual(registry.inserts, ['b→a前'])

  await fiber.dispose()
  await root.fiber.dispose()
}

// 真实事件总线上的会话销毁

{
  const root = new Context()
  const registry = new FakeRegistry(
    [ws('a', []), ws('b', [])],
    (change) => root.emit('domain/changed', change),
  )
  root.provide('workspaceRegistry', registry)
  const fiber = root.plugin(plugin)
  await settle()

  const orphan = sessionFixture('s-orphan')
  root.emit('session/created', orphan)
  root.emit('session/disposed', orphan)
  await settle()
  registry.attach('b', 's-orphan')
  await settle()
  assert.deepEqual(registry.inserts, [], '真实事件总线下：已销毁的会话不参与上浮')

  await fiber.dispose()
  await root.fiber.dispose()
}

console.log('cordis-integration checks passed')
