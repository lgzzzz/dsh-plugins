/** 右栏呈现方式切换(⌘/Ctrl+S):与面板 chrome 的全屏按钮**同一入口**——会话级 store 的
 * `actions.setMode(sessionId, mode)`(dockkit `planSetMode` 的唯一写面),不碰 DOM、无降级。
 *
 * 按钮语义复刻(上游 `PanelChrome` 的 onClick):按钮点的是「**生效**呈现」,即
 * `fullscreen = autoFullscreen || layout.mode === 'fullscreen'`;因此
 * ① 生效全屏时 next = 'push';② 否则 next = 'fullscreen'。
 * 差别只有一处:窄窗(< 768px)上游 `autoFullscreen` 恒真、手动全屏不可达,按钮在切 push 前
 * 先 `setExpanded(sessionId, false)`(收起面板)——本动作照抄,否则窄窗按 ⌘/Ctrl+S 只会把
 * 手动 mode 写成 push 而面板仍被 autoFullscreen 留在全屏,表现为「按了没反应」。
 *
 * 面板已收起时仍照常写 mode:presentation 会丢弃失焦的 push 轨道
 * (`track = shown && !autoFullscreen`),下次展开即按新 mode 呈现。这是上游按钮语义的**超集**:
 * 收起态按钮虽在 DOM 中,却被上游 CSS(`visibility:hidden` + 平移出可视区)藏起来、点不到。
 *
 * 本动作**只切全屏**:一概不碰 diff 分栏(`toggledSplit` 归页头「左右对比」按钮与
 * `sidebarRight.diffSplit` 键位;「分栏持续跟随全屏」是 `dsh-rightbar-diff-split` 的职责)。
 */
import type { Services, SidebarRightDockMode, SidebarRightLayoutLike } from './types.ts'
import { resolveRightbarStore } from './rightbar-layout.ts'
import { currentSessionId } from './session-view.ts'

/** 上游 sidebar-right 的自动全屏断点(未导出常量,值取自其 `RightbarSeat` 的 `viewportWidth < 768`)。
 * 上游该值是框架测量的**框架元素**宽度(`window.innerWidth` 起量后被 AppFrame 的 ResizeObserver
 * 覆盖);本插件只消费 `sidebarRight` 服务与 rightbar store、拿不到那个框架 store,故取同步可读的
 * 窗口宽度。二者仅在框架宽度 ≠ 窗口宽度时分歧(文档滚动条 / 跨断点改窗后的 ≤1 帧滞后),
 * 此时连写出的 mode 都可能不同——见 README「已知限制」。 */
const AUTO_FULLSCREEN_WIDTH = 768

/** 视口是否窄于自动全屏断点(非浏览器环境 / 读不到宽度即 false)。 */
function isNarrowViewport(): boolean {
  const view = globalThis.window as { innerWidth?: unknown } | undefined
  const width = view?.innerWidth
  return typeof width === 'number' && width > 0 && width < AUTO_FULLSCREEN_WIDTH
}

/** 生效呈现是否全屏(autoFullscreen ∪ 手动 fullscreen;与上游面板内判定同式)。 */
function isEffectivelyFullscreen(layout: SidebarRightLayoutLike, narrow: boolean): boolean {
  return narrow || layout.mode === 'fullscreen'
}

/** 切换后的手动呈现方式:生效全屏 → push;否则 → fullscreen。 */
function nextRightbarMode(effectiveFullscreen: boolean): SidebarRightDockMode {
  return effectiveFullscreen ? 'push' : 'fullscreen'
}

/**
 * ⌘/Ctrl+S:切换右栏的 fullscreen(生效全屏 ⇄ 手动 push)。任一环不可用即 no-op 不吞键:
 * 无 `sidebarRight` 服务、该会话尚无 `rightbar.session` store 活实例或布局、活实例缺 `setMode`。
 * @param services - 插件解析后的服务集合。
 * @returns 是否已发出 `setMode`(吞键由分发器据此决定)。
 */
export function toggleRightSidebarFullscreen(services: Services): boolean {
  const sidebarRight = services.sidebarRight
  if (sidebarRight === null || sidebarRight === undefined) return false
  const sessionId = currentSessionId(services)
  if (sessionId === undefined) return false
  // 会话 id 显式下传:布局与活实例共用同一次解析目标(上游无「按会话取 store」的服务面)
  const resolved = resolveRightbarStore(services, sessionId)
  if (resolved === undefined) return false
  const layout = resolved.snapshot.bySession?.[sessionId]?.layout
  if (layout === undefined) return false
  const actions = resolved.instance.actions
  const setMode = actions?.setMode
  if (actions === undefined || typeof setMode !== 'function') return false

  const narrow = isNarrowViewport()
  const fullscreen = isEffectivelyFullscreen(layout, narrow)
  const nextMode = nextRightbarMode(fullscreen)
  // 窄窗退出全屏 = 收起面板(上游按钮的 autoFullscreen 分支),否则面板不真正退出全屏
  const setExpanded = actions.setExpanded
  const collapses = fullscreen && narrow && typeof setExpanded === 'function'
  try {
    if (collapses) (setExpanded as (sessionId: string, expanded: boolean) => void).call(actions, sessionId, false)
    setMode.call(actions, sessionId, nextMode)
    return true
  } catch {
    return false
  }
}
