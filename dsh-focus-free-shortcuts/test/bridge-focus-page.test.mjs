/**
 * 聚焦右栏页面桥:`Ctrl+Alt+K` / `⌘⌥K` 把键盘交给右栏当前显示的页面(通常是终端,
 * 落到 `.xterm-helper-textarea`),页面已自持键盘时不抢;折叠 / 没有会话 / 没有可见
 * pane 各按约定让位;缺服务即不装;终端内(`.xterm`)的按键在 window 捕获阶段拦下。
 */
import { applyPlugin, captureWarnings, check, checkTrue, domComposer, FakeElement, fakeKeyEvent, fakePageSidebar, fakeSessions, fakeShortcuts, fakeUiSession, FakeCtx, finish, gesture, harness, keydown, session, shortcutContext, withWindowDom, FOCUS_PAGE_ID, FOCUS_PAGE_PRESS, UNUSED_PRESS } from './helpers.mjs'

/** 一列侧栏假 DOM:app 容器(充当 document 根)+ 会话根 + 一个活动 dock pane(+ 可选的终端)。 */
function column({ sessionId = 's1', open = true, terminal = true } = {}) {
  const app = new FakeElement('div', { 'data-app': '' })
  const root = app.append(new FakeElement('div', {
    'data-sidebar-right-session': sessionId,
    ...(open ? { 'data-sidebar-right-open': '' } : {}),
  }))
  const pane = root.append(new FakeElement('section', { 'data-dockkit-pane': 'p1', 'data-dockkit-pane-active': '' }))
  let textarea
  if (terminal) {
    const screen = pane.append(new FakeElement('div', { class: 'xterm' }))
    textarea = screen.append(new FakeElement('textarea', { class: 'xterm-helper-textarea' }))
  }
  return { app, root, pane, textarea }
}

console.log('--- X① 从别处抢键盘:先聚焦活动 pane,再落到终端输入面 ---')
{
  const sidebar = fakePageSidebar({ mounted: 's1' })
  const { app, pane, textarea } = column()
  const dom = withWindowDom({ root: app, activeElement: domComposer })
  const { shortcuts } = harness({ sidebar })
  try {
    checkTrue('固定行已挂载', shortcuts.fixedCatalog.getSnapshot().some((entry) => entry.id === FOCUS_PAGE_ID))
    const press = keydown(FOCUS_PAGE_PRESS, shortcutContext({ target: domComposer }))
    shortcuts.emit(press.input)
    check('消费', press.consumed.count, 1)
    check('先聚焦活动 pane', pane.focusCount, 1)
    check('pane preventScroll', pane.lastFocusOptions, { preventScroll: true })
    check('键盘落到终端输入面', textarea.focusCount, 1)
    check('输入面 preventScroll', textarea.lastFocusOptions, { preventScroll: true })
  } finally {
    dom.restore()
  }
}

console.log('--- X② 页面已自持键盘(如终端里)时不抢,但这一按仍归本桥 ---')
{
  const sidebar = fakePageSidebar({ mounted: 's1' })
  const { app, pane, textarea } = column()
  const dom = withWindowDom({ root: app, activeElement: textarea })
  const { shortcuts } = harness({ sidebar })
  try {
    const press = keydown(FOCUS_PAGE_PRESS, shortcutContext({ region: 'terminal', target: textarea }))
    shortcuts.emit(press.input)
    check('消费', press.consumed.count, 1)
    check('不重复聚焦 pane', pane.focusCount, 0)
    check('不重复聚焦输入面', textarea.focusCount, 0)
  } finally {
    dom.restore()
  }
}

console.log('--- X③ 显示页不是终端:只把键盘交给 pane 本身 ---')
{
  const sidebar = fakePageSidebar({ mounted: 's1' })
  const { app, pane } = column({ terminal: false })
  const dom = withWindowDom({ root: app, activeElement: domComposer })
  const { shortcuts } = harness({ sidebar })
  try {
    const press = keydown(FOCUS_PAGE_PRESS, shortcutContext({ target: domComposer }))
    shortcuts.emit(press.input)
    check('消费', press.consumed.count, 1)
    check('聚焦 pane', pane.focusCount, 1)
  } finally {
    dom.restore()
  }
}

