/**
 * 面板全屏的免聚焦桥：焦点不在右栏时用 `commandTarget()` 回退到活动 dock 面板，
 * 焦点在面板内 / 右栏折叠 / 有模态时交回官方命令。
 *
 * 运行：`node test/fullscreen.test.mjs`（或 pnpm test 跑全部）。
 */
import { createFullscreenBridge, handleFixedInput, installFixedKeyBridge as apply } from '../src/fixed-keys.ts'
import {
  check,
  checkFalse,
  checkTrue,
  fakeCtx,
  fakeShortcuts,
  fakeSidebar,
  finish,
  fixedKeydown,
} from './helpers.mjs'

const composer = { tag: 'composer' }

/** 一次 Ctrl+Alt+Enter 固定输入。 */
function fullscreenInput({ context = {}, ...gesture } = {}) {
  return fixedKeydown('Enter', {
    control: true,
    alt: true,
    ...gesture,
    context: { region: 'editable', modal: null, target: composer, ...context },
  })
}

console.log('--- D① 焦点不在右栏时接管全屏 ---')
{
  const sidebar = fakeSidebar()
  const bridge = createFullscreenBridge(sidebar)
  const input = fullscreenInput()

  checkTrue('接管这一按', bridge.handle(input))
  checkTrue('按键被消费', input.consumed)
  check('已聚焦判定用输入落点', sidebar.calls.focused[0], composer)
  check('活动面板回退用输入落点', sidebar.calls.command[0], composer)
  check('活动面板目标被检查', sidebar.calls.current[0], sidebar.state.target)
  check('执行同一个 toggleFullscreen', sidebar.calls.toggle[0], sidebar.state.target)
}

console.log('--- D② 面板已聚焦 / 折叠 / 模态时不抢 ---')
{
  const focused = fakeSidebar()
  focused.state.focused = focused.state.target
  checkFalse('面板已聚焦交回官方命令', createFullscreenBridge(focused).handle(fullscreenInput()))
  check('已聚焦时不消费、不动作', [focused.calls.toggle.length, focused.calls.command.length], [0, 0])

  const collapsed = fakeSidebar({ expanded: false })
  checkFalse('右栏折叠交回官方命令', createFullscreenBridge(collapsed).handle(fullscreenInput()))
  check('折叠时不解析面板', collapsed.calls.command.length, 0)

  const modal = fakeSidebar()
  checkFalse('模态层下不动作', createFullscreenBridge(modal).handle(fullscreenInput({ context: { modal: 'settings' } })))
  check('模态下不解析面板', modal.calls.command.length, 0)

  const missing = fakeSidebar({ target: undefined })
  checkFalse('没有活动面板时交回官方命令', createFullscreenBridge(missing).handle(fullscreenInput()))

  const repeated = fakeSidebar()
  checkFalse('长按不动作', createFullscreenBridge(repeated).handle(fullscreenInput({ repeat: true })))
  check('长按不消费', repeated.calls.command.length, 0)
}

console.log('--- D③ 目标已失效：消费但不动作 ---')
{
  const sidebar = fakeSidebar({ current: false })
  const bridge = createFullscreenBridge(sidebar)
  const input = fullscreenInput()
  checkTrue('仍然消费这一按', bridge.handle(input))
  checkTrue('按键被消费', input.consumed)
  check('面板已切换时不执行', sidebar.calls.toggle.length, 0)
}

console.log('--- D④ 固定输入：桥接管时不调官方命令 ---')
{
  const shortcuts = fakeShortcuts()
  const sidebar = fakeSidebar()
  const input = fullscreenInput()
  handleFixedInput(shortcuts.registry, 'linux', input, createFullscreenBridge(sidebar))
  check('不调官方命令', shortcuts.invocations.length, 0)
  check('执行全屏', sidebar.calls.toggle.length, 1)

  const focused = fakeSidebar()
  focused.state.focused = focused.state.target
  handleFixedInput(shortcuts.registry, 'linux', fullscreenInput(), createFullscreenBridge(focused))
  check('已聚焦时调官方命令', shortcuts.invocations.map((entry) => entry.id), ['pane.fullscreen.toggle'])

  handleFixedInput(shortcuts.registry, 'linux', fixedKeydown('KeyN', { control: true, alt: true }), createFullscreenBridge(sidebar))
  check('其它键不受桥影响', shortcuts.invocations.map((entry) => entry.id), ['pane.fullscreen.toggle', 'session.new'])
}

console.log('--- D⑤ 装配：Web 装桥，Desktop / 无右栏服务不装 ---')
{
  const shortcuts = fakeShortcuts()
  const sidebar = fakeSidebar()
  const ctx = fakeCtx({ shortcuts, sidebarRight: sidebar })
  apply(ctx)
  shortcuts.fire(fullscreenInput())
  check('Web 上焦点不在右栏也能全屏', sidebar.calls.toggle.length, 1)
  check('没有调官方命令', shortcuts.invocations.length, 0)

  const desktop = fakeShortcuts({ runtime: 'desktop' })
  const desktopSidebar = fakeSidebar()
  apply(fakeCtx({ shortcuts: desktop, sidebarRight: desktopSidebar }))
  desktop.fire(fullscreenInput())
  check('Desktop 不装桥', desktopSidebar.calls.toggle.length, 0)
  check('Desktop 仍走官方命令', desktop.invocations.map((entry) => entry.id), ['pane.fullscreen.toggle'])

  const bare = fakeShortcuts()
  apply(fakeCtx({ shortcuts: bare }))
  bare.fire(fullscreenInput())
  check('没有右栏服务时走官方命令', bare.invocations.map((entry) => entry.id), ['pane.fullscreen.toggle'])
}

finish()
