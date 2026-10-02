/**
 * E 桥接:面板键 —— 在假 Cordis 上下文里走线 `src/pane-keys.ts` 的面板命令桥
 * (由入口 `src/client.ts` 装上)。
 * 覆盖聚焦让位、回退到活动 dock pane、折叠 / 无 pane / 模态 / repeat / 过期
 * 目标,跟随生效绑定(改绑 / 解绑 / 冲突),以及 desktop 让位与服务缺席。
 *
 * 运行:`node test/bridge-pane-keys.test.mjs`(或 pnpm test 跑全部)。
 */
import { check, checkTrue, domComposer, finish, FULLSCREEN_BINDING, FULLSCREEN_PRESS, gesture, harness, keydown, row, shortcutContext, SPLIT_PRESS } from './helpers.mjs'

console.log('--- E① 已聚焦面板:让内置命令独占这一按 ---')
{
  const { shortcuts, sidebar } = harness()
  sidebar.focused = { paneId: 'p1' }
  const { input, consumed } = keydown(FULLSCREEN_PRESS, shortcutContext({ region: 'page' }))
  shortcuts.emit(input)
  check('未调用面板操作', sidebar.calls, [])
  check('未消费', consumed.count, 0)
}
console.log('--- E② 焦点在输入框:回退到活动 dock pane 并消费 ---')
{
  const { shortcuts, sidebar } = harness()
  const target = { paneId: 'p1', host: 'dock' }
  sidebar.focused = undefined
  sidebar.command = target
  const { input, consumed } = keydown(FULLSCREEN_PRESS, shortcutContext({ region: 'editable', target: domComposer }))
  shortcuts.emit(input)
  check('全屏该 pane', sidebar.calls, [['fullscreen', target]])
  check('消费一次', consumed.count, 1)
}
console.log('--- E③ 折叠 / 没有可用 pane / 模态 / repeat / 目标过期 ---')
{
  const collapsed = harness()
  collapsed.sidebar.focused = undefined
  collapsed.sidebar.command = { paneId: 'p1' }
  collapsed.sidebar.expanded = false
  const a = keydown(FULLSCREEN_PRESS, shortcutContext())
  collapsed.shortcuts.emit(a.input)
  check('折叠时不动作', collapsed.sidebar.calls, [])
  check('折叠时不消费', a.consumed.count, 0)

  const noTarget = harness()
  noTarget.sidebar.focused = undefined
  noTarget.sidebar.command = undefined
  const b = keydown(FULLSCREEN_PRESS, shortcutContext())
  noTarget.shortcuts.emit(b.input)
  check('无 pane 时不动作', noTarget.sidebar.calls, [])
  check('无 pane 时不消费', b.consumed.count, 0)

  const modal = harness()
  modal.sidebar.focused = undefined
  modal.sidebar.command = { paneId: 'p1' }
  const c = keydown(FULLSCREEN_PRESS, shortcutContext({ modal: 'settings' }))
  modal.shortcuts.emit(c.input)
  check('模态中不动作', modal.sidebar.calls, [])
  check('模态中不消费', c.consumed.count, 0)

  const repeat = harness()
  repeat.sidebar.focused = undefined
  repeat.sidebar.command = { paneId: 'p1' }
  const d = keydown(gesture('Enter', { alt: true, meta: true, repeat: true }), shortcutContext())
  repeat.shortcuts.emit(d.input)
  check('repeat 不动作', repeat.sidebar.calls, [])
  check('repeat 仍消费', d.consumed.count, 1)

  const stale = harness()
  stale.sidebar.focused = undefined
  stale.sidebar.command = { paneId: 'p1' }
  stale.sidebar.current = false
  const e = keydown(FULLSCREEN_PRESS, shortcutContext())
  stale.shortcuts.emit(e.input)
  check('目标过期不动作', stale.sidebar.calls, [])
  check('目标过期仍消费', e.consumed.count, 1)

  const composing = harness()
  composing.sidebar.focused = undefined
  composing.sidebar.command = { paneId: 'p1' }
  const f = keydown(gesture('Enter', { alt: true, meta: true, composing: true }), shortcutContext())
  composing.shortcuts.emit(f.input)
  check('输入法中不动作', composing.sidebar.calls, [])
  check('输入法中不消费', f.consumed.count, 0)
}
console.log('--- E④ 分屏键走同一条回退 ---')
{
  const { shortcuts, sidebar } = harness()
  sidebar.focused = undefined
  sidebar.command = { paneId: 'p2' }
  const { input, consumed } = keydown(SPLIT_PRESS, shortcutContext())
  shortcuts.emit(input)
  check('按 paneId 分屏', sidebar.calls, [['split', 'p2']])
  check('分屏也消费', consumed.count, 1)
}
console.log('--- E⑤ 跟随生效绑定:改绑 / 解绑 / 冲突都不接管 ---')
{
  const rebound = harness({ rows: [row('pane.fullscreen.toggle', { code: 'KeyJ', modifiers: ['meta', 'shift'] })] })
  rebound.sidebar.command = { paneId: 'p1' }
  const old = keydown(FULLSCREEN_PRESS, shortcutContext())
  rebound.shortcuts.emit(old.input)
  check('旧键不再触发', rebound.sidebar.calls, [])
  const fresh = keydown(gesture('KeyJ', { meta: true, shift: true }), shortcutContext())
  rebound.shortcuts.emit(fresh.input)
  check('新键触发', rebound.sidebar.calls, [['fullscreen', { paneId: 'p1' }]])

  const unbound = harness({ rows: [row('pane.fullscreen.toggle', null)] })
  unbound.sidebar.command = { paneId: 'p1' }
  const press = keydown(FULLSCREEN_PRESS, shortcutContext())
  unbound.shortcuts.emit(press.input)
  check('解绑后不接管', unbound.sidebar.calls, [])

  const conflicted = harness({ rows: [row('pane.fullscreen.toggle', FULLSCREEN_BINDING, { conflicts: ['other.cmd'] })] })
  conflicted.sidebar.command = { paneId: 'p1' }
  const clash = keydown(FULLSCREEN_PRESS, shortcutContext())
  conflicted.shortcuts.emit(clash.input)
  check('冲突后不接管', conflicted.sidebar.calls, [])
}
console.log('--- E⑥ 失败模式:desktop 让位、服务缺席即 no-op ---')
{
  // Desktop 只关掉面板桥接(配置键由原生通道派发);停止序列与审批键照常安装
  // ——后两者都是固定动作,DOM 固定通道在两端都跑。
  const desktop = harness({ runtime: 'desktop' })
  check('desktop 不装面板桥(停止 + 审批 + 聚焦)', desktop.shortcuts.listenerCount(), 3)
  checkTrue('desktop 记一条 warn', desktop.warnings.some((line) => line.includes('native keyboard bridge')))
  desktop.sidebar.command = { paneId: 'p1' }
  const press = keydown(FULLSCREEN_PRESS, shortcutContext({ target: domComposer }))
  desktop.shortcuts.emit(press.input)
  check('desktop 面板键不动作', desktop.sidebar.calls, [])
  check('desktop 面板键不消费', press.consumed.count, 0)

  const noSidebar = harness({ withSidebar: false })
  check('无 sidebarRight 不装面板桥(停止 + 审批 + 聚焦)', noSidebar.shortcuts.listenerCount(), 3)
  check('无 sidebarRight 不抛', noSidebar.warnings.length, 0)
  const orphan = keydown(FULLSCREEN_PRESS, shortcutContext({ target: domComposer }))
  noSidebar.shortcuts.emit(orphan.input)
  check('无 sidebarRight 面板键不动', orphan.consumed.count, 0)
}

finish()
