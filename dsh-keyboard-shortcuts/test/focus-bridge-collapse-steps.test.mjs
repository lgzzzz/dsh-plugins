/**
 * 折叠中间步骤桥：固定行元数据、固定通道的消费边界、外层 / 单步两层目标、焦点保持、
 * 终端捕获与卸载。折叠动作一律是点击上游标题；测试里的假控件把点击记在 `clicks` 上。
 */
import {
  COLLAPSE_STEPS_BINDING,
  COLLAPSE_STEPS_ID,
  collapseStepsCommand,
  installCollapseStepsBridge,
} from '../src/collapse-steps.ts'
import { LOCK_ATTRIBUTE, SEAL_ATTRIBUTE } from '../src/collapse-seal.ts'
import {
  captureWarnings,
  check,
  checkTrue,
  FakeCtx,
  FakeElement,
  fakeKeyEvent,
  fakeShortcuts,
  finish,
  gesture,
  keydown,
  shortcutContext,
  withWindowDom,
} from './focus-helpers.mjs'

/** 一个带主会话槽位与滚动口的假页面。 */
function mainScroll() {
  const app = new FakeElement('div')
  const main = app.append(new FakeElement('div', { 'data-slot': 'main.conversation' }))
  const scroll = main.append(new FakeElement('div', { 'data-conversation-scroll': '' }))
  return { app, main, scroll }
}

/** 一个会“点击自己 → 聚焦自己 → 收起自己”的上游标题替身。 */
function clickable(element) {
  element.clicks = 0
  element.click = () => {
    element.clicks += 1
    element.focus()
    element.setAttribute('aria-expanded', 'false')
  }
  return element
}

/** 摆一个带 top / height 的假盒子；读取时取当前值。 */
function place(element, top, height) {
  element.rect = { top, height }
  element.getBoundingClientRect = () => ({
    top: element.rect.top,
    bottom: element.rect.top + element.rect.height,
    height: element.rect.height,
    left: 0,
    right: 800,
    width: 800,
  })
  return element
}

/** 装配桥接并返回各部件。 */
function bridgeHarness({ platform = 'windows', root } = {}) {
  const shortcuts = fakeShortcuts({ platform })
  const ctx = new FakeCtx({ shortcuts })
  const warnings = captureWarnings(() => installCollapseStepsBridge(ctx))
  return { shortcuts, ctx, warnings, root }
}

console.log('--- E① 固定行：id、键帽、绑定与分组 ---')
{
  check('固定行 id', COLLAPSE_STEPS_ID, 'dsh-keyboard-shortcuts.collapse-steps')
  check('Windows 键帽', collapseStepsCommand('windows').keys, ['Ctrl', 'Alt', '.'])
  check('macOS 键帽', collapseStepsCommand('macos').keys, ['⌘', '⌥', '.'])
  check('行标签', collapseStepsCommand('linux').label(), '折叠中间步骤')
  check('逻辑绑定', collapseStepsCommand('linux').bindings, [COLLAPSE_STEPS_BINDING])
  check('分组', collapseStepsCommand('linux').group, 'application')

  const { shortcuts } = bridgeHarness()
  const row = shortcuts.fixedCatalog.getSnapshot().find((entry) => entry.id === COLLAPSE_STEPS_ID)
  check('注册后的物理绑定', row?.bindings, [{ code: 'Period', modifiers: ['control', 'alt'] }])
}

