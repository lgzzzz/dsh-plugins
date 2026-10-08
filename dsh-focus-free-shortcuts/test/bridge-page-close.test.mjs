/**
 * 页面关闭桥(`page.close`):焦点不在右侧栏时也关掉当前页面 ——
 * 活动 dock pane 回退、已聚焦让位、折叠 / 无目标 / 陈旧标记 / 模态 / repeat / 不可关,
 * 跟随生效绑定(改绑 / 解绑 / 冲突 / 平台形态),以及 desktop 让位与服务缺席。
 */
import { applyPlugin, captureWarnings, check, checkTrue, domComposer, FakeCtx, FakeNode, fakeShortcuts, fakeSidebar, finish, FULLSCREEN_PRESS, gesture, harness, keydown, PAGE_CLOSE_BINDING, PAGE_CLOSE_ID, PAGE_CLOSE_PRESS, PAGE_CLOSE_WIN_BINDING, PAGE_CLOSE_WIN_PRESS, row, shortcutContext } from './helpers.mjs'

console.log('--- T① 焦点不在右侧栏:回退到活动 dock pane 关掉当前页并消费 ---')
{
  const { shortcuts, sidebar } = harness()
  const target = { paneId: 'p1', host: 'dock', tabId: 't7' }
  sidebar.command = target
  const { input, consumed } = keydown(PAGE_CLOSE_PRESS, shortcutContext({ region: 'editable', target: domComposer }))
  shortcuts.emit(input)
  check('关掉活动 pane 的当前页', sidebar.calls, [['close', target]])
  check('消费一次', consumed.count, 1)

  const body = harness()
  const loose = { paneId: 'p2', host: 'dock', tabId: 't3' }
  body.sidebar.command = loose
  const press = keydown(PAGE_CLOSE_PRESS, shortcutContext({ target: null }))
  body.shortcuts.emit(press.input)
  check('焦点没有目标时同样回退', body.sidebar.calls, [['close', loose]])
  check('焦点没有目标时也消费', press.consumed.count, 1)
}

console.log('--- T② 已聚焦面板:让内置命令独占这一按 ---')
{
  const { shortcuts, sidebar } = harness()
  const focused = { paneId: 'p1', host: 'dock', tabId: 't7' }
  sidebar.focused = focused
  sidebar.command = focused
  const { input, consumed } = keydown(PAGE_CLOSE_PRESS, shortcutContext({ region: 'page', target: domComposer }))
  shortcuts.emit(input)
  check('未调用关闭', sidebar.calls, [])
  check('未消费', consumed.count, 0)
}

