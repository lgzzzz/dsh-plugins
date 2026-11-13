/**
 * 右栏打开的呈现策略，以及「指定入口默认全屏」。
 *
 * 需求只有两条规则：
 *
 *   - **指定入口默认全屏**：改动卡片标题（打开「本地变更」）与 `⌘⌥Y`（打开「变更请求」）。
 *   - **其余任何打开都非全屏**：改动卡片的文件行、中间过程里的文件 / 资源链接、上下文菜单
 *     打开文件、工具栏 / 其它插件发起的打开，都先把右栏从 `fullscreen` 拉回 `push` 再打开。
 *
 * 实现方式不是拦点击或猜手势，而是在安装时给右栏面的四个打开入口（`openResource` /
 * `openTab` / `openResourceIn` / `openTabIn`）各包一层：**先按原逻辑打开，若打开前面板是
 * 全屏，打开后再切回推挤**。打开成功时右栏一定已经展开，`toggleFullscreen` 才能生效；
 * 先打开再切换也避开了「折叠状态下无法切呈现方式」的上游限制。
 *
 * 指定入口仍然在打开之后自己调 `presentFullscreen`，所以它们会经历「打开 → 回推挤 →
 * 切全屏」两步；两步合并在同一个事件任务里，React 只提交最终的全屏布局，用户看不到
 * 中间态。这样不需要在插件之间传递「这次打开要不要全屏」的意图，`⌘⌥Y` 留在
 * `dsh-keyboard-shortcuts` 里也照样工作。
 *
 * 不干预的情况：
 *
 *   - 窄窗口（< 768px）的自动全屏：此时推挤呈现也被上游画成全屏，切 `push` 反而会把右栏收起来；
 *   - 打开落在浮动面板（`destination: 'float'`）：打开的是一块浮层，不改变停靠栏的呈现方式；
 *   - 面板还没画出来、读不到 `data-sidebar-right-panel`、没有全屏命令、目标已陈旧。
 *
 * 呈现方式只读 DOM 的 `data-sidebar-right-panel`，不直接写 store；切回推挤仍走公开的
 * `toggleFullscreen(target)`。上游锚点与边界见 docs/dsh-changes-behavior.md。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { DocumentLike } from './dom.ts'

/** 右栏面板根的呈现方式属性：`push`（推挤）或 `fullscreen`（全屏，含窄窗口自动全屏）。 */
export const PANEL_ATTRIBUTE = 'data-sidebar-right-panel'

/** 面板所属会话的属性；只读当前会话的那块面板。 */
export const PANEL_SESSION_ATTRIBUTE = 'data-sidebar-right-session'

/** 推挤呈现：右栏占一列，不是全屏。 */
export const PUSH_MODE = 'push'

/** 全屏呈现。 */
export const FULLSCREEN_MODE = 'fullscreen'

/** 窄于此宽度的窗口里，上游把展开的右栏自动画成全屏；此时不尝试切回推挤。 */
export const AUTO_FULLSCREEN_WIDTH = 768

/** 文档根元素上的生效标记：打开策略装上时写入，卸载时移除。 */
export const MARKER_ATTRIBUTE = 'data-dsh-changes-behavior-open'

/** 右栏的呈现方式：面板根 `data-sidebar-right-panel` 的两个公开取值。 */
export type PanelMode = 'push' | 'fullscreen'

/** 用来确认「刚打开的活动页确实是这一页」的最小形状；`contentId` 可省略。 */
export interface ExpectedTab {
  readonly kind?: string
  readonly contentId?: string
}

/**
 * 指定入口的「本次打开要全屏」意图。
 *
 * 包装层看到意图时跳过「切回推挤」，于是原来的 `presentFullscreen` 仍按 DOM 现值工作：
 * 原本 push 就切成全屏，原本已全屏就保持。意图只在同一个同步任务内有效，`finally` 里
 * 一定还原，不会泄漏到下一次打开。
 */
let fullscreenIntent = 0

/** 当前是否有指定入口正在打开（包装层据此跳过非全屏策略）。 */
export function hasFullscreenIntent(): boolean {
  return fullscreenIntent > 0
}

/**
 * 在「本次打开要全屏」的意图下执行一次打开。
 * @param open - 真正调用右栏打开入口的同步函数。
 * @returns 打开函数的返回值。
 */
