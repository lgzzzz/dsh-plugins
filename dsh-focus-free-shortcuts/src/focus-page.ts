/**
 * 快捷键分组：`⌘⌥K`（macOS）/ `Ctrl+Alt+K`（Windows、Linux）把键盘交给右侧栏**当前显示**
 * 的那一页 —— 通常就是终端，于是不必先用鼠标点进 `.xterm` 才能打字。
 *
 * 与页面切换键（`page-cycle.ts` 的 `⌘⌥←/→`）的关系：那一对是"换一页、再交还键盘"，
 * 本键不换页，只把键盘交给**眼下的**这一页；两者共用同一条交棒判定
 * （`focusShownPage`：定位该 Session 的右栏根节点、选出可见 pane，再下探到页面自己的
 * 输入面，例如终端的 `.xterm-helper-textarea`；页面已自行持有键盘时不动它）。
 *
 * 固定行声明的是逻辑组合 `primary+alt`，注册表在 macOS 上展开成 `meta+alt`（⌘⌥）、在
 * Windows/Linux 上展开成 `control+alt`（Ctrl+Alt）。本插件自己注册固定行
 * `dsh-focus-free-shortcuts.focus-page`（group `application`），固定行的存在本身就是占用：
 *
 *   - **键位与内置的撞车**：Web 上 `session.search`（会话搜索）的默认键位正是
 *     `primary+alt+K`，本固定行会把它挤成「冲突」——搜索项在快捷键设置里亮红、按键不再
 *     打开搜索，需要用户自行给搜索改绑；连带地，上游把「恢复全部默认」的校验也建立在这份
 *     冲突表上（`edit({type:'reset-all'})` 对任何带冲突的行都判 `conflict`），用户改动过
 *     快捷键时点它会以冲突失败。这是有意的取舍：终端里那一格只有固定行够得着。
 *   - **右栏折叠时不动作、也不消费**：折叠态下没有"当前显示的页"（浮动面板同样不在本键
 *     范围内，与页面切换键的边界一致）；不消费时该按由快捷键服务按冲突处理（吞掉、不弹错）。
 *   - **落在 `.xterm` 内的按键**不会到达 window 上的 fixed-input 监听（终端在自己的
 *     textarea 处理器里 `stopPropagation()`），因此与页面循环 / 会话导航两桥一样另装捕获
 *     阶段的 window `keydown`，在事件进入终端前判定：命中即吞掉这一按（此时交棒是
 *     无操作——键盘本来就在终端里），既不误动作也不把它当终端输入送进 shell。
 *
 * 逐行机制见 docs/dsh-focus-free-shortcuts/03-fixed-input-and-pane-keys.md；
 * 与内置命令的冲突与代价见 docs/dsh-focus-free-shortcuts/06-boundaries-and-contracts.md。
 */
import {
  captureContext,
  captureGesture,
  composedElement,
  terminalTarget,
} from './capture.ts'
import { bindingKeycaps, fixedRowOwns } from './binding.ts'
import { isKeydown, name, warn, type KeydownInput } from './runtime.ts'
import { focusShownPage } from './page-cycle.ts'
import type {
  ShortcutContext,
  ShortcutFixedCommand,
  ShortcutGesture,
  Shortcuts,
} from '@deepseek-ai/dsh-client-shortcuts/client'
import type {ShortcutCommandId, ShortcutPlatform} from '@deepseek-ai/dsh-client-shortcuts/protocol'
import type {Context} from '@deepseek-ai/cordis'
// 空导入：让 TS 加载本包对 `@deepseek-ai/cordis` 的模块增强，`ctx.sidebarRight`
// 由它声明；`Context['sidebarRight']` 是取到该面的公开途径。
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'

/** Cordis 增强声明的 Right-Sidebar 面。 */
type Sidebar = Context['sidebarRight']

/** 本桥挂载的固定行 id。 */
export const FOCUS_PAGE_ID: ShortcutCommandId = 'dsh-focus-free-shortcuts.focus-page' as ShortcutCommandId

/** 固定行占用的逻辑物理组合：`primary+alt+K`（macOS 上即 `⌘⌥K`，Windows 上即 `Ctrl+Alt+K`）。 */
export const FOCUS_PAGE_BINDING: ShortcutFixedCommand['bindings'][number] = {
  code: 'KeyK',
  modifiers: ['primary', 'alt'],
}

/** 本插件挂载的固定行：占用按键并声明动作名称与分组；键帽按平台格式化。 */
export function focusPageCommand(platform: ShortcutPlatform): ShortcutFixedCommand {
  return {
    id: FOCUS_PAGE_ID,
    label: () => '聚焦右栏页面',
    keys: bindingKeycaps(FOCUS_PAGE_BINDING, platform, 'K'),
    bindings: [FOCUS_PAGE_BINDING],
    group: 'application',
  }
}

