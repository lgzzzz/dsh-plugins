/**
 * 折叠中间步骤的纯判定：可执行条件、外层 / 单步两层目标、主会话作用域与去重。
 *
 * 目标只认上游发布在 DOM 上的稳定标记：轮次过程按钮 `[data-turn-process]`、过程组标题
 * `[data-process-activity]`、单步详情 `[data-disclosure-row]` / `[data-expandable]`。本文件
 * 不装桥、不发按键，只验证选择与让位规则。
 */
import {
  collapseBatches,
  collapseStepTargets,
  currentCollapseBatches,
  currentCollapseTargets,
  conversationRoots,
  collapseStepsEligible,
} from '../src/collapse-steps.ts'
import { LOCK_ATTRIBUTE, SEAL_ATTRIBUTE } from '../src/collapse-seal.ts'
import {
  FakeElement,
  check,
  checkTrue,
  finish,
  gesture,
  shortcutContext,
  withWindowDom,
} from './collapse-helpers.mjs'

/** 一个主会话滚动口：`main.conversation` 槽位 → 滚动口。 */
function mainScroll() {
  const app = new FakeElement('div')
  const main = app.append(new FakeElement('div', { 'data-slot': 'main.conversation' }))
  const scroll = main.append(new FakeElement('div', { 'data-conversation-scroll': '' }))
  return { app, main, scroll }
}

/** 一个展开 / 收起状态的开启控件。 */
function openControl(attributes, expanded) {
  return new FakeElement('button', { ...attributes, 'aria-expanded': String(expanded) })
}

console.log('--- D① 准入：长按 / 组字 / 已消费 / 模态都让位 ---')
{
  const page = shortcutContext({ target: null })
  check('普通按键可执行', collapseStepsEligible(gesture('Period', { control: true, alt: true }), page), true)
  check('模态层让位', collapseStepsEligible(gesture('Period', { control: true, alt: true }), shortcutContext({ modal: 'settings' })), false)
  check('长按让位', collapseStepsEligible(gesture('Period', { control: true, alt: true, repeat: true }), page), false)
  check('组字让位', collapseStepsEligible(gesture('Period', { control: true, alt: true, composing: true }), page), false)
  check('已被消费让位', collapseStepsEligible(gesture('Period', { control: true, alt: true, defaultPrevented: true }), page), false)
}

console.log('--- D② 外层优先：轮次过程与过程组标题一起收 ---')
{
  const { scroll } = mainScroll()
  const turn = scroll.append(openControl({ 'data-turn-process': '1' }, true))
  const groupRoot = scroll.append(new FakeElement('div', { 'data-step-process': '' }))
  const group = groupRoot.append(openControl({ 'data-process-activity': 'commands' }, true))
  const detailRoot = scroll.append(new FakeElement('div', { 'data-chat-flow-kind': 'tool-call' }))
  const detail = detailRoot.append(new FakeElement('div', { 'data-disclosure-row': '', 'aria-expanded': 'true' }))

  const targets = collapseStepTargets(scroll)
  check('外层目标数', targets.length, 2)
  checkTrue('轮次过程在目标里', targets.includes(turn))
  checkTrue('过程组标题在目标里', targets.includes(group))
  check('单步详情不在这一按里', targets.includes(detail), false)
}