console.log('--- E② 固定通道：有目标才消费，折叠外层后不再点单步详情 ---')
{
  const { app, scroll } = mainScroll()
  const turn = clickable(scroll.append(new FakeElement('button', { 'data-turn-process': '1', 'aria-expanded': 'true' })))
  const groupRoot = scroll.append(new FakeElement('div', { 'data-step-process': '' }))
  const group = clickable(groupRoot.append(new FakeElement('button', { 'data-process-activity': 'commands', 'aria-expanded': 'true' })))
  const detailRoot = scroll.append(new FakeElement('div', { 'data-chat-flow-kind': 'tool-call' }))
  const detail = clickable(detailRoot.append(new FakeElement('div', { 'data-disclosure-row': '', 'aria-expanded': 'true' })))

  const dom = withWindowDom({ root: app })
  try {
    const { shortcuts } = bridgeHarness({ root: app })
    const press = keydown(gesture('Period', { control: true, alt: true }), shortcutContext({ target: null }))
    shortcuts.emit(press.input)
    check('外层两个都点击', [turn.clicks, group.clicks], [1, 1])
    check('被外层遮住的单步详情不点', detail.clicks, 0)
    check('这一按被消费', press.consumed.count, 1)
    check('外层已收起', [turn.getAttribute('aria-expanded'), group.getAttribute('aria-expanded')], ['false', 'false'])
    check('普通元素的 focus 没有被固化成自有属性', Object.prototype.hasOwnProperty.call(turn, 'focus'), false)

    // 外层都收起后再按一次，这次才落到单步详情。
    const again = keydown(gesture('Period', { control: true, alt: true }), shortcutContext({ target: null }))
    shortcuts.emit(again.input)
    check('第二次按收单步详情', detail.clicks, 1)
    check('第二次仍消费', again.consumed.count, 1)
  } finally {
    dom.restore()
  }
}

console.log('--- E③ 没有展开项时不动作、不消费 ---')
{
  const { app, scroll } = mainScroll()
  clickable(scroll.append(new FakeElement('button', { 'data-turn-process': '1', 'aria-expanded': 'false' })))
  const groupRoot = scroll.append(new FakeElement('div', { 'data-step-process': '' }))
  clickable(groupRoot.append(new FakeElement('button', { 'data-process-activity': 'commands', 'aria-expanded': 'false' })))
  const detailRoot = scroll.append(new FakeElement('div', { 'data-chat-flow-kind': 'tool-call' }))
  clickable(detailRoot.append(new FakeElement('div', { 'data-disclosure-row': '', 'aria-expanded': 'false' })))

  const dom = withWindowDom({ root: app })
  try {
    const { shortcuts } = bridgeHarness()
    const press = keydown(gesture('Period', { control: true, alt: true }), shortcutContext({ target: null }))
    shortcuts.emit(press.input)
    check('没有可折的展开项', press.consumed.count, 0)
  } finally {
    dom.restore()
  }
}

console.log('--- E④ 让位：别的键、模态、长按、组字、已消费、未挂载的行 ---')
{
  const { app, scroll } = mainScroll()
  const turn = clickable(scroll.append(new FakeElement('button', { 'data-turn-process': '1', 'aria-expanded': 'true' })))
  const dom = withWindowDom({ root: app })
  try {
    const { shortcuts } = bridgeHarness()
    const cases = [
      ['别的键', gesture('KeyY', { control: true, alt: true }), shortcutContext({ target: null })],
      ['模态层', gesture('Period', { control: true, alt: true }), shortcutContext({ modal: 'settings' })],
      ['长按', gesture('Period', { control: true, alt: true, repeat: true }), shortcutContext({ target: null })],
      ['组字', gesture('Period', { control: true, alt: true, composing: true }), shortcutContext({ target: null })],
      ['已被消费', gesture('Period', { control: true, alt: true, defaultPrevented: true }), shortcutContext({ target: null })],
      ['多按 Shift', gesture('Period', { control: true, alt: true, shift: true }), shortcutContext({ target: null })],
    ]
    for (const [label, value, context] of cases) {
      const press = keydown(value, context)
      shortcuts.emit(press.input)
      check(`${label}不消费`, press.consumed.count, 0)
    }
    check('上述情形一次也没点', turn.clicks, 0)
  } finally {
    dom.restore()
  }
}