/**
 * 该次按键能否在没有 DOM 焦点时聚焦右栏页面。
 *
 * 任何输入区域都接受（这正是要从 composer / 终端键位之外抢键盘的场景），已消费的按键
 * 也照常处理；只保留输入法组合中、自动重复与存在模态这三项排除 —— 与页面切换键同一份
 * 准入，两条投递路径（固定通道与终端前的捕获拦截）共用。
 */
export function focusPageEligible(gesture: ShortcutGesture, context: ShortcutContext): boolean {
  return !gesture.repeat
    && !gesture.composing
    && context.modal === null
}

/**
 * 一次按键要交棒的右栏所在 Session；任何条件不成立时返回 undefined。
 *
 * 两条投递路径共用本判定：本固定行仍占用这一按、右栏处于展开态（有"当前显示的页"）、
 * 且屏幕上有一个 Session。
 */
export function focusPageTarget(
  shortcuts: Shortcuts,
  sidebar: Sidebar,
  gesture: ShortcutGesture,
  context: ShortcutContext,
): FocusPageTarget | undefined {
  if (!focusPageEligible(gesture, context)) return undefined
  if (!fixedRowOwns(shortcuts.fixedCatalog.getSnapshot(), FOCUS_PAGE_ID, gesture)) return undefined
  // 右栏折叠时不显示任何页：没有可交棒的页面，也不消费这一按。
  if (!sidebar.isExpanded()) return undefined
  const sessionId = sidebar.mounted.getSnapshot()
  if (sessionId === undefined) return undefined
  return { sessionId }
}

/** 一次解析出的交棒：键盘要落到的右栏所在 Session。 */
export interface FocusPageTarget {
  readonly sessionId: string
}

/**
 * 把键盘交给该 Session 右栏当前显示的页面（页面已自行持有键盘时不动它）。
 * @returns 是否找到可见 pane 并持有键盘。
 */
export function focusPage(sessionId: string): boolean {
  return focusShownPage(sessionId)
}

/**
 * 桥接聚焦右栏页面键。
 *
 * 通过两条路径投递按键：观察者处理 DOM 通道收到的按键（命中即消费，避免这一按同时被
 * 输入控件或冲突的内置命令处理）；捕获阶段 window `keydown` 监听处理落在 `.xterm` 内、
 * 通道收不到的按键。两条路径运行同一判定（`focusPageTarget`）与同一交棒，一次按键只被
 * 处理一次。
 */
export function installFocusPageBridge(ctx: Context): void {
  ctx.inject(['shortcuts', 'sidebarRight'], (scope) => {
    const shortcuts: Shortcuts = scope.shortcuts
    const sidebar: Sidebar = scope.sidebarRight
    if (typeof shortcuts.observeFixedInput !== 'function') {
      warn('shortcuts service exposes no observeFixedInput; focus-page key not installed')
      return
    }
    // 固定行要先挂载，观察者才读得到；两者同属一个 scope，按同样顺序销毁。
    scope.effect(() => shortcuts.registerFixed(focusPageCommand(shortcuts.platform)), `${name}: focus page fixed row`)
    scope.effect(() => shortcuts.observeFixedInput((input) => {
      if (!isKeydown(input)) return
      handleFocusPageInput(shortcuts, sidebar, input)
    }), `${name}: focus page key`)
    // 终端那一半：落在 `.xterm` 内的 keydown 到不了上面的 window 监听（终端在自己的
    // textarea 处理器里停掉了它），本捕获监听早一个阶段看到它，并复用同一份判定。
    scope.effect(() => {
      if (typeof window === 'undefined') return () => {}
      const onKeydown = (event: KeyboardEvent): void => {
        if (event.type !== 'keydown') return
        const element = composedElement(event)
        if (!terminalTarget(element)) return
        const target = focusPageTarget(shortcuts, sidebar, captureGesture(event), captureContext(element))
        if (target === undefined) return
        // 在终端自身处理器之前拦截：事件到此为止，xterm 既收不到该按键，也不会把它
        // 当成终端输入送进 shell。
        event.preventDefault()
        event.stopPropagation()
        focusPage(target.sessionId)
      }
      window.addEventListener('keydown', onKeydown, true)
      return () => window.removeEventListener('keydown', onKeydown, true)
    }, `${name}: focus page terminal capture`)
  })
}

/**
 * 处理固定通道投递的一次 keydown；只有解析出交棒目标时才消费按键。
 */
function handleFocusPageInput(shortcuts: Shortcuts, sidebar: Sidebar, input: KeydownInput): void {
  const target = focusPageTarget(shortcuts, sidebar, input.gesture, input.context)
  if (target === undefined) return
  // 先消费再动作：该按键归本桥专用，避免同时被输入控件或冲突的内置命令处理。
  input.consume()
  focusPage(target.sessionId)
}
