/**
 * 改动文件卡片的两处点击改写：标题 → 本地变更，右键 → 本轮快照 diff。
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
 *      「本地变更」标签页，并 `stopPropagation()` 阻止上游打开本轮审查页；
 *   2. **左键点文件行**（`li` 里的按钮）→ 不处理，保持上游的「本轮文件 diff」；
 *   3. **右键标题或文件行** → 用宿主 `contextMenus` 打开上下文菜单，贡献一条「查看本轮快照
 *      diff」，执行时调用该按钮读到的 React `onClick`，回到上游原本的审查标签页。
 *
 * 失败一律收敛为「不动作」：右栏不在、本地变更类型没注册、地址无法认领、拿不到会话、
 * 按钮上没有可读的 `onClick`、`contextMenus` 服务缺席，都把这次手势留给上游 / 浏览器。
 * 只有确认能打开时才 `stopPropagation()`，不会吞掉点击。
 *
 * 上游锚点、边界与验证方式见 docs/dsh-changes-card-local.md。
 */
import type { Context } from '@deepseek-ai/cordis'
import { clickElement, isModified, type DocumentLike, type ElementLike, type EventLike } from './dom.ts'
import { findClickHandler } from './fiber.ts'
import { NS, translateOf, zh, en, type LocaleLike } from './locales.ts'

/** 插件 id：诊断前缀、标记与菜单贡献 id 都用它。 */
export const name = 'dsh-changes-card-local'

/** 改动文件卡片根元素；只有这张卡片用它。 */
export const CARD_SELECTOR = '[data-changed-files]'

/** 卡片里「展开全部文件」折叠按钮的标记；它不是「标题」，必须跳过。 */
export const TOGGLE_ATTRIBUTE = 'aria-expanded'

/** 文件行的容器标签：卡片用 `<li>` 包住每一行，标题不在其中。 */
export const ROW_TAG = 'li'

/** 文档根元素上的生效标记：装上时写入，卸载时移除。 */
export const MARKER_ATTRIBUTE = 'data-dsh-changes-card-local'

/** 「本地变更」标签页地址前缀；后面依次是组件编码的会话 id 与 `/local`。 */
export const LOCAL_CHANGES_PREFIX = 'dsh-resource://forge-changes/'

/** 「本地变更」标签页地址的固定尾段。 */
export const LOCAL_CHANGES_SOURCE = 'local'

/** 本插件在上下文菜单里拥有的目标种类（只用于它自己弹出的菜单）。 */
export const MENU_TARGET = 'dsh-changes-card-local/changed-turn'

/** 菜单贡献 id（同一目标种类内唯一）。 */
export const MENU_CONTRIBUTION_ID = 'dsh-changes-card-local/changed-turn'

/** 菜单动作 id。 */
export const MENU_ACTION_ID = 'open-snapshot'

/** 右栏导航服务：打开资源、读当前会话。 */
export interface SidebarLike {
  readonly mounted: { getSnapshot(): string | undefined }
  openResource(address: string, options?: { readonly params?: unknown }): void
}

/** 右栏标签类型注册表：只用来确认目标地址确实有类型认领。 */
export interface TabRegistryLike {
  claim(address: string, kind?: string): unknown
}

/** 菜单动作（宿主 `MenuAction` 里本插件用到的字段）。 */
export interface MenuActionLike {
  readonly id: string
  readonly label: string
  run(): void
}

/** 宿主上下文菜单服务的最小面。 */
export interface ContextMenusLike {
  open(target: unknown, point: { readonly x: number; readonly y: number }): void
  register(contribution: {
    readonly id: string
    readonly target: string
    readonly order: number
    readonly resolve: (target: unknown, signal: AbortSignal) => readonly MenuActionLike[]
  }): () => void
}

/** 运行期可注入项：测试用它替换告警输出。 */
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
 * 右键菜单的落点：卡片的标题或文件行按钮（折叠按钮除外）。
 * @param target - 事件目标元素。
 * @returns 按钮，或 null。
 */
export function menuButton(target: ElementLike | null): ElementLike | null {
  if (target === null || typeof target.closest !== 'function') return null
  const button = target.closest('button')
  if (button === null) return null
  if (button.closest?.(CARD_SELECTOR) == null) return null
  if (button.hasAttribute?.(TOGGLE_ATTRIBUTE) === true) return null
  return button
}

/**
 * 菜单弹出的位置：指针事件用指针坐标，键盘手势用按钮底边。
 * @param event - 触发的右键 / 按键事件。
 * @param button - 触发元素。
 * @param keyboard - 是否键盘手势。
 * @returns 视口坐标。
 */
function menuPoint(event: EventLike, button: ElementLike, keyboard: boolean): { x: number; y: number } {
  if (!keyboard && event.clientX !== undefined && event.clientY !== undefined) {
    return { x: event.clientX, y: event.clientY }
  }
  const rect = button.getBoundingClientRect?.()
  return { x: rect?.left ?? 0, y: rect?.bottom ?? 0 }
}

/**
 * 安装两处点击改写，并在文档根上留一个标记。
 *
 * 依赖在事件发生时才读（`ctx.get`），所以 `contextMenus` 比本插件晚挂载也能用；
 * 右栏服务缺席时本插件整体不动作。
 * @param ctx - 浏览器 Context（或其注入子作用域）。
 * @param runtime - 可注入的告警输出。
 * @param doc - 目标文档；没有文档（非浏览器环境）时为空操作。
 * @returns 卸载函数：移除监听、菜单贡献与标记。
 */
