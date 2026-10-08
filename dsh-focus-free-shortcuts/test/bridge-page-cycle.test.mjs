/**
 * 页面循环桥:`Ctrl+Alt+←/→` 切页,并在 commit 之后聚焦活动 pane;页面自聚焦时不抢,
 * 折叠 / 单页 / 无活动页 / 无会话让位,缺服务即不装。终端内(`.xterm`)的按键在
 * window 捕获阶段拦下。展开补位:折叠态按内置 `sidebar.right.toggle` 后有界轮询面板
 * 是否展开,展开后把键盘交给活动页的终端输入面(自聚焦 / 只读 / 非终端 / 已展开 /
 * 卸载后让位,且不消费这一按)。
 */
import { applyPlugin, captureWarnings, check, checkTrue, fakeDocument, FakeElement, fakeKeyEvent, fakePageSidebar, fakeShortcuts, fakeWindow, FakeCtx, finish, gesture, harness, keydown, row, shortcutContext, PAGE_CYCLE_ID, PAGE_NEXT_PRESS, PAGE_PREVIOUS_PRESS, SIDEBAR_TOGGLE_BINDING, SIDEBAR_TOGGLE_PRESS, UNUSED_PRESS } from './helpers.mjs'

/**
 * 置入假 document / 假 window(捕获监听就装在上面)/ 可选的 rAF 队列与定时器队列,
 * 用完即还原。`pump()` 先泵定时器、再泵 rAF。
 */
function withPageDom({ app, activeElement = null, raf = false, window = fakeWindow() } = {}) {
  const document = fakeDocument({ root: app, activeElement })
  const queue = []
  const timers = []
  const previousDocument = globalThis.document
  const previousWindow = globalThis.window
  const previousRaf = globalThis.requestAnimationFrame
  globalThis.document = document
  globalThis.window = window
  window.setTimeout = (fn) => {
    timers.push(fn)
    return timers.length
  }
  window.clearTimeout = () => {}
  if (raf) globalThis.requestAnimationFrame = (fn) => {
    queue.push(fn)
    return queue.length
  }
  return {
    window,
    queue,
    timers,
    pump(maxTimers = Infinity) {
      let drained = 0
      while (timers.length > 0 && drained < maxTimers) {
        timers.shift()()
        drained += 1
      }
      while (queue.length > 0) queue.shift()()
    },
    restore() {
      if (previousDocument === undefined) delete globalThis.document
      else globalThis.document = previousDocument
      if (previousWindow === undefined) delete globalThis.window
      else globalThis.window = previousWindow
      if (previousRaf === undefined) delete globalThis.requestAnimationFrame
      else globalThis.requestAnimationFrame = previousRaf
    },
  }
}

/** 一列侧栏假 DOM:app 容器(充当 document 根)+ 会话根 + 一个活动 dock pane。 */
function column({ sessionId = 's1', open = true, pane = true } = {}) {
  const app = new FakeElement('div', { 'data-app': '' })
  const root = app.append(new FakeElement('div', {
    'data-sidebar-right-session': sessionId,
    ...(open ? { 'data-sidebar-right-open': '' } : {}),
  }))
  const paneEl = new FakeElement('section', pane ? { 'data-dockkit-pane': 'p1', 'data-dockkit-pane-active': '' } : {})
  if (pane) root.append(paneEl)
  return { app, root, pane: paneEl }
}

console.log('--- M① 无焦点切页并自动聚焦:commit 之后才聚焦活动 pane ---')
{
  const sidebar = fakePageSidebar({ list: ['t1', 't2', 't3'], active: 't1' })
  const { shortcuts } = harness({ sidebar })
  const { app, pane } = column()
  const dom = withPageDom({ app, raf: true })
  try {
    checkTrue('固定行已挂载', shortcuts.fixedCatalog.getSnapshot().some((entry) => entry.id === PAGE_CYCLE_ID))
    const press = keydown(PAGE_NEXT_PRESS, shortcutContext({ target: null }))
    shortcuts.emit(press.input)
    check('切到下一页', sidebar.focusCalls, ['t2'])
    check('消费', press.consumed.count, 1)
    check('此刻还没聚焦(等 commit 后再聚焦)', pane.focusCount, 0)
    dom.pump()
    check('聚焦到活动 pane', pane.focusCount, 1)
    check('preventScroll', pane.lastFocusOptions, { preventScroll: true })
  } finally {
    dom.restore()
  }
}

