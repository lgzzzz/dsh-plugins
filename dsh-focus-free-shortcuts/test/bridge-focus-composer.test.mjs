/**
 * 聚焦输入框桥:`Ctrl+Alt+J` 聚焦 composer 输入面。覆盖固定行挂载、从文本控件抢键盘、
 * 各类否决与失败模式(缺 sessions / 缺 observeFixedInput 即不装),以及终端内的捕获
 * 拦截与卸载复位。
 */
import { applyPlugin, captureWarnings, check, checkTrue, domBody, domComposer, FakeElement, fakeKeyEvent, fakeSessions, fakeShortcuts, FakeCtx, finish, gesture, harness, keydown, session, shortcutContext, withWindowDom, FOCUS_COMPOSER_ID, FOCUS_COMPOSER_PRESS } from './helpers.mjs'

/** 一个可聚焦的假 facade:`conversation.input.for()` 返回它,focus() 计数。 */
function focusingFacade() {
  const facade = { calls: 0, focus() { facade.calls += 1 } }
  return facade
}

/** 装配"composer 输入面可聚焦"的场景(其余服务走默认)。 */
function focusHarness({ onFor, facade = focusingFacade(), ...options } = {}) {
  const conversation = {
    input: {
      for: onFor === undefined ? () => facade : onFor,
    },
  }
  return { facade, ...harness({ conversation, ...options }) }
}

console.log('--- K① 无焦点聚焦:page 与文本控件内都抢到键盘 ---')
{
  const { facade, shortcuts } = focusHarness()
  checkTrue('固定行已挂载', shortcuts.fixedCatalog.getSnapshot().some((entry) => entry.id === FOCUS_COMPOSER_ID))

  const page = keydown(FOCUS_COMPOSER_PRESS, shortcutContext({ target: domBody }))
  shortcuts.emit(page.input)
  check('body 上聚焦一次', facade.calls, 1)
  check('消费', page.consumed.count, 1)

  const editable = keydown(FOCUS_COMPOSER_PRESS, shortcutContext({ region: 'editable', target: domComposer }))
  shortcuts.emit(editable.input)
  check('文本控件内也聚焦(从别处抢回键盘)', facade.calls, 2)
  check('文本控件内也消费', editable.consumed.count, 1)
}

console.log('--- K② 让位:不是本键 / 主视图缺失 / 歧义 ---')
{
  const { facade, shortcuts } = focusHarness()
  const other = keydown(gesture('KeyK', { control: true, alt: true }), shortcutContext({ target: domBody }))
  shortcuts.emit(other.input)
  check('别的键不聚焦', facade.calls, 0)
  check('别的键不消费', other.consumed.count, 0)

  const noMain = focusHarness({ summary: {} })
  const press = keydown(FOCUS_COMPOSER_PRESS, shortcutContext({ target: domBody }))
  noMain.shortcuts.emit(press.input)
  check('没有主视图会话不聚焦', noMain.facade.calls, 0)
  check('没有主视图会话不消费', press.consumed.count, 0)

  const ambiguous = focusHarness({ summary: { s1: session('s1'), s2: session('s2') } })
  const clash = keydown(FOCUS_COMPOSER_PRESS, shortcutContext({ target: domBody }))
  ambiguous.shortcuts.emit(clash.input)
  check('两个主视图(切换中)不聚焦', ambiguous.facade.calls, 0)
  check('两个主视图不消费', clash.consumed.count, 0)
}

console.log('--- K③ 准入否决:模态 / 终端 / repeat / 组字 / 已被消费 ---')
{
  const cases = [
    ['模态层之上', { modal: 'settings' }, {}],
    ['终端内', { region: 'terminal' }, {}],
    ['长按重复', {}, { repeat: true }],
    ['组字中', {}, { composing: true }],
    ['已被消费', {}, { defaultPrevented: true }],
  ]
  for (const [label, context, overrides] of cases) {
    const { facade, shortcuts } = focusHarness()
    const press = keydown(gesture('KeyJ', { control: true, alt: true, ...overrides }), shortcutContext(context))
    shortcuts.emit(press.input)
    check(`${label}不聚焦`, facade.calls, 0)
    check(`${label}不消费`, press.consumed.count, 0)
  }
}

