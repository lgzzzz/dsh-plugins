/**
 * B 包装与装配:原地包装 + slots 装配 —— 包装后就地生效、收起时机可切换且
 * 投影引用稳定、注入面透传、幂等、晚到注册、目标缺席自检(有界窗口)、形状变化
 * 告警,以及服务缺席 / entries 抛错 / 无 inject 方法时的 no-op。
 */
import { createFoldPatchState, wrapPresentationSource } from '../src/policy-fold.ts'
import { apply as applyPlugin } from '../src/client.ts'
import {
  captureWarnings, chatEntry, check, checkTrue, FakeSlots, finish, makeSource,
  MISSING_PROBE_MS, probeWindowMs, sleep, waitFor,
} from './helpers.mjs'

console.log('--- B① 包装后就地生效:收起时机两种取值都读取到折叠值 ---')
{
  const { source, setMode, setTiming } = makeSource('verbose', 'completion')
  const state = createFoldPatchState()
  check('首次包装返回 true', wrapPresentationSource(source, state), true)

  const completion = source.getSnapshot()
  check('completion 下关闭完整展开豁免', completion.foldCompletedTurns, true)
  check('completion 被保留', completion.collapseTiming, 'completion')

  setTiming('next-input')
  const nextInput = source.getSnapshot()
  check('next-input 下仍折叠', nextInput.foldCompletedTurns, true)
  check('next-input 被保留', nextInput.collapseTiming, 'next-input')
  checkTrue('同一策略重复读取保持同一投影对象', source.getSnapshot() === nextInput)

  setMode('detailed')
  const detailed = source.getSnapshot()
  check('detailed 不受影响', detailed.foldCompletedTurns, true)
  check('detailed 保持 history', detailed.stepGrouping, 'history')
  check('detailed 保留当前收起时机', detailed.collapseTiming, 'next-input')

  setMode('verbose')
  check('切回 verbose 继续折叠', source.getSnapshot().foldCompletedTurns, true)
  check('重复包装返回 false', wrapPresentationSource(source, state), false)
  check('patchedCount 只记一次', state.patchedCount, 1)
}

console.log('--- B② 装配:slots.inject 后即打,渲染读走折叠后的值 ---')
{
  const { source } = makeSource('verbose', 'next-input')
  const entry = chatEntry(source)
  const slots = new FakeSlots([entry])
  applyPlugin({ get: (name) => (name === 'slots' ? slots : undefined) })
  check('注入的槽', slots.injected, ['conversation.view'])
  check('已登记注册变化订阅', slots.listenerCount(), 1)

  const face = entry.inject()
  checkTrue('注入面透传 hooks', face.hooks.presentation === source)
  checkTrue('openFile 等其余成员原样保留', typeof face.openFile === 'function')
  const policy = face.hooks.presentation.getSnapshot()
  check('verbose 折叠', policy.foldCompletedTurns, true)
  check('收起时机未被改写', policy.collapseTiming, 'next-input')
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
}

console.log('--- B④ 晚到的注册(ui-chat 在本插件之后 apply)也被打上 ---')
{
  const { source } = makeSource('verbose', 'next-input')
  const slots = new FakeSlots([])
  applyPlugin({ get: (name) => (name === 'slots' ? slots : undefined) })
  const entry = chatEntry(source)
  slots.register(entry)
  const policy = entry.inject().hooks.presentation.getSnapshot()
  check('后到注册的 inject 被包装', policy.foldCompletedTurns, true)
  check('后到注册仍保留收起时机', policy.collapseTiming, 'next-input')
}

console.log('--- B⑤ 目标缺席:no-op 不抛,窗口走完才告警一次 ---')
{
  const slots = new FakeSlots([])
  const warnings = []
  const original = console.warn
  // 告警由自检窗口的定时器异步发出,所以整个等待期间都替换 console.warn。
  console.warn = (...args) => warnings.push(args[0])
  try {
    applyPlugin({ get: (name) => (name === 'slots' ? slots : undefined) })
    check('同步阶段不告警', warnings.length, 0)
    checkTrue('窗口走完告警一次', await waitFor(() => warnings.length > 0))
    check('只告警一次', warnings.length, 1)
    checkTrue('告警含槽名', String(warnings[0]).includes('conversation.view'))
  } finally {
    console.warn = original
  }
}

console.log('--- B⑥ 形状变化:告警一次,注入面原样返回 ---')
{
  const entry = { options: { id: 'chat' }, inject: () => ({ hooks: {} }) }
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

console.log('--- B⑧ 启动期误报回归:chat 注册项晚到(窗口内)照样打上,且不告警 ---')
{
  const { source } = makeSource('verbose', 'next-input')
  const slots = new FakeSlots([])
  const warnings = []
  const original = console.warn
  // 整个窗口都替换 console.warn:断言要覆盖窗口内的全部时段,期间发出的告警一条都不能漏到真控制台。
  console.warn = (...args) => warnings.push(args[0])
  try {
    applyPlugin({ get: (name) => (name === 'slots' ? slots : undefined) })
    // 复刻真实启动:槽已声明,但 ui-chat 的包与它的依赖链还没激活,注册项晚几拍才到。
    await sleep(MISSING_PROBE_MS * 2)
    const entry = chatEntry(source)
    slots.register(entry)
    const policy = entry.inject().hooks.presentation.getSnapshot()
    check('晚到注册的 inject 被包装', policy.foldCompletedTurns, true)
    check('晚到注册仍保留收起时机', policy.collapseTiming, 'next-input')
    await sleep(probeWindowMs())
    check('窗口内到齐就不告警', warnings, [])
  } finally {
    console.warn = original
  }
}

console.log('--- B⑨ source 被冻结:告警一次,注入面原样返回 ---')
{
  const frozen = Object.freeze({
    getSnapshot: () => makeSource('verbose').source.getSnapshot(),
    subscribe: () => () => {},
  })
  const entry = { options: { id: 'chat' }, inject: () => ({ hooks: { presentation: frozen }, other: 1 }) }
  const slots = new FakeSlots([entry])
  applyPlugin({ get: (name) => (name === 'slots' ? slots : undefined) })
  const warnings = captureWarnings(() => {
    const face = entry.inject()
    check('其他注入成员原样保留', face.other, 1)
    entry.inject()
  })
  check('冻结 source 只告警一次', warnings.length, 1)
  checkTrue('告警提到 source', String(warnings[0]).includes('source'))
}

finish()