console.log('--- M② 页面自聚焦(如终端)时不抢键盘 ---')
{
  const sidebar = fakePageSidebar({ list: ['t1', 't2'], active: 't1' })
  const { shortcuts } = harness({ sidebar })
  const { app, pane } = column()
  const terminal = pane.append(new FakeElement('div'))
  const dom = withPageDom({ app, activeElement: terminal, raf: true })
  try {
    const press = keydown(PAGE_NEXT_PRESS, shortcutContext({ region: 'terminal', target: terminal }))
    shortcuts.emit(press.input)
    check('焦点在终端里仍切页', sidebar.focusCalls, ['t2'])
    check('消费', press.consumed.count, 1)
    dom.pump()
    check('键盘已被该页拿走,不抢', pane.focusCount, 0)
  } finally {
    dom.restore()
  }
}

console.log('--- M③ 从页面内切页:文本控件 / 终端 / 已被消费 ---')
{
  const cases = [
    ['文本控件内', { region: 'editable' }, {}],
    ['终端内', { region: 'terminal' }, {}],
    ['已被消费', {}, { defaultPrevented: true }],
  ]
  for (const [label, context, overrides] of cases) {
    const sidebar = fakePageSidebar({ list: ['t1', 't2'], active: 't1' })
    const { shortcuts } = harness({ sidebar })
    const press = keydown(gesture('ArrowLeft', { control: true, alt: true, ...overrides }), shortcutContext(context))
    shortcuts.emit(press.input)
    check(`${label}切到上一页`, sidebar.focusCalls, ['t2'])
    check(`${label}消费`, press.consumed.count, 1)
  }
}

console.log('--- M④ 让位:折叠 / 单页 / 无活动页 / 无会话 / 别的键 ---')
{
  const cases = [
    ['面板折叠', fakePageSidebar({ list: ['t1', 't2', 't3'], active: 't1', expanded: false })],
    ['只有一页', fakePageSidebar({ list: ['t1'], active: 't1' })],
    ['没有活动页', fakePageSidebar({ list: ['t1', 't2'], active: null })],
    ['没有会话', fakePageSidebar({ mounted: null })],
  ]
  for (const [label, sidebar] of cases) {
    const { shortcuts } = harness({ sidebar })
    const press = keydown(PAGE_NEXT_PRESS, shortcutContext({ target: null }))
    shortcuts.emit(press.input)
    check(`${label}不切页`, sidebar.focusCalls, [])
    check(`${label}不消费`, press.consumed.count, 0)
  }

  const sidebar = fakePageSidebar({ list: ['t1', 't2', 't3'], active: 't1' })
  const { shortcuts } = harness({ sidebar })
  const other = keydown(UNUSED_PRESS, shortcutContext({ target: null }))
  shortcuts.emit(other.input)
  check('别的键不切页', sidebar.focusCalls, [])
  check('别的键不消费', other.consumed.count, 0)
}

console.log('--- M⑤ 失败模式:缺 sidebarRight / 缺 observeFixedInput 即不装 ---')
{
  const noSidebar = harness({ withSidebar: false })
  check('缺 sidebarRight 时页面循环固定行未挂载', noSidebar.shortcuts.fixedCatalog.getSnapshot().some((entry) => entry.id === PAGE_CYCLE_ID), false)

  const bare = new FakeCtx({
    shortcuts: { ...fakeShortcuts(), observeFixedInput: undefined },
    sidebarRight: fakePageSidebar(),
    sessions: { list: { getSnapshot: () => ({ ids: [], byId: {}, phase: 'ready' }) }, binding: () => undefined, scope: () => undefined },
  })
  const warnings = captureWarnings(() => applyPlugin(bare))
  checkTrue('缺 observeFixedInput 时页面循环桥告警', warnings.some((line) => line.includes('page-cycle keys not installed')))
  check('缺 observeFixedInput 时未装任何监听', bare.effects.length, 0)
}

