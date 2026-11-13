/**
 * `⌘⌥Y`（macOS）/ `Ctrl+Alt+Y`（Windows、Linux）打开右栏的「变更请求」面板。
 *
 * 这条键现在归 `dsh-changes-behavior` 所有：它与「点改动卡片标题打开本地变更」是同一族
 * 行为（打开一个 changes 页面并默认全屏），放在同一个插件里才能共用「本次打开要全屏」
 * 的意图，不必在插件之间传状态。
 *
 * 打开动作本身仍然只经公开面：`sidebarRight.openTab('forge-panel')`，不读 git、不判断
 * 当前会话有没有本地变更。打开后由 `presentFullscreen` 切成全屏；如果右栏原本就是全屏
 * 或窄窗口自动全屏，保持现状。
 *
 * 固定行声明的是逻辑组合 `primary+alt`，注册表在 macOS 上展开成 `meta+alt`、在
 * Windows/Linux 上展开成 `control+alt`。固定行存在本身就是占用：本插件自己注册
 * `dsh-changes-behavior.changes-open`（group `application`）。
 *
 * 投递路径与其它快捷键桥一致：固定输入观察者处理 DOM 通道；落在 `.xterm` 内的按键在
 * window 捕获阶段被拦下（终端会在自己的处理器里停掉冒泡），两条路径共用同一份判定，
 * 一次按键只处理一次。模态层打开、没有屏幕会话、长按、输入法组合中都不动作、不消费。
 *
 * 机制与边界见 docs/dsh-changes-behavior.md。
 */
import type { Context } from '@deepseek-ai/cordis'
import type {
  ShortcutContext,
  ShortcutFixedCommand,
  ShortcutFixedInput,
  ShortcutGesture,
  Shortcuts,
} from '@deepseek-ai/dsh-client-shortcuts/client'
import type { ShortcutCommandId, ShortcutPlatform } from '@deepseek-ai/dsh-client-shortcuts/protocol'
// 空导入：让 TS 加载右栏包对 `@deepseek-ai/cordis` 的模块增强（`ctx.sidebarRight`）。
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { bindingKeycaps, fixedRowOwns } from 'dsh-shortcut-utils/binding.ts'
import { captureContext, captureGesture, composedElement, terminalTarget } from 'dsh-shortcut-utils/capture.ts'
import { presentFullscreen, withFullscreenIntent } from './presentation.ts'
import type { DocumentLike } from './dom.ts'

/** 插件 id：诊断前缀与固定行 id 前缀都用它。 */
export const name = 'dsh-changes-behavior'

/** 右栏服务面（`ctx.sidebarRight`）。 */
type Sidebar = Context['sidebarRight']

/** 快捷键服务面（`ctx.shortcuts`）。 */
type ShortcutsService = Shortcuts

/** 注册表发布的固定输入中的一次 keydown。 */
type KeydownInput = Extract<ShortcutFixedInput, { type: 'keydown' }>

/** 本桥挂载的固定行 id。 */
export const CHANGES_OPEN_ID: ShortcutCommandId = 'dsh-changes-behavior.changes-open' as ShortcutCommandId

/** 固定行占用的逻辑物理组合：`primary+alt+Y`（macOS 上即 `⌘⌥Y`，Windows 上即 `Ctrl+Alt+Y`）。 */
export const CHANGES_OPEN_BINDING: ShortcutFixedCommand['bindings'][number] = {
  code: 'KeyY',
  modifiers: ['primary', 'alt'],
}

/** 上游 forge 包注册的变更请求面板 kind：页面类型由 `openTab()` 打开。 */
export const FORGE_PANEL_KIND = 'forge-panel'

/** 默认告警：统一加插件前缀。 */
function warn(message: string, detail?: unknown): void {
  if (detail === undefined) console.warn(`[${name}] ${message}`)
  else console.warn(`[${name}] ${message}`, detail)
}

/** 收窄固定输入联合类型，调用处不必各自断言。 */
function isKeydown(input: ShortcutFixedInput): input is KeydownInput {
  return input.type === 'keydown'
}

/** 本插件挂载的固定行：占用按键并声明动作名称与分组；键帽按平台格式化。 */
export function changesOpenCommand(platform: ShortcutPlatform): ShortcutFixedCommand {
  return {
    id: CHANGES_OPEN_ID,
    label: () => '打开变更请求',
    keys: bindingKeycaps(CHANGES_OPEN_BINDING, platform, 'Y'),
    bindings: [CHANGES_OPEN_BINDING],
    group: 'application',
  }
}