console.log('--- E⑤ 焦点保持：合成点击不抢 composer / 终端的键盘 ---')
{
  const { app, scroll } = mainScroll()
  const turn = clickable(scroll.append(new FakeElement('button', { 'data-turn-process': '1', 'aria-expanded': 'true' })))
  let focusCalls = 0
  const originalFocus = function focus() {
    focusCalls += 1
  }
  turn.focus = originalFocus
  const dom = withWindowDom({ root: app })
  try {
    const { shortcuts } = bridgeHarness()
    const press = keydown(gesture('Period', { control: true, alt: true }), shortcutContext({ target: null }))
    shortcuts.emit(press.input)
    check('上游点击调用过 focus', turn.clicks, 1)
    check('focus 被临时屏蔽', focusCalls, 0)
    checkTrue('原自有 focus 已恢复', turn.focus === originalFocus)
    check('收起状态已生效', turn.getAttribute('aria-expanded'), 'false')
  } finally {
    dom.restore()
  }
}

console.log('--- E⑥ 缺 observeFixedInput：告警且不挂行 ---')
{
  const shortcuts = {
    ...fakeShortcuts(),
    observeFixedInput: undefined,
  }
  const ctx = new FakeCtx({ shortcuts })
  const warnings = captureWarnings(() => installCollapseStepsBridge(ctx))
  check('没有注册固定行', shortcuts.fixedCatalog.getSnapshot().some((entry) => entry.id === COLLAPSE_STEPS_ID), false)
  checkTrue('有明确告警', warnings.some((line) => line.includes('collapse-steps key not installed')))
}

console.log('--- E⑦ 卸载：固定行与观察者一起释放 ---')
{
  const { app, scroll } = mainScroll()
  const turn = clickable(scroll.append(new FakeElement('button', { 'data-turn-process': '1', 'aria-expanded': 'true' })))
  const dom = withWindowDom({ root: app })
  try {
    const { shortcuts, ctx } = bridgeHarness()
    check('挂载后固定行在录', shortcuts.fixedCatalog.getSnapshot().some((entry) => entry.id === COLLAPSE_STEPS_ID), true)
    check('挂载后观察者在录', shortcuts.listenerCount(), 1)
    const before = keydown(gesture('Period', { control: true, alt: true }), shortcutContext({ target: null }))
    shortcuts.emit(before.input)
    check('卸载前折叠', turn.clicks, 1)

    for (const effect of ctx.effects) {
      if (typeof effect.dispose === 'function') effect.dispose()
    }
    check('卸载后固定行离录', shortcuts.fixedCatalog.getSnapshot().some((entry) => entry.id === COLLAPSE_STEPS_ID), false)
    check('卸载后观察者清空', shortcuts.listenerCount(), 0)

    // 再展开一次，确认卸载后的按键不再折叠。
    turn.setAttribute('aria-expanded', 'true')
    const after = keydown(gesture('Period', { control: true, alt: true }), shortcutContext({ target: null }))
    shortcuts.emit(after.input)
    check('卸载后不再点击', turn.clicks, 1)
    check('卸载后不消费', after.consumed.count, 0)
  } finally {
    dom.restore()
  }
}

/** 一段终端 DOM：`.xterm` 与它自己的 helper textarea。 */
function terminal(app) {
  const pane = app.append(new FakeElement('section', { 'data-dockkit-pane': 'p1' }))
  const screen = pane.append(new FakeElement('div', { class: 'xterm' }))
  const textarea = screen.append(new FakeElement('textarea', { class: 'xterm-helper-textarea' }))
  return { pane, screen, textarea, path: [textarea, screen, pane, app] }
}

