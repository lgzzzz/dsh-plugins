/**
 * 全屏关栏桥:window 捕获阶段拦下裸 Esc、关掉全屏右栏并吞掉这一按;焦点在终端或右栏
 * 自己的文本控件里、模态之上、服务面已折叠、停靠呈现各按约定让位;缺 sidebarRight 即不装;
 * 没有 window 时安装为 no-op;卸载后监听释放。
 */
import {
  approvalPending, check, domBody, domComposer, FakeElement, fakeKeyEvent, fakeSidebar, fakeUiSession, finish,
  gesture, harness, keydown, questionPending, shortcutContext, statusWith, withWindowDom,
} from './focus-helpers.mjs'
import { markFullscreenDismissed } from '../src/fullscreen-dismiss.ts'

/** 一段假 DOM:app 根 + 一个右栏面板根(呈现方式 / 开合可调,里面留一块普通内容)。 */
function column({ mode = 'fullscreen', open = true } = {}) {
  const app = new FakeElement('div', { 'data-app': '' })
  const panel = app.append(new FakeElement('div', {
    'data-sidebar-right-session': 's1',
    'data-sidebar-right-panel': mode,
    ...(open ? { 'data-sidebar-right-open': '' } : {}),
  }))
  const pane = panel.append(new FakeElement('div'))
  return { app, panel, pane }
}

/** 一段终端 DOM:`.xterm` 里是 xterm 自己的输入面。 */
function terminalIn(app) {
  const pane = app.append(new FakeElement('div'))
  const screen = pane.append(new FakeElement('div', { class: 'xterm' }))
  const textarea = screen.append(new FakeElement('textarea', { class: 'xterm-helper-textarea' }))
  return { pane, screen, textarea }
}

console.log('--- Z① 全屏 + 页面焦点:吞掉这一按并关栏 ---')
{
  const { app, panel, pane } = column()
  const dom = withWindowDom({ root: app, activeElement: pane })
  const sidebar = fakeSidebar()
  harness({ sidebar })
  try {
    const event = fakeKeyEvent({ path: [pane, panel, app], code: 'Escape' })
    dom.window.emit(event)
    check('这一按被吞', [event.prevented, event.stopped, event.immediateStopped], [1, 1, 1])
    check('关栏一次(与面板自带的折叠按钮同一条动作)', sidebar.calls, [['toggleExpanded']])
  } finally {
    dom.restore()
  }
}

console.log('--- Z② 焦点在被盖住的输入框里:浮层优先,照样关栏 ---')
{
  const { app, panel, pane } = column()
  const dom = withWindowDom({ root: app, activeElement: domComposer })
  const sidebar = fakeSidebar()
  harness({ sidebar })
  try {
    const event = fakeKeyEvent({ path: [domComposer, domBody], code: 'Escape' })
    dom.window.emit(event)
    check('这一按被吞', [event.prevented, event.stopped, event.immediateStopped], [1, 1, 1])
    check('关栏一次', sidebar.calls, [['toggleExpanded']])
  } finally {
    dom.restore()
  }
}

console.log('--- Z③ 让位:不吞、不关 ---')
{
  const cases = [
    ['服务面已折叠', { expanded: false }],
    ['停靠呈现', { mode: 'push' }],
    ['DOM 上已折叠', { open: false }],
    ['带 Ctrl', { event: { ctrlKey: true } }],
    ['带 Meta', { event: { metaKey: true } }],
    ['长按重复', { event: { repeat: true } }],
    ['组字中', { event: { isComposing: true } }],
    ['别的键', { event: { code: 'Enter' } }],
  ]
  for (const [label, options] of cases) {
    const built = column({ mode: options.mode, open: options.open })
    const sidebar = fakeSidebar()
    sidebar.expanded = options.expanded ?? true
    const dom = withWindowDom({ root: built.app, activeElement: built.pane })
    harness({ sidebar })
    try {
      const event = fakeKeyEvent({
        path: [built.pane, built.panel, built.app], code: 'Escape', ...options.event,
      })
      dom.window.emit(event)
      check(`${label}:不吞`, [event.prevented, event.stopped], [0, 0])
      check(`${label}:不关栏`, sidebar.calls, [])
    } finally {
      dom.restore()
    }
  }
}

