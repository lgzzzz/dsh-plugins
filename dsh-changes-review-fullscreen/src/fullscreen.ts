/**
 * 改动文件卡片点击后的右栏呈现：打开 `changes-review` 标签页时顺带切到全屏。
 *
 * 上游 `@deepseek-ai/dsh-client-ui-deliverables` 把每个完成轮次的改动文件渲染成一张
 * 卡片（`[data-changed-files]`）。卡片标题与每个文件行都是按钮，点击时调用
 * `sidebarRight.openResource()` 打开（或聚焦）那一轮的改动审查标签页（kind
 * `changes-review`），落在右栏的活动 dock 面板；面板的呈现方式（push / fullscreen）
 * 由布局状态 `mode` 决定，唯一公开的写入口是 `sidebarRight.toggleFullscreen(target)`。
 *
 * 本模块在 `document` 捕获阶段接住这些点击，等 React 的 `onClick` 把标签页打开、
 * 面板展开之后，再对活动 dock 面板调用同一个 `toggleFullscreen()`：
 *
 *   - **只在本来不是全屏时切**：面板根上的 `[data-sidebar-right-panel]` 是呈现方式的
 *     DOM 读数（`push` / `fullscreen`，后者也覆盖窄窗口的自动全屏）。已经是 `fullscreen`
 *     时不动作，否则会把用户刚打开的全屏又切回去；窄窗口下 `toggleFullscreen()` 的语义
 *     是折叠，跳过它才不会把右栏收起来。
 *   - **只处理打开审查页的按钮**：卡片里还有一个「展开全部文件」的折叠按钮（带
 *     `aria-expanded`），点它不打开标签页；跳过它，避免顺手把当前标签页切成全屏。
 *   - **延后到微任务**：本监听在捕获阶段先于 React 的根监听，点击处理器要等事件派发
 *     结束才把标签页放进 store；微任务读到的 `active()` 与面板状态才是打开后的。
 *   - **失败收敛为不动作**：没有右栏服务、没有面板、活动标签页不是审查页、目标不是
 *     当前 dock 面板，都直接返回，不改其它标签页、不报错。
 *
 * 上游锚点、边界与验证方式见 docs/dsh-changes-review-fullscreen.md。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { SidebarRightTarget } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
// 空导入：加载右栏包对 `@deepseek-ai/cordis` 的模块增强（`ctx.sidebarRight`）。
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'

/** 插件 id：诊断与 DOM 标记都用它。 */
export const name = 'dsh-changes-review-fullscreen'

/** 改动文件卡片根元素；只有这张卡片用它。 */
export const CARD_SELECTOR = '[data-changed-files]'

/** 上游 `changes-review` 标签页的 kind：本插件只给这一种标签页切全屏。 */
export const REVIEW_KIND = 'changes-review'

/** 右栏面板根上的呈现方式标记。 */
export const PANEL_ATTRIBUTE = 'data-sidebar-right-panel'

/** 右栏处于推挤呈现（非全屏）。 */
export const PUSH_PANEL_SELECTOR = `[${PANEL_ATTRIBUTE}="push"]`

/** 右栏处于全屏呈现；窄窗口的自动全屏也带这个值。 */
export const FULLSCREEN_PANEL_SELECTOR = `[${PANEL_ATTRIBUTE}="fullscreen"]`

/** 当前画在屏幕上的那个会话视图：不活跃的会话视图带 `hidden`，但它们的 tab 仍可能保留。 */
export const ACTIVE_VIEW_SELECTOR = '[data-sidebar-right-session]:not([hidden])'

/** 当前会话视图里的 push 面板。 */
const ACTIVE_PUSH_PANEL_SELECTOR = `${ACTIVE_VIEW_SELECTOR} ${PUSH_PANEL_SELECTOR}`

/** 当前会话视图里的全屏面板。 */
const ACTIVE_FULLSCREEN_PANEL_SELECTOR = `${ACTIVE_VIEW_SELECTOR} ${FULLSCREEN_PANEL_SELECTOR}`

/** 文档根元素上的生效标记：装上时写入，卸载时移除。 */
export const MARKER_ATTRIBUTE = 'data-dsh-changes-review-fullscreen'

/** 本插件用到的右栏面：活动标签页、目标解析与全屏切换。 */
export type Sidebar = Context['sidebarRight']

/** 可被 `closest` / 属性读取的最小元素形状（生产环境是 `Element`）。 */
export interface ElementLike {
  readonly disabled?: boolean
  closest?(selector: string): ElementLike | null
  hasAttribute?(attribute: string): boolean
  getAttribute?(attribute: string): string | null
}

/** 可打标记的文档根元素。 */
export interface MarkedElement {
  setAttribute(name: string, value: string): void
  removeAttribute(name: string): void
}

/** 本插件需要的文档能力；只用到捕获监听、根标记与选择查询，便于测试替身。 */
export interface DocumentLike {
  readonly documentElement?: MarkedElement | null
  addEventListener(type: string, listener: (event: Event) => void, capture: boolean): void
  removeEventListener(type: string, listener: (event: Event) => void, capture: boolean): void
  querySelector(selector: string): ElementLike | null
}

/** 运行期可注入项：测试替换调度器，生产用微任务。 */
export interface FullscreenRuntime {
  /** 安排一次「打开已提交之后」的动作。 */
  readonly schedule?: (callback: () => void) => void
}