console.log('--- M⑥ 卸载:固定行与监听一起释放 ---')
{
  const sidebar = fakePageSidebar({ list: ['t1', 't2'], active: 't1' })
  const { ctx, shortcuts } = harness({ sidebar })
  checkTrue('挂载后固定行在录', shortcuts.fixedCatalog.getSnapshot().some((entry) => entry.id === PAGE_CYCLE_ID))
  const before = keydown(PAGE_NEXT_PRESS, shortcutContext({ target: null }))
  shortcuts.emit(before.input)
  check('卸载前切页', before.consumed.count, 1)

  for (const effect of ctx.effects) {
    if (typeof effect.dispose === 'function') effect.dispose()
  }
  checkTrue('卸载后固定行离录', !shortcuts.fixedCatalog.getSnapshot().some((entry) => entry.id === PAGE_CYCLE_ID))
  const after = keydown(PAGE_NEXT_PRESS, shortcutContext({ target: null }))
  shortcuts.emit(after.input)
  check('卸载后不再消费', after.consumed.count, 0)
}

console.log('--- M⑦ 终端内切页:捕获阶段在 xterm 之前拦下 ---')
{
  const sidebar = fakePageSidebar({ list: ['t1', 't2'], active: 't1' })
  const { app, root, pane } = column()
  const terminal = pane.append(new FakeElement('div', { class: 'xterm' }))
  const textarea = terminal.append(new FakeElement('textarea'))
  const dom = withPageDom({ app, raf: true })
  const { shortcuts } = harness({ sidebar })
  try {
    const event = fakeKeyEvent({ path: [textarea, terminal, pane, root, app], code: 'ArrowLeft', ctrlKey: true, altKey: true })
    dom.window.emit(event)
    check('终端内切到上一页', sidebar.focusCalls, ['t2'])
    check('事件在捕获阶段被吞', [event.prevented, event.stopped], [1, 1])
    check('此刻还没聚焦(等 commit 后再聚焦)', pane.focusCount, 0)
    dom.pump()
    check('聚焦到活动 pane', pane.focusCount, 1)
    check('只切换一次(观察者通道从未见到该按)', sidebar.focusCalls, ['t2'])
  } finally {
    dom.restore()
  }
}

console.log('--- M⑧ 捕获路径让位:不吞事件,原样交给 xterm ---')
{
  const cases = [
    {
      label: '只有一页',
      sidebar: fakePageSidebar({ list: ['t1'], active: 't1' }),
      extra: () => {},
    },
    {
      label: '模态打开',
      sidebar: fakePageSidebar({ list: ['t1', 't2'], active: 't1' }),
      extra: (app) => {
        app.append(new FakeElement('div', { role: 'dialog', 'aria-modal': 'true' }))
      },
    },
  ]
  for (const { label, sidebar, extra } of cases) {
    const { app, root, pane } = column()
    const terminal = pane.append(new FakeElement('div', { class: 'xterm' }))
    const textarea = terminal.append(new FakeElement('textarea'))
    extra(app)
    const dom = withPageDom({ app })
    const { shortcuts } = harness({ sidebar })
    try {
      const event = fakeKeyEvent({ path: [textarea, terminal, pane, root, app], code: 'ArrowLeft', ctrlKey: true, altKey: true })
      dom.window.emit(event)
      check(`${label}不切页`, sidebar.focusCalls, [])
      check(`${label}不吞事件`, [event.prevented, event.stopped], [0, 0])
    } finally {
      dom.restore()
    }
  }

  const sidebar = fakePageSidebar({ list: ['t1', 't2'], active: 't1' })
  const { app, root, pane } = column()
  const terminal = pane.append(new FakeElement('div', { class: 'xterm' }))
  const textarea = terminal.append(new FakeElement('textarea'))
  const dom = withPageDom({ app })
  const { shortcuts } = harness({ sidebar })
  try {
    const repeated = fakeKeyEvent({ path: [textarea, terminal, pane, root, app], code: 'ArrowLeft', ctrlKey: true, altKey: true, repeat: true })
    dom.window.emit(repeated)
    check('长按重复不切页', sidebar.focusCalls, [])
    check('长按重复不吞事件', [repeated.prevented, repeated.stopped], [0, 0])
  } finally {
    dom.restore()
  }
}