console.log('--- K④ 失败模式:无 scope / 缺 conversation.input / for 抛错 ---')
{
  // scope 解析不到(sessions.scope 返回 undefined):静默 no-op。
  const orphanSessions = fakeSessions({ summary: { s1: session('s1') } })
  const orphanCtx = new FakeCtx({
    shortcuts: fakeShortcuts(),
    sessions: orphanSessions,
  })
  captureWarnings(() => applyPlugin(orphanCtx))
  const orphan = keydown(FOCUS_COMPOSER_PRESS, shortcutContext({ target: domBody }))
  orphanCtx.services.shortcuts.emit(orphan.input)
  check('scope 缺失不聚焦', orphan.consumed.count, 0)

  // conversation 在 scope 上不存在(如会话还没装配 input):告警并不消费。
  const without = focusHarness({ conversation: undefined })
  const missing = keydown(FOCUS_COMPOSER_PRESS, shortcutContext({ target: domBody }))
  const warnings = captureWarnings(() => without.shortcuts.emit(missing.input))
  check('缺 conversation.input 不消费', missing.consumed.count, 0)
  checkTrue('缺 conversation.input 告警', warnings.some((line) => line.includes('conversation input registry unavailable')))

  // for() 抛错:捕获并告警,按键不归本桥。
  const throwing = focusHarness({ onFor: () => { throw new Error('boom') } })
  const broken = keydown(FOCUS_COMPOSER_PRESS, shortcutContext({ target: domBody }))
  const warnings2 = captureWarnings(() => throwing.shortcuts.emit(broken.input))
  check('for 抛错不消费', broken.consumed.count, 0)
  checkTrue('for 抛错告警', warnings2.some((line) => line.includes('composer focus target unavailable')))
}

console.log('--- K⑤ 失败模式:缺 sessions / 缺 observeFixedInput 即不装 ---')
{
  const noSessions = harness({ withSessions: false })
  check('缺 sessions 只装面板桥、页面关闭桥与页面循环桥', noSessions.shortcuts.listenerCount(), 3)

  const bare = new FakeCtx({
    shortcuts: { ...fakeShortcuts(), observeFixedInput: undefined },
    sidebarRight: { focusedTarget: () => undefined },
    sessions: fakeSessions({ summary: { s1: session('s1') } }),
    uiSession: { sessionStatus: { getSnapshot: () => new Map() } },
  })
  const warnings = captureWarnings(() => applyPlugin(bare))
  checkTrue('缺 observeFixedInput 时聚焦桥告警', warnings.some((line) => line.includes('focus-composer key not installed')))
  check('缺 observeFixedInput 时未装监听', bare.effects.length, 0)
}

console.log('--- K⑥ 卸载:固定行与监听一起释放 ---')
{
  const { ctx, shortcuts } = focusHarness()
  check('挂载后固定行在录', shortcuts.fixedCatalog.getSnapshot().some((entry) => entry.id === FOCUS_COMPOSER_ID), true)
  const before = keydown(FOCUS_COMPOSER_PRESS, shortcutContext({ target: domBody }))
  shortcuts.emit(before.input)
  check('卸载前聚焦', before.consumed.count, 1)

  for (const effect of ctx.effects) {
    if (typeof effect.dispose === 'function') effect.dispose()
  }
  check('卸载后固定行离录', shortcuts.fixedCatalog.getSnapshot().some((entry) => entry.id === FOCUS_COMPOSER_ID), false)
  const after = keydown(FOCUS_COMPOSER_PRESS, shortcutContext({ target: domBody }))
  shortcuts.emit(after.input)
  check('卸载后不再消费', after.consumed.count, 0)
}

/** 一段终端 DOM:pane 里的 `.xterm` 与它自己的 helper textarea。 */
function terminal() {
  const app = new FakeElement('div', { 'data-app': '' })
  const pane = app.append(new FakeElement('section', { 'data-dockkit-pane': 'p1' }))
  const screen = pane.append(new FakeElement('div', { class: 'xterm' }))
  const textarea = screen.append(new FakeElement('textarea', { class: 'xterm-helper-textarea' }))
  return { app, pane, screen, textarea, path: [textarea, screen, pane, app] }
}

console.log('--- K⑦ 终端内按 ⌘⌥J / Ctrl+Alt+J:捕获阶段抢回键盘 ---')
{
  const dom = withWindowDom({ root: new FakeElement('div') })
  try {
    const { facade } = focusHarness()
    const { path } = terminal()
    const event = fakeKeyEvent({ path, code: 'KeyJ', ctrlKey: true, altKey: true })
    dom.window.emit(event)
    check('终端内聚焦输入框', facade.calls, 1)
    check('事件在捕获阶段被吞', [event.prevented, event.stopped], [1, 1])
  } finally {
    dom.restore()
  }

  // macOS 口径:同一个窗口里只认 ⌘⌥J,`Ctrl+Alt+J` 原样留给终端。
  const macDom = withWindowDom({ root: new FakeElement('div') })
  try {
    const { facade } = focusHarness({ platform: 'macos' })
    const { path } = terminal()
    const ctrl = fakeKeyEvent({ path, code: 'KeyJ', ctrlKey: true, altKey: true })
    macDom.window.emit(ctrl)
    check('macOS 上 Ctrl+Alt+J 不聚焦', facade.calls, 0)
    check('macOS 上 Ctrl+Alt+J 不吞事件', [ctrl.prevented, ctrl.stopped], [0, 0])
    const meta = fakeKeyEvent({ path, code: 'KeyJ', metaKey: true, altKey: true })
    macDom.window.emit(meta)
    check('macOS 上 ⌘⌥J 聚焦', facade.calls, 1)
    check('macOS 上 ⌘⌥J 被吞', [meta.prevented, meta.stopped], [1, 1])
  } finally {
    macDom.restore()
  }
}

