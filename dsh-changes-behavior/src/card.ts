/**
 * 改动文件卡片的点击改写：标题 → 本地变更。
 *
 * 上游 `@deepseek-ai/dsh-client-ui-deliverables` 把每个完成轮次的改动渲染成一张卡片
 * （`[data-changed-files]`）：
 *
 *   - 多文件卡片的标题按钮调用 `openReview(0)`，打开本轮审查标签页并定位到第 1 个文件；
 *   - 每个文件行调用 `openReview(index)`，打开同一标签页并定位到该文件；
 *   - 「展开全部文件」按钮带 `aria-expanded`，只改列表高度；
 *   - 单文件卡片没有列表，标题就是那唯一一行。
 *
 * 本插件在 `document` 捕获阶段（React 18 的合成事件监听挂在应用根容器上，捕获早于它）：
 *
 *   1. **左键点标题**（卡片内、不在 `li` 里、不带 `aria-expanded` 的按钮）→ 调用
 *      `sidebarRight.openResource('dsh-resource://forge-changes/<session>/local')` 打开
 *      「本地变更」标签页，右栏原本是推挤呈现时再 `toggleFullscreen()` 切成全屏，
 *      最后 `stopPropagation()` 阻止上游打开本轮审查页；
 *   2. **左键点文件行**（`li` 里的按钮）→ 不处理，保持上游的「本轮文件 diff」。
 *
 * 标题点击不区分修饰键：`⌘` / `Ctrl` / `Alt` / `Shift` + 左键与普通左键一样打开本地变更。
 * 卡片标题与文件行上的右键不接管，保留浏览器原生菜单。
 *
 * 全屏只在「刚打开 / 聚焦的确实是本地变更」且右栏当前是 `push` 时切：已经全屏（含窄窗口
 * 自动全屏）、面板还没画出来、活动页不是那一页、右栏面没有全屏命令，都保持现状。
 *
 * 失败一律收敛为「不动作」：右栏不在、本地变更类型没注册、地址无法认领、拿不到会话，
 * 都把这次手势留给上游 / 浏览器。只有确认能打开时才 `stopPropagation()`，不会吞掉点击；
 * 切全屏失败不影响已经完成的打开。
 *
 * 上游锚点、边界与验证方式见 docs/dsh-changes-behavior.md。
 */
import type { Context } from '@deepseek-ai/cordis'
// 空导入：加载上游客户端包对 `@deepseek-ai/cordis` 的模块增强
// （`ctx.sidebarRight` / `ctx.sidebarRightTabs`）。
import type { SidebarRightTabClaim } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { clickElement, type DocumentLike, type ElementLike, type EventLike } from './dom.ts'
import { presentFullscreen, withFullscreenIntent } from './presentation.ts'

/** 插件 id：诊断前缀与标记都用它。 */
export const name = 'dsh-changes-behavior'

/** 改动文件卡片根元素；只有这张卡片用它。 */
export const CARD_SELECTOR = '[data-changed-files]'

/** 卡片里「展开全部文件」折叠按钮的标记；它不是「标题」，必须跳过。 */
export const TOGGLE_ATTRIBUTE = 'aria-expanded'

/** 文件行的容器标签：卡片用 `<li>` 包住每一行，标题不在其中。 */
export const ROW_TAG = 'li'

/** 文档根元素上的生效标记：装上时写入，卸载时移除。 */
export const MARKER_ATTRIBUTE = 'data-dsh-changes-behavior-card'

/** 「本地变更」标签页地址前缀；后面依次是组件编码的会话 id 与 `/local`。 */
export const LOCAL_CHANGES_PREFIX = 'dsh-resource://forge-changes/'

/** 「本地变更」标签页地址的固定尾段。 */
export const LOCAL_CHANGES_SOURCE = 'local'

/** 右栏导航服务：上游 `SidebarRightController`（`ctx.sidebarRight`）。 */
type Sidebar = Context['sidebarRight']

/** 右栏标签类型注册表：上游 `SidebarRightTabRegistry`（`ctx.sidebarRightTabs`）。 */
type TabRegistry = Context['sidebarRightTabs']

/** 运行期可注入项（测试接缝）：上游没有对应类型，测试用它替换告警输出。 */
export interface Runtime {
  /** 输出一条带插件前缀的诊断。 */
  readonly warn?: (message: string) => void
}

/** 默认告警：统一加插件前缀。 */
function defaultWarn(message: string): void {
  console.warn(`[${name}] ${message}`)
}