console.log('--- E⑧ 终端内 Ctrl+Alt+. / ⌘⌥.：捕获阶段折叠并吞键 ---')
{
  const windows = mainScroll()
  const turn = clickable(windows.scroll.append(new FakeElement('button', { 'data-turn-process': '1', 'aria-expanded': 'true' })))
  const term = terminal(windows.app)
  const dom = withWindowDom({ root: windows.app })
  try {
    const { shortcuts } = bridgeHarness()
    const event = fakeKeyEvent({ path: term.path, code: 'Period', ctrlKey: true, altKey: true })
    dom.window.emit(event)
    check('终端内折叠', turn.clicks, 1)
    check('终端内这一按被吞', [event.prevented, event.stopped], [1, 1])

    // 非终端落点由固定通道处理，这条捕获监听不抢。
    const page = fakeKeyEvent({ path: [windows.app], code: 'Period', ctrlKey: true, altKey: true })
    dom.window.emit(page)
    check('非终端落点不由捕获路径处理', [page.prevented, page.stopped], [0, 0])

    // 没有目标可折时不吞，终端照常拿到这一按。
    turn.setAttribute('aria-expanded', 'false')
    const idle = fakeKeyEvent({ path: term.path, code: 'Period', ctrlKey: true, altKey: true })
    dom.window.emit(idle)
    check('没有目标不吞终端按键', [idle.prevented, idle.stopped], [0, 0])
    check('固定行仍在录', shortcuts.fixedCatalog.getSnapshot().some((entry) => entry.id === COLLAPSE_STEPS_ID), true)
  } finally {
    dom.restore()
  }
}

console.log('--- E⑨ 终端捕获的让位：别的键 / 端点外的组合 / 模态 ---')
{
  const windows = mainScroll()
  const turn = clickable(windows.scroll.append(new FakeElement('button', { 'data-turn-process': '1', 'aria-expanded': 'true' })))
  const term = terminal(windows.app)
  // 先不挂上模态层：前四例各自因为键位 / 长按 / 组字让位；最后才是模态让位。
  const modal = new FakeElement('div', { role: 'dialog', 'aria-modal': 'true' })
  const dom = withWindowDom({ root: windows.app })
  try {
    bridgeHarness()
    for (const [label, event] of [
      ['别的键', fakeKeyEvent({ path: term.path, code: 'KeyY', ctrlKey: true, altKey: true })],
      ['多按 Shift', fakeKeyEvent({ path: term.path, code: 'Period', ctrlKey: true, altKey: true, shiftKey: true })],
      ['长按', fakeKeyEvent({ path: term.path, code: 'Period', ctrlKey: true, altKey: true, repeat: true })],
      ['组字', fakeKeyEvent({ path: term.path, code: 'Period', ctrlKey: true, altKey: true, isComposing: true })],
    ]) {
      dom.window.emit(event)
      check(`${label}不折叠`, turn.clicks, 0)
      check(`${label}不吞`, [event.prevented, event.stopped], [0, 0])
    }
    // 模态打开时：即使落点在终端、键也匹配，也让给弹窗。
    windows.app.append(modal)
    const blocked = fakeKeyEvent({ path: term.path, code: 'Period', ctrlKey: true, altKey: true })
    dom.window.emit(blocked)
    check('模态下不折叠', turn.clicks, 0)
    check('模态下不吞', [blocked.prevented, blocked.stopped], [0, 0])
  } finally {
    dom.restore()
  }
}

console.log('--- E⑩ macOS 口径：只认 ⌘⌥.，Ctrl+Alt+. 留给终端 ---')
{
  const windows = mainScroll()
  const turn = clickable(windows.scroll.append(new FakeElement('button', { 'data-turn-process': '1', 'aria-expanded': 'true' })))
  const term = terminal(windows.app)
  const dom = withWindowDom({ root: windows.app })
  try {
    bridgeHarness({ platform: 'macos' })
    const ctrl = fakeKeyEvent({ path: term.path, code: 'Period', ctrlKey: true, altKey: true })
    dom.window.emit(ctrl)
    check('macOS 上 Ctrl+Alt+. 不折叠', turn.clicks, 0)
    check('macOS 上 Ctrl+Alt+. 不被吞', [ctrl.prevented, ctrl.stopped], [0, 0])

    const meta = fakeKeyEvent({ path: term.path, code: 'Period', metaKey: true, altKey: true })
    dom.window.emit(meta)
    check('macOS 上 ⌘⌥. 折叠', turn.clicks, 1)
    check('macOS 上 ⌘⌥. 被吞', [meta.prevented, meta.stopped], [1, 1])
  } finally {
    dom.restore()
  }
}