console.log('--- K⑧ 捕获路径让位:非终端目标 / 模态 / 长按 / 组字 / 无输入面都不吞 ---')
{
  const dom = withWindowDom({ root: new FakeElement('div') })
  try {
    const { facade } = focusHarness()
    const { app, path } = terminal()
    const editor = app.append(new FakeElement('textarea'))
    const cases = [
      ['文本控件里(仍归冒泡通道)', [editor, app], {}],
      ['长按重复', path, { repeat: true }],
      ['组字中', path, { isComposing: true }],
      ['别的键', path, { code: 'KeyK' }],
      ['缺 Alt', path, { altKey: false }],
      ['多了 Shift', path, { shiftKey: true }],
    ]
    for (const [label, eventPath, overrides] of cases) {
      const event = fakeKeyEvent({ path: eventPath, code: 'KeyJ', ctrlKey: true, altKey: true, ...overrides })
      dom.window.emit(event)
      check(`${label}不由捕获路径出手`, [event.prevented, event.stopped], [0, 0])
    }
    check('上述情形一次也没聚焦', facade.calls, 0)
  } finally {
    dom.restore()
  }

  // 模态层之上让位:不动作、不吞。
  const modal = terminal()
  modal.app.append(new FakeElement('div', { role: 'dialog', 'aria-modal': 'true' }))
  const modalDom = withWindowDom({ root: modal.app })
  try {
    const { facade } = focusHarness()
    const event = fakeKeyEvent({ path: modal.path, code: 'KeyJ', ctrlKey: true, altKey: true })
    modalDom.window.emit(event)
    check('模态层之上不聚焦', facade.calls, 0)
    check('模态层之上不吞事件', [event.prevented, event.stopped], [0, 0])
  } finally {
    modalDom.restore()
  }

  // 主视图 Session 不唯一(切换中):不动作、不吞。
  const ambiguousDom = withWindowDom({ root: new FakeElement('div') })
  try {
    const { facade } = focusHarness({ summary: { s1: session('s1'), s2: session('s2') } })
    const event = fakeKeyEvent({ path: terminal().path, code: 'KeyJ', ctrlKey: true, altKey: true })
    ambiguousDom.window.emit(event)
    check('两个主视图不聚焦', facade.calls, 0)
    check('两个主视图不吞事件', [event.prevented, event.stopped], [0, 0])
  } finally {
    ambiguousDom.restore()
  }
}

console.log('--- K⑨ 终端捕获:输入面不可达时告警且不吞 ---')
{
  const dom = withWindowDom({ root: new FakeElement('div') })
  try {
    focusHarness({ conversation: undefined })
    const event = fakeKeyEvent({ path: terminal().path, code: 'KeyJ', ctrlKey: true, altKey: true })
    const warnings = captureWarnings(() => dom.window.emit(event))
    checkTrue('缺 conversation.input 告警', warnings.some((line) => line.includes('conversation input registry unavailable')))
    check('缺 conversation.input 不吞事件', [event.prevented, event.stopped], [0, 0])
  } finally {
    dom.restore()
  }
}

console.log('--- K⑩ 卸载:终端捕获监听一起释放 ---')
{
  const dom = withWindowDom({ root: new FakeElement('div') })
  try {
    const { ctx, facade } = focusHarness()
    const { path } = terminal()
    const before = fakeKeyEvent({ path, code: 'KeyJ', ctrlKey: true, altKey: true })
    dom.window.emit(before)
    check('卸载前终端内聚焦', facade.calls, 1)
    for (const effect of ctx.effects) {
      if (typeof effect.dispose === 'function') effect.dispose()
    }
    const after = fakeKeyEvent({ path, code: 'KeyJ', ctrlKey: true, altKey: true })
    dom.window.emit(after)
    check('卸载后不再聚焦', facade.calls, 1)
    check('卸载后不吞事件', [after.prevented, after.stopped], [0, 0])
  } finally {
    dom.restore()
  }
}

finish()