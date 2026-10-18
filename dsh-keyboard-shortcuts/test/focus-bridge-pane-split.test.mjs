/**
 * 分屏键桥：聚焦让位、回退到活动 dock pane、折叠 / 无 pane / 模态 / repeat / 过期目标，
 * 跟随生效绑定（改绑 / 解绑 / 冲突），以及 desktop 让位与服务缺席。
 *
 * 面板全屏键已归固定行 `dsh-keyboard-shortcuts.pane.fullscreen.toggle`，由
 * `fullscreen.test.mjs` 覆盖；本桥只处理 `pane.split`。
 */
import {
  check,
  checkTrue,
  domComposer,
  finish,
  gesture,
  harness,
  keydown,
  row,
  shortcutContext,
  SPLIT_BINDING,
  SPLIT_PRESS,
} from './focus-helpers.mjs'

console.log('--- E① 已聚焦面板：让内置命令独占这一按 ---')
{
  const { shortcuts, sidebar } = harness()
  sidebar.focused = { paneId: 'p1' }
  const { input, consumed } = keydown(SPLIT_PRESS, shortcutContext({ region: 'page' }))
  shortcuts.emit(input)
  check('未调用分屏', sidebar.calls, [])
  check('未消费', consumed.count, 0)
}

console.log('--- E② 焦点在输入框：回退到活动 dock pane 并消费 ---')
{
  const { shortcuts, sidebar } = harness()
  const target = { paneId: 'p1', host: 'dock' }
  sidebar.focused = undefined
  sidebar.command = target
  const { input, consumed } = keydown(SPLIT_PRESS, shortcutContext({ region: 'editable', target: domComposer }))
  shortcuts.emit(input)
  check('按 paneId 分屏', sidebar.calls, [['split', 'p1']])
  check('消费一次', consumed.count, 1)
}

console.log('--- E③ 折叠 / 没有可用 pane / 模态 / repeat / 目标过期 ---')
{
  const collapsed = harness()
  collapsed.sidebar.focused = undefined
  collapsed.sidebar.command = { paneId: 'p1' }
  collapsed.sidebar.expanded = false
  const a = keydown(SPLIT_PRESS, shortcutContext())
  collapsed.shortcuts.emit(a.input)
  check('折叠时不动作', collapsed.sidebar.calls, [])
  check('折叠时不消费', a.consumed.count, 0)

  const noTarget = harness()
  noTarget.sidebar.focused = undefined
  noTarget.sidebar.command = undefined
  const b = keydown(SPLIT_PRESS, shortcutContext())
  noTarget.shortcuts.emit(b.input)
  check('无 pane 时不动作', noTarget.sidebar.calls, [])
  check('无 pane 时不消费', b.consumed.count, 0)

  const modal = harness()
  modal.sidebar.focused = undefined
  modal.sidebar.command = { paneId: 'p1' }
  const c = keydown(SPLIT_PRESS, shortcutContext({ modal: 'settings' }))
  modal.shortcuts.emit(c.input)
  check('模态中不动作', modal.sidebar.calls, [])
  check('模态中不消费', c.consumed.count, 0)

  const repeat = harness()
  repeat.sidebar.focused = undefined
  repeat.sidebar.command = { paneId: 'p1' }
  const d = keydown(gesture('Backslash', { meta: true, repeat: true }), shortcutContext())
  repeat.shortcuts.emit(d.input)
  check('repeat 不动作', repeat.sidebar.calls, [])
  check('repeat 仍消费', d.consumed.count, 1)

  const stale = harness()
  stale.sidebar.focused = undefined
  stale.sidebar.command = { paneId: 'p1' }
  stale.sidebar.current = false
  const e = keydown(SPLIT_PRESS, shortcutContext())
  stale.shortcuts.emit(e.input)
  check('目标过期不动作', stale.sidebar.calls, [])
  check('目标过期仍消费', e.consumed.count, 1)

  const composing = harness()
  composing.sidebar.focused = undefined
  composing.sidebar.command = { paneId: 'p1' }
  const f = keydown(gesture('Backslash', { meta: true, composing: true }), shortcutContext())
  composing.shortcuts.emit(f.input)
  check('输入法中不动作', composing.sidebar.calls, [])
  check('输入法中不消费', f.consumed.count, 0)
}

console.log('--- E④ 跟随生效绑定：改绑 / 解绑 / 冲突都不接管 ---')
{
  const rebound = harness({ rows: [row('pane.split', { code: 'KeyJ', modifiers: ['meta', 'shift'] })] })
  rebound.sidebar.command = { paneId: 'p1' }
  const old = keydown(SPLIT_PRESS, shortcutContext())
  rebound.shortcuts.emit(old.input)
  check('旧键不再触发', rebound.sidebar.calls, [])
  const fresh = keydown(gesture('KeyJ', { meta: true, shift: true }), shortcutContext())
  rebound.shortcuts.emit(fresh.input)
  check('新键触发', rebound.sidebar.calls, [['split', 'p1']])

  const unbound = harness({ rows: [row('pane.split', null)] })
  unbound.sidebar.command = { paneId: 'p1' }
  const press = keydown(SPLIT_PRESS, shortcutContext())
  unbound.shortcuts.emit(press.input)
  check('解绑后不接管', unbound.sidebar.calls, [])

  const conflicted = harness({ rows: [row('pane.split', SPLIT_BINDING, { conflicts: ['other.cmd'] })] })
  conflicted.sidebar.command = { paneId: 'p1' }
  const clash = keydown(SPLIT_PRESS, shortcutContext())
  conflicted.shortcuts.emit(clash.input)
  check('冲突后不接管', conflicted.sidebar.calls, [])
}

console.log('--- E⑤ 失败模式：desktop 让位、服务缺席即 no-op ---')
{
  const desktop = harness({ runtime: 'desktop' })
  checkTrue('desktop 记一条 warn', desktop.warnings.some((line) => line.includes('native keyboard bridge')))
  desktop.sidebar.command = { paneId: 'p1' }
  const press = keydown(SPLIT_PRESS, shortcutContext({ target: domComposer }))
  desktop.shortcuts.emit(press.input)
  check('desktop 分屏键不动作', desktop.sidebar.calls, [])
  check('desktop 分屏键不消费', press.consumed.count, 0)

  const noSidebar = harness({ withSidebar: false })
  check('无 sidebarRight 不抛', noSidebar.warnings.length, 0)
  const orphan = keydown(SPLIT_PRESS, shortcutContext({ target: domComposer }))
  noSidebar.shortcuts.emit(orphan.input)
  check('无 sidebarRight 分屏键不动', orphan.consumed.count, 0)
}

finish()