export function withFullscreenIntent<T>(open: () => T): T {
  fullscreenIntent += 1
  try {
    return open()
  } finally {
    fullscreenIntent -= 1
  }
}

/** 右栏导航服务：上游 `SidebarRightController`（`ctx.sidebarRight`）。 */
type Sidebar = Context['sidebarRight']

/** 运行期可注入项（测试接缝）：上游没有对应类型，测试用它替换告警输出。 */
export interface PresentationRuntime {
  /** 输出一条带插件前缀的诊断。 */
  readonly warn?: (message: string) => void
}

/** 默认告警：统一加插件前缀。 */
function defaultWarn(message: string): void {
  console.warn(`[dsh-changes-behavior] ${message}`)
}

/** 提取错误消息，避免把 `unknown` 直接拼进诊断。 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 读当前会话的右栏呈现方式。
 *
 * 面板根的 `[data-sidebar-right-panel]` 是布局状态的公开读数（`push` / `fullscreen`）；
 * 其它会话的视图仍留在 DOM 里（带 `hidden`），先排除掉，否则会把别的会话的全屏当成自己的。
 * @param doc - 目标文档。
 * @param sessionId - 当前屏幕上的会话。
 * @returns 呈现方式；面板还没画出、读不到属性或没有文档查询能力时为 undefined。
 */
export function panelMode(doc: DocumentLike, sessionId: string): PanelMode | undefined {
  const panels = doc.querySelectorAll?.(`[${PANEL_ATTRIBUTE}]`)
  if (panels === undefined) return undefined
  for (let index = 0; index < panels.length; index += 1) {
    const panel = panels[index]
    if (panel === undefined) continue
    if (panel.getAttribute?.(PANEL_SESSION_ATTRIBUTE) !== sessionId) continue
    if (panel.closest?.('[hidden]') != null) continue
    const mode = panel.getAttribute?.(PANEL_ATTRIBUTE)
    if (mode === PUSH_MODE) return 'push'
    if (mode === FULLSCREEN_MODE) return 'fullscreen'
  }
  return undefined
}

/** 读视口宽度；文档没有 window / 宽度时返回 undefined（按宽窗口处理）。 */
function viewportWidth(doc: DocumentLike): number | undefined {
  const view = doc.defaultView as { readonly innerWidth?: unknown } | null | undefined
  return typeof view?.innerWidth === 'number' ? view.innerWidth : undefined
}

/** 当前是不是窄窗口的自动全屏：此时上游本来就会把推挤画成全屏，不应再切。 */
export function isAutoFullscreen(doc: DocumentLike): boolean {
  const width = viewportWidth(doc)
  return width !== undefined && width < AUTO_FULLSCREEN_WIDTH
}

/**
 * 把刚打开的「本地变更」切成全屏。
 *
 * 只从 `push` 切到 `fullscreen`：已经全屏（含窄窗口自动全屏）时再 `toggleFullscreen()`
 * 会把它切回推挤，窄窗口下甚至会把右栏收起来，所以先读面板现值。
 * @param sidebar - 右栏面。
 * @param doc - 目标文档。
 * @param sessionId - 当前屏幕上的会话。
 * @param claim - 刚打开那一页的认领结果；用来确认活动页确实是它。
 * @returns 是否执行了切换。
 */
export function presentFullscreen(
  sidebar: Sidebar,
  doc: DocumentLike,
  sessionId: string,
  claim: ExpectedTab | undefined,
): boolean {
  const toggle = sidebar.toggleFullscreen
  if (typeof toggle !== 'function') return false
  if (sidebar.isExpanded?.() === false) return false
  const current = sidebar.active?.()
  if (current === undefined) return false
  if (claim?.kind !== undefined && current.kind !== claim.kind) return false
  if (claim?.contentId !== undefined && current.contentId !== claim.contentId) return false
  if (panelMode(doc, sessionId) !== PUSH_MODE) return false
  const target = sidebar.commandTarget?.(null)
  if (target === undefined || target === null) return false
  if (sidebar.isTargetCurrent?.(target) === false) return false
  toggle.call(sidebar, target)
  return true
}

/**
 * 把右栏从全屏切回推挤。打开成功后调用；已经推挤、读不到现值、窄窗口自动全屏、
 * 面板已折叠或目标陈旧时都不动作。
 * @param sidebar - 右栏面。
 * @param doc - 目标文档。
 * @param sessionId - 本次打开所属的会话。
 * @returns 是否执行了切换。
 */