console.log('--- D③ 没有外层展开项时退到单步详情 ---')
{
  const { scroll } = mainScroll()
  // 轮次过程已经收起、过程组标题也收起。
  scroll.append(openControl({ 'data-turn-process': '1' }, false))
  const groupRoot = scroll.append(new FakeElement('div', { 'data-step-process': '' }))
  groupRoot.append(openControl({ 'data-process-activity': 'commands' }, false))

  const tool = scroll.append(new FakeElement('div', { 'data-chat-flow-kind': 'tool-call' }))
  const disclosure = tool.append(new FakeElement('div', { 'data-disclosure-row': '', 'aria-expanded': 'true' }))
  const expandable = tool.append(new FakeElement('div', { 'data-expandable': '', 'aria-expanded': 'true' }))
  const closed = tool.append(new FakeElement('div', { 'data-disclosure-row': '', 'aria-expanded': 'false' }))
  // 同一个元素同时带两种标记时只收一次。
  const both = tool.append(new FakeElement('div', {
    'data-disclosure-row': '',
    'data-expandable': '',
    'aria-expanded': 'true',
  }))

  const targets = collapseStepTargets(scroll)
  check('收展开的单步详情数', targets.length, 3)
  checkTrue('思考 / 工具行在目标里', targets.includes(disclosure))
  checkTrue('命令输出在目标里', targets.includes(expandable))
  checkTrue('同时带两种标记的行只收一次', targets.includes(both))
  check('收起的详情跳过', targets.includes(closed), false)
}

console.log('--- D④ 单步详情只认过程 / 工具 / 助手步骤容器 ---')
{
  const { scroll } = mainScroll()
  const tool = scroll.append(new FakeElement('div', { 'data-chat-flow-kind': 'tool-call' }))
  const step = scroll.append(new FakeElement('div', { 'data-step-process': '' }))
  const assistant = scroll.append(new FakeElement('div', { 'data-chat-flow-kind': 'assistant-step' }))
  const process = scroll.append(new FakeElement('div', { 'data-chat-flow-kind': 'turn-process' }))
  const system = scroll.append(new FakeElement('div', { 'data-chat-flow-kind': 'system-prompt' }))
  const question = scroll.append(new FakeElement('div', { 'data-question-key': 'q1' }))

  const expected = [
    tool.append(new FakeElement('div', { 'data-disclosure-row': '', 'aria-expanded': 'true' })),
    step.append(new FakeElement('div', { 'data-expandable': '', 'aria-expanded': 'true' })),
    assistant.append(new FakeElement('div', { 'data-disclosure-row': '', 'aria-expanded': 'true' })),
    process.append(new FakeElement('div', { 'data-expandable': '', 'aria-expanded': 'true' })),
  ]
  system.append(new FakeElement('div', { 'data-expandable': '', 'aria-expanded': 'true' }))
  question.append(new FakeElement('div', { 'data-disclosure-row': '', 'aria-expanded': 'true' }))

  const targets = collapseStepTargets(scroll)
  check('只收工作步骤容器里的详情数', targets.length, expected.length)
  for (const [index, target] of expected.entries()) {
    checkTrue(`第 ${index + 1} 个详情在目标里`, targets.includes(target))
  }
}

console.log('--- D⑤ 不可操作的轮次过程不占外层 ---')
{
  const { scroll } = mainScroll()
  const running = scroll.append(openControl({ 'data-turn-process': '1', disabled: true }, true))
  running.disabled = true
  const groupRoot = scroll.append(new FakeElement('div', { 'data-step-process': '' }))
  const group = groupRoot.append(openControl({ 'data-process-activity': 'commands', 'aria-disabled': 'true' }, true))
  const detailRoot = scroll.append(new FakeElement('div', { 'data-chat-flow-kind': 'tool-call' }))
  const detail = detailRoot.append(new FakeElement('div', { 'data-disclosure-row': '', 'aria-expanded': 'true' }))

  const targets = collapseStepTargets(scroll)
  check('只剩单步详情', targets.length, 1)
  checkTrue('禁用的轮次过程不占外层', targets.includes(running) === false)
  checkTrue('单步详情被收', targets.includes(detail))
  check('aria-disabled 的组标题也不占外层', targets.includes(group), false)
}

