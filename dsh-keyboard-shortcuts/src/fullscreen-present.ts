/**
 * 打开右栏页面后把它默认切成全屏呈现。
 *
 * `sidebarRight.toggleFullscreen(target)` 是呈现方式的唯一公开写入口；它只切当前活动的
 * dock 面板，且面板折叠或目标是浮动面板时不动作。本模块把它接到「刚打开一个页面」之后：
 *
 *   - **只从 push 切到 fullscreen**：面板根上的 `[data-sidebar-right-panel]` 是呈现方式的
 *     DOM 读数（`push` / `fullscreen`，后者也覆盖窄窗口的自动全屏）。已经是 `fullscreen`
 *     时不动作——`toggleFullscreen()` 会把它切回 `push`，窄窗口下甚至会把右栏收起来。
 *   - **只给调用方指定的页面切**：`active()` 必须正是刚打开的那个 kind。浮层里的同名
 *     页面被 reveal 时活动 dock 面板仍是别的页面，跳过它能避免把无关页面切成全屏。
 *   - **失败收敛为不动作**：没有 `document`、找不到 push 面板、右栏折叠、目标解析不出
 *     或已陈旧，都直接返回；不抛错、不影响按键本身已经完成的打开动作。
 *
 * 机制与边界见 docs/dsh-keyboard-shortcuts.md 与
 * docs/dsh-keyboard-shortcuts/03-fixed-input-and-pane-keys.md。
 */
import type { Context } from '@deepseek-ai/cordis'
// 空导入：加载右栏包对 `@deepseek-ai/cordis` 的模块增强（`ctx.sidebarRight`）。
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'

/** Cordis 增强声明的 Right-Sidebar 面。 */
type Sidebar = Context['sidebarRight']

/** 右栏处于推挤呈现、尚未全屏时的面板根节点。 */
const PUSH_PANEL_SELECTOR = '[data-sidebar-right-panel="push"]'

/** 当前画在屏幕上的会话视图：不活跃会话的视图带 `hidden`，但它们的 tab 仍可能保留。 */
const ACTIVE_VIEW_SELECTOR = '[data-sidebar-right-session]:not([hidden])'

/** 当前会话视图里的 push 面板。 */
const ACTIVE_PUSH_PANEL_SELECTOR = `${ACTIVE_VIEW_SELECTOR} ${PUSH_PANEL_SELECTOR}`

/** 当前会话视图里的全屏面板。 */
const ACTIVE_FULLSCREEN_PANEL_SELECTOR = `${ACTIVE_VIEW_SELECTOR} [data-sidebar-right-panel="fullscreen"]`

/**
 * 刚打开的页面若落在 push 呈现的右栏里，把它切成全屏。
 * @param sidebar - 右栏面。
 * @param kind - 刚打开的页面 kind。
 * @returns 是否执行了切换。
 */
export function presentSidebarFullscreen(sidebar: Sidebar, kind: string): boolean {
  if (typeof document === 'undefined') return false
  // 不活跃会话的视图仍留在 DOM 里（hidden），它们的呈现方式属于另一个会话；先读当前
  // 会话视图里的全屏标记，避免把已经全屏的右栏误切回 push。
  if (document.querySelector(ACTIVE_FULLSCREEN_PANEL_SELECTOR) !== null) return false
  if (document.querySelector(ACTIVE_PUSH_PANEL_SELECTOR) === null
    && document.querySelector(PUSH_PANEL_SELECTOR) === null) return false
  if (sidebar.active()?.kind !== kind) return false
  if (!sidebar.isExpanded()) return false
  const target = sidebar.commandTarget(null)
  if (target === undefined) return false
  if (!sidebar.isTargetCurrent(target)) return false
  sidebar.toggleFullscreen(target)
  return true
}