console.log('--- Z④ 让位:焦点在终端里 / 右栏自己的文本控件里 / 模态之上 ---')
{
  // 终端:`.xterm` 内的 Esc 归终端。
  const terminalColumn = column()
  const terminal = terminalIn(terminalColumn.pane)
  const terminalDom = withWindowDom({ root: terminalColumn.app, activeElement: terminal.textarea })
  const terminalSidebar = fakeSidebar()
  harness({ sidebar: terminalSidebar })
  try {
    const event = fakeKeyEvent({ path: [terminal.textarea, terminal.screen, terminal.pane, terminalColumn.app], code: 'Escape' })
    terminalDom.window.emit(event)
    check('终端内:不吞', [event.prevented, event.stopped], [0, 0])
    check('终端内:不关栏', terminalSidebar.calls, [])
  } finally {
    terminalDom.restore()
  }

  // 右栏自己的文本控件(终端页签的重命名输入框就是这样一段 DOM):控件自带 Esc 语义。
  const renameColumn = column()
  const rename = renameColumn.pane.append(new FakeElement('input'))
  const renameDom = withWindowDom({ root: renameColumn.app, activeElement: rename })
  const renameSidebar = fakeSidebar()
  harness({ sidebar: renameSidebar })
  try {
    const event = fakeKeyEvent({ path: [rename, renameColumn.pane, renameColumn.panel, renameColumn.app], code: 'Escape' })
    renameDom.window.emit(event)
    check('右栏文本控件内:不吞', [event.prevented, event.stopped], [0, 0])
    check('右栏文本控件内:不关栏', renameSidebar.calls, [])
  } finally {
    renameDom.restore()
  }

  // 模态层之上:Esc 先归模态。
  const modalColumn = column()
  modalColumn.app.append(new FakeElement('div', { role: 'dialog', 'aria-modal': 'true' }))
  const modalDom = withWindowDom({ root: modalColumn.app, activeElement: modalColumn.pane })
  const modalSidebar = fakeSidebar()
  harness({ sidebar: modalSidebar })
  try {
    const event = fakeKeyEvent({ path: [modalColumn.pane, modalColumn.panel, modalColumn.app], code: 'Escape' })
    modalDom.window.emit(event)
    check('模态之上:不吞', [event.prevented, event.stopped], [0, 0])
    check('模态之上:不关栏', modalSidebar.calls, [])
  } finally {
    modalDom.restore()
  }
}

console.log('--- Z⑤ 失败模式:缺 sidebarRight 即不装;没有 window 时是 no-op ---')
{
  const { app, panel, pane } = column()
  const dom = withWindowDom({ root: app, activeElement: pane })
  try {
    const { sidebar } = harness({ withSidebar: false })
    const event = fakeKeyEvent({ path: [pane, panel, app], code: 'Escape' })
    dom.window.emit(event)
    check('缺 sidebarRight:不吞', [event.prevented, event.stopped], [0, 0])
    check('缺 sidebarRight:没有可关的面', sidebar.calls, [])
  } finally {
    dom.restore()
  }

  // 没有 window(非 DOM 环境):安装为 no-op,装配不抛、无告警,释放同样不抛。
  const { ctx, warnings } = harness({ sidebar: fakeSidebar() })
  check('没有 window:装配无告警', warnings, [])
  for (const effect of ctx.effects) {
    if (typeof effect.dispose === 'function') effect.dispose()
  }
}