console.log('--- X④ 边界:面板展开但没有可见 pane 时只消费、不动作 ---')
{
  const sidebar = fakePageSidebar({ mounted: 's1' })
  const app = new FakeElement('div', { 'data-app': '' })
  const dom = withWindowDom({ root: app, activeElement: domComposer })
  const { shortcuts } = harness({ sidebar })
  try {
    const press = keydown(FOCUS_PAGE_PRESS, shortcutContext({ target: domComposer }))
    shortcuts.emit(press.input)
    check('消费(先消费再动作)', press.consumed.count, 1)
  } finally {
    dom.restore()
  }
}

console.log('--- X⑤ 让位:折叠 / 没有会话 / 别的键 / 模态 / repeat ---')
{
  const cases = [
    ['右栏折叠', { sidebar: fakePageSidebar({ mounted: 's1', expanded: false }), press: FOCUS_PAGE_PRESS, context: {} }],
    ['没有会话', { sidebar: fakePageSidebar({ mounted: null }), press: FOCUS_PAGE_PRESS, context: {} }],
    ['别的键', { sidebar: fakePageSidebar({ mounted: 's1' }), press: UNUSED_PRESS, context: {} }],
    ['模态层之上', { sidebar: fakePageSidebar({ mounted: 's1' }), press: FOCUS_PAGE_PRESS, context: { modal: 'settings' } }],
    ['长按重复', { sidebar: fakePageSidebar({ mounted: 's1' }), press: gesture('KeyK', { control: true, alt: true, repeat: true }), context: {} }],
    ['组字中', { sidebar: fakePageSidebar({ mounted: 's1' }), press: gesture('KeyK', { control: true, alt: true, composing: true }), context: {} }],
  ]
  for (const [label, testCase] of cases) {
    const { app, pane, textarea } = column()
    const dom = withWindowDom({ root: app, activeElement: domComposer })
    const { shortcuts } = harness({ sidebar: testCase.sidebar })
    try {
      const press = keydown(testCase.press, shortcutContext({ target: domComposer, ...testCase.context }))
      shortcuts.emit(press.input)
      check(`${label}不消费`, press.consumed.count, 0)
      check(`${label}不动焦点`, [pane.focusCount, textarea.focusCount], [0, 0])
    } finally {
      dom.restore()
    }
  }
}

console.log('--- X⑥ 失败模式:缺 sidebarRight / 缺 observeFixedInput 即不装 ---')
{
  const noSidebar = harness({ withSidebar: false })
  check('缺 sidebarRight 时聚焦右栏页面固定行未挂载', noSidebar.shortcuts.fixedCatalog.getSnapshot().some((entry) => entry.id === FOCUS_PAGE_ID), false)

  const bare = new FakeCtx({
    shortcuts: { ...fakeShortcuts(), observeFixedInput: undefined },
    sidebarRight: fakePageSidebar(),
    sessions: fakeSessions({ summary: { s1: session('s1') } }),
    uiSession: fakeUiSession(),
  })
  const warnings = captureWarnings(() => applyPlugin(bare))
  checkTrue('缺 observeFixedInput 时聚焦右栏页面桥告警', warnings.some((line) => line.includes('focus-page key not installed')))
  check('缺 observeFixedInput 时未装监听', bare.effects.length, 0)
}

console.log('--- X⑦ 卸载:固定行与监听一起释放 ---')
{
  const sidebar = fakePageSidebar({ mounted: 's1' })
  const { app, textarea } = column()
  const dom = withWindowDom({ root: app, activeElement: domComposer })
  const { ctx, shortcuts } = harness({ sidebar })
  try {
    const before = keydown(FOCUS_PAGE_PRESS, shortcutContext({ target: domComposer }))
    shortcuts.emit(before.input)
    check('卸载前交棒', before.consumed.count, 1)

    for (const effect of ctx.effects) {
      if (typeof effect.dispose === 'function') effect.dispose()
    }
    checkTrue('卸载后固定行离录', !shortcuts.fixedCatalog.getSnapshot().some((entry) => entry.id === FOCUS_PAGE_ID))
    const after = keydown(FOCUS_PAGE_PRESS, shortcutContext({ target: domComposer }))
    shortcuts.emit(after.input)
    check('卸载后不再消费', after.consumed.count, 0)
    check('卸载后不动键盘', textarea.focusCount, 1)
  } finally {
    dom.restore()
  }
}

