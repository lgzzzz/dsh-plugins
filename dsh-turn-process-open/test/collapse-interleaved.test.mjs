/**
 * 穿插输入的轮次：`⌘⌥.` 只能封口。
 *
 * 回归用例（session-18839b11「多仓库赔付字段改造 (1)」）：回合进行中又进来两条用户消息，
 * 上游把轮次过程的 `hasContent` 置为 false，标题渲染成 `disabled` 且完全不写
 * `aria-expanded`；锁定器与「点击标题」的折叠路径都跳过这一轮。修复前按键收集不到任何
 * 目标，连 `consume()` 都不做，表现为「⌘⌥. 没反应、中间步骤不折」。
 *
 * 这里按当时的 DOM 形状装配桥：不可折的轮次标题 + 同一轮的平铺过程组（组头容器 hidden、
 * 组体可见）。断言按键把最新一轮封口成组头形态、被消费，且封口后的组头照常可开合。
 */
import { installCollapseStepsBridge } from '../src/collapse-steps.ts'
import { SEAL_ATTRIBUTE } from '../src/collapse-seal.ts'
import { PIN_ATTRIBUTE } from '../src/pin.ts'
import {
  captureWarnings,
  check,
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
 * 穿插输入的轮次：标题 disabled、没有 `aria-expanded`、没有锁标记（锁定器不接管）。
 * @param scroll - 主会话滚动口。
 * @param turn - 轮次号。
 * @returns 标题按钮。
 */
function unfoldableHeader(scroll, { turn = '1' } = {}) {
  const row = scroll.append(new FakeElement('div', { 'data-chat-turn': turn, 'data-chat-flow-kind': 'turn-process' }))
  const header = row.append(new FakeElement('button', {
    'data-turn-process': turn,
    'data-turn-process-tool-calls': '82',
  }))
  header.disabled = true
  return header
}

/**
 * 一个平铺过程组：组头容器 hidden、组标题（可点开合）、组体。
 * @param scroll - 主会话滚动口。
 * @param turn - 轮次号。
 * @param activity - 组标题上的活动类型。
 * @returns 组根、组头容器与组标题按钮。
 */
function flatGroup(scroll, { turn = '1', activity = 'commands' } = {}) {
  const root = scroll.append(new FakeElement('div', {
    'data-step-process': '',
    'data-chat-turn': turn,
    'data-group-expanded-mode': 'true',
  }))
  const header = root.append(new FakeElement('div', { hidden: '' }))
  const toggle = header.append(new FakeElement('button', { 'data-process-activity': activity, 'aria-expanded': 'false' }))
  toggle.clicks = 0
  toggle.click = () => {
    toggle.clicks += 1
    toggle.focus()
    toggle.setAttribute('aria-expanded', 'false')
  }
  const body = root.append(new FakeElement('div', { 'data-step-process-body': '' }))
  body.append(new FakeElement('div', { 'data-chat-flow-key': `${turn}:${activity}:body` }))
  return { root, header, toggle }
}

console.log('--- I① 穿插输入的轮次：按键封口最新一轮的平铺组并消费 ---')
{
  const { app, scroll } = mainScroll()
  const header = unfoldableHeader(scroll, { turn: '1' })
  const commands = flatGroup(scroll, { turn: '1', activity: 'commands' })
  const reads = flatGroup(scroll, { turn: '1', activity: 'read' })
  const dom = withWindowDom({ root: app })
  try {
    const { shortcuts } = bridgeHarness()
    const press1 = press(shortcuts)
    check('这一按被消费', press1.consumed.count, 1)
    check('第一个组封口', commands.root.hasAttribute(SEAL_ATTRIBUTE), true)
    check('第二个组封口', reads.root.hasAttribute(SEAL_ATTRIBUTE), true)
    check('组头从 hidden 放出', [commands.header.hasAttribute('hidden'), reads.header.hasAttribute('hidden')], [false, false])
    check('不去点不可折的轮次标题', header.clicks === undefined ? 0 : header.clicks, 0)
    check('不给不可折的轮次加锁', header.hasAttribute(PIN_ATTRIBUTE), false)

    const press2 = press(shortcuts)
    check('再按一次没有可做的事', press2.consumed.count, 0)
  } finally {
    dom.restore()
  }
}

console.log('--- I② 封口后的组头照常可开合，再按一次收的是组标题 ---')
{
  const { app, scroll } = mainScroll()
  const header = unfoldableHeader(scroll, { turn: '1' })
  const commands = flatGroup(scroll, { turn: '1', activity: 'commands' })
  const dom = withWindowDom({ root: app })
  try {
    const { shortcuts } = bridgeHarness()
    check('先封口', press(shortcuts).consumed.count, 1)
    // 读者在封口形态下展开这一组：上游把 aria-expanded 置为 true（组体由封口 CSS 放回）。
    commands.toggle.setAttribute('aria-expanded', 'true')
    const reopen = press(shortcuts)
    check('这一按收的是展开的组标题', commands.toggle.clicks, 1)
    check('组标题已收起', commands.toggle.getAttribute('aria-expanded'), 'false')
    check('这一按被消费', reopen.consumed.count, 1)
    check('已经封口的组不重复计数', commands.root.hasAttribute(SEAL_ATTRIBUTE), true)
  } finally {
    dom.restore()
  }
}

console.log('--- I③ 上游已折起的轮次（aria-expanded=false）不封口、不消费 ---')
{
  const { app, scroll } = mainScroll()
  const header = unfoldableHeader(scroll, { turn: '1' })
  header.removeAttribute('disabled')
  header.setAttribute('aria-expanded', 'false')
  const commands = flatGroup(scroll, { turn: '1', activity: 'commands' })
  const dom = withWindowDom({ root: app })
  try {
    const { shortcuts } = bridgeHarness()
    const press1 = press(shortcuts)
    check('不封口', commands.root.hasAttribute(SEAL_ATTRIBUTE), false)
    check('不消费', press1.consumed.count, 0)
  } finally {
    dom.restore()
  }
}

finish()
