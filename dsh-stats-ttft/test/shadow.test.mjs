/**
 * 账本遮蔽：空账本、安装、保持、源项重建、源项消失、嵌套对账，以及注册选项的
 * order / locale / inject 透传与 priority 递减。
 *
 * 运行：`node test/shadow.test.mjs`（或 pnpm test 跑全部）。
 */
import {
  createShadowState,
  findSourceEntry,
  reconcileShadow,
  shadowOptions,
  withdrawShadow,
  STATS_ID,
  STATS_SLOT,
} from '../src/shadow.ts'
import { FakeSlots, check, checkSame, finish } from './helpers.mjs'

const inner = () => null
const inner2 = () => null
const injectFace = () => ({ hooks: { performanceUsage: () => 'detailed' } })

function source(overrides = {}) {
  return {
    component: inner,
    options: { id: STATS_ID, order: 0, label: 'Stats' },
    locale: 'chat',
    inject: injectFace,
    ...overrides,
  }
}

console.log('--- A 空账本 ---')
{
  const slots = new FakeSlots()
  const state = createShadowState()
  check('absent', reconcileShadow(slots, state, () => 'wrapped'), 'absent')
  check('没有注册', slots.registrations.length, 0)
}

console.log('--- B 首次遮蔽 ---')
const slots = new FakeSlots()
const state = createShadowState()
const firstSource = source()
const firstWrapped = function Wrapped() {
  return null
}
slots.setEntries(STATS_SLOT, [firstSource])
check('install', reconcileShadow(slots, state, () => firstWrapped), 'install')
{
  const reg = slots.registrations[0]
  check('注册 id', reg.options.id, STATS_ID)
  check('保持 order', reg.options.order, 0)
  check('保持 label', reg.options.label, 'Stats')
  check('保持 locale', reg.options.locale, 'chat')
  checkSame('inject 透传', reg.options.inject, injectFace)
  check('priority 取源项减一', reg.options.priority, -1)
  checkSame('component 是包装层', reg.component, firstWrapped)
  check('账本里源项与遮蔽项并存', slots.entries(STATS_SLOT).length, 2)
}

console.log('--- C 同一个源项保持 ---')
{
  const outcome = reconcileShadow(slots, state, () => {
    throw new Error('不应重建')
  })
  check('hold', outcome, 'hold')
  check('没有重复注册', slots.registrations.length, 1)
}

console.log('--- D 源项换对象 ---')
{
  const secondSource = source({ component: inner2 })
  const ours = slots.entries(STATS_SLOT).find((entry) => entry.component === firstWrapped)
  slots.setEntries(STATS_SLOT, [secondSource, ours])
  let secondWrapped
  const outcome = reconcileShadow(slots, state, () => {
    secondWrapped = function Wrapped2() {
      return null
    }
    return secondWrapped
  })
  check('replace', outcome, 'replace')
  check('旧遮蔽项已撤回', slots.entries(STATS_SLOT).filter((entry) => entry.component === firstWrapped).length, 0)
  check('新遮蔽项只有一个', slots.entries(STATS_SLOT).filter((entry) => entry.component === secondWrapped).length, 1)
  check('新注册 priority 仍减一', slots.registrations.at(-1).options.priority, -1)
}

console.log('--- E 源项消失 ---')
{
  slots.setEntries(STATS_SLOT, [])
  check('withdrawn', reconcileShadow(slots, state, () => 'never'), 'withdrawn')
  check('账本为空', slots.entries(STATS_SLOT).length, 0)
  check('重复撤回幂等', withdrawShadow(state), false)
}

console.log('--- F 嵌套对账（busy） ---')
{
  const nestedSlots = new FakeSlots()
  const nestedState = createShadowState()
  nestedSlots.setEntries(STATS_SLOT, [source()])
  let nested
  const outcome = reconcileShadow(nestedSlots, nestedState, () => {
    nested = reconcileShadow(nestedSlots, nestedState, () => 'never')
    return function WrappedBusy() {
      return null
    }
  })
  check('外层 install', outcome, 'install')
  check('嵌套 busy', nested, 'busy')
  check('只注册一项', nestedSlots.registrations.length, 1)
}

console.log('--- G 注册选项与源项识别 ---')
{
  check('默认 priority 为 -1', shadowOptions({ options: { id: STATS_ID } }).priority, -1)
  check('源 priority 2 → 1', shadowOptions({ options: { id: STATS_ID, priority: 2 } }).priority, 1)
  check('未给 order 不落键', 'order' in shadowOptions({ options: { id: STATS_ID } }), false)
  check('未给 locale 不落键', 'locale' in shadowOptions({ options: { id: STATS_ID } }), false)
  checkSame(
    '按 id 取源项',
    findSourceEntry([{ component: inner }, { component: firstWrapped, options: { id: STATS_ID } }], firstWrapped),
    undefined,
  )
  const sourceEntry = { component: inner2, options: { id: STATS_ID } }
  checkSame(
    '排除自己的遮蔽项',
    findSourceEntry([sourceEntry, { component: firstWrapped, options: { id: STATS_ID } }], firstWrapped),
    sourceEntry,
  )
}

finish()
