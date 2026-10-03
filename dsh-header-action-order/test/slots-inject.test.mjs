/**
 * 装配与重排:`src/client.ts` 装进假 slots 后 —— inject 后立刻重排、
 * 后到注册被重放带回、冻结 options 只放弃那一条、服务缺席 / entries 抛错
 * 时 no-op。
 *
 * 运行:`node test/slots-inject.test.mjs`(或 pnpm test 跑全部)。
 */
import { applyHeaderActionOrder } from '../src/order.ts'
import {
  EXPECTED,
  FakeSlots,
  HEADER_ACTION_SLOT,
  applyPlugin,
  captureWarnings,
  check,
  entry,
  finish,
  upstreamEntries,
} from './helpers.mjs'

console.log('--- B① slots.inject 后立刻重排,渲染序为目标序 ---')
{
  const slots = new FakeSlots(upstreamEntries())
  applyPlugin({ get: (name) => (name === 'slots' ? slots : undefined) })
  check('注入的槽', slots.injected, [HEADER_ACTION_SLOT])
  check('渲染序', slots.renderedOrder(), EXPECTED)
  check('已登记注册变化订阅', slots.listenerCount(), 1)
}

console.log('--- B② 后到的注册(独立 bundle 的图标)被重放带进正确的位 ---')
{
  const slots = new FakeSlots(upstreamEntries())
  applyPlugin({ get: (name) => (name === 'slots' ? slots : undefined) })
  slots.register(entry('desktop-notify', 120))
  check('后到图标排最后', slots.renderedOrder(), [...EXPECTED, 'desktop-notify'])
  slots.register(entry('agent-team-late', 20))
  check('后到图标按原 order 落在未列出段', slots.renderedOrder(), [
    ...EXPECTED,
    'agent-team-late',
    'desktop-notify',
  ])
}

console.log('--- B③ 冻结的 options:只放弃那一条,其余照写 ---')
{
  const frozen = { options: Object.freeze({ id: 'agent-preset', order: -10 }) }
  const slots = new FakeSlots([frozen, entry('job-list', 20), entry('agent-team', 20)])
  let written
  const warnings = captureWarnings(() => {
    written = applyHeaderActionOrder(slots)
  })
  check('只写了能写的', written, 2)
  check('冻结项保持原序', frozen.options.order, -10)
  check('渲染序(冻结项仍在最前)', slots.renderedOrder(), ['agent-preset', 'agent-team', 'job-list'])
  check('记了一条 warn', warnings.length, 1)
}

console.log('--- B④ 服务缺席 / entries 抛错:no-op,不抛 ---')
{
  applyPlugin({})
  applyPlugin({ get: () => undefined })
  const throwing = new FakeSlots(upstreamEntries())
  throwing.entriesThrows = true
  let threw = null
  const warnings = captureWarnings(() => {
    try {
      applyPlugin({ get: (name) => (name === 'slots' ? throwing : undefined) })
    } catch (error) {
      threw = error
    }
  })
  check('entries 抛错不冒泡', threw, null)
  check('entries 抛错记了 warn', warnings.length, 1)
  check('注册变化订阅仍已登记', throwing.listenerCount(), 1)
}

finish()
