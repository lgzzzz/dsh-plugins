/** 校验 `lib/client.js` 的模块 id / 插件名 / `inject` 声明,并用真产物装配一遍端到端走线(产物零 external)。 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { captureWarnings, check, checkTrue, domBody, domComposer, fakeDocument, fakeSessions, fakeSessionNavigation, fakeShortcuts, fakeSidebar, fakeUiSession, FakeCtx, finish, FULLSCREEN_BINDING, FULLSCREEN_PRESS, gesture, keydown, PAGE_CLOSE_BINDING, PAGE_CLOSE_ID, PAGE_CLOSE_PRESS, pluginRoot, row, session, shortcutContext, sidebarTree, APPROVAL_FIXED_ROWS, approvalPending, questionPending, SESSION_ACTIVE_CYCLE_ID, SESSION_CYCLE_ID, SESSION_NEXT_MAC_PRESS, SESSION_NEXT_PRESS } from './helpers.mjs'

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
  check('模块 id', registration?.id, 'dsh-focus-free-shortcuts')
  const plugin = registration.factory(() => {
    throw new Error('产物要求了外部模块:本插件不应有任何 external')
  })
  check('插件名', plugin.name, 'dsh-focus-free-shortcuts')
  check('inject 声明', plugin.inject, ['shortcuts'])

  let cancelled = 0
  const shortcuts = fakeShortcuts({
    rows: [row('pane.fullscreen.toggle', FULLSCREEN_BINDING), row(PAGE_CLOSE_ID, PAGE_CLOSE_BINDING)],
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
  // 页面关闭桥:焦点在输入框里也关掉活动 dock pane 的当前页。
  const closePress = keydown(PAGE_CLOSE_PRESS, shortcutContext({ target: domComposer }))
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
    const press = keydown(SESSION_NEXT_PRESS, shortcutContext({ target: domBody }))
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
    check('macOS 聚焦输入框行落成 ⌘⌥J', bindingsOf('dsh-focus-free-shortcuts.focus-composer'), [{ code: 'KeyJ', modifiers: ['alt', 'meta'] }])
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
}

finish()
