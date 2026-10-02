/**
 * L 页面循环判定:`src/page-cycle.ts` 与 `src/binding.ts` 的纯决策 ——
 * 固定行同时预约两个方向(`Ctrl+Alt+←` / `Ctrl+Alt+→`)、准入(刻意放行终端与
 * 已被消费的按)、以及环状步进。
 *
 * 运行:`node test/decide-page-cycle.test.mjs`(或 pnpm test 跑全部)。
 */
import {
  PAGE_CYCLE_COMMAND,
  PAGE_CYCLE_ID,
  PAGE_NEXT_BINDING,
  PAGE_PREVIOUS_BINDING,
  pageCycleEligible,
  pageStepFor,
  steppedPageId,
} from '../src/page-cycle.ts'
import { check, checkTrue, finish, gesture, shortcutContext, PAGE_CYCLE_FIXED_ROWS, PAGE_NEXT_PRESS, PAGE_PREVIOUS_PRESS } from './helpers.mjs'

console.log('--- L① 固定行本身:一行预约两个方向,归 application 组 ---')
{
  check('固定行 id', PAGE_CYCLE_COMMAND.id, PAGE_CYCLE_ID)
  check('← 绑定', PAGE_CYCLE_COMMAND.bindings[0], PAGE_PREVIOUS_BINDING)
  check('→ 绑定', PAGE_CYCLE_COMMAND.bindings[1], PAGE_NEXT_BINDING)
  check('固定行显示键', PAGE_CYCLE_COMMAND.keys, ['Ctrl', 'Alt', '←/→'])
  check('固定行分组', PAGE_CYCLE_COMMAND.group, 'application')
}

console.log('--- L② 固定行归属与方向:只有本键对命中,且方向由命中的 code 决定 ---')
{
  check('← 命中为 previous', pageStepFor(PAGE_CYCLE_FIXED_ROWS, PAGE_CYCLE_ID, PAGE_PREVIOUS_PRESS), 'previous')
  check('→ 命中为 next', pageStepFor(PAGE_CYCLE_FIXED_ROWS, PAGE_CYCLE_ID, PAGE_NEXT_PRESS), 'next')
  check('裸 ← 不命中', pageStepFor(PAGE_CYCLE_FIXED_ROWS, PAGE_CYCLE_ID, gesture('ArrowLeft')), undefined)
  check('Ctrl+← 不命中', pageStepFor(PAGE_CYCLE_FIXED_ROWS, PAGE_CYCLE_ID, gesture('ArrowLeft', { control: true })), undefined)
  check('Alt+← 不命中', pageStepFor(PAGE_CYCLE_FIXED_ROWS, PAGE_CYCLE_ID, gesture('ArrowLeft', { alt: true })), undefined)
  check('Ctrl+Alt+Shift+← 不命中', pageStepFor(PAGE_CYCLE_FIXED_ROWS, PAGE_CYCLE_ID, gesture('ArrowLeft', { control: true, alt: true, shift: true })), undefined)
  check('别的键不命中', pageStepFor(PAGE_CYCLE_FIXED_ROWS, PAGE_CYCLE_ID, gesture('Enter')), undefined)
  check('行未挂载不命中', pageStepFor([], PAGE_CYCLE_ID, PAGE_NEXT_PRESS), undefined)
}

console.log('--- L③ 准入:页 / 文本控件 / 终端 / 已被消费都准入,模态 / repeat / 组字否决 ---')
{
  checkTrue('page 上准入', pageCycleEligible(PAGE_NEXT_PRESS, shortcutContext()))
  checkTrue('文本控件内准入(要离开的正是页面自身)', pageCycleEligible(PAGE_NEXT_PRESS, shortcutContext({ region: 'editable' })))
  checkTrue('终端内准入(核心:焦点在终端里依然能切页)', pageCycleEligible(PAGE_NEXT_PRESS, shortcutContext({ region: 'terminal' })))
  checkTrue('已被消费仍准入(终端等本地控件先处理也不算数)', pageCycleEligible(gesture('ArrowLeft', { control: true, alt: true, defaultPrevented: true }), shortcutContext()))
  check('模态层之上否决', pageCycleEligible(PAGE_NEXT_PRESS, shortcutContext({ modal: 'settings' })), false)
  check('repeat 否决', pageCycleEligible(gesture('ArrowLeft', { control: true, alt: true, repeat: true }), shortcutContext()), false)
  check('组字中否决', pageCycleEligible(gesture('ArrowLeft', { control: true, alt: true, composing: true }), shortcutContext()), false)
}

// 准入只负责"能不能出手",具体键归固定行管 —— 与其余四组的分工一致。
{
  check('别的键同样准入(是否动作由固定行决定)', pageCycleEligible(gesture('Enter'), shortcutContext()), true)
}

console.log('--- L④ 环状步进:回头绕到末尾,到头绕回开头 ---')
{
  const pages = ['t1', 't2', 't3']
  check('3 页向前走一步', steppedPageId(pages, 't1', 'next'), 't2')
  check('3 页向后走一步', steppedPageId(pages, 't2', 'previous'), 't1')
  check('末尾向前绕回开头', steppedPageId(pages, 't3', 'next'), 't1')
  check('开头向后绕到末尾', steppedPageId(pages, 't1', 'previous'), 't3')
  check('2 页双向', steppedPageId(['a', 'b'], 'a', 'next'), 'b')
  check('2 页反向', steppedPageId(['a', 'b'], 'a', 'previous'), 'b')

  const one = ['only']
  check('单页无可切', steppedPageId(one, 'only', 'next'), undefined)
  check('空列表无可切', steppedPageId([], undefined, 'next'), undefined)
  check('当前页不在列表不切', steppedPageId(pages, 'ghost', 'next'), undefined)
  check('没有当前页不切', steppedPageId(pages, undefined, 'next'), undefined)
}

finish()