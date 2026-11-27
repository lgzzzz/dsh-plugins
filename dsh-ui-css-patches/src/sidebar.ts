/**
 * 左栏「只能因宽度不够自动收起」的手动开关守卫。
 *
 * 左栏是否收起由 `AppFrame` 的渲染条件决定:
 *   - `viewport < SIDEBAR_AUTO_COLLAPSE(1024)` 时看 `layoutInfo.narrowExpanded`,默认 false ——
 *     窗口变窄时自动收起;
 *   - 宽窗口看 `layoutInfo.sidebar === 0`,只有 `toggleSidebar` 会把它写成 0。
 *
 * 手动收起只有一条写入路径:`toggleSidebar`(收起按钮、`sidebar.left.toggle` 命令、抽屉遮罩与
 * Esc 关闭都落到它)。这里把 `ctx.layout` 实例上的 `toggleSidebar` 与它内部 `panels` 动作表上的
 * 同名动作都包一层:当前左栏已收起时才放行(这一按只会展开),已展开时吞掉。于是:
 *   - 宽窗口左栏永远展开,不再能被按钮 / 快捷键 / 遮罩收起;
 *   - 窄窗口由 `setViewportWidth` 的断点穿越自动收起,收起后仍可手动展开;
 *   - 抽屉模式(<768)打开后也不能手动关掉,只能通过选择全局面板 / 工作区(`selectPanel`
 *     在窄窗口清掉 `narrowExpanded`)或把窗口缩到断点另一侧退出。
 *
 * 收起状态读的是帧上的 `data-sidebar-collapsed`(上游只在 `sidebarCollapsed` 时输出),不碰
 * React 内部。动作表是 `LayoutController` 的私有字段,运行期是普通属性;字段缺席时只包控制器
 * 方法,按钮与快捷键仍被拦住,只有直接调动作表的遮罩 / Esc 会漏过。
 *
 * 卸载时把两个方法还原;`ctx.inject(['layout'])` 在布局服务被替换后会重新执行本守卫。
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'

/** 帧上的左栏收起标记;只在左栏收起时输出。 */
export const LEFT_SIDEBAR_COLLAPSED_ATTRIBUTE = 'data-sidebar-collapsed'

/** 与 {@link LEFT_SIDEBAR_COLLAPSED_ATTRIBUTE} 对应的选择器。 */
export const LEFT_SIDEBAR_COLLAPSED_SELECTOR = `[${LEFT_SIDEBAR_COLLAPSED_ATTRIBUTE}]`

/** 左栏收起按钮的锚点;展开态由本插件用 CSS 隐藏。 */
export const LEFT_SIDEBAR_TOGGLE_SELECTOR = '[data-sidebar-toggle]'

/** 守卫只需要 `querySelector`;真实 `Document` 与测试替身都满足。 */
export interface SidebarStateDocument {
  querySelector(selector: string): Element | null
}

/** 一个带 `toggleSidebar` 的对象:布局控制器、或它的面板动作表。 */
export interface ToggleOwner {
  toggleSidebar?: () => void
}

/** `LayoutController` 运行期字段:根 store 的已绑定动作表。 */
interface LayoutPanels {
  toggleSidebar?: () => void
}

/** 读取控制器私有 `panels` 字段的最小结构。 */
interface LayoutWithPanels {
  readonly panels?: LayoutPanels
}

/**
 * 左栏此刻是否收起。
 * @param doc - 拥有 AppFrame 的文档(测试可传替身)。
 * @returns 帧上带 `data-sidebar-collapsed` 时为 true。
 */
export function isLeftSidebarCollapsed(doc: SidebarStateDocument): boolean {
  return doc.querySelector(LEFT_SIDEBAR_COLLAPSED_SELECTOR) !== null
}

/**
 * 把「收起」从 `toggleSidebar` 里拿掉:已展开时调用是空操作,已收起时原样放行(展开)。
 * @param layout - `ctx.layout` 控制器。
 * @param doc - 用来读收起状态的文档。
 * @returns 还原两个方法的清理函数。
 */
export function installSidebarGuard(layout: ToggleOwner, doc: SidebarStateDocument): () => void {
  const restores: Array<() => void> = []
  const patch = (owner: ToggleOwner | undefined): void => {
    const original = owner?.toggleSidebar
    if (owner === undefined || typeof original !== 'function') return
    owner.toggleSidebar = function guardedToggleSidebar(this: unknown) {
      // 已展开:这一按会写成 sidebar = 0 或 narrowExpanded = false,一律吞掉。
      if (!isLeftSidebarCollapsed(doc)) return
      return original.call(this)
    }
    restores.push(() => {
      owner.toggleSidebar = original
    })
  }
  patch(layout)
  // 抽屉遮罩、模态层 Esc 绕过控制器直接调动作表;动作表也包一层。
  patch((layout as LayoutWithPanels).panels)
  return () => {
    for (const restore of restores.reverse()) restore()
    restores.length = 0
  }
}

/**
 * 把守卫挂到布局服务上。
 * @param ctx - 浏览器插件 Context。
 * @param doc - 拥有 AppFrame 的文档。
 */
export function installLeftSidebarPin(ctx: Context, doc: SidebarStateDocument): void {
  ctx.inject(['layout'], (scope) => {
    scope.effect(() => installSidebarGuard(scope.layout, doc), 'left sidebar guard')
  })
}
