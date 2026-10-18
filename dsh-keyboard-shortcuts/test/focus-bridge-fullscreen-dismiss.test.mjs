/**
 * 全屏关栏桥:window 捕获阶段拦下裸 Esc、关掉全屏右栏并吞掉这一按;焦点在终端或右栏
 * 自己的文本控件里、模态之上、服务面已折叠、停靠呈现各按约定让位;缺 sidebarRight 即不装;
 * 没有 window 时安装为 no-op;卸载后监听释放。
 */
import {
  approvalPending, check, domBody, domComposer, FakeElement, fakeKeyEvent, fakeSidebar, fakeUiSession, finish,
  gesture, harness, keydown, questionPending, shortcutContext, statusWith, withWindowDom,
} from './focus-helpers.mjs'

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
    check('这一按被吞', [event.prevented, event.stopped], [1, 1])
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
    check('这一按被吞', [event.prevented, event.stopped], [1, 1])
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

finish()