export function installCardLocal(
  ctx: Context,
  runtime: Runtime = {},
  doc: DocumentLike | undefined = typeof document === 'undefined'
    ? undefined
    : document as unknown as DocumentLike,
): () => void {
  if (doc === undefined) return () => {}
  const warn = runtime.warn ?? defaultWarn
  const locale = serviceOf<LocaleLike>(ctx, 'locale')
  let disposeLocale: (() => void) | undefined
  if (locale !== undefined) {
    try {
      // 先注册字典再绑定命名空间：`bind` 可能按注册时刻解析字典。
      disposeLocale = locale.register(NS, { zh, en })
    } catch (error) {
      warn(`locale registration failed: ${messageOf(error)}`)
    }
  }
  const t = translateOf(locale)

  /** 右键时捕获的上游 `onClick`；菜单动作执行时只消费一次。 */
  let opener: (() => void) | null = null
  /** 菜单贡献的注销函数；第一次需要菜单时注册。 */
  let disposeMenu: (() => void) | undefined
  /** 每次打开菜单换一个序号，让同一位置的重复右键重新打开而不是被当成「再点一次关闭」。 */
  let serial = 0

  const ensureMenu = (): ContextMenusLike | undefined => {
    const menus = serviceOf<ContextMenusLike>(ctx, 'contextMenus')
    if (menus === undefined) return undefined
    if (disposeMenu !== undefined) return menus
    try {
      disposeMenu = menus.register({
        id: MENU_CONTRIBUTION_ID,
        target: MENU_TARGET,
        order: 0,
        resolve: () => {
          const run = opener
          if (run === null) return []
          return [{
            id: MENU_ACTION_ID,
            label: t('openSnapshot'),
            run: () => {
              opener = null
              run()
            },
          }]
        },
      })
    } catch (error) {
      warn(`context menu registration failed: ${messageOf(error)}`)
    }
    return menus
  }

  /**
   * 标题被左键点了：打开「本地变更」。
   * @returns 是否已接管这次点击（接管后调用方才会阻止冒泡）。
   */
  const openLocalChanges = (): boolean => {
    const sidebar = serviceOf<SidebarLike>(ctx, 'sidebarRight')
    if (sidebar === undefined) return false
    const sessionId = sidebar.mounted.getSnapshot()
    if (sessionId === undefined) return false
    const address = localChangesAddress(sessionId)
    const tabs = serviceOf<TabRegistryLike>(ctx, 'sidebarRightTabs')
    if (tabs === undefined) return false
    try {
      tabs.claim(address)
    } catch {
      // 没有注册「本地变更」类型（forge bundle 未挂载）：这次点击留给上游，仍打开本轮审查页。
      return false
    }
    try {
      sidebar.openResource(address)
    } catch (error) {
      // 右栏在点击与调用之间卸载等情形：这次点击留给上游，不吞点击。
      warn(`open local changes failed: ${messageOf(error)}`)
      return false
    }
    return true
  }

  const onClick = (event: EventLike): void => {
    if (event.defaultPrevented === true) return
    if (isModified(event)) return
    const button = headerButton(clickElement(event))
    if (button === null) return
    if (openLocalChanges()) event.stopPropagation()
  }

  const onContextMenu = (event: EventLike): void => {
    if (event.defaultPrevented === true) return
    const button = menuButton(clickElement(event))
    if (button === null) return
    const run = findClickHandler(button)
    if (run === null) return
    const menus = ensureMenu()
    if (menus === undefined) return
    opener = run
    try {
      menus.open({ kind: MENU_TARGET, value: { serial: (serial += 1) } }, menuPoint(event, button, false))
    } catch (error) {
      opener = null
      warn(`open context menu failed: ${messageOf(error)}`)
      return
    }
    event.preventDefault()
    event.stopPropagation()
  }

  const onKeyDown = (event: EventLike): void => {
    if (event.defaultPrevented === true) return
    const keyboard = event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey === true)
    if (!keyboard) return
    const button = menuButton(clickElement(event))
    if (button === null) return
    const run = findClickHandler(button)
    if (run === null) return
    const menus = ensureMenu()
    if (menus === undefined) return
    opener = run
    try {
      menus.open({ kind: MENU_TARGET, value: { serial: (serial += 1) } }, menuPoint(event, button, true))
    } catch (error) {
      opener = null
      warn(`open context menu failed: ${messageOf(error)}`)
      return
    }
    event.preventDefault()
    event.stopPropagation()
  }

  doc.addEventListener('click', onClick, true)
  doc.addEventListener('contextmenu', onContextMenu, true)
  doc.addEventListener('keydown', onKeyDown, true)
  doc.documentElement?.setAttribute(MARKER_ATTRIBUTE, '')

  return () => {
    doc.removeEventListener('click', onClick, true)
    doc.removeEventListener('contextmenu', onContextMenu, true)
    doc.removeEventListener('keydown', onKeyDown, true)
    opener = null
    disposeMenu?.()
    disposeMenu = undefined
    disposeLocale?.()
    disposeLocale = undefined
    doc.documentElement?.removeAttribute(MARKER_ATTRIBUTE)
  }
}

/** 提取错误消息，避免把 `unknown` 直接拼进诊断。 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