/**
 * 读一个可选服务；服务缺席或尚未挂载时返回 undefined。
 * @param ctx - 当前 fiber 的 Context。
 * @param key - 服务名。
 * @returns 服务实例或 undefined。
 */
export function serviceOf<T>(ctx: Context, key: string): T | undefined {
  if (typeof ctx.get !== 'function') return undefined
  const value = ctx.get(key)
  return value === undefined || value === null ? undefined : value as T
}

/**
 * 「本地变更」标签页的资源地址。
 * @param sessionId - 右栏当前会话。
 * @returns `dsh-resource://forge-changes/<sessionId>/local`。
 */
export function localChangesAddress(sessionId: string): string {
  return `${LOCAL_CHANGES_PREFIX}${encodeURIComponent(sessionId)}/${LOCAL_CHANGES_SOURCE}`
}

/**
 * 该元素是不是卡片的**标题**按钮。
 *
 * 标题是卡片里唯一不在 `<li>` 中、也不带 `aria-expanded` 的按钮（多文件卡片与单文件卡片都是）；
 * 文件行在 `<li>` 里，折叠按钮带 `aria-expanded`，两者都返回 null。
 * @param target - 事件目标元素。
 * @returns 标题按钮，或 null。
 */
export function headerButton(target: ElementLike | null): ElementLike | null {
  if (target === null || typeof target.closest !== 'function') return null
  const button = target.closest('button')
  if (button === null) return null
  if (button.closest?.(CARD_SELECTOR) == null) return null
  if (button.hasAttribute?.(TOGGLE_ATTRIBUTE) === true) return null
  if (button.closest?.(ROW_TAG) != null) return null
  return button
}

/**
 * 安装标题点击改写，并在文档根上留一个标记。
 *
 * 依赖在事件发生时才读（`ctx.get`），所以右栏服务比本插件晚挂载也能用；
 * 右栏服务缺席时本插件整体不动作。
 * @param ctx - 浏览器 Context（或其注入子作用域）。
 * @param runtime - 可注入的告警输出。
 * @param doc - 目标文档；没有文档（非浏览器环境）时为空操作。
 * @returns 卸载函数：移除监听与标记。
 */
export function installCardBehavior(
  ctx: Context,
  runtime: Runtime = {},
  doc: DocumentLike | undefined = typeof document === 'undefined'
    ? undefined
    : document as unknown as DocumentLike,
): () => void {
  if (doc === undefined) return () => {}
  const warn = runtime.warn ?? defaultWarn

  /**
   * 标题被左键点了：打开「本地变更」，右栏原本是推挤呈现时再切成全屏。
   * @returns 是否已接管这次点击（接管后调用方才会阻止冒泡）。
   */
  const openLocalChanges = (): boolean => {
    const sidebar = serviceOf<Sidebar>(ctx, 'sidebarRight')
    if (sidebar === undefined) return false
    const sessionId = sidebar.mounted.getSnapshot()
    if (sessionId === undefined) return false
    const address = localChangesAddress(sessionId)
    const tabs = serviceOf<TabRegistry>(ctx, 'sidebarRightTabs')
    if (tabs === undefined) return false
    let claim: SidebarRightTabClaim | undefined
    try {
      claim = tabs.claim(address)
    } catch {
      // 没有注册「本地变更」类型（forge bundle 未挂载）：这次点击留给上游，仍打开本轮审查页。
      return false
    }
    try {
      withFullscreenIntent(() => sidebar.openResource(address))
    } catch (error) {
      // 右栏在点击与调用之间卸载等情形：这次点击留给上游，不吞点击。
      warn(`open local changes failed: ${messageOf(error)}`)
      return false
    }
    try {
      presentFullscreen(sidebar, doc, sessionId, claim)
    } catch (error) {
      // 已经打开成功：切全屏失败只记一条诊断，不改变这次点击已被接管的事实。
      warn(`present fullscreen failed: ${messageOf(error)}`)
    }
    return true
  }

  const onClick = (event: EventLike): void => {
    if (event.defaultPrevented === true) return
    const button = headerButton(clickElement(event))
    if (button === null) return
    if (openLocalChanges()) event.stopPropagation()
  }

  doc.addEventListener('click', onClick, true)
  doc.documentElement?.setAttribute(MARKER_ATTRIBUTE, '')

  return () => {
    doc.removeEventListener('click', onClick, true)
    doc.documentElement?.removeAttribute(MARKER_ATTRIBUTE)
  }
}

/** 提取错误消息，避免把 `unknown` 直接拼进诊断。 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
