/**
 * 关页固定键的免聚焦回退：焦点不在右栏时用活动 dock 面板关页；已聚焦 / 模态 /
 * 折叠 / 目标不可关时交回官方命令。
 *
 * 运行：`node test/page-close.test.mjs`（或 pnpm test 跑全部）。
 */
import { createPageCloseBridge, installFixedKeyBridge } from '../src/fixed-keys.ts'
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

/** 带关页动词的假右栏。 */
function sidebarWithClose(overrides = {}) {
  const sidebar = fakeSidebar(overrides)
  sidebar.calls.close = []
  sidebar.closeable = true
  sidebar.canCloseTarget = (candidate) => {
    sidebar.calls.canClose ??= []
    sidebar.calls.canClose.push(candidate)
    return sidebar.closeable
  }
  sidebar.closeTarget = (candidate) => {
    sidebar.calls.close.push(candidate)
  }
  return sidebar
}

/** 一次 Ctrl+Alt+, 固定输入。 */
function closeInput({ context = {}, ...gesture } = {}) {
  return fixedKeydown('Comma', {
    control: true,
    alt: true,
    ...gesture,
    context: { region: 'editable', modal: null, target: composer, ...context },
  })
}

console.log('--- P① 焦点不在右栏：回退到活动 dock 面板并消费 ---')
{
  const sidebar = sidebarWithClose()
  const bridge = createPageCloseBridge(sidebar)
  const input = closeInput()
  checkTrue('接管这一按', bridge.handle(input))
  checkTrue('按键被消费', input.consumed)
  check('关掉活动面板的目标', sidebar.calls.close, [{ sessionId: 'session', paneId: 'pane', host: 'dock', tabId: 'tab', occurrence: {}, navigationRevision: 0 }])
}

console.log('--- P② 已聚焦 / 模态 / 折叠 / 不可关：交回官方命令 ---')
{
  const focused = sidebarWithClose()
  focused.focusedTarget = () => ({ paneId: 'p1' })
  checkFalse('焦点在面板内交回', createPageCloseBridge(focused).handle(closeInput()))

  checkFalse('模态层下交回', createPageCloseBridge(sidebarWithClose()).handle(closeInput({ context: { modal: 'settings' } })))

  const collapsed = sidebarWithClose({ expanded: false })
  checkFalse('右栏折叠交回', createPageCloseBridge(collapsed).handle(closeInput()))

  const notCloseable = sidebarWithClose()
  notCloseable.closeable = false
  const blocked = closeInput()
  checkFalse('目标不可关交回', createPageCloseBridge(notCloseable).handle(blocked))
  check('不可关时不消费', blocked.consumed, false)

  const missing = sidebarWithClose()
  missing.commandTarget = () => undefined
  checkFalse('解析不出目标交回', createPageCloseBridge(missing).handle(closeInput()))
}

console.log('--- P③ 过期目标：消费但不关页 ---')
{
  const stale = sidebarWithClose()
  stale.isTargetCurrent = () => false
  const press = closeInput()
  checkTrue('过期目标仍接管', createPageCloseBridge(stale).handle(press))
  check('过期目标仍消费', press.consumed, true)
  check('过期目标不关页', stale.calls.close, [])
}

console.log('--- P④ 装配：固定输入命中时先走桥，失败再调官方命令 ---')
{
  const shortcuts = fakeShortcuts()
  const sidebar = sidebarWithClose()
  const ctx = fakeCtx({ shortcuts, sidebarRight: sidebar })
  // 只装固定键组，避免其余桥依赖的服务缺席造成干扰。
  installFixedKeyBridge(ctx)
  shortcuts.fire(closeInput())
  check('全屏 / 关页走桥时只关页', sidebar.calls.close.length, 1)
  check('桥接管时不调官方命令', shortcuts.invocations, [])
}

finish()
