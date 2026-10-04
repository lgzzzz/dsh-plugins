/**
 * 会话循环桥:`Ctrl+Alt+↓` / `Ctrl+Alt+↑` 在左侧栏前三个工作区当前渲染出来的会话行之间
 * 环状切换,活跃会话(运行中 / 有待答交互)优先 —— 唯一的活跃会话已在屏上时改用全部候选。
 * 目标就是当前会话、没有候选、缺服务时让位;终端内(`.xterm`)的按键在 window 捕获阶段拦下。
 */
import { captureWarnings, check, checkTrue, fakeDocument, fakeKeyEvent, fakePageSidebar, fakeShortcuts, fakeSessions, fakeUiSession, fakeWindow, FakeCtx, FakeElement, finish, gesture, harness, keydown, session, shortcutContext, sidebarTree, statusTable, applyPlugin, SESSION_CYCLE_ID, SESSION_NEXT_PRESS, SESSION_PREVIOUS_PRESS } from './helpers.mjs'

/** 装假 document(侧栏树)与假 window(捕获监听就装在上面),用完还原。 */
function withSidebarDom({ app, activeElement = null, window = fakeWindow() } = {}) {
  const previousDocument = globalThis.document
  const previousWindow = globalThis.window
  globalThis.document = fakeDocument({ root: app, activeElement })
  globalThis.window = window
  return {
    window,
    restore() {
      if (previousDocument === undefined) delete globalThis.document
      else globalThis.document = previousDocument
      if (previousWindow === undefined) delete globalThis.window
      else globalThis.window = previousWindow
    },
  }
}

/** 一段侧栏树 + 终端里的一个 `.xterm` 输入面;返回事件路径(从输入面往上到根)。 */
function treeWithTerminal(groups) {
  const tree = sidebarTree(groups)
  const terminal = tree.append(new FakeElement('div', { class: 'xterm' }))
  const textarea = terminal.append(new FakeElement('textarea'))
  return { tree, terminal, textarea, path: [textarea, terminal, tree] }
}

/** 模拟一次真实切换:把「主视图保留」挪到目标会话上。 */
function switchCurrent(summary, id) {
  for (const [key, row] of Object.entries(summary)) row.retainedBy = key === id ? { mainView: 1 } : {}
}

const PAGE_SIDEBAR = () => fakePageSidebar({ list: ['t1', 't2'], active: 't1' })

console.log('--- Q① 无焦点切换:按 ↓ / ↑ 在显示顺序上环状走,并消费该按键 ---')
{
  const sidebar = PAGE_SIDEBAR()
  const tree = sidebarTree([{ key: 'w1', sessions: ['s1', 's2', 's3'] }])
  const summary = {
    s1: session('s1', { running: false }),
    s2: session('s2', { mainView: 0, running: false }),
    s3: session('s3', { mainView: 0, running: false }),
  }
  const dom = withSidebarDom({ app: tree })
  const { shortcuts, navigation } = harness({ sidebar, summary })
  try {
    checkTrue('固定行已挂载', shortcuts.fixedCatalog.getSnapshot().some((entry) => entry.id === SESSION_CYCLE_ID))
    const next = keydown(SESSION_NEXT_PRESS, shortcutContext({ target: null }))
    shortcuts.emit(next.input)
    check('↓ 切到下一个', navigation.opened, ['s2'])
    check('消费', next.consumed.count, 1)

    switchCurrent(summary, 's2')
    shortcuts.emit(keydown(SESSION_NEXT_PRESS, shortcutContext({ target: null })).input)
    check('再 ↓ 继续往下走', navigation.opened, ['s2', 's3'])

    // 当前会话在末尾:↓ 绕回开头;接着站在开头时 ↑ 绕到末尾。
    switchCurrent(summary, 's3')
    shortcuts.emit(keydown(SESSION_NEXT_PRESS, shortcutContext({ target: null })).input)
    switchCurrent(summary, 's1')
    shortcuts.emit(keydown(SESSION_PREVIOUS_PRESS, shortcutContext({ target: null })).input)
    check('末尾 ↓ 绕回开头,开头 ↑ 绕到末尾', navigation.opened, ['s2', 's3', 's1', 's3'])
    check('页面循环的键不受影响', sidebar.focusCalls, [])
  } finally {
    dom.restore()
  }
}