/**
 * 一次按键能否打开变更请求：长按、输入法组合中、已被别处消费或存在模态层时让位。
 */
export function changesOpenEligible(gesture: ShortcutGesture, context: ShortcutContext): boolean {
  return !gesture.repeat
    && !gesture.composing
    && !gesture.defaultPrevented
    && context.modal === null
}

/**
 * 一次按键是否要打开变更请求：固定行未挂载、按键不命中、让位条件成立或没有屏幕会话时
 * 返回 false。
 */
export function changesOpenTarget(
  shortcuts: ShortcutsService,
  sidebar: Sidebar,
  gesture: ShortcutGesture,
  context: ShortcutContext,
): boolean {
  if (!changesOpenEligible(gesture, context)) return false
  if (!fixedRowOwns(shortcuts.fixedCatalog.getSnapshot(), CHANGES_OPEN_ID, gesture)) return false
  return sidebar.mounted.getSnapshot() !== undefined
}

/**
 * 打开（或聚焦已打开的）「变更请求」面板，并在面板原本是推挤呈现时切成全屏。
 * @param sidebar - 右栏面。
 * @param doc - 目标文档，用于读面板呈现方式。
 */
function openForgePanel(sidebar: Sidebar, doc: DocumentLike | undefined): void {
  if (typeof sidebar.openTab !== 'function') {
    warn('sidebarRight exposes no openTab; forge panel not opened')
    return
  }
  const sessionId = sidebar.mounted.getSnapshot()
  if (sessionId === undefined) return
  try {
    withFullscreenIntent(() => sidebar.openTab(FORGE_PANEL_KIND))
  } catch (error) {
    warn('打开变更请求面板失败：', error)
    return
  }
  if (doc === undefined) return
  try {
    presentFullscreen(sidebar, doc, sessionId, { kind: FORGE_PANEL_KIND })
  } catch (error) {
    warn('切换变更请求面板全屏失败：', error)
  }
}

/**
 * 桥接变更请求快捷键。
 *
 * 固定行先挂载（观察者只投递本行占用的按键），观察者处理 DOM 通道；落在 `.xterm` 内的
 * 按键到不了那条通道，所以在 window 捕获阶段另装一条监听，命中时先吞掉按键再走同一个
 * 打开动作。两条路径共用 {@link changesOpenTarget}，一次按键只打开一次。
 *
 * @param ctx - 已具备 `shortcuts` 与 `sidebarRight` 的 Context / 作用域。
 * @param doc - 目标文档；省略时取全局 `document`。
 */
export function installChangesOpenBridge(
  ctx: Context,
  doc: DocumentLike | undefined = typeof document === 'undefined'
    ? undefined
    : document as unknown as DocumentLike,
): void {
  ctx.inject(['shortcuts', 'sidebarRight'], (scope) => {
    const shortcuts: ShortcutsService = scope.shortcuts
    const sidebar: Sidebar = scope.sidebarRight
    if (typeof shortcuts.observeFixedInput !== 'function') {
      warn('shortcuts service exposes no observeFixedInput; changes key not installed')
      return
    }
    scope.effect(
      () => shortcuts.registerFixed(changesOpenCommand(shortcuts.platform)),
      `${name}: changes fixed row`,
    )
    scope.effect(
      () => shortcuts.observeFixedInput((input) => {
        if (!isKeydown(input)) return
        if (!changesOpenTarget(shortcuts, sidebar, input.gesture, input.context)) return
        input.consume()
        openForgePanel(sidebar, doc)
      }),
      `${name}: changes key`,
    )
    // 终端那一半：`.xterm` 内的 keydown 在终端自己的处理器里被停掉，这里早一个阶段看到它。
    scope.effect(() => {
      if (typeof window === 'undefined') return () => {}
      const onKeydown = (event: KeyboardEvent): void => {
        if (event.type !== 'keydown') return
        const element = composedElement(event)
        if (!terminalTarget(element)) return
        if (!changesOpenTarget(shortcuts, sidebar, captureGesture(event), captureContext(element))) return
        // 先吞掉这一按：不把它当终端输入送进 shell，也不让别的处理器再执行一次。
        event.preventDefault()
        event.stopPropagation()
        openForgePanel(sidebar, doc)
      }
      window.addEventListener('keydown', onKeydown, true)
      return () => window.removeEventListener('keydown', onKeydown, true)
    }, `${name}: changes key terminal capture`)
  })
}
