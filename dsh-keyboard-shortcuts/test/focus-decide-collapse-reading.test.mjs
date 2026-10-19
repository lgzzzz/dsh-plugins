/**
 * 折叠后的阅读位置：阅读线、锚点、回退到用户消息（阅读线下 3px），以及几何 / 跟随尾部 / 上游动画边界。
 *
 * 假 DOM 的几何由测试直接摆：滚动口在 y=100、高 500；composer 顶在 y=550；
 * 阅读线因此是 101。行按文档顺序排布，点击折叠时由替身 `click` 自己改高度 / 隐藏标记。
 */
import { collapseBatches } from '../src/collapse-steps.ts'
import {
  applyReadingAnchor,
  planReadingAnchor,
} from '../src/reading-anchor.ts'
import {
  check,
  checkTrue,
  FakeElement,
  finish,
} from './focus-helpers.mjs'

/** 一个带 top / bottom / height 的盒子。 */
function box(top, height) {
  return {
    top,
    bottom: top + height,
    height,
    left: 0,
    right: 800,
    width: 800,
    x: 0,
    y: top,
    toJSON() {
      return { top, bottom: top + height, height, left: 0, right: 800, width: 800 }
    },
  }
}

/** 摆一行：读取 `rect` 的当前值，测试可在点击后改写。 */
function place(element, top, height) {
  element.rect = { top, height }
  element.getBoundingClientRect = () => box(element.rect.top, element.rect.height)
  return element
}

/** 主会话滚动口 + composer：阅读线 101，可见带底 550。 */
function readingScroll() {
  const app = new FakeElement('div')
  const main = app.append(new FakeElement('div', { 'data-slot': 'main.conversation' }))
  const scroll = main.append(new FakeElement('div', { 'data-conversation-scroll': '' }))
  place(scroll, 100, 500)
  scroll.clientTop = 0
  scroll.clientHeight = 500
  scroll.scrollHeight = 2000
  scroll.scrollTop = 700
  const seat = scroll.append(new FakeElement('div', { 'data-composer-seat': '' }))
  place(seat, 550, 100)
  return { app, main, scroll, seat }
}

function chatRow(parent, attributes, top, height) {
  return place(parent.append(new FakeElement('div', attributes)), top, height)
}

/** 一行用户消息、一个轮次过程、一个会被隐藏的过程行、一个答案行。 */
function scene({ anchorTop = 240, anchorAfter = 140, hideAnchor = false, keep = {} } = {}) {
  const { app, main, scroll, seat } = readingScroll()
  const user = chatRow(scroll, {
    'data-chat-flow-key': 'user',
    'data-chat-flow-kind': 'user',
    'data-chat-turn': '1',
  }, 20, 70)
  const process = chatRow(scroll, {
    'data-chat-flow-key': 'process',
    'data-chat-turn': '1',
  }, 90, 30)
  const target = process.append(new FakeElement('button', { 'data-turn-process': '1', 'aria-expanded': 'true' }))
  place(target, 90, 30)
  const hidden = chatRow(scroll, {
    'data-chat-flow-key': 'hidden',
    'data-chat-turn': '1',
  }, 130, 100)
  const anchor = chatRow(scroll, {
    'data-chat-flow-key': 'answer',
    'data-chat-flow-kind': 'assistant-step',
    'data-chat-turn': '1',
  }, anchorTop, 200)
  target.click = () => {
    target.setAttribute('aria-expanded', 'false')
    hidden.setAttribute('hidden', '')
    hidden.rect.height = 0
    anchor.rect.top = anchorAfter
    if (hideAnchor) {
      anchor.setAttribute('hidden', '')
      anchor.rect.height = 0
    }
    for (const [name, value] of Object.entries(keep)) target.setAttribute(name, value)
  }
  return { app, main, scroll, seat, user, process, target, hidden, anchor }
}