/** 鸭子类型判定「可 `closest` 的节点」，与仓库内其它捕获层同一手法。 */
function hasClosest(value: unknown): value is ElementLike {
  return typeof value === 'object'
    && value !== null
    && 'closest' in value
    && typeof (value as { closest?: unknown }).closest === 'function'
}

/**
 * 事件路径上的第一个元素；没有可用路径时退回 `event.target`。
 * @param event - 一次 click 事件。
 * @returns 点击目标元素，取不到则返回 null。
 */
export function clickElement(event: Event): ElementLike | null {
  const path = typeof event.composedPath === 'function' ? event.composedPath() : []
  for (const value of path) {
    if (hasClosest(value)) return value
  }
  return hasClosest(event.target) ? event.target : null
}

/**
 * 该点击是否来自改动文件卡片里「打开审查页」的按钮。
 *
 * 卡片里只有两类按钮：标题 / 文件行（打开审查页）与「展开全部文件」的折叠按钮
 * （带 `aria-expanded`，只改列表高度）。后者返回 null；卡片外的点击同样返回 null。
 * @param target - 点击目标元素。
 * @returns 打开审查页的按钮，或 null。
 */
export function reviewOpenButton(target: ElementLike | null): ElementLike | null {
  if (target === null || typeof target.closest !== 'function') return null
  const button = target.closest('button')
  if (button === null) return null
  if (button.closest?.(CARD_SELECTOR) === null || button.closest?.(CARD_SELECTOR) === undefined) return null
  if (button.hasAttribute?.('aria-expanded') === true) return null
  if (button.disabled === true) return null
  if (button.getAttribute?.('aria-disabled') === 'true') return null
  return button
}

/**
 * 右栏当前的呈现方式。
 * @param doc - 目标文档。
 * @returns `fullscreen`、`push`，或还没有面板标记时的 undefined。
 */
export function panelMode(doc: DocumentLike): 'fullscreen' | 'push' | undefined {
  // 先读当前会话视图：不活跃会话的视图仍留在 DOM 里（hidden），它们的呈现方式属于
  // 另一个会话，不能拿来判断现在这块面板。只有找不到视图根时才退回整页读数。
  if (doc.querySelector(ACTIVE_FULLSCREEN_PANEL_SELECTOR) !== null) return 'fullscreen'
  if (doc.querySelector(ACTIVE_PUSH_PANEL_SELECTOR) !== null) return 'push'
  if (doc.querySelector(FULLSCREEN_PANEL_SELECTOR) !== null) return 'fullscreen'
  if (doc.querySelector(PUSH_PANEL_SELECTOR) !== null) return 'push'
  return undefined
}

/**
 * 打开审查页之后把它所在的右栏切到全屏。
 *
 * 只在「当前是 push 呈现」且「活动标签页确实是 changes-review」时动作：
 * 前者避免把已有 / 自动全屏切回 push，后者保证点击的是打开审查页的卡片按钮。
 * @param sidebar - 右栏面。
 * @param doc - 目标文档，用于读取呈现方式。
 * @returns 是否执行了切换。
 */
export function fullscreenReviewAfterOpen(sidebar: Sidebar, doc: DocumentLike): boolean {
  if (panelMode(doc) !== 'push') return false
  if (!sidebar.isExpanded()) return false
  const active = sidebar.active()
  if (active?.kind !== REVIEW_KIND) return false
  const target: SidebarRightTarget | undefined = sidebar.commandTarget(null)
  if (target === undefined || target.host !== 'dock') return false
  if (!sidebar.isTargetCurrent(target)) return false
  sidebar.toggleFullscreen(target)
  return true
}

/** 默认调度器：微任务在本次点击的事件派发（含 React 的 onClick）之后、绘制之前运行。 */
function defaultSchedule(callback: () => void): void {
  if (typeof queueMicrotask === 'function') queueMicrotask(callback)
  else setTimeout(callback, 0)
}

/**
 * 安装「点击改动文件卡片后默认全屏打开审查页」的捕获监听，并在文档根上留一个标记。
 * @param sidebar - 右栏面。
 * @param runtime - 可注入的调度器；默认微任务。
 * @param doc - 目标文档；没有文档（非浏览器环境）时为空操作。
 * @returns 卸载函数，移除监听与标记。
 */
export function installChangesReviewFullscreen(
  sidebar: Sidebar,
  runtime: FullscreenRuntime = {},
  doc: DocumentLike | undefined = typeof document === 'undefined'
    ? undefined
    : document as unknown as DocumentLike,
): () => void {
  if (doc === undefined) return () => {}
  const schedule = runtime.schedule ?? defaultSchedule
  let scheduled = false
  const onClick = (event: Event): void => {
    if (scheduled) return
    if (reviewOpenButton(clickElement(event)) === null) return
    scheduled = true
    schedule(() => {
      scheduled = false
      try {
        fullscreenReviewAfterOpen(sidebar, doc)
      } catch {
        // 右栏服务在点击与微任务之间卸载：这次点击收敛为不动作，不影响页面。
      }
    })
  }
  doc.addEventListener('click', onClick, true)
  doc.documentElement?.setAttribute(MARKER_ATTRIBUTE, '')

  return () => {
    doc.removeEventListener('click', onClick, true)
    doc.documentElement?.removeAttribute(MARKER_ATTRIBUTE)
  }
}
