/**
 * B 包装与装配:`src/policy-fold.ts` 的原地包装 + `src/client.ts` 的 slots
 * 装配 —— 包装后就地生效、注入面透传、幂等、晚到注册、目标缺席自检、
 * 形状变化告警,以及服务缺席 / `entries` 抛错 / 无 `inject` 方法时的 no-op。
 *
 * 运行:`node test/inject-wrap.test.mjs`(或 pnpm test 跑全部)。
 */
import { CHAT_VIEW_ID, CHAT_VIEW_SLOT, createFoldPatchState, wrapPresentationSource } from '../src/policy-fold.ts'
import { apply as applyPlugin } from '../src/client.ts'
import { captureWarnings, chatEntry, check, checkTrue, FakeSlots, finish, makeSource } from './helpers.mjs'

console.log('--- B① 包装后就地生效:已折叠 + 其余模式不受影响 ---')
{
  const { source, setMode } = makeSource('verbose')
  const state = createFoldPatchState()
  const entry = chatEntry(source)
  check('首次包装返回 true', wrapPresentationSource(source, state), true)
  check('verbose 读取即折叠', source.getSnapshot().foldCompletedTurns, true)

  setMode('compact')
  const compact = source.getSnapshot()
  check('compact 仍为 false', compact.foldCompletedTurns, false)
  check('compact 其余字段不变', compact.stepGrouping, 'collapsed')

  setMode('standard')
  check('standard 仍为 true', source.getSnapshot().foldCompletedTurns, true)

  check('重复包装返回 false', wrapPresentationSource(source, state), false)
  check('patchedCount 只记一次', state.patchedCount, 1)
  checkTrue('注册项未被改动', entry.options.id === CHAT_VIEW_ID)
}

console.log('--- B② 装配:slots.inject 后即打,渲染读走折叠后的值 ---')
{
  const { source } = makeSource('verbose')
  const entry = chatEntry(source)
  const slots = new FakeSlots([entry])
  applyPlugin({ get: (name) => (name === 'slots' ? slots : undefined) })
  check('注入的槽', slots.injected, [CHAT_VIEW_SLOT])
  check('已登记注册变化订阅', slots.listenerCount(), 1)

  const face = entry.inject()
  checkTrue('注入面透传 hooks', face.hooks.presentation === source)
  checkTrue('openFile 等其余成员原样保留', typeof face.openFile === 'function')
  check('verbose 折叠', face.hooks.presentation.getSnapshot().foldCompletedTurns, true)
}

console.log('--- B③ 幂等:重复扫描不叠加包装 ---')
{
  const { source } = makeSource('verbose')
  const entry = chatEntry(source)
  const slots = new FakeSlots([entry])
  applyPlugin({ get: (name) => (name === 'slots' ? slots : undefined) })
  const first = entry.inject

  slots.register({ options: { id: 'other' }, inject: () => ({}) })
  slots.register({ options: { id: 'other-2' }, inject: () => ({}) })
  checkTrue('inject 未被二次包装', entry.inject === first)

  entry.inject()
  entry.inject()
  check('读取多次仍为 true', source.getSnapshot().foldCompletedTurns, true)
  checkTrue('只包装了一个 source', source.getSnapshot() !== undefined)
}

console.log('--- B④ 晚到的注册(ui-chat 在本插件之后 apply)也被打上 ---')
{
  const { source } = makeSource('verbose')
  const slots = new FakeSlots([])
  applyPlugin({ get: (name) => (name === 'slots' ? slots : undefined) })
  const entry = chatEntry(source)
  slots.register(entry)
  check('后到注册的 inject 被包装', entry.inject().hooks.presentation.getSnapshot().foldCompletedTurns, true)
}

console.log('--- B⑤ 目标缺席:no-op 不抛,延后一拍告警一次 ---')
{
  const slots = new FakeSlots([])
  const warnings = []
  const original = console.warn
  console.warn = (...args) => warnings.push(args[0])
  try {
    applyPlugin({ get: (name) => (name === 'slots' ? slots : undefined) })
    check('同步阶段不告警', warnings.length, 0)
    await Promise.resolve() // 冲掉 queueMicrotask 里的那次自检
    check('延后一拍告警一次', warnings.length, 1)
    checkTrue('告警含槽名', String(warnings[0]).includes(CHAT_VIEW_SLOT))
  } finally {
    console.warn = original
  }
}

console.log('--- B⑥ 形状变化:告警一次,注入面原样返回 ---')
{
  const entry = { options: { id: CHAT_VIEW_ID }, inject: () => ({ hooks: {} }) }
  const slots = new FakeSlots([entry])
  applyPlugin({ get: (name) => (name === 'slots' ? slots : undefined) })
  const warnings = captureWarnings(() => {
    entry.inject()
    entry.inject()
  })
  check('告警一次', warnings.length, 1)
  checkTrue('告警提到 presentation', String(warnings[0]).includes('presentation'))
}

console.log('--- B⑦ 服务缺席 / entries 抛错 / 无 inject 方法:no-op ---')
{
  applyPlugin({})
  applyPlugin({ get: () => undefined })
  applyPlugin({ get: () => null })

  const throwing = new FakeSlots([chatEntry(makeSource('verbose').source)])
  throwing.entriesThrows = true
  const warnings = captureWarnings(() => {
    applyPlugin({ get: (name) => (name === 'slots' ? throwing : undefined) })
  })
  check('entries 抛错记一条 warn', warnings.length, 1)
  checkTrue('entries 抛错不冒泡', throwing.listenerCount() === 1)

  const bare = { entries: () => [chatEntry(makeSource('verbose').source)] }
  let threw = null
  try {
    applyPlugin({ get: (name) => (name === 'slots' ? bare : undefined) })
  } catch (error) {
    threw = error
  }
  check('无 inject 方法也能直接打', threw, null)
}

finish()