console.log('--- R① 阅读线、候选行与回退行 ---')
{
  const { scroll, user, target, hidden, anchor } = scene()
  const plan = planReadingAnchor(scroll, [target])
  check('采集到阅读位置', plan !== null, true)
  check('阅读线 = 滚动口上边界 + 1', plan.line, 101)
  check('可见带下边界取 composer 顶', plan.bottom, 550)
  check('阅读线以下的行数', plan.rows.length, 2)
  checkTrue('第一个候选是会被隐藏的过程行', plan.rows[0].element === hidden)
  check('第一个候选的折叠前位置', plan.rows[0].top, 130)
  checkTrue('第二个候选是答案行', plan.rows[1].element === anchor)
  checkTrue('回退锚定到该轮的用户消息', plan.fallback === user)
}

console.log('--- R② 锚点在视口内：折叠后保持锚点屏幕位置 ---')
{
  const { scroll, target, anchor } = scene()
  const collapsed = collapseBatches([{ root: scroll, targets: [target] }])
  check('补偿尚未在同步路径执行', scroll.scrollTop, 700)
  await Promise.resolve()
  check('折叠目标被点击', collapsed, 1)
  check('锚点折叠后上移 100', anchor.rect.top, 140)
  check('滚动补偿 100', scroll.scrollTop, 600)
}

console.log('--- R③ 锚点在视口外：用户消息顶到阅读线下 3px ---')
{
  const { scroll, target } = scene({ anchorTop: 600, anchorAfter: 400 })
  const collapsed = collapseBatches([{ root: scroll, targets: [target] }])
  check('回退也延到微任务', scroll.scrollTop, 700)
  await Promise.resolve()
  check('折叠目标被点击', collapsed, 1)
  check('回退滚动量 = 用户消息顶 - (阅读线 + 3)', scroll.scrollTop, 616)
}

console.log('--- R④ composer 顶以下也算视口外 ---')
{
  const { scroll, target } = scene({ anchorTop: 560, anchorAfter: 400 })
  const plan = planReadingAnchor(scroll, [target])
  target.click()
  check('锚点在 composer 下面仍被采集', plan.rows[1].top, 560)
  check('走回退分支', applyReadingAnchor(plan), 'fallback')
  check('用户消息对齐后的滚动位置', scroll.scrollTop, 616)
}

console.log('--- R⑤ 跟随尾部时不做补偿 ---')
{
  const { scroll, target } = scene()
  scroll.append(new FakeElement('div', { 'data-chat-following-tail': '' }))
  const plan = planReadingAnchor(scroll, [target])
  target.click()
  check('跟随尾部走 none', applyReadingAnchor(plan), 'none')
  check('滚动位置没动', scroll.scrollTop, 700)
}

console.log('--- R⑥ 上游折叠动画在跑时不做二次补偿 ---')
{
  const { scroll, target } = scene({ keep: { 'data-chat-motion': 'collapse' } })
  const plan = planReadingAnchor(scroll, [target])
  target.click()
  check('上游动画走 none', applyReadingAnchor(plan), 'none')
  check('滚动位置没动', scroll.scrollTop, 700)
}

console.log('--- R⑦ 所有候选都被隐藏：没有锚点也不回退 ---')
{
  const { scroll, target } = scene({ hideAnchor: true })
  const plan = planReadingAnchor(scroll, [target])
  target.click()
  check('没有仍可见的候选', applyReadingAnchor(plan), 'none')
  check('滚动位置没动', scroll.scrollTop, 700)
}

console.log('--- R⑧ 滚动目标越界时夹到 0 ---')
{
  const { scroll, target } = scene({ anchorAfter: 0 })
  const plan = planReadingAnchor(scroll, [target])
  scroll.scrollTop = 50
  target.click()
  applyReadingAnchor(plan)
  check('向上补偿夹到 0', scroll.scrollTop, 0)
}

console.log('--- R⑨ 没有几何的假 DOM：折叠照常，补偿跳过 ---')
{
  const app = new FakeElement('div')
  const main = app.append(new FakeElement('div', { 'data-slot': 'main.conversation' }))
  const scroll = main.append(new FakeElement('div', { 'data-conversation-scroll': '' }))
  scroll.scrollTop = 0
  const target = scroll.append(new FakeElement('button', { 'data-turn-process': '1', 'aria-expanded': 'true' }))
  let clicks = 0
  target.click = () => {
    clicks += 1
    target.setAttribute('aria-expanded', 'false')
  }
  const collapsed = collapseBatches([{ root: scroll, targets: [target] }])
  check('折叠仍然发生', [collapsed, clicks], [1, 1])
  check('没有几何时不做补偿', scroll.scrollTop, 0)
}

