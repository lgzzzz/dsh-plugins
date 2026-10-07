/**
 * 会话循环桥:两条键各走各的池子 —— `Ctrl+↓` / `Ctrl+↑` 在左侧栏前三个工作区当前渲染出来的
 * 会话行之间环状切换(全部候选);`Ctrl+Alt+↓` / `Ctrl+Alt+↑` 只在**活跃会话**(运行中 /
 * 待交互 / 已完成未读)之间切换,活跃池空或只剩当前会话时让位(不动作、不消费)。
 * 目标就是当前会话、没有候选、缺服务时让位;终端内(`.xterm`)的按键在 window 捕获阶段拦下。
 */
import { captureWarnings, check, checkTrue, fakeDocument, fakeKeyEvent, fakePageSidebar, fakeSessionNavigation, fakeShortcuts, fakeSessions, fakeUiSession, fakeWindow, FakeCtx, FakeElement, finish, gesture, harness, keydown, session, shortcutContext, sidebarTree, statusTable, applyPlugin, SESSION_ACTIVE_CYCLE_ID, SESSION_ACTIVE_NEXT_PRESS, SESSION_ACTIVE_PREVIOUS_PRESS, SESSION_CYCLE_ID, SESSION_NEXT_PRESS, SESSION_PREVIOUS_PRESS } from './helpers.mjs'

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

console.log('--- Q① Ctrl+↓ / Ctrl+↑:全部候选,无焦点环状切换并消费 ---')
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
    checkTrue('两条固定行都已挂载', [SESSION_CYCLE_ID, SESSION_ACTIVE_CYCLE_ID].every((id) => shortcuts.fixedCatalog.getSnapshot().some((entry) => entry.id === id)))
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

    // 没有任何会话带状态点:活跃池是空的,Ctrl+Alt+↓ 无事可做(也不消费)。
    const idle = keydown(SESSION_ACTIVE_NEXT_PRESS, shortcutContext({ target: null }))
    shortcuts.emit(idle.input)
    check('没有活跃会话时 Ctrl+Alt+↓ 不动', navigation.opened, ['s2', 's3', 's1', 's3'])
    check('没有活跃会话时 Ctrl+Alt+↓ 不消费', idle.consumed.count, 0)
  } finally {
    dom.restore()
  }
}

console.log('--- Q② 当前会话不在候选里(如它在第四个/别的工作区) ---')
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

console.log('--- Q③ Ctrl+Alt+↓ / Ctrl+Alt+↑:只在活跃会话之间走 ---')
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
    shortcuts.emit(keydown(SESSION_ACTIVE_NEXT_PRESS, shortcutContext({ target: null })).input)
    check('两个活跃会话:↓ 落到第一个活跃会话', navigation.opened, ['s2'])
    switchCurrent(summary, 's2')
    shortcuts.emit(keydown(SESSION_ACTIVE_NEXT_PRESS, shortcutContext({ target: null })).input)
    check('只在活跃里继续走(跳过 s3)', navigation.opened, ['s2', 's4'])
    switchCurrent(summary, 's4')
    shortcuts.emit(keydown(SESSION_ACTIVE_NEXT_PRESS, shortcutContext({ target: null })).input)
    check('活跃池内绕回开头', navigation.opened, ['s2', 's4', 's2'])
    switchCurrent(summary, 's2')
    shortcuts.emit(keydown(SESSION_ACTIVE_PREVIOUS_PRESS, shortcutContext({ target: null })).input)
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
    shortcuts.emit(keydown(SESSION_ACTIVE_NEXT_PRESS, shortcutContext({ target: null })).input)
    shortcuts.emit(keydown(SESSION_ACTIVE_PREVIOUS_PRESS, shortcutContext({ target: null })).input)
    check('↑ / ↓ 都先跳到那个活跃会话', navigation.opened, ['s2', 's2'])
  } finally {
    dom.restore()
  }
}

{
  // 唯一活跃会话正是当前会话:活跃池里没有别人 —— 不动作、不消费(常规导航交给 Ctrl+↑/↓)。
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
    const next = keydown(SESSION_ACTIVE_NEXT_PRESS, shortcutContext({ target: null }))
    shortcuts.emit(next.input)
    const previous = keydown(SESSION_ACTIVE_PREVIOUS_PRESS, shortcutContext({ target: null }))
    shortcuts.emit(previous.input)
    check('已经站在唯一的活跃会话上:不切会话', navigation.opened, [])
    check('已经站在唯一的活跃会话上:不消费', [next.consumed.count, previous.consumed.count], [0, 0])

    // 同一时刻 Ctrl+↓ 照常往下走 —— 两条键互不顶替。
    switchCurrent(summary, 's2')
    shortcuts.emit(keydown(SESSION_NEXT_PRESS, shortcutContext({ target: null })).input)
    check('Ctrl+↓ 照常在全部候选里往下走', navigation.opened, ['s3'])
  } finally {
    dom.restore()
  }
}