console.log('--- T③ 折叠 / 无目标 / 陈旧标记 / 模态 / repeat / 不可关 ---')
{
  const collapsed = harness()
  collapsed.sidebar.command = { paneId: 'p1', tabId: 't7' }
  collapsed.sidebar.expanded = false
  const a = keydown(PAGE_CLOSE_PRESS, shortcutContext({ target: domComposer }))
  collapsed.shortcuts.emit(a.input)
  check('折叠时不动作', collapsed.sidebar.calls, [])
  check('折叠时不消费', a.consumed.count, 0)

  const noTarget = harness()
  noTarget.sidebar.command = undefined
  const b = keydown(PAGE_CLOSE_PRESS, shortcutContext({ target: domComposer }))
  noTarget.shortcuts.emit(b.input)
  check('没有活动 pane 时不动作', noTarget.sidebar.calls, [])
  check('没有活动 pane 时不消费', b.consumed.count, 0)

  // 焦点在侧栏容器内但不在面板内:官方 commandTarget 对陈旧标记不回退。
  const stale = harness()
  stale.sidebar.command = { paneId: 'p1', tabId: 't7' }
  const sidebarRoot = new FakeNode('div', ['data-sidebar-right-session'])
  const sidebarMargin = sidebarRoot.append(new FakeNode('div'))
  const c = keydown(PAGE_CLOSE_PRESS, shortcutContext({ target: sidebarMargin }))
  stale.shortcuts.emit(c.input)
  check('陈旧侧栏标记时不动作', stale.sidebar.calls, [])
  check('陈旧侧栏标记时不消费', c.consumed.count, 0)

  const modal = harness()
  modal.sidebar.command = { paneId: 'p1', tabId: 't7' }
  const d = keydown(PAGE_CLOSE_PRESS, shortcutContext({ modal: 'settings', target: domComposer }))
  modal.shortcuts.emit(d.input)
  check('模态中不动作(让内置关弹窗)', modal.sidebar.calls, [])
  check('模态中不消费', d.consumed.count, 0)

  const repeat = harness()
  repeat.sidebar.command = { paneId: 'p1', tabId: 't7' }
  const e = keydown(gesture('KeyW', { alt: true, meta: true, repeat: true }), shortcutContext({ target: domComposer }))
  repeat.shortcuts.emit(e.input)
  check('repeat 不动作', repeat.sidebar.calls, [])
  check('repeat 仍消费', e.consumed.count, 1)

  const uncloseable = harness()
  uncloseable.sidebar.command = { paneId: 'p1', tabId: undefined }
  uncloseable.sidebar.closeable = false
  const f = keydown(PAGE_CLOSE_PRESS, shortcutContext({ target: domComposer }))
  uncloseable.shortcuts.emit(f.input)
  check('不可关的页面不动作', uncloseable.sidebar.calls, [])
  check('不可关的页面不消费(仍归内置)', f.consumed.count, 0)

  const composing = harness()
  composing.sidebar.command = { paneId: 'p1', tabId: 't7' }
  const g = keydown(gesture('KeyW', { alt: true, meta: true, composing: true }), shortcutContext({ target: domComposer }))
  composing.shortcuts.emit(g.input)
  check('输入法中不动作', composing.sidebar.calls, [])
  check('输入法中不消费', g.consumed.count, 0)

  const consumedElsewhere = harness()
  consumedElsewhere.sidebar.command = { paneId: 'p1', tabId: 't7' }
  const h = keydown(gesture('KeyW', { alt: true, meta: true, defaultPrevented: true }), shortcutContext({ target: domComposer }))
  consumedElsewhere.shortcuts.emit(h.input)
  check('已被消费时不动作', consumedElsewhere.sidebar.calls, [])
  check('已被消费时不再消费', h.consumed.count, 0)
}

console.log('--- T④ 跟随生效绑定:改绑 / 解绑 / 冲突 / 平台形态 / 别的键不误触 ---')
{
  const rebound = harness({ rows: [row(PAGE_CLOSE_ID, { code: 'KeyJ', modifiers: ['meta', 'shift'] })] })
  rebound.sidebar.command = { paneId: 'p1', tabId: 't7' }
  const old = keydown(PAGE_CLOSE_PRESS, shortcutContext({ target: domComposer }))
  rebound.shortcuts.emit(old.input)
  check('旧键不再触发', rebound.sidebar.calls, [])
  const fresh = keydown(gesture('KeyJ', { meta: true, shift: true }), shortcutContext({ target: domComposer }))
  rebound.shortcuts.emit(fresh.input)
  check('新键触发', rebound.sidebar.calls, [['close', { paneId: 'p1', tabId: 't7' }]])

  const unbound = harness({ rows: [row(PAGE_CLOSE_ID, null)] })
  unbound.sidebar.command = { paneId: 'p1', tabId: 't7' }
  const press = keydown(PAGE_CLOSE_PRESS, shortcutContext({ target: domComposer }))
  unbound.shortcuts.emit(press.input)
  check('解绑后不接管', unbound.sidebar.calls, [])
  check('解绑后不消费', press.consumed.count, 0)

  const conflicted = harness({ rows: [row(PAGE_CLOSE_ID, PAGE_CLOSE_BINDING, { conflicts: ['other.cmd'] })] })
  conflicted.sidebar.command = { paneId: 'p1', tabId: 't7' }
  const clash = keydown(PAGE_CLOSE_PRESS, shortcutContext({ target: domComposer }))
  conflicted.shortcuts.emit(clash.input)
  check('冲突后不接管', conflicted.sidebar.calls, [])

  const missing = harness({ rows: [] })
  missing.sidebar.command = { paneId: 'p1', tabId: 't7' }
  const absent = keydown(PAGE_CLOSE_PRESS, shortcutContext({ target: domComposer }))
  missing.shortcuts.emit(absent.input)
  check('命令缺席时不接管', missing.sidebar.calls, [])

  // Windows/Linux 的同一组合是 control+alt+W:只认自己那一组物理键。
  const windows = harness({ rows: [row(PAGE_CLOSE_ID, PAGE_CLOSE_WIN_BINDING)] })
  windows.sidebar.command = { paneId: 'p1', tabId: 't7' }
  const win = keydown(PAGE_CLOSE_WIN_PRESS, shortcutContext({ target: domComposer }))
  windows.shortcuts.emit(win.input)
  check('Windows 形态触发', windows.sidebar.calls, [['close', { paneId: 'p1', tabId: 't7' }]])
  const macOnWindows = keydown(PAGE_CLOSE_PRESS, shortcutContext({ target: domComposer }))
  windows.shortcuts.emit(macOnWindows.input)
  check('macOS 形态在 Windows 行上不动', windows.sidebar.calls, [['close', { paneId: 'p1', tabId: 't7' }]])
  check('macOS 形态在 Windows 行上不消费', macOnWindows.consumed.count, 0)

  const otherKey = harness()
  otherKey.sidebar.command = { paneId: 'p1', tabId: 't7' }
  const other = keydown(FULLSCREEN_PRESS, shortcutContext({ target: domComposer }))
  otherKey.shortcuts.emit(other.input)
  check('面板键不误关页面', otherKey.sidebar.calls, [['fullscreen', { paneId: 'p1', tabId: 't7' }]])
}

