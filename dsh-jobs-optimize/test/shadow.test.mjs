/**
 * 账本遮蔽逻辑：源项定位、遮蔽项的注册选项、以及安装 / 保持 / 重建 / 撤回的对账序列。
 *
 * 运行：`node test/shadow.test.mjs`（或 pnpm test 跑全部）。
 */
import { FakeSlots, JOB_LIST_ID, JOB_LIST_SLOT, check, checkFalse, checkSame, checkTrue, finish } from './helpers.mjs'
import {
  createShadowState,
  findSourceEntry,
  reconcileShadow,
  shadowOptions,
  withdrawShadow,
} from '../src/shadow.ts'

const injectFace = () => ({ hooks: { jobs: 'source' } })
const sourceEntry = (overrides = {}) => ({
  component: overrides.component ?? function UpstreamJobListAction() {},
  options: { id: JOB_LIST_ID, order: 20, label: 'Jobs', ...(overrides.options ?? {}) },
  locale: 'job',
  inject: overrides.inject ?? injectFace,
})

console.log('--- S① 源项定位 ---')
{
  const upstream = sourceEntry()
  const wrapped = function JobListHoverOpen() {}
  const other = { component: function AgentPresetLabel() {}, options: { id: 'agent-preset', order: -10 } }

  checkSame('账本只有源项时命中源项', findSourceEntry([other, upstream], undefined), upstream)
  checkSame('我们的遮蔽项不冒充源项', findSourceEntry([{ component: wrapped, options: { id: JOB_LIST_ID, priority: -1 } }, upstream], wrapped), upstream)
  check('只剩我们的项时返回 undefined', findSourceEntry([{ component: wrapped, options: { id: JOB_LIST_ID, priority: -1 } }], wrapped), undefined)
  check('同槽的其它 id 不算源项', findSourceEntry([other], wrapped), undefined)
  check('空账本返回 undefined', findSourceEntry([], wrapped), undefined)
}

console.log('--- S② 遮蔽项的注册选项 ---')
{
  const upstream = sourceEntry()
  const options = shadowOptions(upstream)
  check('槽名', options.name, JOB_LIST_SLOT)
  check('注册 id', options.id, JOB_LIST_ID)
  check('order 原样抄来', options.order, 20)
  check('label 原样抄来', options.label, 'Jobs')
  check('locale 原样抄来', options.locale, 'job')
  checkSame('inject 复用源项那个函数（业务面只由它交出）', options.inject, upstream.inject)
  check('priority 取源项减一（遮蔽成立的条件）', options.priority, -1)
  check('不抄 children / store', Object.keys(options).sort(), ['id', 'inject', 'label', 'locale', 'name', 'order', 'priority'])

  const bare = shadowOptions({ component: function Inner() {}, options: { id: JOB_LIST_ID } })
  check('源项没给的键不落键', Object.keys(bare).sort(), ['id', 'name', 'priority'])
  check('默认 priority 0 的源项也得 -1', bare.priority, -1)

  const deep = shadowOptions(sourceEntry({ options: { priority: 3 } }))
  check('已有 priority 的源项再减一', deep.priority, 2)
}

console.log('--- S③ 安装 / 保持 / 重建 / 撤回 ---')
{
  const slots = new FakeSlots()
  const state = createShadowState()
  const wrap = () => function JobListHoverOpen() {}

  check('账本为空时无事可做', reconcileShadow(slots, state, wrap), 'absent')

  const upstream = sourceEntry()
  slots.setEntries(JOB_LIST_SLOT, [upstream])
  check('源项出现时首次遮蔽', reconcileShadow(slots, state, wrap), 'install')
  check('注册项数', slots.registrations.length, 1)
  check('账本里同 id 两项并存（原项 + 遮蔽项）', slots.entries(JOB_LIST_SLOT).filter((e) => e.options?.id === JOB_LIST_ID).length, 2)
  checkSame('源项本身没被改写', slots.entries(JOB_LIST_SLOT)[0], upstream)
  check('遮蔽项 priority 低于源项', slots.registrations[0].options.priority, -1)
  checkTrue('遮蔽项的 component 是包装组件', typeof slots.registrations[0].component === 'function')

  check('源项未变时保持', reconcileShadow(slots, state, wrap), 'hold')
  check('保持不产生新注册', slots.registrations.length, 1)

  const remounted = sourceEntry()
  slots.setEntries(JOB_LIST_SLOT, [remounted])
  check('源项换对象时重建', reconcileShadow(slots, state, wrap), 'replace')
  check('重建后仍只有一个遮蔽项', slots.entries(JOB_LIST_SLOT).filter((e) => e.options?.id === JOB_LIST_ID).length, 2)
  check('重建后总注册次数', slots.registrations.length, 2)

  const issued = slots.registrations[1].entry
  slots.setEntries(JOB_LIST_SLOT, [issued])
  check('源项消失时撤回', reconcileShadow(slots, state, wrap), 'withdrawn')
  check('撤回后账本里没有 job-list', slots.entries(JOB_LIST_SLOT).filter((e) => e.options?.id === JOB_LIST_ID).length, 0)
  check('再扫一次无事可做', reconcileShadow(slots, state, wrap), 'absent')
  checkFalse('无遮蔽项时撤回是空操作', withdrawShadow(state))
}

console.log('--- S④ 注册抛错时记账保持干净 ---')
{
  const slots = new FakeSlots()
  const state = createShadowState()
  const wrap = () => function JobListHoverOpen() {}
  slots.setEntries(JOB_LIST_SLOT, [sourceEntry()])
  slots.registerError = new Error('priority 撞车')

  let thrown = null
  try {
    reconcileShadow(slots, state, wrap)
  } catch (error) {
    thrown = error
  }
  checkTrue('注册失败向上抛给调用方', thrown instanceof Error)
  check('记账未留下遮蔽项', state.dispose, undefined)

  slots.registerError = null
  check('下一次对账仍能安装（没有残留）', reconcileShadow(slots, state, wrap), 'install')
  check('注册项数', slots.registrations.length, 1)
}

console.log('--- S⑤ 对账期间被同步回调不叠加包装 ---')
{
  const slots = new FakeSlots()
  const state = createShadowState()
  const outcomes = []
  let wraps = 0
  const wrap = () => {
    wraps += 1
    return function JobListHoverOpen() {}
  }
  // 订阅者就是对账本身：FakeSlots 在 register 与撤销里同步通知订阅者，模拟注册表在一次变更
  // 尚未返回时就回调（真实注册表的 subscribe 冲刷是微任务，但 markDirty 同步通知自己的听众，
  // 两种时机都不该让记账半写状态被当成事实）。
  slots.subscribe(JOB_LIST_SLOT, () => {
    outcomes.push(reconcileShadow(slots, state, wrap))
  })

  slots.setEntries(JOB_LIST_SLOT, [sourceEntry()])
  // 嵌套那次先返回，外层后返回。
  check('嵌套那次被挡下，外层照常完成安装', outcomes, ['busy', 'install'])
  check('只包装一次', wraps, 1)
  check('只注册一项', slots.registrations.length, 1)
  check('priority 仍是源项减一', slots.registrations[0].options.priority, -1)

  slots.setEntries(JOB_LIST_SLOT, [sourceEntry()])
  check('重建时嵌套的两次也被挡下', outcomes.slice(2), ['busy', 'busy', 'replace'])
  check('重建只包装一次', wraps, 2)
  check('重建只注册一项', slots.registrations.length, 2)
  check('账本里同 id 仍是两项', slots.entries(JOB_LIST_SLOT).filter((e) => e.options?.id === JOB_LIST_ID).length, 2)
}

finish()
