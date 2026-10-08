/**
 * 内置 `session.new` 的终端桥:焦点在 `.xterm` 里时,Web 上默认的 `Ctrl+Alt+N`
 * (macOS `⌘⌥N`)在 window 捕获阶段被拦下,并调用与内置 `run()` 同一个
 * `uiWorkspace.startSession()`(不带参数 = 沿用当前 / 最近的工作区)。
 *
 * 覆盖:命中就吞掉这一按、各平台只认自己那一组、键位跟随生效目录、非终端目标 /
 * 模态 / 长按 / 组字一律放行、`uiWorkspace` 缺席时等它到位(形状不符才告警)、
 * 没有 `window` 时静默不装,以及卸载复位。本桥**不注册固定行**,固定通道里
 * `session.new` 仍归内置命令。
 */
import { applyPlugin, captureWarnings, check, checkTrue, FakeCtx, FakeElement, fakeKeyEvent, fakeSessions, fakeSessionNavigation, fakeShortcuts, fakeUiSession, finish, harness, keydown, row, session, shortcutContext, withWindowDom, FULLSCREEN_BINDING, PAGE_CLOSE_BINDING, PAGE_CLOSE_ID, SESSION_NEW_BINDING, SESSION_NEW_ID, SESSION_NEW_MAC_BINDING, SESSION_NEW_ROWS } from './helpers.mjs'

/** 一段终端 DOM:pane 里的 `.xterm` 与它自己的 helper textarea。 */
function terminal() {
  const app = new FakeElement('div', { 'data-app': '' })
  const pane = app.append(new FakeElement('section', { 'data-dockkit-pane': 'p1' }))
  const screen = pane.append(new FakeElement('div', { class: 'xterm' }))
  const textarea = screen.append(new FakeElement('textarea', { class: 'xterm-helper-textarea' }))
  return { app, pane, screen, textarea, path: [textarea, screen, pane, app] }
}

/** 一次终端内的 keydown 事件(Windows/Linux 口径的 `Ctrl+Alt+N`)。 */
function terminalPress(path, overrides = {}) {
  return fakeKeyEvent({ path, code: 'KeyN', ctrlKey: true, altKey: true, ...overrides })
}

console.log('--- V① 终端内新建会话:捕获阶段拦下,动作与内置命令同一个 ---')
{
  const dom = withWindowDom({ root: new FakeElement('div') })
  try {
    const { shortcuts, navigation } = harness({ rows: SESSION_NEW_ROWS })
    const { path } = terminal()
    const event = terminalPress(path)
    dom.window.emit(event)
    check('调用了 uiWorkspace.startSession', navigation.started, [undefined])
    check('这一按在捕获阶段被吞', [event.prevented, event.stopped], [1, 1])
    check('只新建一次', navigation.started.length, 1)
    checkTrue('不注册固定行(session.new 仍归内置命令)', !shortcuts.fixedCatalog.getSnapshot().some((entry) => entry.id === SESSION_NEW_ID))
  } finally {
    dom.restore()
  }
}

console.log('--- V② 其余键位一律放行 ---')
{
  const dom = withWindowDom({ root: new FakeElement('div') })
  try {
    const { navigation } = harness({ rows: SESSION_NEW_ROWS })
    const { path } = terminal()
    const cases = [
      ['只有 Ctrl', { altKey: false }],
      ['只有 Alt', { ctrlKey: false }],
      ['多了 Shift', { shiftKey: true }],
      ['长按重复', { repeat: true }],
      ['组字中', { isComposing: true }],
      ['别的键', { code: 'KeyM' }],
    ]
    for (const [label, overrides] of cases) {
      const event = terminalPress(path, overrides)
      dom.window.emit(event)
      check(`${label}不新建会话`, navigation.started, [])
      check(`${label}不吞事件`, [event.prevented, event.stopped], [0, 0])
    }
  } finally {
    dom.restore()
  }
}