console.log('--- E⑪ 折叠后按阅读线补偿滚动 ---')
{
  const { app, scroll } = mainScroll()
  place(scroll, 100, 500)
  scroll.clientTop = 0
  scroll.clientHeight = 500
  scroll.scrollHeight = 2000
  scroll.scrollTop = 700
  const seat = scroll.append(new FakeElement('div', { 'data-composer-seat': '' }))
  place(seat, 550, 100)
  place(scroll.append(new FakeElement('div', {
    'data-chat-flow-key': 'user',
    'data-chat-flow-kind': 'user',
    'data-chat-turn': '1',
  })), 20, 70)
  const process = scroll.append(new FakeElement('div', { 'data-chat-flow-key': 'process', 'data-chat-turn': '1' }))
  place(process, 90, 30)
  const turn = process.append(new FakeElement('button', { 'data-turn-process': '1', 'aria-expanded': 'true' }))
  const hidden = scroll.append(new FakeElement('div', { 'data-chat-flow-key': 'hidden', 'data-chat-turn': '1' }))
  place(hidden, 130, 100)
  const anchor = scroll.append(new FakeElement('div', {
    'data-chat-flow-key': 'answer',
    'data-chat-flow-kind': 'assistant-step',
    'data-chat-turn': '1',
  }))
  place(anchor, 240, 200)
  turn.click = () => {
    turn.setAttribute('aria-expanded', 'false')
    hidden.setAttribute('hidden', '')
    hidden.rect.height = 0
    anchor.rect.top = 140
  }

  const dom = withWindowDom({ root: app })
  try {
    const { shortcuts } = bridgeHarness()
    const press = keydown(gesture('Period', { control: true, alt: true }), shortcutContext({ target: null }))
    shortcuts.emit(press.input)
    check('补偿延到微任务', scroll.scrollTop, 700)
    await Promise.resolve()
    check('这一按仍被消费', press.consumed.count, 1)
    check('折叠已生效', turn.getAttribute('aria-expanded'), 'false')
    check('锚点换到折叠后的屏幕位置', scroll.scrollTop, 600)
  } finally {
    dom.restore()
  }
}

console.log('--- E⑪ 只有封口目标（最新一轮平铺）时也消费并封口 ---')
{
  const { app, scroll } = mainScroll()
  // 已结束、带锁、展开的轮次过程标题：不归快捷键折叠。
  const turnRow = scroll.append(new FakeElement('div', { 'data-chat-turn': '1', 'data-chat-flow-kind': 'turn-process' }))
  clickable(turnRow.append(new FakeElement('button', {
    'data-turn-process': '1',
    'aria-expanded': 'true',
    [LOCK_ATTRIBUTE]: '',
  })))
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
    const { shortcuts } = bridgeHarness()
    const press = keydown(gesture('Period', { control: true, alt: true }), shortcutContext({ target: null }))
    shortcuts.emit(press.input)
    check('封口生效', groupRoot.hasAttribute(SEAL_ATTRIBUTE), true)
    check('组头显示', groupHeader.hasAttribute('hidden'), false)
    check('这一按被消费', press.consumed.count, 1)

    const again = keydown(gesture('Period', { control: true, alt: true }), shortcutContext({ target: null }))
    shortcuts.emit(again.input)
    check('再按一次没有可做的事', again.consumed.count, 0)
  } finally {
    dom.restore()
  }
}

finish()