console.log('--- Z⑥ 卸载:监听释放,不再关栏 ---')
{
  const { app, panel, pane } = column()
  const dom = withWindowDom({ root: app, activeElement: pane })
  const sidebar = fakeSidebar()
  const { ctx } = harness({ sidebar })
  try {
    const before = fakeKeyEvent({ path: [pane, panel, app], code: 'Escape' })
    dom.window.emit(before)
    check('卸载前关栏', sidebar.calls, [['toggleExpanded']])

    for (const effect of ctx.effects) {
      if (typeof effect.dispose === 'function') effect.dispose()
    }
    const after = fakeKeyEvent({ path: [pane, panel, app], code: 'Escape' })
    dom.window.emit(after)
    check('卸载后不吞', [after.prevented, after.stopped], [0, 0])
    check('卸载后不再关栏', sidebar.calls, [['toggleExpanded']])
  } finally {
    dom.restore()
  }
}

console.log('--- Z⑦ 与待答交互的交叠:一次按键只关栏,不作答看不见的卡片 ---')
{
  // 全屏浮层盖住整块 composer,待答审批 / 提问卡片在它下面看不见;两条 Esc 桥都要让位,
  // 否则同一次按键会一边关栏、一边答掉一个不可见的待答请求。
  const approval = approvalPending()
  const { app, panel, pane } = column()
  const dom = withWindowDom({ root: app, activeElement: pane })
  const sidebar = fakeSidebar()
  harness({ sidebar, uiSession: fakeUiSession({ status: statusWith('s1', approval) }) })
  try {
    dom.window.emit(fakeKeyEvent({ path: [pane, panel, app], code: 'Escape' }))
    check('关栏一次', sidebar.calls, [['toggleExpanded']])
    check('审批不作答', approval.answers, [])
  } finally {
    dom.restore()
  }

  const question = questionPending()
  const questionColumn = column()
  const questionDom = withWindowDom({ root: questionColumn.app, activeElement: questionColumn.pane })
  const questionSidebar = fakeSidebar()
  const questionHarness = harness({ sidebar: questionSidebar, uiSession: fakeUiSession({ status: statusWith('s1', question) }) })
  try {
    // 观察者那一半:关栏桥命中时会在捕获阶段停掉事件,固定通道收不到。
    const press = keydown(gesture('Escape'), shortcutContext({ target: domBody }))
    questionHarness.shortcuts.emit(press.input)
    check('提问不作答', question.dismissals, 0)
    check('提问桥不消费', press.consumed.count, 0)
    questionDom.window.emit(fakeKeyEvent({ path: [questionColumn.pane, questionColumn.panel, questionColumn.app], code: 'Escape' }))
    check('捕获路上仍然关栏', questionSidebar.calls, [['toggleExpanded']])
  } finally {
    questionDom.restore()
  }
}