export function presentPush(sidebar: Sidebar, doc: DocumentLike, sessionId: string): boolean {
  const toggle = sidebar.toggleFullscreen
  if (typeof toggle !== 'function') return false
  if (sidebar.isExpanded?.() === false) return false
  if (panelMode(doc, sessionId) !== FULLSCREEN_MODE) return false
  if (isAutoFullscreen(doc)) return false
  const target = sidebar.commandTarget?.(null)
  if (target === undefined || target === null) return false
  if (sidebar.isTargetCurrent?.(target) === false) return false
  toggle.call(sidebar, target)
  return true
}

/** 打开入口在右栏面上的最小形状：四个打开方法与切屏读数。 */
interface WrappableSidebar {
  readonly mounted?: { getSnapshot(): string | undefined }
  openResource?: (...args: unknown[]) => unknown
  openTab?: (...args: unknown[]) => unknown
  openResourceIn?: (...args: unknown[]) => unknown
  openTabIn?: (...args: unknown[]) => unknown
}

/** 一次包层安装的记录，用于卸载时按相反顺序还原。 */
interface WrappedOpen {
  readonly name: keyof WrappableSidebar
  readonly original: (...args: unknown[]) => unknown
  readonly wrapper: (...args: unknown[]) => unknown
  /** 原方法是不是实例自身属性：不是则卸载时删除包层，露出原型方法。 */
  readonly own: boolean
}

/** 打开选项里本模块关心的字段。 */
interface OpenOptions {
  readonly destination?: string
}

/**
 * 给右栏的四个打开入口装上「除指定入口外都非全屏」的包层。
 *
 * @param sidebar - 右栏面。
 * @param doc - 目标文档。
 * @param runtime - 测试可注入的告警输出。
 * @returns 卸载函数：按相反顺序还原，只还原仍然指向本包层的方法。
 */
export function installOpenPolicy(
  sidebar: Sidebar,
  doc: DocumentLike,
  runtime: PresentationRuntime = {},
): () => void {
  const warn = runtime.warn ?? defaultWarn
  const target = sidebar as unknown as WrappableSidebar
  const wrapped: WrappedOpen[] = []

  /**
   * 包一个打开入口。
   * @param name - 方法名。
   * @param sessionArg - 会话来源：`'mounted'` 从服务读，数字表示第几个参数。
   * @param optionsArg - 打开选项在参数里的下标。
   */
  const wrap = (name: keyof WrappableSidebar, sessionArg: 'mounted' | number, optionsArg: number): void => {
    const original = target[name]
    if (typeof original !== 'function') return
    const own = Object.prototype.hasOwnProperty.call(target, name)
    const wrapper = function opened(this: unknown, ...args: unknown[]): unknown {
      const sessionId = sessionArg === 'mounted'
        ? target.mounted?.getSnapshot()
        : args[sessionArg]
      if (typeof sessionId !== 'string') return original.apply(this, args)
      const options = args[optionsArg] as OpenOptions | undefined
      const result = original.apply(this, args)
      if (options?.destination !== 'float' && !hasFullscreenIntent()) {
        try {
          presentPush(sidebar, doc, sessionId)
        } catch (error) {
          warn(`present push failed: ${messageOf(error)}`)
        }
      }
      return result
    }
    ;(target as Record<string, unknown>)[name] = wrapper
    wrapped.push({ name, original, wrapper, own })
  }

  // 公开的导航入口：会话取自 mounted，选项在第 2 个参数。
  wrap('openResource', 'mounted', 1)
  wrap('openTab', 'mounted', 1)
  // Tab 自己的动作 / 上下文菜单用的按会话入口：会话是第 1 个参数，选项在最后。
  wrap('openResourceIn', 0, 2)
  wrap('openTabIn', 0, 2)

  doc.documentElement?.setAttribute(MARKER_ATTRIBUTE, '')

  return () => {
    for (let index = wrapped.length - 1; index >= 0; index -= 1) {
      const item = wrapped[index]
      if (item === undefined) continue
      if ((target as Record<string, unknown>)[item.name] !== item.wrapper) continue
      if (item.own) (target as Record<string, unknown>)[item.name] = item.original
      else delete (target as Record<string, unknown>)[item.name]
    }
    wrapped.length = 0
    doc.documentElement?.removeAttribute(MARKER_ATTRIBUTE)
  }
}