{
  // 有待答交互的会话即使没在运行也算活跃;已完成未读(绿点)同样算。
  const sidebar = PAGE_SIDEBAR()
  const tree = sidebarTree([{ key: 'w1', sessions: ['s1', 's2', 's3', 's4'] }])
  const summary = {
    s1: session('s1', { running: false }),
    s2: session('s2', { mainView: 0, running: false }),
    s3: session('s3', { mainView: 0, running: false }),
    s4: session('s4', { mainView: 0, running: false }),
  }
  const uiSession = fakeUiSession({ status: statusTable({
    s3: { pendingInteraction: { key: 'q1', kind: 'question', sessionId: 's3' } },
    s4: { completionUnread: true },
  }) })
  const dom = withSidebarDom({ app: tree })
  const { shortcuts, navigation } = harness({ sidebar, summary, uiSession })
  try {
    shortcuts.emit(keydown(SESSION_ACTIVE_NEXT_PRESS, shortcutContext({ target: null })).input)
    check('待答交互也算活跃:↓ 落到那个会话', navigation.opened, ['s3'])
    switchCurrent(summary, 's3')
    shortcuts.emit(keydown(SESSION_ACTIVE_NEXT_PRESS, shortcutContext({ target: null })).input)
    check('已完成未读也算活跃:↓ 落到绿点会话', navigation.opened, ['s3', 's4'])
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
    const summary = { s1: session('s1', { running: true }) }
    const dom = withSidebarDom({ app: tree ?? new FakeElement('div', { role: 'tree' }) })
    const { shortcuts, navigation } = harness({ sidebar, summary })
    try {
      for (const [key, press] of [['Ctrl+↓', SESSION_NEXT_PRESS], ['Ctrl+Alt+↓', SESSION_ACTIVE_NEXT_PRESS]]) {
        const input = keydown(press, shortcutContext({ target: null }))
        shortcuts.emit(input.input)
        check(`${label}:${key} 不切会话`, navigation.opened, [])
        check(`${label}:${key} 不消费`, input.consumed.count, 0)
      }
    } finally {
      dom.restore()
    }
  }
}

{
  // 没有 document(理论上不该发生)时同样让位。
  const sidebar = PAGE_SIDEBAR()
  const { shortcuts, navigation } = harness({ sidebar, summary: { s1: session('s1') } })
  for (const press of [SESSION_NEXT_PRESS, SESSION_ACTIVE_NEXT_PRESS]) {
    const input = keydown(press, shortcutContext({ target: null }))
    shortcuts.emit(input.input)
    check('没有 document:不切会话', navigation.opened, [])
    check('没有 document:不消费', input.consumed.count, 0)
  }
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
    for (const [key, press, opened] of [
      ['Ctrl+↓', SESSION_NEXT_PRESS, ['s2']],
      ['Ctrl+Alt+↓', SESSION_ACTIVE_NEXT_PRESS, ['s3']],
    ]) {
      const sidebar = PAGE_SIDEBAR()
      const tree = sidebarTree([{ key: 'w1', sessions: ['s1', 's2', 's3'] }])
      const summary = {
        s1: session('s1', { running: false }),
        s2: session('s2', { mainView: 0, running: false }),
        s3: session('s3', { mainView: 0, running: true }),
      }
      const dom = withSidebarDom({ app: tree })
      const { shortcuts, navigation } = harness({ sidebar, summary })
      try {
        const input = keydown({ ...press, ...overrides }, shortcutContext(context))
        shortcuts.emit(input.input)
        check(`${label} ${key} 照常切到目标`, navigation.opened, opened)
        check(`${label} ${key} 消费`, input.consumed.count, 1)
      } finally {
        dom.restore()
      }
    }
  }
}

console.log('--- Q⑥ 模态层之上让位 ---')
{
  const sidebar = PAGE_SIDEBAR()
  const tree = sidebarTree([{ key: 'w1', sessions: ['s1', 's2'] }])
  tree.append(new FakeElement('div', { role: 'dialog', 'aria-modal': 'true' }))
  const summary = { s1: session('s1', { running: false }), s2: session('s2', { mainView: 0, running: true }) }
  const dom = withSidebarDom({ app: tree })
  const { shortcuts, navigation } = harness({ sidebar, summary })
  try {
    for (const press of [SESSION_NEXT_PRESS, SESSION_ACTIVE_NEXT_PRESS]) {
      const input = keydown(press, shortcutContext({ modal: 'settings', target: null }))
      shortcuts.emit(input.input)
      check('模态层之上不切会话', navigation.opened, [])
      check('模态层之上不消费', input.consumed.count, 0)
    }
  } finally {
    dom.restore()
  }
}