console.log('--- Z⑧ 隐藏会话遗留的全屏面板:不抢 Esc;当前会话可见时才关栏 ---')
{
  // 隐藏会话里的面板标记还在 DOM 里。旧实现把它当成当前浮层:抢走 Esc、关掉当前会话的
  // 右栏(或一个看不见的侧栏);新实现要求至少有一个可见的全屏面板才接管。
  const hiddenOnlyApp = new FakeElement('div', { 'data-app': '' })
  const hiddenOnlySession = hiddenOnlyApp.append(new FakeElement('div', { 'data-sidebar-right-session': 's2', hidden: '' }))
  hiddenOnlySession.append(new FakeElement('div', {
    'data-sidebar-right-session': 's2',
    'data-sidebar-right-panel': 'fullscreen',
    'data-sidebar-right-open': '',
  }))
  const hiddenOnlyPage = hiddenOnlyApp.append(new FakeElement('div'))
  const hiddenOnlyDom = withWindowDom({ root: hiddenOnlyApp, activeElement: hiddenOnlyPage })
  const hiddenOnlySidebar = fakeSidebar()
  harness({ sidebar: hiddenOnlySidebar })
  try {
    const event = fakeKeyEvent({ path: [hiddenOnlyPage, hiddenOnlyApp], code: 'Escape' })
    hiddenOnlyDom.window.emit(event)
    check('只有隐藏面板:不吞', [event.prevented, event.stopped], [0, 0])
    check('只有隐藏面板:不关栏', hiddenOnlySidebar.calls, [])
  } finally {
    hiddenOnlyDom.restore()
  }

  // 隐藏面板与当前会话的可见全屏面板同时存在:仍然只关一次当前这一个。
  const mixedApp = new FakeElement('div', { 'data-app': '' })
  const hiddenSession = mixedApp.append(new FakeElement('div', { 'data-sidebar-right-session': 's2', 'aria-hidden': 'true' }))
  hiddenSession.append(new FakeElement('div', {
    'data-sidebar-right-session': 's2',
    'data-sidebar-right-panel': 'fullscreen',
    'data-sidebar-right-open': '',
  }))
  const visiblePanel = mixedApp.append(new FakeElement('div', {
    'data-sidebar-right-session': 's1',
    'data-sidebar-right-panel': 'fullscreen',
    'data-sidebar-right-open': '',
  }))
  const mixedPage = visiblePanel.append(new FakeElement('div'))
  const mixedDom = withWindowDom({ root: mixedApp, activeElement: mixedPage })
  const mixedSidebar = fakeSidebar()
  harness({ sidebar: mixedSidebar })
  try {
    const event = fakeKeyEvent({ path: [mixedPage, visiblePanel, mixedApp], code: 'Escape' })
    mixedDom.window.emit(event)
    check('隐藏 + 可见:吞掉这一按', [event.prevented, event.stopped], [1, 1])
    check('隐藏 + 可见:关栏一次', mixedSidebar.calls, [['toggleExpanded']])
  } finally {
    mixedDom.restore()
  }
}

console.log('--- Z⑨ 关栏宽限:同一按的重复投递 / 紧接着的第二按都不落到审批上 ---')
{
  // 面板有折叠动画,用户常在看起来没反应时再按一下;这一下若落到刚露出来的审批卡片上,
  // 就成了「按 Esc 关右侧栏却把 dsh 发起的授权拒掉」。关栏后 500ms 内裸 Esc 仍归这次关栏:
  // DOM 捕获路继续吞掉它,固定通道的审批 / 停止 / 提问观察者各自读同一条宽限让位。
  const { app, panel, pane } = column()
  const dom = withWindowDom({ root: app, activeElement: pane })
  const pending = approvalPending()
  const sidebar = fakeSidebar()
  const { shortcuts } = harness({ sidebar, uiSession: fakeUiSession({ status: statusWith('s1', pending) }) })
  try {
    const first = fakeKeyEvent({ path: [pane, panel, app], code: 'Escape' })
    dom.window.emit(first)
    check('第一按:吞掉', [first.prevented, first.stopped, first.immediateStopped], [1, 1, 1])
    check('第一按:关栏一次', sidebar.calls, [['toggleExpanded']])
    check('第一按:审批不作答', pending.answers, [])

    // 折叠已经落到 DOM 与服务面:第二次按键不再有全屏面板可关。
    panel.removeAttribute('data-sidebar-right-open')
    sidebar.expanded = false

    const second = fakeKeyEvent({ path: [domBody, app], code: 'Escape' })
    dom.window.emit(second)
    check('宽限内第二按:继续吞掉', [second.prevented, second.stopped, second.immediateStopped], [1, 1, 1])
    check('宽限内第二按:不再关栏', sidebar.calls, [['toggleExpanded']])
    check('宽限内第二按:审批不作答', pending.answers, [])

    const fixed = keydown(gesture('Escape'), shortcutContext({ target: domBody }))
    shortcuts.emit(fixed.input)
    check('宽限内固定通道:不消费', fixed.consumed.count, 0)
    check('宽限内固定通道:审批不作答', pending.answers, [])
  } finally {
    dom.restore()
  }

  // 宽限过期(用时序注入把关栏时刻推远):Esc 回到审批桥,照常一下即拒绝。
  markFullscreenDismissed(performance.now() - 1000)
  const later = keydown(gesture('Escape'), shortcutContext({ target: domBody }))
  shortcuts.emit(later.input)
  check('宽限过后:Esc 照常拒绝', pending.answers, ['rejected'])
  check('宽限过后:按键被消费', later.consumed.count, 1)
}

