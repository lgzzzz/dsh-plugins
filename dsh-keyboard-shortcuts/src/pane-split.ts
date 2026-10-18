/**
 * 分屏键：`⌘\`（macOS）/ `Ctrl+\`（Windows、Linux）。
 *
 * 内置 `pane.split` 用 `sidebarRight.focusedTarget(element)` 解析归属，目标不在可见 dock
 * 面板内时返回 `command.noFocus`，所以用户点进面板之前这一按会被拒绝。本模块改用固定输入
 * 观察者（每个 keydown 都早于可配置派发运行，可消费该按键），经
 * `sidebarRight.commandTarget(element)`（回退到当前 Session 的活动 dock 面板）解析同一归属：
 * 已聚焦的面板仍然优先，并且只跟随生效的目录行（被重绑、禁用或不存在的内置命令不动）。
 *
 * 面板全屏键不在这里：它由固定行 `dsh-keyboard-shortcuts.pane.fullscreen.toggle`
 * 占住（见 `fixed-keys.ts`），因此内置目录里的 `pane.fullscreen.toggle` 行处于冲突态，
 * 本桥只处理 `pane.split`。不向快捷键目录注册任何条目。仅 Web 运行时安装：Desktop 上
 * 这些可配置绑定由原生键盘桥接派发，本 DOM 观察者无法抑制。
 *
 * 逐行机制见 docs/dsh-keyboard-shortcuts/03-fixed-input-and-pane-keys.md。
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

/** 本桥接跟踪的内置分屏命令注册 id。 */
export const SPLIT_COMMAND_ID = 'pane.split'

/** 当前生效目录中的 `pane.split` 是否恰好占用了这一按。 */
export function paneSplitFor(
  rows: readonly ShortcutCatalogEntry[],
  gesture: ShortcutGesture,
): boolean {
  if (gesture.secondCode !== undefined) return false
  const binding = enabledBinding(rows, SPLIT_COMMAND_ID)
  return binding !== undefined && bindingMatches(binding, gesture)
}

/**
 * 安装分屏键的桥接。仅 Web 运行时：Desktop 上这些可配置绑定由原生键盘桥接派发，
 * 本 DOM 观察者无法抑制，重复执行会分屏两次。
 */
export function installPaneSplitBridge(ctx: Context): void {
  ctx.inject(['shortcuts', 'sidebarRight'], (scope) => {
    const shortcuts: Shortcuts = scope.shortcuts
    const sidebar: Sidebar = scope.sidebarRight
    if (shortcuts.runtime !== 'web') {
      warn('desktop runtime: pane keys are dispatched by the native keyboard bridge, so the focus-free pane split bridge is not installed here')
      return
    }
    if (typeof shortcuts.observeFixedInput !== 'function') {
      warn('shortcuts service exposes no observeFixedInput; pane split bridge not installed')
      return
    }
    scope.effect(() => shortcuts.observeFixedInput((input) => {
      if (!isKeydown(input)) return
      handlePaneSplitInput(shortcuts, sidebar, input)
    }), `${name}: pane split key`)
  })
}

/** 处理固定通道投递的一次 keydown；只有解析出面板目标时才消费按键。 */
function handlePaneSplitInput(shortcuts: Shortcuts, sidebar: Sidebar, input: KeydownInput): void {
  const gesture: ShortcutGesture = input.gesture
  const context = input.context
  if (gesture.composing || gesture.defaultPrevented) return
  // 命令没有声明模态，模态下的按键由内置派发消费并阻断。
  if (context.modal !== null) return
  if (!paneSplitFor(shortcuts.catalog.getSnapshot(), gesture)) return
  const element = context.target ?? (typeof document === 'undefined' ? null : document.activeElement)
  // 面板已聚焦时由内置命令处理，这里再执行一次会多分一屏。
  if (sidebar.focusedTarget(element) !== undefined) return
  // 未展开时没有面板可分屏；展开本身也会聚焦活动面板，之后内置命令即可生效。
  if (!sidebar.isExpanded()) return
  const target = sidebar.commandTarget(element)
  if (target === undefined) return
  // 先消费再执行：否则内置命令会解析为 `command.noFocus` 并自行 preventDefault。
  input.consume()
  if (gesture.repeat) return
  if (!sidebar.isTargetCurrent(target)) return
  sidebar.split(target.paneId)
}