console.log('--- T⑤ 失败模式:desktop 让位、服务缺席即 no-op、缺 observeFixedInput 告警 ---')
{
  // Desktop 上 `⌘W`(primary+W)本来就免聚焦(未聚焦时关窗口),本桥不装;
  // 停止、审批、提问、聚焦输入框、聚焦右栏页面、页面循环与会话循环桥照常安装。
  const desktop = harness({ runtime: 'desktop' })
  check('desktop 不装页面关闭桥(其余七条仍在)', desktop.shortcuts.listenerCount(), 7)
  checkTrue('desktop 记一条 warn', desktop.warnings.some((line) => line.includes('native keyboard bridge')))
  desktop.sidebar.command = { paneId: 'p1', tabId: 't7' }
  const press = keydown(PAGE_CLOSE_PRESS, shortcutContext({ target: domComposer }))
  desktop.shortcuts.emit(press.input)
  check('desktop 页面键不动作', desktop.sidebar.calls, [])
  check('desktop 页面键不消费', press.consumed.count, 0)

  const noSidebar = harness({ withSidebar: false })
  check('无 sidebarRight 不装页面关闭桥(停止 + 审批 + 提问 + 聚焦输入框 + 会话循环)', noSidebar.shortcuts.listenerCount(), 5)
  check('无 sidebarRight 不抛', noSidebar.warnings.length, 0)
  const orphan = keydown(PAGE_CLOSE_PRESS, shortcutContext({ target: domComposer }))
  noSidebar.shortcuts.emit(orphan.input)
  check('无 sidebarRight 页面键不消费', orphan.consumed.count, 0)

  const bare = new FakeCtx({
    shortcuts: { ...fakeShortcuts(), observeFixedInput: undefined },
    sidebarRight: fakeSidebar(),
  })
  const warnings = captureWarnings(() => applyPlugin(bare))
  checkTrue('缺 observeFixedInput 时页面关闭桥告警', warnings.some((line) => line.includes('page close bridge not installed')))
  check('缺 observeFixedInput 时未装监听', bare.effects.length, 0)
}

console.log('--- T⑥ 卸载:观察者随 effect 释放 ---')
{
  const { ctx, shortcuts, sidebar } = harness()
  sidebar.command = { paneId: 'p1', tabId: 't7' }
  const before = keydown(PAGE_CLOSE_PRESS, shortcutContext({ target: domComposer }))
  shortcuts.emit(before.input)
  check('卸载前关页', before.consumed.count, 1)

  for (const effect of ctx.effects) {
    if (typeof effect.dispose === 'function') effect.dispose()
  }
  const after = keydown(PAGE_CLOSE_PRESS, shortcutContext({ target: domComposer }))
  shortcuts.emit(after.input)
  check('卸载后不再关页', sidebar.calls, [['close', { paneId: 'p1', tabId: 't7' }]])
  check('卸载后不消费', after.consumed.count, 0)
}

finish()
