/**
 * 聚焦输入框桥:`Ctrl+Alt+J` 聚焦 composer 输入面。覆盖固定行挂载、从文本控件抢键盘、
 * 各类否决与失败模式(缺 sessions / 缺 observeFixedInput 即不装),以及卸载复位。
 */
import { applyPlugin, captureWarnings, check, checkTrue, domBody, domComposer, fakeSessions, fakeShortcuts, FakeCtx, finish, gesture, harness, keydown, session, shortcutContext, FOCUS_COMPOSER_ID, FOCUS_COMPOSER_PRESS } from './helpers.mjs'

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
  check('缺 sessions 只装面板桥与页面循环桥', noSessions.shortcuts.listenerCount(), 2)

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

finish()