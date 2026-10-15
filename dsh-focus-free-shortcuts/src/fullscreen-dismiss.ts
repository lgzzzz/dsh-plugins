/**
 * `Esc` 关闭全屏呈现的右侧边栏。
 *
 * 右栏全屏时盖住整个视口（手动全屏；窄于 768px 的窗口里展开即自动全屏）。此时面板的
 * 两个控件都在面板自己的页签行末端：`⌘⌥Enter` 是"切换呈现方式"，折叠按钮要先把手挪到
 * 那里。本模块把裸 `Esc` 接过来，关掉这个盖在最上层的面板。
 *
 * 动作与面板自带的折叠按钮逐字相同（`sidebarRight.toggleExpanded()`）：展开即折叠，只
 * 折叠呈现、不重置记录的模式，所以再次展开仍回到全屏——与点那个按钮一样。
 *
 * 投递路径只有一条：window 捕获阶段的 `keydown` 监听。它早于官方固定通道里的两条停止
 * 序列（官方 `response.stop` 与本插件的停止桥）与任何本地控件，因此全屏期间 `Esc` 归本桥
 * 所有：那两条序列收不到这一按，凑不成停止；面板关掉之后再按两下才停止回合。命中时先
 * `preventDefault()` + `stopPropagation()` 再关栏，这一按不再传给浏览器或别的控件。两条
 * 序列在两端都由 DOM 固定通道驱动，所以 Web 与 Desktop 都安装本桥。
 *
 * 让位（不动作、不消费）：
 *   - 焦点落在终端 `.xterm` 内：`Esc` 属于终端（与停止桥、审批桥、提问桥同一条门槛）；
 *   - 焦点落在右栏自己的文本控件里（`[data-sidebar-right-session]` 内）：控件自带取消
 *     语义（终端页签的重命名输入框就用 `Esc` 取消重命名）；
 *   - 有模态层打开：`Esc` 先归模态（`captureContext` 的 `modal !== null`）；
 *   - 右栏已折叠、或 DOM 上没有全屏呈现的面板标记：没有可关的东西。两者不一致（例如
 *     面板正在卸载）时也不动，免得把 `toggleExpanded()` 的折叠语义翻成展开。
 *
 * 不注册固定行：裸 `Esc` 早已被上游 `response.stop` 与 `approval.reject` 两条固定行预约，
 * 本桥只在全屏这一状态下抢先用掉它，不改那份预约表。待答审批与提问卡片同样不在这一按上
 * 作答——它们被这块浮层盖住，两条桥各自读本模块的 `fullscreenSidebarShown()` 让位。
 *
 * 机制见 docs/dsh-focus-free-shortcuts/03-fixed-input-and-pane-keys.md；
 * 归属与边界见 docs/dsh-focus-free-shortcuts/02-ownership-resolution.md 与
 * docs/dsh-focus-free-shortcuts/06-boundaries-and-contracts.md。
 */
import { captureContext, captureGesture, pressElement } from './capture.ts'
import { name } from './runtime.ts'
import type { ShortcutContext, ShortcutGesture } from '@deepseek-ai/dsh-client-shortcuts/client'
import type { Context } from '@deepseek-ai/cordis'
// 空导入：让 TS 加载本包对 `@deepseek-ai/cordis` 的模块增强，`ctx.sidebarRight` 由它声明。
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'

/** Cordis 增强声明的 Right-Sidebar 面：本桥只用 `isExpanded` 与 `toggleExpanded`。 */
type Sidebar = Context['sidebarRight']

/** 全屏呈现且已展开的右栏面板根节点：呈现方式与开合状态都落在这一个元素上。 */
const FULLSCREEN_PANEL_SELECTOR = '[data-sidebar-right-panel="fullscreen"][data-sidebar-right-open]'

/** 右栏会话根节点：面板自身与它内部的每个面板都带这个标记。 */
const SIDEBAR_SESSION_SELECTOR = '[data-sidebar-right-session]'