console.log('--- M⑨ 捕获路径只认终端:非 .xterm 目标一律放行 ---')
{
  const sidebar = fakePageSidebar({ list: ['t1', 't2'], active: 't1' })
  const { app, root, pane } = column()
  const editor = pane.append(new FakeElement('textarea'))
  const dom = withPageDom({ app })
  const { shortcuts } = harness({ sidebar })
  try {
    const event = fakeKeyEvent({ path: [editor, pane, root, app], code: 'ArrowLeft', ctrlKey: true, altKey: true })
    dom.window.emit(event)
    check('捕获钩子不拦非终端目标', [event.prevented, event.stopped], [0, 0])
    check('未走捕获路径切换', sidebar.focusCalls, [])
  } finally {
    dom.restore()
  }
}

console.log('--- M⑩ 卸载:捕获监听连同固定行 / 观察者一起释放 ---')
{
  const sidebar = fakePageSidebar({ list: ['t1', 't2'], active: 't1' })
  const { app, root, pane } = column()
  const terminal = pane.append(new FakeElement('div', { class: 'xterm' }))
  const textarea = terminal.append(new FakeElement('textarea'))
  const dom = withPageDom({ app })
  const { ctx, shortcuts } = harness({ sidebar })
  try {
    const before = fakeKeyEvent({ path: [textarea, terminal, pane, root, app], code: 'ArrowRight', ctrlKey: true, altKey: true })
    dom.window.emit(before)
    check('卸载前终端内切页', sidebar.focusCalls, ['t2'])
    check('卸载前吞事件', before.stopped, 1)
    for (const effect of ctx.effects) {
      if (typeof effect.dispose === 'function') effect.dispose()
    }
    const after = fakeKeyEvent({ path: [textarea, terminal, pane, root, app], code: 'ArrowLeft', ctrlKey: true, altKey: true })
    dom.window.emit(after)
    check('卸载后不再切页', sidebar.focusCalls, ['t2'])
    check('卸载后不吞事件', [after.prevented, after.stopped], [0, 0])
  } finally {
    dom.restore()
  }
}

console.log('--- M⑪ 展开补位:折叠态按展开键,下一帧把键盘交到终端的 xterm ---')
{
  const sidebar = fakePageSidebar({ list: ['t1', 't2'], active: 't1', expanded: false })
  const { shortcuts } = harness({ sidebar, rows: [row('sidebar.right.toggle', SIDEBAR_TOGGLE_BINDING)] })
  const { app, root, pane } = column({ open: false })
  const terminal = pane.append(new FakeElement('div', { class: 'xterm' }))
  const textarea = terminal.append(new FakeElement('textarea', { class: 'xterm-helper-textarea' }))
  const dom = withPageDom({ app, activeElement: pane, raf: true })
  try {
    const press = keydown(SIDEBAR_TOGGLE_PRESS, shortcutContext({ target: null }))
    shortcuts.emit(press.input)
    check('不消费这一按(主人是内置 toggle)', press.consumed.count, 0)
    // 模拟内置 toggle 的提交:展开 + 聚焦活动 pane。
    sidebar.expanded = true
    root.setAttribute('data-sidebar-right-open', '')
    pane.focus({ preventScroll: true })
    check('pane 已被内置聚焦', pane.focusCount, 1)
    check('此刻还没轮到桥', textarea.focusCount, 0)
    dom.pump()
    check('焦点落到终端输入', textarea.focusCount, 1)
    check('preventScroll', textarea.lastFocusOptions, { preventScroll: true })
  } finally {
    dom.restore()
  }
}

console.log('--- M⑫ 展开补位让位:已展开时按同一键(折叠按)不动作 ---')
{
  const sidebar = fakePageSidebar({ list: ['t1', 't2'], active: 't1', expanded: true })
  const { shortcuts } = harness({ sidebar, rows: [row('sidebar.right.toggle', SIDEBAR_TOGGLE_BINDING)] })
  const { app, pane } = column()
  const terminal = pane.append(new FakeElement('div', { class: 'xterm' }))
  const textarea = terminal.append(new FakeElement('textarea', { class: 'xterm-helper-textarea' }))
  const dom = withPageDom({ app, activeElement: pane, raf: true })
  try {
    const press = keydown(SIDEBAR_TOGGLE_PRESS, shortcutContext({ target: null }))
    shortcuts.emit(press.input)
    dom.pump()
    check('折叠按不聚焦终端', textarea.focusCount, 0)
    check('不消费', press.consumed.count, 0)
  } finally {
    dom.restore()
  }
}