console.log('--- V③ 捕获路径只认终端;模态层之上让位 ---')
{
  const { app } = terminal()
  const dom = withWindowDom({ root: app })
  try {
    const { navigation } = harness({ rows: SESSION_NEW_ROWS })
    const editor = app.append(new FakeElement('textarea'))
    const event = terminalPress([editor, app])
    dom.window.emit(event)
    check('文本控件里不由本桥处理', navigation.started, [])
    check('不吞文本控件里的事件', [event.prevented, event.stopped], [0, 0])
  } finally {
    dom.restore()
  }

  // 模态层打开时,终端内的这一按也让位(不动作、不吞)。
  const modal = terminal()
  modal.app.append(new FakeElement('div', { role: 'dialog', 'aria-modal': 'true' }))
  const modalDom = withWindowDom({ root: modal.app })
  try {
    const set = harness({ rows: SESSION_NEW_ROWS })
    const modalEvent = terminalPress(modal.path)
    modalDom.window.emit(modalEvent)
    check('模态层之上不新建会话', set.navigation.started, [])
    check('模态层之上不吞事件', [modalEvent.prevented, modalEvent.stopped], [0, 0])
  } finally {
    modalDom.restore()
  }
}

console.log('--- V④ 键位跟随生效目录:改绑跟随,没有这一行就不出手 ---')
{
  // 每次换一套目录都换一个 window:捕获监听是按插件实例挂在 window 上的,同一个 window 上
  // 叠两个 harness 时,先注册的那条会先看到按键。
  const reboundDom = withWindowDom({ root: new FakeElement('div') })
  try {
    const { path } = terminal()
    // 改绑到 Ctrl+Shift+N:新键在终端里生效,旧键不再出手。
    const rebound = harness({ rows: [row(SESSION_NEW_ID, { code: 'KeyN', modifiers: ['control', 'shift'] })] })
    const oldKey = terminalPress(path)
    reboundDom.window.emit(oldKey)
    check('改绑后旧键不新建会话', rebound.navigation.started, [])
    check('改绑后旧键不吞事件', [oldKey.prevented, oldKey.stopped], [0, 0])
    const newKey = fakeKeyEvent({ path, code: 'KeyN', ctrlKey: true, shiftKey: true })
    reboundDom.window.emit(newKey)
    check('改绑后新键新建会话', rebound.navigation.started, [undefined])
    check('改绑后新键被吞', [newKey.prevented, newKey.stopped], [1, 1])
  } finally {
    reboundDom.restore()
  }

  const absentDom = withWindowDom({ root: new FakeElement('div') })
  try {
    // 目录里根本没有 session.new(解绑 / 被别的注册者挤掉):这一按无主,原样交给终端。
    const absent = harness({ rows: [row(PAGE_CLOSE_ID, PAGE_CLOSE_BINDING)] })
    const event = terminalPress(terminal().path)
    absentDom.window.emit(event)
    check('没有这一行时不出手', absent.navigation.started, [])
    check('没有这一行时不吞事件', [event.prevented, event.stopped], [0, 0])
  } finally {
    absentDom.restore()
  }
}

console.log('--- V⑤ macOS:同一按在终端里换成 ⌘⌥N ---')
{
  const macDom = withWindowDom({ root: new FakeElement('div') })
  try {
    const { path } = terminal()
    const mac = harness({ platform: 'macos', rows: [row(SESSION_NEW_ID, SESSION_NEW_MAC_BINDING)] })
    const ctrl = terminalPress(path)
    macDom.window.emit(ctrl)
    check('macOS 上 Ctrl+Alt+N 不新建会话', mac.navigation.started, [])
    check('macOS 上 Ctrl+Alt+N 不吞事件', [ctrl.prevented, ctrl.stopped], [0, 0])
    const meta = fakeKeyEvent({ path, code: 'KeyN', metaKey: true, altKey: true })
    macDom.window.emit(meta)
    check('macOS 上 ⌘⌥N 新建会话', mac.navigation.started, [undefined])
    check('macOS 上 ⌘⌥N 被吞', [meta.prevented, meta.stopped], [1, 1])
  } finally {
    macDom.restore()
  }

  const winDom = withWindowDom({ root: new FakeElement('div') })
  try {
    const { path } = terminal()
    const win = harness({ rows: SESSION_NEW_ROWS })
    const wrong = fakeKeyEvent({ path, code: 'KeyN', metaKey: true, altKey: true })
    winDom.window.emit(wrong)
    check('Windows 上 ⌘⌥N 不新建会话', win.navigation.started, [])
    check('Windows 上 ⌘⌥N 不吞事件', [wrong.prevented, wrong.stopped], [0, 0])
  } finally {
    winDom.restore()
  }
}

