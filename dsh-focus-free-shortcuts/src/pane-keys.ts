/**
 * 右侧栏面板按键：`⌘⌥Enter` 全屏切换、`⌘\` 分屏。
 *
 * `pane.fullscreen.toggle` 与 `pane.split` 调用 `sidebarRight.focusedTarget(element)`，
 * 目标不在可见 dock 面板内时返回 `command.noFocus`，所以用户点击进面板之前两者都会拒绝。
 * 本模块改用固定输入观察者（每个 keydown 都早于可配置派发运行，可消费该按键），通过
 * `sidebarRight.commandTarget(element)`（回退为当前 Session 的活动 dock 面板）解析同一归属：
 * 已聚焦的面板仍然优先，并且只跟随生效的目录行（被重绑、禁用或不存在的内置命令不动）。
 * 不向快捷键目录注册任何条目。仅 Web 运行时：Desktop 上这些可配置绑定由原生键盘桥接派发，
 * 本 DOM 观察者无法抑制。
 */
import { bindingMatches, enabledBinding } from './binding.ts'
import { isKeydown, name, warn, type KeydownInput } from './runtime.ts'
import type {
  ShortcutCatalogEntry,
  ShortcutGesture,
  Shortcuts,
} from '@deepseek-ai/dsh-client-shortcuts/client'
import type {Context} from '@deepseek-ai/cordis'
// 空导入：让 TS 加载本包对 `@deepseek-ai/cordis` 的模块增强，它声明了 `ctx.sidebarRight`，
// 该公开接口带有 `focusedTarget` / `commandTarget`，且不在包的 `/client` 导出名单里。
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'

/** 右侧栏接口，取自 Cordis 模块增强声明的类型。 */
type Sidebar = Context['sidebarRight']

/** 本插件桥接的两个面板命令的注册 id。 */
export interface PaneCommandIds {
  readonly fullscreen: string
  readonly split: string
}

/** 该按键属于哪个内置面板动作。 */
export type PaneAction = 'fullscreen' | 'split'

/** 当前生效目录中拥有该按键的内置面板命令；其他按键返回 undefined。 */
export function paneActionFor(
  rows: readonly ShortcutCatalogEntry[],
  gesture: ShortcutGesture,
  ids: PaneCommandIds,
): PaneAction | undefined {
  if (gesture.secondCode !== undefined) return undefined
  const candidates: readonly (readonly [PaneAction, string])[] = [
    ['fullscreen', ids.fullscreen],
    ['split', ids.split],
  ]
  for (const [action, id] of candidates) {
    const binding = enabledBinding(rows, id)
    if (binding !== undefined && bindingMatches(binding, gesture)) return action
  }
  return undefined
}

/** 本桥接跟踪的两个内置面板命令的注册 id。 */
const PANE_COMMAND_IDS: PaneCommandIds = {
  fullscreen: 'pane.fullscreen.toggle',
  split: 'pane.split',
}

/**
 * 安装面板全屏/分屏键的桥接。仅 Web 运行时：Desktop 上这些可配置绑定由原生键盘桥接派发，
 * 本 DOM 观察者无法抑制，重复执行会切换两次。
 */
export function installPaneBridge(ctx: Context): void {
  ctx.inject(['shortcuts', 'sidebarRight'], (scope) => {
    const shortcuts: Shortcuts = scope.shortcuts
    const sidebar: Sidebar = scope.sidebarRight
    if (shortcuts.runtime !== 'web') {
      warn('desktop runtime: pane keys are dispatched by the native keyboard bridge, so the focus-free pane bridge is not installed here')
      return
    }
    if (typeof shortcuts.observeFixedInput !== 'function') {
      warn('shortcuts service exposes no observeFixedInput; pane bridge not installed')
      return
    }
    scope.effect(() => shortcuts.observeFixedInput((input) => {
      if (!isKeydown(input)) return
      handlePaneInput(shortcuts, sidebar, input)
    }), `${name}: pane keys`)
  })
}

/** 用内置面板命令处理一次固定通道的 keydown。 */
function handlePaneInput(shortcuts: Shortcuts, sidebar: Sidebar, input: KeydownInput): void {
  const gesture: ShortcutGesture = input.gesture
  const context = input.context
  if (gesture.composing || gesture.defaultPrevented) return
  // 两个命令都未声明模态，模态下的按键由内置派发消费并阻断。
  if (context.modal !== null) return
  const rows = shortcuts.catalog.getSnapshot()
  const action = paneActionFor(rows, gesture, PANE_COMMAND_IDS)
  if (action === undefined) return
  const element = context.target ?? (typeof document === 'undefined' ? null : document.activeElement)
  // 面板已聚焦时由内置命令处理，这里再执行一次会抵消它。
  if (sidebar.focusedTarget(element) !== undefined) return
  // 未展开时没有面板可全屏；展开本身也会聚焦活动面板，之后内置命令即可生效。
  if (!sidebar.isExpanded()) return
  const target = sidebar.commandTarget(element)
  if (target === undefined) return
  // 先消费再执行：否则内置命令会解析为 `command.noFocus` 并自行 preventDefault。
  input.consume()
  if (gesture.repeat) return
  if (!sidebar.isTargetCurrent(target)) return
  if (action === 'fullscreen') sidebar.toggleFullscreen(target)
  else sidebar.split(target.paneId)
}