console.log('--- M⑬ 展开补位让位:显示页不是终端时只保留 pane 聚焦 ---')
{
  const sidebar = fakePageSidebar({ list: ['t1', 't2'], active: 't1', expanded: false })
  const { shortcuts } = harness({ sidebar, rows: [row('sidebar.right.toggle', SIDEBAR_TOGGLE_BINDING)] })
  const { app, root, pane } = column({ open: false })
  const dom = withPageDom({ app, activeElement: pane, raf: true })
  try {
    const press = keydown(SIDEBAR_TOGGLE_PRESS, shortcutContext({ target: null }))
    shortcuts.emit(press.input)
    sidebar.expanded = true
    root.setAttribute('data-sidebar-right-open', '')
    dom.pump()
    check('非终端页:桥不再碰焦点', pane.focusCount, 0)
    check('不消费', press.consumed.count, 0)
  } finally {
    dom.restore()
  }
}

console.log('--- M⑭ 展开补位让位:只读终端不交棒 ---')
{
  const sidebar = fakePageSidebar({ list: ['t1', 't2'], active: 't1', expanded: false })
  const { shortcuts } = harness({ sidebar, rows: [row('sidebar.right.toggle', SIDEBAR_TOGGLE_BINDING)] })
  const { app, root, pane } = column({ open: false })
  const terminal = pane.append(new FakeElement('div', { class: 'xterm' }))
  const textarea = terminal.append(new FakeElement('textarea', { class: 'xterm-helper-textarea' }))
  textarea.readOnly = true
  const dom = withPageDom({ app, activeElement: pane, raf: true })
  try {
    const press = keydown(SIDEBAR_TOGGLE_PRESS, shortcutContext({ target: null }))
    shortcuts.emit(press.input)
    sidebar.expanded = true
    root.setAttribute('data-sidebar-right-open', '')
    dom.pump()
    check('只读终端不聚焦', textarea.focusCount, 0)
  } finally {
    dom.restore()
  }
}

console.log('--- M⑮ 展开补位让位:页面自己已持键盘(xterm 自聚焦)不抢 ---')
{
  const sidebar = fakePageSidebar({ list: ['t1', 't2'], active: 't1', expanded: false })
  const { shortcuts } = harness({ sidebar, rows: [row('sidebar.right.toggle', SIDEBAR_TOGGLE_BINDING)] })
  const { app, root, pane } = column({ open: false })
  const terminal = pane.append(new FakeElement('div', { class: 'xterm' }))
  const textarea = terminal.append(new FakeElement('textarea', { class: 'xterm-helper-textarea' }))
  const dom = withPageDom({ app, activeElement: textarea, raf: true })
  try {
    const press = keydown(SIDEBAR_TOGGLE_PRESS, shortcutContext({ target: null }))
    shortcuts.emit(press.input)
    sidebar.expanded = true
    root.setAttribute('data-sidebar-right-open', '')
    dom.pump()
    check('键盘已被页面拿走,不抢', textarea.focusCount, 0)
  } finally {
    dom.restore()
  }
}

console.log('--- M⑯ 卸载:展开补位随观察者一起释放 ---')
{
  const sidebar = fakePageSidebar({ list: ['t1', 't2'], active: 't1', expanded: false })
  const { ctx, shortcuts } = harness({ sidebar, rows: [row('sidebar.right.toggle', SIDEBAR_TOGGLE_BINDING)] })
  const { app, root, pane } = column({ open: false })
  const terminal = pane.append(new FakeElement('div', { class: 'xterm' }))
  const textarea = terminal.append(new FakeElement('textarea', { class: 'xterm-helper-textarea' }))
  const dom = withPageDom({ app, activeElement: pane, raf: true })
  try {
    for (const effect of ctx.effects) {
      if (typeof effect.dispose === 'function') effect.dispose()
    }
    const press = keydown(SIDEBAR_TOGGLE_PRESS, shortcutContext({ target: null }))
    shortcuts.emit(press.input)
    sidebar.expanded = true
    root.setAttribute('data-sidebar-right-open', '')
    dom.pump()
    check('卸载后展开补位不再动作', textarea.focusCount, 0)
  } finally {
    dom.restore()
  }
}