console.log('--- V⑥ 服务缺席时等待:到位后补装,形状不符才告警 ---')
{
  const dom = withWindowDom({ root: new FakeElement('div') })
  try {
    const shortcuts = fakeShortcuts({ rows: SESSION_NEW_ROWS })
    const ctx = new FakeCtx({
      shortcuts,
      sidebarRight: { focusedTarget: () => undefined },
      sessions: fakeSessions({ summary: { s1: session('s1') } }),
      uiSession: fakeUiSession(),
    })
    const warnings = captureWarnings(() => applyPlugin(ctx))
    check('uiWorkspace 缺席时不告警(那只是还没激活)', warnings, [])
    checkTrue('注入停在等待里', ctx.pending.some((entry) => entry.deps.includes('uiWorkspace')))
    const { path } = terminal()
    const early = terminalPress(path)
    dom.window.emit(early)
    check('服务没来时不出手', [early.prevented, early.stopped], [0, 0])

    // 服务晚到:补装后同一次按键照常新建会话。
    const navigation = fakeSessionNavigation()
    ctx.provide('uiWorkspace', navigation)
    const late = terminalPress(path)
    dom.window.emit(late)
    check('服务到位后照常新建会话', navigation.started, [undefined])
    check('服务到位后吞掉这一按', [late.prevented, late.stopped], [1, 1])
  } finally {
    dom.restore()
  }

  // 形状不符(上游改了方法名):告警一次,整条桥不安装。
  const wrongDom = withWindowDom({ root: new FakeElement('div') })
  try {
    const ctx = new FakeCtx({
      shortcuts: fakeShortcuts({ rows: SESSION_NEW_ROWS }),
      sidebarRight: { focusedTarget: () => undefined },
      sessions: fakeSessions({ summary: { s1: session('s1') } }),
      uiSession: fakeUiSession(),
      uiWorkspace: { openSession() {} },
    })
    const warnings = captureWarnings(() => applyPlugin(ctx))
    checkTrue('形状不符时告警', warnings.some((line) => line.includes('session.new key not bridged')))
    const { path } = terminal()
    const event = terminalPress(path)
    wrongDom.window.emit(event)
    check('形状不符时不动作', [event.prevented, event.stopped], [0, 0])
  } finally {
    wrongDom.restore()
  }
}

console.log('--- V⑦ 卸载:捕获监听一起释放 ---')
{
  const dom = withWindowDom({ root: new FakeElement('div') })
  try {
    const { ctx, navigation } = harness({ rows: SESSION_NEW_ROWS })
    const { path } = terminal()
    const before = terminalPress(path)
    dom.window.emit(before)
    check('卸载前新建会话', navigation.started, [undefined])
    for (const effect of ctx.effects) {
      if (typeof effect.dispose === 'function') effect.dispose()
    }
    const after = terminalPress(path)
    dom.window.emit(after)
    check('卸载后不再新建会话', navigation.started, [undefined])
    check('卸载后不吞事件', [after.prevented, after.stopped], [0, 0])
  } finally {
    dom.restore()
  }
}

console.log('--- V⑧ 没有 window 时静默不装(无 DOM 的装配走查) ---')
{
  const previousWindow = globalThis.window
  delete globalThis.window
  try {
    const ctx = new FakeCtx({
      shortcuts: fakeShortcuts({ rows: SESSION_NEW_ROWS }),
      sidebarRight: { focusedTarget: () => undefined },
      sessions: fakeSessions({ summary: { s1: session('s1') } }),
      uiSession: fakeUiSession(),
      uiWorkspace: fakeSessionNavigation(),
    })
    const warnings = captureWarnings(() => applyPlugin(ctx))
    check('没有 window 时不告警', warnings, [])
  } finally {
    if (previousWindow !== undefined) globalThis.window = previousWindow
  }
}

console.log('--- V⑨ 固定通道不替内置命令出手 ---')
{
  const dom = withWindowDom({ root: new FakeElement('div') })
  try {
    const { shortcuts, navigation } = harness({
      rows: [row(SESSION_NEW_ID, SESSION_NEW_BINDING), row('pane.fullscreen.toggle', FULLSCREEN_BINDING)],
    })
    const press = keydown({ code: 'KeyN', control: true, alt: true }, shortcutContext({ target: null }))
    shortcuts.emit(press.input)
    check('固定通道不新建会话', navigation.started, [])
    check('固定通道不消费这一按', press.consumed.count, 0)
  } finally {
    dom.restore()
  }
}

finish()