console.log('--- X⑧ 终端内:捕获阶段在 xterm 之前拦下,不让它落进 shell ---')
{
  const sidebar = fakePageSidebar({ mounted: 's1' })
  const { app, root, pane, textarea } = column()
  const dom = withWindowDom({ root: app, activeElement: textarea })
  const { shortcuts } = harness({ sidebar })
  try {
    checkTrue('固定行已挂载', shortcuts.fixedCatalog.getSnapshot().some((entry) => entry.id === FOCUS_PAGE_ID))
    const event = fakeKeyEvent({ path: [textarea, pane, domComposer, root, app], code: 'KeyK', ctrlKey: true, altKey: true })
    dom.window.emit(event)
    check('事件在捕获阶段被吞', [event.prevented, event.stopped], [1, 1])
    check('键盘本来就在终端里,不重复聚焦', [pane.focusCount, textarea.focusCount], [0, 0])
  } finally {
    dom.restore()
  }
}

console.log('--- X⑨ 捕获路径让位:不吞事件,原样交给 xterm ---')
{
  const cases = [
    { label: '右栏折叠', sidebar: fakePageSidebar({ mounted: 's1', expanded: false }), open: true },
    { label: '没有会话', sidebar: fakePageSidebar({ mounted: null }), open: true },
    {
      label: '模态打开',
      sidebar: fakePageSidebar({ mounted: 's1' }),
      open: true,
      extra: (app) => app.append(new FakeElement('div', { role: 'dialog', 'aria-modal': 'true' })),
    },
  ]
  for (const testCase of cases) {
    const { app, root, pane, textarea } = column({ open: testCase.open })
    testCase.extra?.(app)
    const dom = withWindowDom({ root: app })
    const { shortcuts } = harness({ sidebar: testCase.sidebar })
    try {
      const event = fakeKeyEvent({ path: [textarea, pane, root, app], code: 'KeyK', ctrlKey: true, altKey: true })
      dom.window.emit(event)
      check(`${testCase.label}不吞事件`, [event.prevented, event.stopped], [0, 0])
    } finally {
      dom.restore()
    }
  }

  // 长按重复与"落在别处"的按键同样放行。
  const { app, root, pane, textarea } = column()
  const dom = withWindowDom({ root: app })
  const { shortcuts } = harness({ sidebar: fakePageSidebar({ mounted: 's1' }) })
  try {
    const repeated = fakeKeyEvent({ path: [textarea, pane, root, app], code: 'KeyK', ctrlKey: true, altKey: true, repeat: true })
    dom.window.emit(repeated)
    check('长按重复不吞事件', [repeated.prevented, repeated.stopped], [0, 0])

    const editor = pane.append(new FakeElement('textarea'))
    const loose = fakeKeyEvent({ path: [editor, pane, root, app], code: 'KeyK', ctrlKey: true, altKey: true })
    dom.window.emit(loose)
    check('非 .xterm 目标不拦(交给冒泡通道)', [loose.prevented, loose.stopped], [0, 0])
  } finally {
    dom.restore()
  }
}

console.log('--- X⑩ 卸载:捕获监听随观察者一起释放 ---')
{
  const sidebar = fakePageSidebar({ mounted: 's1' })
  const { app, root, pane, textarea } = column()
  const dom = withWindowDom({ root: app, activeElement: textarea })
  const { ctx, shortcuts } = harness({ sidebar })
  try {
    const before = fakeKeyEvent({ path: [textarea, pane, root, app], code: 'KeyK', ctrlKey: true, altKey: true })
    dom.window.emit(before)
    check('卸载前吞事件', before.stopped, 1)
    for (const effect of ctx.effects) {
      if (typeof effect.dispose === 'function') effect.dispose()
    }
    const after = fakeKeyEvent({ path: [textarea, pane, root, app], code: 'KeyK', ctrlKey: true, altKey: true })
    dom.window.emit(after)
    check('卸载后不吞事件', [after.prevented, after.stopped], [0, 0])
    const press = keydown(FOCUS_PAGE_PRESS, shortcutContext({ target: domComposer }))
    shortcuts.emit(press.input)
    check('卸载后观察者也不再消费', press.consumed.count, 0)
  } finally {
    dom.restore()
  }
}

finish()
