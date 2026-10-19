/** 校验 `lib/client.js` 的模块 id / 插件名 / `inject` 声明,并用真产物装配一遍端到端走线(产物零 external)。 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { captureWarnings, check, checkTrue, domBody, domComposer, fakeDocument, fakeKeyEvent, FakeElement, fakeSessions, fakeSessionNavigation, fakeShortcuts, fakeSidebar, fakeUiSession, FakeCtx, finish, FULLSCREEN_BINDING, FULLSCREEN_PRESS, gesture, keydown, pluginRoot, row, session, shortcutContext, sidebarTree, withWindowDom, APPROVAL_FIXED_ROWS, approvalPending, questionPending, SESSION_ACTIVE_CYCLE_ID, SESSION_CYCLE_ID, SESSION_NEW_ID, SESSION_NEXT_MAC_PRESS, SESSION_NEXT_PRESS } from './focus-helpers.mjs'

console.log('--- G① lib/client.js 注册、声明与端到端装配 ---')
{
  let registration = null
  globalThis.window = {
    __ModuleLoader__: {
      load: (reg) => {
        registration = reg
      },
    },
  }
  try {
    // eslint-disable-next-line no-eval
    ;(0, eval)(readFileSync(join(pluginRoot, 'lib', 'client.js'), 'utf8'))
  } finally {
    delete globalThis.window
  }
  checkTrue('registration 非空', registration !== null)
  check('模块 id', registration?.id, 'dsh-keyboard-shortcuts')
  const plugin = registration.factory(() => {
    throw new Error('产物要求了外部模块:本插件不应有任何 external')
  })
  check('插件名', plugin.name, 'dsh-keyboard-shortcuts')
  check('inject 声明', plugin.inject, ['shortcuts'])

  let cancelled = 0
  // 固定键按平台展开：这里用 macOS 口径，与 meta+alt 的手势一致。
  const shortcuts = fakeShortcuts({
    platform: 'macos',
    rows: [row('pane.fullscreen.toggle', FULLSCREEN_BINDING)],
    fixedRows: APPROVAL_FIXED_ROWS,
  })
  const sidebar = fakeSidebar()
  sidebar.command = { paneId: 'p1' }
  const navigation = fakeSessionNavigation()
  // 待答状态表按引用读取:先无待答,再挂上一条审批。
  const status = new Map()
  const ctx = new FakeCtx({
    shortcuts,
    sidebarRight: sidebar,
    sessions: fakeSessions({ summary: { s1: session('s1'), s2: session('s2', { mainView: 0, running: false }) }, scope: () => ({ get: () => ({ cancel: () => { cancelled += 1; return Promise.resolve() } }) }) }),
    uiSession: fakeUiSession({ status }),
    uiWorkspace: navigation,
  })
  const warnings = captureWarnings(() => plugin.apply(ctx))
  check('产物装配无告警', warnings, [])
  shortcuts.emit(keydown(FULLSCREEN_PRESS, shortcutContext({ target: domComposer })).input)
  check('产物里全屏桥接生效', sidebar.calls, [['fullscreen', { paneId: 'p1' }]])
  // 页面关闭固定键:焦点在输入框里也关掉活动 dock pane 的当前页。
  const closePress = keydown(gesture('Comma', { alt: true, meta: true }), shortcutContext({ target: domComposer }))
  shortcuts.emit(closePress.input)
  check('产物里页面关闭桥接生效', sidebar.calls, [['fullscreen', { paneId: 'p1' }], ['close', { paneId: 'p1' }]])
  check('产物里页面关闭键被消费', closePress.consumed.count, 1)
  shortcuts.emit(keydown(gesture('Escape'), shortcutContext({ target: domBody })).input)
  shortcuts.emit(keydown(gesture('Escape'), shortcutContext({ target: domBody })).input)
  check('产物里停止桥接生效', cancelled, 1)

  const approval = approvalPending()
  status.set('s1', { running: true, pendingInteraction: approval, completionUnread: false })
  shortcuts.emit(keydown(gesture('Enter'), shortcutContext({ target: domBody })).input)
  shortcuts.emit(keydown(gesture('Escape'), shortcutContext({ target: domBody })).input)
  check('产物里审批键生效', approval.answers, ['allowed-once', 'rejected'])
  check('产物里审批键不误停回合', cancelled, 1)

  // 换成待答提问:同一个 Esc 归提问桥,关卡片而非停回合。
  const question = questionPending()
  status.set('s1', { running: true, pendingInteraction: question, completionUnread: false })
  shortcuts.emit(keydown(gesture('Escape'), shortcutContext({ target: domBody })).input)
  check('产物里提问键生效', question.dismissals, 1)
  check('产物里提问键不误停回合', cancelled, 1)

  // 会话循环桥:按左侧栏前三个工作区当前渲染出来的会话行切换(这里装一段假侧栏 DOM)。
  const previousDocument = globalThis.document
  globalThis.document = fakeDocument({ root: sidebarTree([{ key: 'w1', sessions: ['s1', 's2'] }]) })
  try {
    checkTrue('产物里两条会话循环固定行都已挂载', [SESSION_CYCLE_ID, SESSION_ACTIVE_CYCLE_ID].every((id) => shortcuts.fixedCatalog.getSnapshot().some((entry) => entry.id === id)))
    const press = keydown(SESSION_NEXT_MAC_PRESS, shortcutContext({ target: domBody }))
    shortcuts.emit(press.input)
    check('产物里会话循环桥接生效', navigation.opened, ['s2'])
    check('产物里会话循环消费按键', press.consumed.count, 1)
  } finally {
    if (previousDocument === undefined) delete globalThis.document
    else globalThis.document = previousDocument
  }
  console.log('--- G② 产物在 macOS 平台上把逻辑 primary 落成 ⌘ 系键位 ---')
  {
    const shortcuts = fakeShortcuts({ platform: 'macos', fixedRows: APPROVAL_FIXED_ROWS })
    const navigation = fakeSessionNavigation()
    const macCtx = new FakeCtx({
      shortcuts,
      sidebarRight: fakeSidebar(),
      sessions: fakeSessions({ summary: { s1: session('s1'), s2: session('s2', { mainView: 0, running: false }) } }),
      uiSession: fakeUiSession(),
      uiWorkspace: navigation,
    })
    check('macOS 装配无告警', captureWarnings(() => plugin.apply(macCtx)), [])
    const macRows = shortcuts.fixedCatalog.getSnapshot()
    const bindingsOf = (id) => macRows.find((entry) => entry.id === id)?.bindings
    const keysOf = (id) => macRows.find((entry) => entry.id === id)?.keys
    check('macOS 聚焦输入框行落成 ⌘⌥J', bindingsOf('dsh-keyboard-shortcuts.focus-composer'), [{ code: 'KeyJ', modifiers: ['alt', 'meta'] }])
    check('macOS 会话循环行落成 ⌘↑/↓', bindingsOf(SESSION_CYCLE_ID), [{ code: 'ArrowUp', modifiers: ['meta'] }, { code: 'ArrowDown', modifiers: ['meta'] }])
    check('macOS 活跃会话行键帽', keysOf(SESSION_ACTIVE_CYCLE_ID), ['⌘', '⌥', '↑/↓'])

    const macPreviousDocument = globalThis.document
    globalThis.document = fakeDocument({ root: sidebarTree([{ key: 'w1', sessions: ['s1', 's2'] }]) })
    try {
      shortcuts.emit(keydown(SESSION_NEXT_MAC_PRESS, shortcutContext({ target: domBody })).input)
      check('macOS ⌘↓ 走会话导航', navigation.opened, ['s2'])
      const wrong = keydown(SESSION_NEXT_PRESS, shortcutContext({ target: domBody }))
      shortcuts.emit(wrong.input)
      check('macOS 上 Ctrl+↓ 不动产物', navigation.opened, ['s2'])
      check('macOS 上 Ctrl+↓ 不消费', wrong.consumed.count, 0)
    } finally {
      if (macPreviousDocument === undefined) delete globalThis.document
      else globalThis.document = macPreviousDocument
    }
  }

  console.log('--- G③ 产物里的终端捕获:⌘⌥J / Ctrl+Alt+J 与 ⌘⌥N / Ctrl+Alt+N ---')
  {
    // 一段终端 DOM:`.xterm` 里的 helper textarea 是按键目标,`closest('.xterm')` 判它是终端。
    const app = new FakeElement('div', { 'data-app': '' })
    const pane = app.append(new FakeElement('section', { 'data-dockkit-pane': 'p1' }))
    const screen = pane.append(new FakeElement('div', { class: 'xterm' }))
    const textarea = screen.append(new FakeElement('textarea', { class: 'xterm-helper-textarea' }))
    const path = [textarea, screen, pane, app]
    const dom = withWindowDom({ root: app })
    try {
      const facade = { calls: 0, focus() { facade.calls += 1 } }
      const shortcuts = fakeShortcuts({
        rows: [row(SESSION_NEW_ID, { code: 'KeyN', modifiers: ['control', 'alt'] })],
        fixedRows: APPROVAL_FIXED_ROWS,
      })
      const navigation = fakeSessionNavigation()
      const ctx = new FakeCtx({
        shortcuts,
        sidebarRight: fakeSidebar(),
        sessions: fakeSessions({
          summary: { s1: session('s1') },
          scope: () => ({ get: (name) => (name === 'conversation' ? { input: { for: () => facade } } : undefined) }),
        }),
        uiSession: fakeUiSession(),
        uiWorkspace: navigation,
      })
      check('终端捕获装配无告警', captureWarnings(() => plugin.apply(ctx)), [])

      const focusKey = fakeKeyEvent({ path, code: 'KeyJ', ctrlKey: true, altKey: true })
      dom.window.emit(focusKey)
      check('产物里终端内 Ctrl+Alt+J 聚焦输入框', facade.calls, 1)
      check('产物里终端内 Ctrl+Alt+J 被吞', [focusKey.prevented, focusKey.stopped], [1, 1])

      const newKey = fakeKeyEvent({ path, code: 'KeyN', ctrlKey: true, altKey: true })
      dom.window.emit(newKey)
      check('产物里终端内 Ctrl+Alt+N 调官方 session.new', shortcuts.invocations.map((entry) => entry.id), ['session.new'])
      check('产物里终端内 Ctrl+Alt+N 被吞', [newKey.prevented, newKey.stopped], [1, 1])
    } finally {
      dom.restore()
    }
  }

  console.log('--- G③b 产物里的 macOS 死键 ⌘⌥N ---')
  {
    const app = new FakeElement('div', { 'data-app': '' })
    const composer = app.append(new FakeElement('textarea', { class: 'composer' }))
    const path = [composer, app]
    const dom = withWindowDom({ root: app, activeElement: composer })
    try {
      const shortcuts = fakeShortcuts({ platform: 'macos' })
      const ctx = new FakeCtx({
        shortcuts,
        sidebarRight: fakeSidebar(),
        sessions: fakeSessions({ summary: { s1: session('s1') } }),
        uiSession: fakeUiSession(),
        uiWorkspace: fakeSessionNavigation(),
      })
      check('死键捕获装配无告警', captureWarnings(() => plugin.apply(ctx)), [])

      const dead = fakeKeyEvent({ path, key: 'Dead', code: 'KeyN', metaKey: true, altKey: true })
      dom.window.emit(dead)
      check('产物里死键 ⌘⌥N 调官方 session.new', shortcuts.invocations.map((entry) => entry.id), ['session.new'])
      check('产物里死键区域是输入框', shortcuts.invocations[0].context.region, 'editable')
      check('产物里死键没有模态', shortcuts.invocations[0].context.modal, null)
      checkTrue('产物里死键目标是 composer', shortcuts.invocations[0].context.target === composer)
      check('产物里死键被吞', [dead.prevented, dead.stopped], [1, 1])
    } finally {
      dom.restore()
    }
  }

  console.log('--- G④ 产物里的全屏关栏:全屏右栏上的裸 Esc 被吞掉并关栏 ---')
  {
    const app = new FakeElement('div', { 'data-app': '' })
    const panel = app.append(new FakeElement('div', {
      'data-sidebar-right-session': 's1',
      'data-sidebar-right-panel': 'fullscreen',
      'data-sidebar-right-open': '',
    }))
    const pane = panel.append(new FakeElement('section'))
    const dom = withWindowDom({ root: app, activeElement: pane })
    try {
      const shortcuts = fakeShortcuts()
      const sidebar = fakeSidebar()
      const ctx = new FakeCtx({
        shortcuts,
        sidebarRight: sidebar,
        sessions: fakeSessions({ summary: { s1: session('s1') } }),
        uiSession: fakeUiSession(),
        uiWorkspace: fakeSessionNavigation(),
      })
      check('全屏关栏装配无告警', captureWarnings(() => plugin.apply(ctx)), [])
      const escape = fakeKeyEvent({ path: [pane, panel, app], code: 'Escape' })
      dom.window.emit(escape)
      check('产物里全屏 Esc 被吞', [escape.prevented, escape.stopped], [1, 1])
      check('产物里全屏 Esc 关栏', sidebar.calls, [['toggleExpanded']])
    } finally {
      dom.restore()
    }
  }

  console.log('--- G⑤ 产物里的折叠中间步骤:⌘⌥. 收展开的轮次过程 ---')
  {
    const app = new FakeElement('div', { 'data-app': '' })
    const main = app.append(new FakeElement('div', { 'data-slot': 'main.conversation' }))
    const scroll = main.append(new FakeElement('div', { 'data-conversation-scroll': '' }))
    const turn = scroll.append(new FakeElement('button', { 'data-turn-process': '1', 'aria-expanded': 'true' }))
    turn.clicks = 0
    turn.click = () => {
      turn.clicks += 1
      turn.setAttribute('aria-expanded', 'false')
    }
    const dom = withWindowDom({ root: app })
    try {
      const shortcuts = fakeShortcuts({ platform: 'macos', fixedRows: APPROVAL_FIXED_ROWS })
      const ctx = new FakeCtx({
        shortcuts,
        sidebarRight: fakeSidebar(),
        sessions: fakeSessions({ summary: { s1: session('s1') } }),
        uiSession: fakeUiSession(),
        uiWorkspace: fakeSessionNavigation(),
      })
      check('折叠键装配无告警', captureWarnings(() => plugin.apply(ctx)), [])
      checkTrue('产物里折叠固定行已挂载', shortcuts.fixedCatalog.getSnapshot().some((entry) => entry.id === 'dsh-keyboard-shortcuts.collapse-steps'))
      const press = keydown(gesture('Period', { alt: true, meta: true }), shortcutContext({ target: null }))
      shortcuts.emit(press.input)
      check('产物里轮次过程被点击', turn.clicks, 1)
      check('产物里折叠键被消费', press.consumed.count, 1)
      check('产物里轮次过程已收起', turn.getAttribute('aria-expanded'), 'false')
    } finally {
      dom.restore()
    }
  }
}

finish()