console.log('--- Z⑩ 关栏宽限只吞裸 Esc:Enter 与带修饰键的组合照常 ---')
{
  const { app, panel, pane } = column()
  const dom = withWindowDom({ root: app, activeElement: pane })
  const pending = approvalPending()
  const sidebar = fakeSidebar()
  const { shortcuts } = harness({ sidebar, uiSession: fakeUiSession({ status: statusWith('s1', pending) }) })
  try {
    dom.window.emit(fakeKeyEvent({ path: [pane, panel, app], code: 'Escape' }))
    panel.removeAttribute('data-sidebar-right-open')
    sidebar.expanded = false

    // Enter(允许一次)不受宽限影响:按键在固定通道被消费并作答。
    const allow = keydown(gesture('Enter'), shortcutContext({ target: domBody }))
    shortcuts.emit(allow.input)
    check('宽限内 Enter 照常允许一次', pending.answers, ['allowed-once'])
    check('宽限内 Enter 被消费', allow.consumed.count, 1)

    // 带修饰键的 Esc 不属于关栏,也不被宽限吞掉:DOM 路不动作,固定通道也不认这条固定行。
    const modified = fakeKeyEvent({ path: [domBody, app], code: 'Escape', ctrlKey: true })
    dom.window.emit(modified)
    check('宽限内 Ctrl+Esc:不吞', [modified.prevented, modified.stopped, modified.immediateStopped], [0, 0, 0])
  } finally {
    dom.restore()
  }

  // 终端与模态层保留自己的 Esc:宽限只吞「可能落到刚露出来的待答卡片上」的那一按。
  const terminalBuild = column()
  const screen = terminalBuild.pane.append(new FakeElement('div', { class: 'xterm' }))
  const textarea = screen.append(new FakeElement('textarea', { class: 'xterm-helper-textarea' }))
  const terminalDom = withWindowDom({ root: terminalBuild.app, activeElement: textarea })
  const terminalSidebar = fakeSidebar()
  harness({ sidebar: terminalSidebar })
  try {
    terminalDom.window.emit(fakeKeyEvent({ path: [terminalBuild.pane, terminalBuild.panel, terminalBuild.app], code: 'Escape' }))
    terminalBuild.panel.removeAttribute('data-sidebar-right-open')
    terminalSidebar.expanded = false
    const terminalEsc = fakeKeyEvent({ path: [textarea, screen, terminalBuild.pane, terminalBuild.app], code: 'Escape' })
    terminalDom.window.emit(terminalEsc)
    check('宽限内终端 Esc:不吞', [terminalEsc.prevented, terminalEsc.stopped], [0, 0])
  } finally {
    terminalDom.restore()
  }

  const modalBuild = column()
  const modalDom = withWindowDom({ root: modalBuild.app, activeElement: modalBuild.pane })
  const modalSidebar = fakeSidebar()
  harness({ sidebar: modalSidebar })
  try {
    modalDom.window.emit(fakeKeyEvent({ path: [modalBuild.pane, modalBuild.panel, modalBuild.app], code: 'Escape' }))
    modalBuild.panel.removeAttribute('data-sidebar-right-open')
    modalSidebar.expanded = false
    modalBuild.app.append(new FakeElement('div', { role: 'dialog', 'aria-modal': 'true' }))
    const modalEsc = fakeKeyEvent({ path: [modalBuild.pane, modalBuild.app], code: 'Escape' })
    modalDom.window.emit(modalEsc)
    check('宽限内模态上的 Esc:不吞', [modalEsc.prevented, modalEsc.stopped], [0, 0])
  } finally {
    modalDom.restore()
  }
}

finish()