console.log('--- R⑩ 阅读行：过程组内的详情行认，组外的不认 ---')
{
  const { scroll } = readingScroll()
  const tool = chatRow(scroll, { 'data-chat-flow-key': 'tool', 'data-chat-flow-kind': 'tool-call', 'data-chat-turn': '1' }, 200, 100)
  const disclosure = place(tool.append(new FakeElement('div', { 'data-disclosure-row': '', 'aria-expanded': 'false' })), 220, 24)
  const expandable = place(tool.append(new FakeElement('div', { 'data-expandable': '', 'aria-expanded': 'false' })), 260, 24)
  const outside = place(scroll.append(new FakeElement('div', { 'data-disclosure-row': '', 'aria-expanded': 'false' })), 300, 24)
  const system = chatRow(scroll, { 'data-chat-flow-key': 'system', 'data-chat-flow-kind': 'system-prompt', 'data-chat-turn': '1' }, 340, 60)
  const plan = planReadingAnchor(scroll, [])
  const elements = plan.rows.map((row) => row.element)
  check('行数 = 工具行 + 组内两条详情 + 系统行', plan.rows.length, 4)
  checkTrue('工具行在阅读行里', elements.includes(tool))
  checkTrue('组内 disclosure 行在阅读行里', elements.includes(disclosure))
  checkTrue('组内 expandable 行在阅读行里', elements.includes(expandable))
  check('组外 disclosure 行不在阅读行里', elements.includes(outside), false)
  check('系统提示词行仍在阅读行里', elements.includes(system), true)
}

console.log('--- R⑪ 没有用户消息时回退到触发通知行 ---')
{
  const { scroll } = readingScroll()
  const trigger = chatRow(scroll, {
    'data-chat-flow-key': 'trigger',
    'data-chat-flow-kind': 'turn-trigger',
    'data-chat-turn': '2',
  }, 120, 40)
  const process = chatRow(scroll, {
    'data-chat-flow-key': 'process',
    'data-chat-turn': '2',
  }, 180, 30)
  const target = process.append(new FakeElement('button', { 'data-turn-process': '2', 'aria-expanded': 'true' }))
  place(target, 180, 30)
  const plan = planReadingAnchor(scroll, [target])
  checkTrue('回退到 turn-trigger 行', plan.fallback === trigger)
}

console.log('--- R⑫ 点击没有改变布局时不回退 ---')
{
  const { scroll, target, hidden } = scene({ anchorTop: 600 })
  target.click = () => {
    target.setAttribute('aria-expanded', 'false')
    hidden.setAttribute('hidden', '')
    hidden.rect.height = 0
  }
  const plan = planReadingAnchor(scroll, [target])
  target.click()
  check('锚点没动时不回退', applyReadingAnchor(plan), 'none')
  check('滚动位置没动', scroll.scrollTop, 700)
}

console.log('--- R⑬ 多个轮次：回退到阅读线附近那一轮的用户消息 ---')
{
  const { scroll } = readingScroll()
  const user1 = chatRow(scroll, {
    'data-chat-flow-key': 'user-1',
    'data-chat-flow-kind': 'user',
    'data-chat-turn': '1',
  }, 5, 70)
  const process1 = chatRow(scroll, {
    'data-chat-flow-key': 'process-1',
    'data-chat-turn': '1',
  }, 80, 30)
  const target1 = process1.append(new FakeElement('button', { 'data-turn-process': '1', 'aria-expanded': 'true' }))
  place(target1, 80, 30)
  const user2 = chatRow(scroll, {
    'data-chat-flow-key': 'user-2',
    'data-chat-flow-kind': 'user',
    'data-chat-turn': '2',
  }, 130, 70)
  const process2 = chatRow(scroll, {
    'data-chat-flow-key': 'process-2',
    'data-chat-turn': '2',
  }, 200, 30)
  const target2 = process2.append(new FakeElement('button', { 'data-turn-process': '2', 'aria-expanded': 'true' }))
  place(target2, 200, 30)
  const first = planReadingAnchor(scroll, [target1, target2])
  checkTrue('阅读线穿过第一轮的过程块时取第一轮', first.fallback === user1)
  process1.rect.height = 20
  process1.rect.top = 20
  const second = planReadingAnchor(scroll, [target1, target2])
  checkTrue('第一轮整块在阅读线上方时取第二轮', second.fallback === user2)
}