console.log('--- Q② 当前会话不在候选里(如它在第四个/别的工作区):进入候选列表 ---')
{
  const sidebar = PAGE_SIDEBAR()
  const tree = sidebarTree([{ key: 'w1', sessions: ['s1', 's2'] }])
  const summary = {
    s1: session('s1', { running: false }),
    s2: session('s2', { mainView: 0, running: false }),
    elsewhere: session('elsewhere', { running: false }),
  }
  const dom = withSidebarDom({ app: tree })
  const { shortcuts, navigation } = harness({ sidebar, summary })
  try {
    switchCurrent(summary, 'elsewhere')
    shortcuts.emit(keydown(SESSION_NEXT_PRESS, shortcutContext({ target: null })).input)
    check('↓ 落候选首', navigation.opened, ['s1'])
    switchCurrent(summary, 'elsewhere')
    shortcuts.emit(keydown(SESSION_PREVIOUS_PRESS, shortcutContext({ target: null })).input)
    check('↑ 落候选尾', navigation.opened, ['s1', 's2'])
  } finally {
    dom.restore()
  }
}

console.log('--- Q③ 活跃优先:只在活跃候选之间跳,单个活跃会话一键抵达 ---')
{
  const sidebar = PAGE_SIDEBAR()
  const tree = sidebarTree([{ key: 'w1', sessions: ['s1', 's2', 's3', 's4'] }])
  const summary = {
    s1: session('s1', { running: false }),
    s2: session('s2', { mainView: 0, running: true }),
    s3: session('s3', { mainView: 0, running: false }),
    s4: session('s4', { mainView: 0, running: true }),
  }
  const dom = withSidebarDom({ app: tree })
  const { shortcuts, navigation } = harness({ sidebar, summary })
  try {
    shortcuts.emit(keydown(SESSION_NEXT_PRESS, shortcutContext({ target: null })).input)
    check('两个活跃会话:↓ 落到第一个活跃会话', navigation.opened, ['s2'])
    switchCurrent(summary, 's2')
    shortcuts.emit(keydown(SESSION_NEXT_PRESS, shortcutContext({ target: null })).input)
    check('活跃池内继续走', navigation.opened, ['s2', 's4'])
    switchCurrent(summary, 's4')
    shortcuts.emit(keydown(SESSION_NEXT_PRESS, shortcutContext({ target: null })).input)
    check('活跃池内绕回开头', navigation.opened, ['s2', 's4', 's2'])
    switchCurrent(summary, 's2')
    shortcuts.emit(keydown(SESSION_PREVIOUS_PRESS, shortcutContext({ target: null })).input)
    check('↑ 在活跃池里反向绕到尾', navigation.opened, ['s2', 's4', 's2', 's4'])
  } finally {
    dom.restore()
  }
}

{
  // 唯一活跃会话不是当前会话:↑ / ↓ 都先跳过去。
  const sidebar = PAGE_SIDEBAR()
  const tree = sidebarTree([{ key: 'w1', sessions: ['s1', 's2', 's3'] }])
  const summary = {
    s1: session('s1', { running: false }),
    s2: session('s2', { mainView: 0, running: true }),
    s3: session('s3', { mainView: 0, running: false }),
  }
  const dom = withSidebarDom({ app: tree })
  const { shortcuts, navigation } = harness({ sidebar, summary })
  try {
    shortcuts.emit(keydown(SESSION_NEXT_PRESS, shortcutContext({ target: null })).input)
    shortcuts.emit(keydown(SESSION_PREVIOUS_PRESS, shortcutContext({ target: null })).input)
    check('↑ / ↓ 都先跳到那个活跃会话', navigation.opened, ['s2', 's2'])
  } finally {
    dom.restore()
  }
}

