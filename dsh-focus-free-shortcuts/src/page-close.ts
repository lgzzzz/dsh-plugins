/**
 * 页面键：`page.close`（关闭当前页面／窗口）。
 *
 * 内置 `page.close` 用 `sidebarRight.focusedTarget(element)` 解析归属，目标不在可见 dock
 * 面板内时返回 `blocked / command.noFocus`（提示「请先聚焦右侧面板」），所以在 Web 上用户
 * 必须先点一下右侧栏才能关掉当前页面。本模块改用固定输入观察者（每个 keydown 都早于可配置
 * 派发运行，可消费该按键），经 `sidebarRight.commandTarget(element)`（回退为当前 Session 的
 * 活动 dock 面板）解析同一归属，与面板键桥同一条机制，并只跟随生效的目录行（被重绑、禁用或
 * 不存在的内置命令不动）。
 *
 * 让位规则与内置命令逐条对齐：
 *   - 焦点已在可见面板内 → 让内置命令独占这一按；
 *   - 右侧栏折叠（`isExpanded()` 为假）→ 不动：折叠时没有「当前显示的页面」，内置的
 *     `focusedTarget` 同样解析不到 dock 面板（只有浮动面板在折叠时仍在画，而那种情形焦点
 *     本来就落在浮动面板内、由上一条让位）；
 *   - 焦点在侧栏容器内但不在面板内（陈旧标记）→ `commandTarget` 按官方语义返回 `undefined`，
 *     与内置的 `blocked / command.stale` 同向，都不动；
 *   - 模态弹窗打开 → 让位：`page.close` 声明了模态，内置派发会用它关掉最上面那层弹窗；
 *   - 目标页面不可关（`canCloseTarget` 为假）→ 不动、不消费，仍由内置命令收场。
 *
 * 只关页面，不关窗口：窗口那一半是 Desktop 的语义（`⌘W` 在 Desktop 上本来就免聚焦，
 * 未聚焦时走 `closeWindow()`），而 Desktop 的可配置绑定由原生键盘桥派发、本 DOM 观察者
 * 压不住，所以本桥只在 Web 安装。
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
// 该公开接口带有 `focusedTarget` / `commandTarget` / `canCloseTarget` / `closeTarget`，
// 且不在包的 `/client` 导出名单里。
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'

/** 右侧栏接口，取自 Cordis 模块增强声明的类型。 */
type Sidebar = Context['sidebarRight']

/** 本桥接跟踪的内置页面命令注册 id。 */
export const PAGE_CLOSE_COMMAND_ID = 'page.close'

/** 当前生效目录中的 `page.close` 是否恰好占用了这一按。 */
export function pageCloseFor(rows: readonly ShortcutCatalogEntry[], gesture: ShortcutGesture): boolean {
  if (gesture.secondCode !== undefined) return false
  const binding = enabledBinding(rows, PAGE_CLOSE_COMMAND_ID)
  return binding !== undefined && bindingMatches(binding, gesture)
}

/**
 * 安装关闭当前页面键的桥接。仅 Web 运行时：Desktop 上 `⌘W`（primary+W）本来就免聚焦
 * （未聚焦时关窗口），而可配置绑定由原生键盘桥派发，本 DOM 观察者无法抑制。
 */
export function installPageCloseBridge(ctx: Context): void {
  ctx.inject(['shortcuts', 'sidebarRight'], (scope) => {
    const shortcuts: Shortcuts = scope.shortcuts
    const sidebar: Sidebar = scope.sidebarRight
    if (shortcuts.runtime !== 'web') {
      warn('desktop runtime: the page close binding is dispatched by the native keyboard bridge, so the focus-free page close bridge is not installed here')
      return
    }
    if (typeof shortcuts.observeFixedInput !== 'function') {
      warn('shortcuts service exposes no observeFixedInput; page close bridge not installed')
      return
    }
    scope.effect(() => shortcuts.observeFixedInput((input) => {
      if (!isKeydown(input)) return
      handlePageCloseInput(shortcuts, sidebar, input)
    }), `${name}: page close key`)
  })
}

/** 用内置 `page.close` 处理一次固定通道的 keydown。 */
function handlePageCloseInput(shortcuts: Shortcuts, sidebar: Sidebar, input: KeydownInput): void {
  const gesture: ShortcutGesture = input.gesture
  const context = input.context
  if (gesture.composing || gesture.defaultPrevented) return
  // 模态下这一按归弹窗：`page.close` 声明了模态，内置派发会用它关掉最上面那层。
  if (context.modal !== null) return
  if (!pageCloseFor(shortcuts.catalog.getSnapshot(), gesture)) return
  const element = context.target ?? (typeof document === 'undefined' ? null : document.activeElement)
  // 面板已聚焦时由内置命令处理；插件再关一次会多关一页。
  if (sidebar.focusedTarget(element) !== undefined) return
  // 折叠时没有"当前显示的页面"；展开本身会把焦点交给活动面板，之后内置命令即可生效。
  if (!sidebar.isExpanded()) return
  // 陈旧侧栏标记（焦点在容器内但不在面板内）经 commandTarget 返回 undefined，与内置同向。
  const target = sidebar.commandTarget(element)
  if (target === undefined) return
  // 关不掉的页面（空面板 / 身份已变）不消费：内置命令会照原样收场，归属不回退。
  if (!sidebar.canCloseTarget(target)) return
  // 先消费再执行：否则内置命令会解析为 `command.noFocus` 并自行 preventDefault。
  input.consume()
  if (gesture.repeat) return
  sidebar.closeTarget(target)
}