console.log('--- R⑭ 标题行滚出阅读线，展开内容仍在读：回退仍取该轮 ---')
{
  const { scroll } = readingScroll()
  const user = chatRow(scroll, {
    'data-chat-flow-key': 'user',
    'data-chat-flow-kind': 'user',
    'data-chat-turn': '1',
  }, -400, 70)
  const process = chatRow(scroll, {
    'data-chat-flow-key': 'process',
    'data-chat-flow-kind': 'turn-process',
    'data-chat-turn': '1',
  }, 80, 20)
  const target = process.append(new FakeElement('button', { 'data-turn-process': '1', 'aria-expanded': 'true' }))
  place(target, 80, 20)
  const hidden = chatRow(scroll, {
    'data-chat-flow-key': 'step',
    'data-chat-flow-kind': 'tool-call',
    'data-chat-turn': '1',
    'data-turn-process-member': 'true',
  }, 105, 100)
  const answer = chatRow(scroll, {
    'data-chat-flow-key': 'answer',
    'data-chat-flow-kind': 'assistant-step',
    'data-chat-turn': '1',
  }, 600, 200)
  target.click = () => {
    target.setAttribute('aria-expanded', 'false')
    hidden.setAttribute('hidden', '')
    hidden.rect.height = 0
    answer.rect.top = 300
  }
  const plan = planReadingAnchor(scroll, [target])
  check('标题行在阅读线上方，不在候选里', plan.rows.some((row) => row.element === process), false)
  checkTrue('回退仍取该轮用户消息', plan.fallback === user)
  const collapsed = collapseBatches([{ root: scroll, targets: [target] }])
  check('折叠目标被点击', collapsed, 1)
  await Promise.resolve()
  check('走回退分支', scroll.scrollTop, 196)
  check('用户消息在阅读线下 3px', user.rect.top - (scroll.scrollTop - 700), 104)
}

console.log('--- R⑮ 阅读线在上一轮展开内容里时，优先上一轮 ---')
{
  const { scroll } = readingScroll()
  const user1 = chatRow(scroll, {
    'data-chat-flow-key': 'user-1',
    'data-chat-flow-kind': 'user',
    'data-chat-turn': '1',
  }, -400, 70)
  const process1 = chatRow(scroll, {
    'data-chat-flow-key': 'process-1',
    'data-chat-flow-kind': 'turn-process',
    'data-chat-turn': '1',
  }, 80, 20)
  const target1 = process1.append(new FakeElement('button', { 'data-turn-process': '1', 'aria-expanded': 'true' }))
  place(target1, 80, 20)
  chatRow(scroll, {
    'data-chat-flow-key': 'step',
    'data-chat-flow-kind': 'tool-call',
    'data-chat-turn': '1',
    'data-turn-process-member': 'true',
  }, 105, 100)
  chatRow(scroll, {
    'data-chat-flow-key': 'answer-1',
    'data-chat-flow-kind': 'assistant-step',
    'data-chat-turn': '1',
  }, 600, 200)
  const user2 = chatRow(scroll, {
    'data-chat-flow-key': 'user-2',
    'data-chat-flow-kind': 'user',
    'data-chat-turn': '2',
  }, 150, 40)
  const process2 = chatRow(scroll, {
    'data-chat-flow-key': 'process-2',
    'data-chat-flow-kind': 'turn-process',
    'data-chat-turn': '2',
  }, 300, 20)
  const target2 = process2.append(new FakeElement('button', { 'data-turn-process': '2', 'aria-expanded': 'true' }))
  place(target2, 300, 20)
  const plan = planReadingAnchor(scroll, [target1, target2])
  checkTrue('回退取第一轮而不是第二轮', plan.fallback === user1)
  check('第二轮用户消息不是回退行', plan.fallback === user2, false)
}

finish()