{
  // 唯一活跃会话正是当前会话:改用全部候选,不把人困在它身上。
  const sidebar = PAGE_SIDEBAR()
  const tree = sidebarTree([{ key: 'w1', sessions: ['s1', 's2', 's3'] }])
  const summary = {
    s1: session('s1', { running: false }),
    s2: session('s2', { mainView: 0, running: true }),
    s3: session('s3', { mainView: 0, running: false }),
  }
  const dom = withSidebarDom({ app: tree })
  const { shortcuts, navigation } = harness({ sidebar, summary })
  try {
    switchCurrent(summary, 's2')
    shortcuts.emit(keydown(SESSION_NEXT_PRESS, shortcutContext({ target: null })).input)
    check('已经站在活跃会话上:↓ 继续往下走', navigation.opened, ['s3'])
    switchCurrent(summary, 's2')
    shortcuts.emit(keydown(SESSION_PREVIOUS_PRESS, shortcutContext({ target: null })).input)
    check('已经站在活跃会话上:↑ 往回走', navigation.opened, ['s3', 's1'])
  } finally {
    dom.restore()
  }
}

{
  // 有待答交互的会话即使没在运行也算活跃。
  const sidebar = PAGE_SIDEBAR()
  const tree = sidebarTree([{ key: 'w1', sessions: ['s1', 's2', 's3'] }])
  const summary = {
    s1: session('s1', { running: false }),
    s2: session('s2', { mainView: 0, running: false }),
    s3: session('s3', { mainView: 0, running: false }),
  }
  const uiSession = fakeUiSession({ status: statusTable({ s3: { pendingInteraction: { key: 'q1', kind: 'question', sessionId: 's3' } } }) })
  const dom = withSidebarDom({ app: tree })
  const { shortcuts, navigation } = harness({ sidebar, summary, uiSession })
  try {
    shortcuts.emit(keydown(SESSION_NEXT_PRESS, shortcutContext({ target: null })).input)
    check('待答交互也算活跃:↓ 落到那个会话', navigation.opened, ['s3'])
  } finally {
    dom.restore()
  }
}

console.log('--- Q④ 让位:没有候选 / 只有一个候选且已是当前会话 / 别的键 ---')
{
  const cases = [
    ['侧栏没有任何行(窄 / 收起 / 搜索过滤中)', undefined],
    ['只有一行且它已是当前会话', sidebarTree([{ key: 'w1', sessions: ['s1'] }])],
  ]
  for (const [label, tree] of cases) {
    const sidebar = PAGE_SIDEBAR()
    const summary = { s1: session('s1', { running: false }) }
    const dom = withSidebarDom({ app: tree ?? new FakeElement('div', { role: 'tree' }) })
    const { shortcuts, navigation } = harness({ sidebar, summary })
    try {
      const press = keydown(SESSION_NEXT_PRESS, shortcutContext({ target: null }))
      shortcuts.emit(press.input)
      check(`${label}:不切会话`, navigation.opened, [])
      check(`${label}:不消费`, press.consumed.count, 0)
    } finally {
      dom.restore()
    }
  }
}

{
  // 没有 document(理论上不该发生)时同样让位。
  const sidebar = PAGE_SIDEBAR()
  const { shortcuts, navigation } = harness({ sidebar, summary: { s1: session('s1') } })
  const press = keydown(SESSION_NEXT_PRESS, shortcutContext({ target: null }))
  shortcuts.emit(press.input)
  check('没有 document:不切会话', navigation.opened, [])
  check('没有 document:不消费', press.consumed.count, 0)
}

{
  // 别的键一律不碰;右栏页面循环的键照旧只切页。
  const sidebar = PAGE_SIDEBAR()
  const tree = sidebarTree([{ key: 'w1', sessions: ['s1', 's2'] }])
  const summary = { s1: session('s1', { running: false }), s2: session('s2', { mainView: 0, running: false }) }
  const dom = withSidebarDom({ app: tree })
  const { shortcuts, navigation } = harness({ sidebar, summary })
  try {
    const other = keydown(gesture('KeyK', { control: true, alt: true }), shortcutContext({ target: null }))
    shortcuts.emit(other.input)
    check('别的键不切会话', navigation.opened, [])
    check('别的键不消费', other.consumed.count, 0)

    const page = keydown(gesture('ArrowRight', { control: true, alt: true }), shortcutContext({ target: null }))
    shortcuts.emit(page.input)
    check('右栏页面循环的键不切会话', navigation.opened, [])
    check('右栏页面循环的键照旧切页', sidebar.focusCalls, ['t2'])
  } finally {
    dom.restore()
  }
}