console.log('--- Q⑦ 终端内切换:捕获阶段在 xterm 之前拦下,且不让转义序列进 shell ---')
{
  for (const [key, code, ctrlKey, altKey, opened] of [
    ['Ctrl+↓', 'ArrowDown', true, false, ['s2']],
    ['Ctrl+Alt+↓', 'ArrowDown', true, true, ['s2']],
    ['Ctrl+Alt+↑', 'ArrowUp', true, true, ['s3']],
  ]) {
    const sidebar = PAGE_SIDEBAR()
    const { tree, path } = treeWithTerminal([{ key: 'w1', sessions: ['s1', 's2', 's3'] }])
    const summary = {
      s1: session('s1', { running: false }),
      s2: session('s2', { mainView: 0, running: true }),
      s3: session('s3', { mainView: 0, running: true }),
    }
    const dom = withSidebarDom({ app: tree })
    const { shortcuts, navigation } = harness({ sidebar, summary })
    try {
      const event = fakeKeyEvent({ path, code, ctrlKey, altKey })
      dom.window.emit(event)
      check(`${key} 终端内切到目标`, navigation.opened, opened)
      check(`${key} 事件在捕获阶段被吞`, [event.prevented, event.stopped], [1, 1])
      check(`${key} 只切换一次(观察者通道从未见到该按)`, navigation.opened, opened)
    } finally {
      dom.restore()
    }
  }
}

{
  // 当前会话已站上唯一的活跃会话:捕获路径同样让位(不吞事件)。
  const sidebar = PAGE_SIDEBAR()
  const { tree, path } = treeWithTerminal([{ key: 'w1', sessions: ['s1', 's2'] }])
  const summary = {
    s1: session('s1', { running: true }),
    s2: session('s2', { mainView: 0, running: false }),
  }
  const dom = withSidebarDom({ app: tree })
  const { shortcuts, navigation } = harness({ sidebar, summary })
  try {
    const event = fakeKeyEvent({ path, code: 'ArrowDown', ctrlKey: true, altKey: true })
    dom.window.emit(event)
    check('活跃池里只有当前会话时不吞事件', [event.prevented, event.stopped], [0, 0])
    check('活跃池里只有当前会话时不切换', navigation.opened, [])
  } finally {
    dom.restore()
  }
}

console.log('--- Q⑧ 捕获路径让位:非终端目标 / 长按 / 模态 / 没有候选 ---')
{
  const sidebar = PAGE_SIDEBAR()
  const tree = sidebarTree([{ key: 'w1', sessions: ['s1', 's2'] }])
  const editor = tree.append(new FakeElement('textarea'))
  const summary = { s1: session('s1', { running: false }), s2: session('s2', { mainView: 0, running: true }) }
  const dom = withSidebarDom({ app: tree })
  const { shortcuts, navigation } = harness({ sidebar, summary })
  try {
    for (const [key, ctrlKey, altKey] of [['Ctrl+↓', true, false], ['Ctrl+Alt+↓', true, true]]) {
      const outside = fakeKeyEvent({ path: [editor, tree], code: 'ArrowDown', ctrlKey, altKey })
      dom.window.emit(outside)
      check(`${key} 非终端目标不吞事件`, [outside.prevented, outside.stopped], [0, 0])
    }
    check('非终端目标不切换', navigation.opened, [])
  } finally {
    dom.restore()
  }
}

{
  const sidebar = PAGE_SIDEBAR()
  const { tree: tree2, path } = treeWithTerminal([{ key: 'w1', sessions: ['s1', 's2'] }])
  tree2.append(new FakeElement('div', { role: 'dialog', 'aria-modal': 'true' }))
  const summary = { s1: session('s1', { running: false }), s2: session('s2', { mainView: 0, running: true }) }
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
    for (const [key, ctrlKey, altKey] of [['Ctrl+↓', true, false], ['Ctrl+Alt+↓', true, true]]) {
      const event = fakeKeyEvent({ path, code: 'ArrowDown', ctrlKey, altKey })
      dom.window.emit(event)
      check(`${key} 没有候选时不吞事件`, [event.prevented, event.stopped], [0, 0])
    }
    check('没有候选时不切换', navigation.opened, [])
  } finally {
    dom.restore()
  }
}