console.log('--- M⑰ 展开补位:面板稍后才打开,轮询在打开后才交棒 ---')
{
  const sidebar = fakePageSidebar({ list: ['t1', 't2'], active: 't1', expanded: false })
  const { shortcuts } = harness({ sidebar, rows: [row('sidebar.right.toggle', SIDEBAR_TOGGLE_BINDING)] })
  const { app, root, pane } = column({ open: false })
  const terminal = pane.append(new FakeElement('div', { class: 'xterm' }))
  const textarea = terminal.append(new FakeElement('textarea', { class: 'xterm-helper-textarea' }))
  const dom = withPageDom({ app, activeElement: pane, raf: true })
  try {
    const press = keydown(SIDEBAR_TOGGLE_PRESS, shortcutContext({ target: null }))
    shortcuts.emit(press.input)
    dom.pump(1) // 第一次探针:还没打开(只泵一个定时器)
    check('面板未开时先不交棒', textarea.focusCount, 0)
    sidebar.expanded = true
    root.setAttribute('data-sidebar-right-open', '')
    pane.focus({ preventScroll: true })
    dom.pump(1) // 第二次探针:已打开,把交棒排进 rAF
    dom.pump() // 下一帧:交棒到终端
    check('面板打开后交棒到终端', textarea.focusCount, 1)
    check('不消费', press.consumed.count, 0)
  } finally {
    dom.restore()
  }
}

console.log('--- M⑱ 展开补位让位:面板始终没打开,有界轮询后放弃 ---')
{
  const sidebar = fakePageSidebar({ list: ['t1', 't2'], active: 't1', expanded: false })
  const { shortcuts } = harness({ sidebar, rows: [row('sidebar.right.toggle', SIDEBAR_TOGGLE_BINDING)] })
  const { app, pane } = column({ open: false })
  const terminal = pane.append(new FakeElement('div', { class: 'xterm' }))
  const textarea = terminal.append(new FakeElement('textarea', { class: 'xterm-helper-textarea' }))
  const dom = withPageDom({ app, activeElement: pane, raf: true })
  try {
    const press = keydown(SIDEBAR_TOGGLE_PRESS, shortcutContext({ target: null }))
    shortcuts.emit(press.input)
    dom.pump()
    check('始终未开:不交棒', textarea.focusCount, 0)
    check('不消费', press.consumed.count, 0)
  } finally {
    dom.restore()
  }
}

console.log('--- M⑲ 展开补位选根:会话包装与面板两层同 id,取内层面板(带 open / 最深) ---')
{
  const sidebar = fakePageSidebar({ list: ['t1', 't2'], active: 't1', expanded: false })
  const { shortcuts } = harness({ sidebar, rows: [row('sidebar.right.toggle', SIDEBAR_TOGGLE_BINDING)] })
  const app = new FakeElement('div', { 'data-app': '' })
  // 外层包装(同 id,不带 data-sidebar-right-open)。
  const outer = app.append(new FakeElement('div', { 'data-sidebar-right-session': 's1' }))
  // 内层面板(同 id,展开时带 data-sidebar-right-open,panes 都在这里)。
  const inner = outer.append(new FakeElement('div', { 'data-sidebar-right-session': 's1' }))
  const paneEl = inner.append(new FakeElement('section', { 'data-dockkit-pane': 'p1', 'data-dockkit-pane-active': '' }))
  const terminal = paneEl.append(new FakeElement('div', { class: 'xterm' }))
  const textarea = terminal.append(new FakeElement('textarea', { class: 'xterm-helper-textarea' }))
  const dom = withPageDom({ app, activeElement: paneEl, raf: true })
  try {
    const press = keydown(SIDEBAR_TOGGLE_PRESS, shortcutContext({ target: null }))
    shortcuts.emit(press.input)
    sidebar.expanded = true
    inner.setAttribute('data-sidebar-right-open', '')
    paneEl.focus({ preventScroll: true })
    dom.pump()
    check('双根时取内层面板,交棒到终端', textarea.focusCount, 1)
    check('不消费', press.consumed.count, 0)
  } finally {
    dom.restore()
  }
}

finish()