console.log('--- Q⑤ 文本框 / 已被消费也照常切换(与页面循环同一条准入) ---')
{
  const cases = [
    ['文本框内', { region: 'editable' }, {}],
    ['已被消费', {}, { defaultPrevented: true }],
  ]
  for (const [label, context, overrides] of cases) {
    const sidebar = PAGE_SIDEBAR()
    const tree = sidebarTree([{ key: 'w1', sessions: ['s1', 's2'] }])
    const summary = { s1: session('s1', { running: false }), s2: session('s2', { mainView: 0, running: false }) }
    const dom = withSidebarDom({ app: tree })
    const { shortcuts, navigation } = harness({ sidebar, summary })
    try {
      const press = keydown(gesture('ArrowDown', { control: true, alt: true, ...overrides }), shortcutContext(context))
      shortcuts.emit(press.input)
      check(`${label}照常切到下一个`, navigation.opened, ['s2'])
      check(`${label}消费`, press.consumed.count, 1)
    } finally {
      dom.restore()
    }
  }
}

console.log('--- Q⑥ 模态层之上让位 ---')
{
  const sidebar = PAGE_SIDEBAR()
  const tree = sidebarTree([{ key: 'w1', sessions: ['s1', 's2'] }])
  tree.append(new FakeElement('div', { role: 'dialog', 'aria-modal': 'true' }))
  const summary = { s1: session('s1', { running: false }), s2: session('s2', { mainView: 0, running: false }) }
  const dom = withSidebarDom({ app: tree })
  const { shortcuts, navigation } = harness({ sidebar, summary })
  try {
    const press = keydown(SESSION_NEXT_PRESS, shortcutContext({ modal: 'settings', target: null }))
    shortcuts.emit(press.input)
    check('模态层之上不切会话', navigation.opened, [])
    check('模态层之上不消费', press.consumed.count, 0)
  } finally {
    dom.restore()
  }
}

console.log('--- Q⑦ 终端内切换:捕获阶段在 xterm 之前拦下,且不让转义序列进 shell ---')
{
  const sidebar = PAGE_SIDEBAR()
  const { tree, path } = treeWithTerminal([{ key: 'w1', sessions: ['s1', 's2'] }])
  const summary = { s1: session('s1', { running: false }), s2: session('s2', { mainView: 0, running: false }) }
  const dom = withSidebarDom({ app: tree })
  const { shortcuts, navigation } = harness({ sidebar, summary })
  try {
    const event = fakeKeyEvent({ path, code: 'ArrowDown', ctrlKey: true, altKey: true })
    dom.window.emit(event)
    check('终端内切到下一个', navigation.opened, ['s2'])
    check('事件在捕获阶段被吞', [event.prevented, event.stopped], [1, 1])
    check('只切换一次(观察者通道从未见到该按)', navigation.opened, ['s2'])
  } finally {
    dom.restore()
  }
}

console.log('--- Q⑧ 捕获路径让位:非终端目标 / 长按 / 模态 / 没有候选 ---')
{
  const sidebar = PAGE_SIDEBAR()
  const tree = sidebarTree([{ key: 'w1', sessions: ['s1', 's2'] }])
  const editor = tree.append(new FakeElement('textarea'))
  const summary = { s1: session('s1', { running: false }), s2: session('s2', { mainView: 0, running: false }) }
  const dom = withSidebarDom({ app: tree })
  const { shortcuts, navigation } = harness({ sidebar, summary })
  try {
    const outside = fakeKeyEvent({ path: [editor, tree], code: 'ArrowDown', ctrlKey: true, altKey: true })
    dom.window.emit(outside)
    check('非终端目标不吞事件', [outside.prevented, outside.stopped], [0, 0])
    check('非终端目标不切换', navigation.opened, [])
  } finally {
    dom.restore()
  }
}