console.log('--- D⑥ 主会话作用域：不误折右栏里的会话 ---')
{
  const { app, scroll: main } = mainScroll()
  const sidebar = app.append(new FakeElement('div', { 'data-slot': 'sidebar.right' }))
  const right = sidebar.append(new FakeElement('div', { 'data-conversation-scroll': '' }))
  const dom = withWindowDom({ root: app })
  try {
    const roots = conversationRoots()
    check('只取一个滚动口', roots.length, 1)
    checkTrue('取的是主会话滚动口', roots.includes(main))
    check('右栏滚动口不在内', roots.includes(right), false)
  } finally {
    dom.restore()
  }

  const one = new FakeElement('div')
  const onlyScroll = one.append(new FakeElement('div', { 'data-conversation-scroll': '' }))
  const oneDom = withWindowDom({ root: one })
  try {
    const onlyRoots = conversationRoots()
    check('没有槽位时仍取到唯一滚动口', onlyRoots.length, 1)
    checkTrue('取到的就是那一个滚动口', onlyRoots.includes(onlyScroll))
  } finally {
    oneDom.restore()
  }

  const two = new FakeElement('div')
  two.append(new FakeElement('div', { 'data-conversation-scroll': '' }))
  two.append(new FakeElement('div', { 'data-conversation-scroll': '' }))
  const twoDom = withWindowDom({ root: two })
  try {
    check('多个滚动口且没有槽位时不动', conversationRoots().length, 0)
  } finally {
    twoDom.restore()
  }
}

console.log('--- D⑦ 多份主会话目标去重 ---')
{
  const { app, scroll: main } = mainScroll()
  const second = app.append(new FakeElement('div', { 'data-slot': 'main.conversation' }))
  const other = second.append(new FakeElement('div', { 'data-conversation-scroll': '' }))
  const turn = main.append(openControl({ 'data-turn-process': '1' }, true))
  // 同一元素在 DOM 上只可能属于一个根；去重主要防两份根读到同一元素（例如嵌套滚动口）。
  const nested = main.append(new FakeElement('div', { 'data-conversation-scroll': '' }))
  nested.append(turn)
  other.append(openControl({ 'data-turn-process': '2' }, true))
  const dom = withWindowDom({ root: app })
  try {
    const targets = currentCollapseTargets()
    check('去重后每份控件只出现一次', new Set(targets).size, targets.length)
    check('两份主会话的目标都收', targets.length, 2)
  } finally {
    dom.restore()
  }
}

console.log('--- D⑧ 锁定标题跳过；平铺轮次封口 ---')
{
  const { app, scroll } = mainScroll()
  // 带锁的轮次过程标题：即使展开也不进目标。
  const turnRow = scroll.append(new FakeElement('div', { 'data-chat-turn': '1', 'data-chat-flow-kind': 'turn-process' }))
  const locked = turnRow.append(openControl({ 'data-turn-process': '1', [LOCK_ATTRIBUTE]: '' }, true))
  // 同一轮的平铺过程组：组头隐藏、组体可见。
  const groupRoot = scroll.append(new FakeElement('div', {
    'data-step-process': '',
    'data-chat-turn': '1',
    'data-group-expanded-mode': 'true',
  }))
  const groupHeader = groupRoot.append(new FakeElement('div', { hidden: '' }))
  groupHeader.append(new FakeElement('button', { 'data-process-activity': 'commands', 'aria-expanded': 'false' }))
  groupRoot.append(new FakeElement('div', { 'data-step-process-body': '' }))

  const dom = withWindowDom({ root: app })
  try {
    check('锁定标题不是折叠目标', collapseStepTargets(scroll).includes(locked), false)
    const before = currentCollapseBatches()
    check('批次里有一个封口目标', before[0]?.seals.length, 1)
    check('没有可点击的目标', before[0]?.targets.length, 0)
    collapseBatches(before)
    check('组根写了封口标记', groupRoot.hasAttribute(SEAL_ATTRIBUTE), true)
    check('组头 hidden 被移除', groupHeader.hasAttribute('hidden'), false)
    check('第二次没有封口目标（幂等）', currentCollapseBatches()[0]?.seals.length, 0)
  } finally {
    dom.restore()
  }
}

finish()
