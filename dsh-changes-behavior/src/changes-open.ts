/**
 * `⌘⌥Y`（macOS）/ `Ctrl+Alt+Y`（Windows、Linux）打开右栏的「变更请求」页。
 *
 * 这条键现在归 `dsh-changes-behavior` 所有：它与「点改动卡片标题打开本地变更」是同一族
 * 行为（打开一个 changes 页面并默认全屏），放在同一个插件里才能共用「本次打开要全屏」
 * 的意图，不必在插件之间传状态。
 *
 * 右栏的变更页由 forge 客户端包的 `forge-changes` 页类型提供，打开要给出具体地址：
 * 会话绑定了变更请求时打开第一张卡片的页面（`.../change/<url>`），没有绑定时打开本地
 * 变更页（`.../local`）。绑定关系只有面板流 `forgePanel.follow` 知道，所以这条键会先读一
 * 帧（带超时，见 `change-request.ts`）；forge 的 Remote 缺席时直接打开本地变更页，不等待。
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
// 类型导入：加载右栏包对 `@deepseek-ai/cordis` 的模块增强（`ctx.sidebarRight` / `ctx.sidebarRightTabs`）。
import type { SidebarRightTabClaim } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { bindingKeycaps, fixedRowOwns } from 'dsh-shortcut-utils/binding.ts'
import { captureContext, captureGesture, composedElement, terminalTarget } from 'dsh-shortcut-utils/capture.ts'
import { localChangesAddress, serviceOf } from './card.ts'
import { changeRequestAddress, firstChangeRequestUrl, type ForgePanelSource } from './change-request.ts'
import { presentFullscreen, withFullscreenIntent } from './presentation.ts'
import type { DocumentLike } from './dom.ts'

/** 插件 id：诊断前缀与固定行 id 前缀都用它。 */
export const name = 'dsh-changes-behavior'

/** 右栏服务面（`ctx.sidebarRight`）。 */
type Sidebar = Context['sidebarRight']

/** 右栏页类型注册表（`ctx.sidebarRightTabs`），用来在打开前确认地址有对应页类型。 */
type TabRegistry = Context['sidebarRightTabs']

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

/** 已解析的绑定关系缓存时长：连按时不重复读面板流，绑定变化最多滞后这么久。 */
const RESOLVED_TTL_MS = 30_000

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
 * 一次按键能否打开变更页：长按、输入法组合中、已被别处消费或存在模态层时让位。
 */
export function changesOpenEligible(gesture: ShortcutGesture, context: ShortcutContext): boolean {
  return !gesture.repeat
    && !gesture.composing
    && !gesture.defaultPrevented
    && context.modal === null
}

/**
 * 一次按键是否要打开变更页：固定行未挂载、按键不命中、让位条件成立或没有屏幕会话时
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
 * 打开（或聚焦已打开的）一个变更页，并在面板原本是推挤呈现时切成全屏。
 * @param scope - 本桥的注入作用域，用来读页类型注册表。
 * @param sidebar - 右栏面。
 * @param sessionId - 本次打开所属的会话。
 * @param address - 变更页地址（某个变更请求或本地变更）。
 * @param doc - 目标文档，用于读面板呈现方式。
 */
function openChangesPage(
  scope: Context,
  sidebar: Sidebar,
  sessionId: string,
  address: string,
  doc: DocumentLike | undefined,
): void {
  if (typeof sidebar.openResource !== 'function') {
    warn('sidebarRight exposes no openResource; changes page not opened')
    return
  }
  let claim: SidebarRightTabClaim | undefined
  const tabs = serviceOf<TabRegistry>(scope, 'sidebarRightTabs')
  if (tabs !== undefined) {
    try {
      claim = tabs.claim(address)
    } catch {
      // 没有注册对应页类型（forge bundle 未挂载）：照常尝试打开，全屏判定退回按现值。
      claim = undefined
    }
  }
  try {
    withFullscreenIntent(() => sidebar.openResource(address))
  } catch (error) {
    warn('打开变更页失败：', error)
    return
  }
  if (doc === undefined) return
  try {
    presentFullscreen(sidebar, doc, sessionId, claim)
  } catch (error) {
    warn('切换变更页全屏失败：', error)
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
  // forge 的 Remote 可能晚挂载或整体缺席：这一层只登记可用性，不影响本桥其余部分。
  let panel: ForgePanelSource | undefined
  ctx.inject(['remote', 'remote.forgePanel'], (scope) => {
    const remote = serviceOf<{ forgePanel?: ForgePanelSource }>(scope, 'remote')
    const found = remote?.forgePanel
    if (found === undefined) return
    panel = found
    scope.effect(() => () => {
      if (panel === found) panel = undefined
    }, `${name}: forge panel release`)
  })

  ctx.inject(['shortcuts', 'sidebarRight'], (scope) => {
    const shortcuts: ShortcutsService = scope.shortcuts
    const sidebar: Sidebar = scope.sidebarRight
    if (typeof shortcuts.observeFixedInput !== 'function') {
      warn('shortcuts service exposes no observeFixedInput; changes key not installed')
      return
    }
    /** 已解析的会话 → 绑定变更请求：连按不重复读面板流。 */
    const resolved = new Map<string, { url: string | undefined; at: number }>()
    const pending = new Map<string, Promise<string | undefined>>()
    const lookup = (source: ForgePanelSource, sessionId: string): Promise<string | undefined> => {
      const cached = resolved.get(sessionId)
      if (cached !== undefined && Date.now() - cached.at < RESOLVED_TTL_MS) {
        return Promise.resolve(cached.url)
      }
      const inFlight = pending.get(sessionId)
      if (inFlight !== undefined) return inFlight
      const task = firstChangeRequestUrl(source, sessionId)
        .then((url) => {
          resolved.set(sessionId, { url, at: Date.now() })
          return url
        })
        .finally(() => {
          pending.delete(sessionId)
        })
      pending.set(sessionId, task)
      return task
    }

    /**
     * 打开这次按键对应的变更页：有绑定走第一张卡片，否则本地变更页；Remote 缺席时不等待。
     * @param sessionId - 右栏当前会话。
     */
    const openForSession = (sessionId: string): void => {
      const source = panel
      if (source === undefined) {
        openChangesPage(scope, sidebar, sessionId, localChangesAddress(sessionId), doc)
        return
      }
      void lookup(source, sessionId).then((url) => {
        // 读流期间用户可能已经切走：不属于当前会话的页面不打开。
        if (sidebar.mounted.getSnapshot() !== sessionId) return
        const address = url === undefined
          ? localChangesAddress(sessionId)
          : changeRequestAddress(sessionId, url)
        openChangesPage(scope, sidebar, sessionId, address, doc)
      })
    }

    /** 命中后消费这一按并开始打开。 */
    const openFromPress = (): void => {
      const sessionId = sidebar.mounted.getSnapshot()
      if (sessionId === undefined) return
      openForSession(sessionId)
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
        openFromPress()
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
        openFromPress()
      }
      window.addEventListener('keydown', onKeydown, true)
      return () => window.removeEventListener('keydown', onKeydown, true)
    }, `${name}: changes key terminal capture`)
  })
}