{
  const sidebar = PAGE_SIDEBAR()
  const tree = sidebarTree([{ key: 'w1', sessions: ['s1', 's2'] }])
  const { tree: tree2, path } = treeWithTerminal([{ key: 'w1', sessions: ['s1', 's2'] }])
  void tree
  tree2.append(new FakeElement('div', { role: 'dialog', 'aria-modal': 'true' }))
  const summary = { s1: session('s1', { running: false }), s2: session('s2', { mainView: 0, running: false }) }
  const dom = withSidebarDom({ app: tree2 })
  const { shortcuts, navigation } = harness({ sidebar, summary })
  try {
    const repeated = fakeKeyEvent({ path, code: 'ArrowDown', ctrlKey: true, altKey: true, repeat: true })
    dom.window.emit(repeated)
    check('长按重复不吞事件', [repeated.prevented, repeated.stopped], [0, 0])
    const modal = fakeKeyEvent({ path, code: 'ArrowDown', ctrlKey: true, altKey: true })
    dom.window.emit(modal)
    check('模态层之上(捕获路径)不吞事件', [modal.prevented, modal.stopped], [0, 0])
    check('两条都不切换', navigation.opened, [])
  } finally {
    dom.restore()
  }
}

{
  const sidebar = PAGE_SIDEBAR()
  const { tree, path } = treeWithTerminal([])
  const dom = withSidebarDom({ app: tree })
  const { shortcuts, navigation } = harness({ sidebar, summary: { s1: session('s1') } })
  try {
    const event = fakeKeyEvent({ path, code: 'ArrowDown', ctrlKey: true, altKey: true })
    dom.window.emit(event)
    check('没有候选时不吞事件', [event.prevented, event.stopped], [0, 0])
    check('没有候选时不切换', navigation.opened, [])
  } finally {
    dom.restore()
  }
}

console.log('--- Q⑨ 失败模式:缺 uiWorkspace / 缺 observeFixedInput 即不装 ---')
{
  const noWorkspace = harness({ withUiWorkspace: false })
  check('缺 uiWorkspace 时会话循环固定行未挂载', noWorkspace.shortcuts.fixedCatalog.getSnapshot().some((entry) => entry.id === SESSION_CYCLE_ID), false)

  const bare = new FakeCtx({
    shortcuts: fakeShortcuts(),
    sessions: fakeSessions({ summary: { s1: session('s1') } }),
    uiSession: fakeUiSession(),
  })
  const warnings = captureWarnings(() => applyPlugin(bare))
  checkTrue('缺 uiWorkspace 时告警', warnings.some((line) => line.includes('uiWorkspace service unavailable; session-cycle keys not installed')))
  check('缺 uiWorkspace 时未挂固定行', bare.effects.some((effect) => String(effect.label).includes('session cycle fixed row')), false)

  const noObserver = new FakeCtx({
    shortcuts: { ...fakeShortcuts(), observeFixedInput: undefined },
    sessions: fakeSessions({ summary: { s1: session('s1') } }),
    uiSession: fakeUiSession(),
    uiWorkspace: { openSession: () => {} },
  })
  const observerWarnings = captureWarnings(() => applyPlugin(noObserver))
  checkTrue('缺 observeFixedInput 时告警', observerWarnings.some((line) => line.includes('session-cycle keys not installed')))
}

console.log('--- Q⑩ 卸载:固定行与捕获监听一起释放 ---')
{
  const sidebar = PAGE_SIDEBAR()
  const { tree, path } = treeWithTerminal([{ key: 'w1', sessions: ['s1', 's2'] }])
  const summary = { s1: session('s1', { running: false }), s2: session('s2', { mainView: 0, running: false }) }
  const dom = withSidebarDom({ app: tree })
  const { ctx, shortcuts, navigation } = harness({ sidebar, summary })
  try {
    const before = fakeKeyEvent({ path, code: 'ArrowDown', ctrlKey: true, altKey: true })
    dom.window.emit(before)
    check('卸载前终端内切换', navigation.opened, ['s2'])
    check('卸载前吞事件', before.stopped, 1)

    for (const effect of ctx.effects) {
      if (typeof effect.dispose === 'function') effect.dispose()
    }
    checkTrue('卸载后固定行离录', !shortcuts.fixedCatalog.getSnapshot().some((entry) => entry.id === SESSION_CYCLE_ID))
    const after = fakeKeyEvent({ path, code: 'ArrowDown', ctrlKey: true, altKey: true })
    dom.window.emit(after)
    check('卸载后不再切换', navigation.opened, ['s2'])
    check('卸载后不吞事件', [after.prevented, after.stopped], [0, 0])
  } finally {
    dom.restore()
  }
}

finish()
