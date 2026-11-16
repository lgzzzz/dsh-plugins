/**
 * 运行中的长回合：`⌘⌥.` 只收已经跑完的过程组，正在输出的那一组保留可见。
 *
 * 上游只在本轮结束后才渲染 `[data-turn-process]` 标题，运行中的轮次没有标题、过程组
 * 处于平铺态；每一个组跑完后组标题上的流式标记（`data-shimmer`，来自
 * `TextShimmer active={!closed}`）会消失。插件据此把“已输出完毕”的组封口成组头形态，
 * 组标题带流式标记的那一组继续平铺、继续流式输出。
 *
 * 本文件装配真实折叠桥，覆盖：首次按键、再按一次（最后一组还在跑）、最后一组跑完后再按、
 * 回合结束后整轮封口，以及跟随尾部时折叠不抛错。
 */
import { installCollapseStepsBridge } from '../src/collapse-steps.ts'
import { LIVE_ATTRIBUTE, SEAL_ATTRIBUTE } from '../src/collapse-seal.ts'
import {
  captureWarnings,
  check,
  checkTrue,
  FakeCtx,
  FakeElement,
  fakeShortcuts,
  finish,
  gesture,
  keydown,
  shortcutContext,
  withWindowDom,
} from './collapse-helpers.mjs'

/** 一个带主会话槽位与滚动口的假页面。 */
function mainScroll() {
  const app = new FakeElement('div')
  const main = app.append(new FakeElement('div', { 'data-slot': 'main.conversation' }))
  const scroll = main.append(new FakeElement('div', { 'data-conversation-scroll': '' }))
  return { app, main, scroll }
}

/** 装配桥接（固定行 + 固定输入观察者 + 终端捕获）。 */
function bridgeHarness() {
  const shortcuts = fakeShortcuts({ platform: 'windows' })
  const ctx = new FakeCtx({ shortcuts })
  const warnings = captureWarnings(() => installCollapseStepsBridge(ctx))
  return { shortcuts, ctx, warnings }
}

/** 按一次 `Ctrl+Alt+.`。 */
function press(shortcuts) {
  const input = keydown(gesture('Period', { control: true, alt: true }), shortcutContext({ target: null }))
  shortcuts.emit(input.input)
  return input
}

/**
 * 一个平铺过程组：组头容器 hidden、组标题（可点开合）、组体。
 * @param scroll - 主会话滚动口。
 * @param options - 轮次、活动类型、是否仍在输出（流式标记）。
 * @returns 组根、组头容器与组标题按钮。
 */
function flatGroup(scroll, { turn = '1', activity = 'commands', live = false } = {}) {
  const root = scroll.append(new FakeElement('div', {
    'data-step-process': '',
    'data-chat-turn': turn,
    'data-group-expanded-mode': 'true',
  }))
  const header = root.append(new FakeElement('div', { hidden: '' }))
  if (live) header.append(new FakeElement('span', { [LIVE_ATTRIBUTE]: '' }))
  const toggle = header.append(new FakeElement('button', { 'data-process-activity': activity, 'aria-expanded': 'false' }))
  root.append(new FakeElement('div', { 'data-step-process-body': '' }))
    .append(new FakeElement('div', { 'data-chat-flow-key': `${turn}:${activity}:body` }))
  return { root, header, toggle }
}

/** 已结束轮次的轮次过程标题（运行中的轮次没有这个节点）。 */
function closedHeader(scroll, { turn = '1' } = {}) {
  const row = scroll.append(new FakeElement('div', { 'data-chat-turn': turn, 'data-chat-flow-kind': 'turn-process' }))
  return row.append(new FakeElement('button', {
    'data-turn-process': turn,
    'aria-expanded': 'true',
    'data-turn-process-locked': '',
  }))
}