/**
 * 当前是否有一个全屏呈现且已展开的右栏面板。
 *
 * 两个标记读的是同一份布局状态：`data-sidebar-right-open` 只在展开时渲染，
 * `data-sidebar-right-panel="fullscreen"` 覆盖手动全屏与窄窗口下的自动全屏。
 * @returns 有这样一个面板时为 true；没有 document 时返回 false。
 */
export function fullscreenSidebarShown(): boolean {
  if (typeof document === 'undefined') return false
  return document.querySelector(FULLSCREEN_PANEL_SELECTOR) !== null
}

/**
 * 目标是否落在右侧栏自己的标记内（面板根或它里面的面板）。
 * @param target - 本次按键的目标元素。
 * @returns 落在右栏内时为 true。
 */
export function sidebarOwnsTarget(target: Element | null): boolean {
  if (target === null || typeof target.closest !== 'function') return false
  return target.closest(SIDEBAR_SESSION_SELECTOR) !== null
}

/**
 * 该按键能否关闭全屏的右侧边栏：裸 `Esc`、首次、未消费、无修饰键、无模态，且不在终端内、
 * 不在右栏自己的文本控件内（见模块头）。
 * @param gesture - 本次按键的物理事实。
 * @param context - 本次按键的归属上下文。
 * @returns 准入通过时为 true。
 */
export function fullscreenDismissEligible(gesture: ShortcutGesture, context: ShortcutContext): boolean {
  return gesture.code === 'Escape'
    && !gesture.repeat
    && !gesture.composing
    && !gesture.defaultPrevented
    && !gesture.control
    && !gesture.alt
    && !gesture.shift
    && !gesture.meta
    && context.modal === null
    && context.region !== 'terminal'
    && !(context.region === 'editable' && sidebarOwnsTarget(context.target))
}

/**
 * 一次按键是否由本桥接管：准入通过、服务面确认右栏仍在展开态、DOM 上确有一个全屏呈现的
 * 面板。服务面那一半防的是陈旧标记：两者不一致时不动作。
 * @param sidebar - 右栏面。
 * @param gesture - 本次按键的物理事实。
 * @param context - 本次按键的归属上下文。
 * @returns 由本桥接管时为 true。
 */
export function fullscreenDismissOwned(
  sidebar: Sidebar,
  gesture: ShortcutGesture,
  context: ShortcutContext,
): boolean {
  if (!fullscreenDismissEligible(gesture, context)) return false
  // 折叠态下 toggleExpanded() 的语义是展开：没有全屏面板可关时不碰它。
  if (!sidebar.isExpanded()) return false
  return fullscreenSidebarShown()
}

/**
 * 关掉全屏的右侧边栏：与面板自带的折叠按钮同一条动作。
 * @param sidebar - 右栏面。
 */
export function dismissFullscreenSidebar(sidebar: Sidebar): void {
  sidebar.toggleExpanded()
}

/**
 * 安装「全屏右栏按 `Esc` 关栏」桥：只挂 window 捕获阶段的 `keydown` 监听。
 *
 * 只跟 `sidebarRight` 服务：本桥不注册固定行，也不读快捷键目录，因此不需要快捷键服务。
 * 缺 `sidebarRight`（右栏插件没挂）时什么都不装；非 DOM 环境没有可挂的监听，也不登记 effect。
 * @param ctx - 客户端根上下文。
 */
export function installFullscreenDismissBridge(ctx: Context): void {
  ctx.inject(['sidebarRight'], (scope) => {
    if (typeof window === 'undefined') return
    const sidebar: Sidebar = scope.sidebarRight
    scope.effect(() => {
      const onKeydown = (event: KeyboardEvent): void => {
        if (event.type !== 'keydown') return
        const element = pressElement(event)
        if (!fullscreenDismissOwned(sidebar, captureGesture(event), captureContext(element))) return
        // 这一按到此为止：本地控件与固定通道（含两条停止序列）都不得再看到它。
        event.preventDefault()
        event.stopPropagation()
        dismissFullscreenSidebar(sidebar)
      }
      window.addEventListener('keydown', onKeydown, true)
      return () => window.removeEventListener('keydown', onKeydown, true)
    }, `${name}: fullscreen dismiss`)
  })
}