console.log('--- Q⑨ 失败模式:缺 uiWorkspace 即等服务不装,形状不符才告警;缺 observeFixedInput 告警 ---')
{
  const mounted = (shortcuts) => [SESSION_CYCLE_ID, SESSION_ACTIVE_CYCLE_ID].some((id) => shortcuts.fixedCatalog.getSnapshot().some((entry) => entry.id === id))

  // uiWorkspace 是注入依赖:缺席时 Cordis 根本不跑桥的回调 —— 既没有固定行,也没有告警。
  const noWorkspace = harness({ withUiWorkspace: false })
  check('缺 uiWorkspace 时会话循环固定行未挂载', mounted(noWorkspace.shortcuts), false)
  check('缺 uiWorkspace 时不告警(等服务激活)', noWorkspace.warnings, [])

  // 服务在、但公开面不对(上游改了方法名):告警一次,不挂固定行。
  const bare = new FakeCtx({
    shortcuts: fakeShortcuts(),
    sessions: fakeSessions({ summary: { s1: session('s1') } }),
    uiSession: fakeUiSession(),
    uiWorkspace: {},
  })
  const warnings = captureWarnings(() => applyPlugin(bare))
  checkTrue('uiWorkspace 形状不符时告警', warnings.some((line) => line.includes('uiWorkspace service unavailable; session-cycle keys not installed')))
  check('uiWorkspace 形状不符时未挂固定行', bare.effects.some((effect) => String(effect.label).includes('session cycle fixed row')), false)

  const noObserver = new FakeCtx({
    shortcuts: { ...fakeShortcuts(), observeFixedInput: undefined },
    sessions: fakeSessions({ summary: { s1: session('s1') } }),
    uiSession: fakeUiSession(),
    uiWorkspace: { openSession: () => {} },
  })
  const observerWarnings = captureWarnings(() => applyPlugin(noObserver))
  checkTrue('缺 observeFixedInput 时告警', observerWarnings.some((line) => line.includes('session-cycle keys not installed')))

  // 复刻 Cordis 的注入语义:uiWorkspace 只是激活得晚(还没提供)时,桥等它到齐后补装,
  // 而不是把「还没激活」当成「缺席」—— 真实客户端里 Workspace browser 的激活晚于本插件。
  {
    const sidebar = PAGE_SIDEBAR()
    const tree = sidebarTree([{ key: 'w1', sessions: ['s1', 's2'] }])
    const dom = withSidebarDom({ app: tree })
    const navigation = fakeSessionNavigation()
    const shortcuts = fakeShortcuts()
    const ctx = new FakeCtx({
      shortcuts,
      sessions: fakeSessions({ summary: { s1: session('s1'), s2: session('s2', { mainView: 0, running: true }) } }),
      uiSession: fakeUiSession(),
    })
    const lateWarnings = captureWarnings(() => applyPlugin(ctx))
    try {
      check('uiWorkspace 未就绪时未挂固定行', ctx.effects.some((effect) => String(effect.label).includes('session cycle fixed row')), false)
      check('uiWorkspace 未就绪时不告警', lateWarnings, [])

      ctx.provide('uiWorkspace', navigation)
      checkTrue('服务到齐后补装两条固定行', [SESSION_CYCLE_ID, SESSION_ACTIVE_CYCLE_ID].every((id) => shortcuts.fixedCatalog.getSnapshot().some((entry) => entry.id === id)))
      const press = keydown(SESSION_NEXT_PRESS, shortcutContext({ target: null }))
      shortcuts.emit(press.input)
      check('补装后照常切换', navigation.opened, ['s2'])
      check('补装后消费按键', press.consumed.count, 1)
    } finally {
      dom.restore()
    }
  }
}

console.log('--- Q⑩ 卸载:固定行与捕获监听一起释放 ---')
{
  const sidebar = PAGE_SIDEBAR()
  const { tree, path } = treeWithTerminal([{ key: 'w1', sessions: ['s1', 's2'] }])
  const summary = { s1: session('s1', { running: false }), s2: session('s2', { mainView: 0, running: true }) }
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
    checkTrue('卸载后两条固定行都离录', !shortcuts.fixedCatalog.getSnapshot().some((entry) => entry.id === SESSION_CYCLE_ID || entry.id === SESSION_ACTIVE_CYCLE_ID))
    const after = fakeKeyEvent({ path, code: 'ArrowDown', ctrlKey: true, altKey: true })
    dom.window.emit(after)
    check('卸载后不再切换', navigation.opened, ['s2'])
    check('卸载后不吞事件', [after.prevented, after.stopped], [0, 0])
  } finally {
    dom.restore()
  }
}

finish()