console.log('--- R① 运行中：已跑完的组收成组头，正在输出的组保留 ---')
{
  const { app, scroll } = mainScroll()
  const done1 = flatGroup(scroll, { activity: 'commands' })
  const done2 = flatGroup(scroll, { activity: 'read' })
  const live = flatGroup(scroll, { activity: 'edit', live: true })
  const dom = withWindowDom({ root: app })
  try {
    const { shortcuts } = bridgeHarness()
    const press1 = press(shortcuts)
    check('这一按被消费', press1.consumed.count, 1)
    check('已跑完的二组封口', [done1.root.hasAttribute(SEAL_ATTRIBUTE), done2.root.hasAttribute(SEAL_ATTRIBUTE)], [true, true])
    check('正在输出的组不动', live.root.hasAttribute(SEAL_ATTRIBUTE), false)
    check('封口的组头从 hidden 放出', [done1.header.hasAttribute('hidden'), done2.header.hasAttribute('hidden')], [false, false])
    check('正在输出的组头仍隐藏', live.header.hasAttribute('hidden'), true)

    const press2 = press(shortcuts)
    check('最后一组还在输出时再按不动作', press2.consumed.count, 0)
  } finally {
    dom.restore()
  }
}

console.log('--- R② 最后一组也跑完后：再按一次把整轮收干净 ---')
{
  const { app, scroll } = mainScroll()
  const done1 = flatGroup(scroll, { activity: 'commands' })
  const last = flatGroup(scroll, { activity: 'edit', live: true })
  const dom = withWindowDom({ root: app })
  try {
    const { shortcuts } = bridgeHarness()
    check('先收已跑完的组', press(shortcuts).consumed.count, 1)
    check('最后一组还开着', last.root.hasAttribute(SEAL_ATTRIBUTE), false)
    // 最后一组跑完：上游撤掉流式标记。
    for (const child of [...last.header.children]) {
      if (child.hasAttribute?.(LIVE_ATTRIBUTE)) child.remove()
    }
    const press2 = press(shortcuts)
    check('再按一次被消费', press2.consumed.count, 1)
    check('最后一组也封口', last.root.hasAttribute(SEAL_ATTRIBUTE), true)
    check('第一组不重复计数', done1.root.hasAttribute(SEAL_ATTRIBUTE), true)
    check('第三次按没有可做的事', press(shortcuts).consumed.count, 0)
  } finally {
    dom.restore()
  }
}

console.log('--- R③ 回合结束后（出现轮次过程标题）：整轮封口 ---')
{
  const { app, scroll } = mainScroll()
  const done1 = flatGroup(scroll, { activity: 'commands' })
  const last = flatGroup(scroll, { activity: 'read', live: true })
  const header = closedHeader(scroll, { turn: '1' })
  const dom = withWindowDom({ root: app })
  try {
    const { shortcuts } = bridgeHarness()
    const press1 = press(shortcuts)
    check('这一按被消费', press1.consumed.count, 1)
    check('两组都封口（有标题时不看流式标记）', [done1.root.hasAttribute(SEAL_ATTRIBUTE), last.root.hasAttribute(SEAL_ATTRIBUTE)], [true, true])
    check('带锁标题没有被点开合', header.hasAttribute('data-turn-process-locked'), true)
  } finally {
    dom.restore()
  }
}

console.log('--- R④ 跟随尾部时折叠：不抛错、照常消费 ---')
{
  const { app, scroll } = mainScroll()
  const tail = scroll.append(new FakeElement('div', { 'data-chat-following-tail': '' }))
  flatGroup(scroll, { activity: 'commands' })
  const live = flatGroup(scroll, { activity: 'commands', live: true })
  const dom = withWindowDom({ root: app })
  try {
    const { shortcuts, warnings } = bridgeHarness()
    const press1 = press(shortcuts)
    check('照常消费', press1.consumed.count, 1)
    check('跟随尾部时不告警', warnings.filter((warning) => warning.includes('阅读位置')).length, 0)
    checkTrue('尾部标记仍在', tail.hasAttribute('data-chat-following-tail'))
    check('正在输出的组仍可见', live.root.hasAttribute(SEAL_ATTRIBUTE), false)
  } finally {
    dom.restore()
  }
}

finish()
