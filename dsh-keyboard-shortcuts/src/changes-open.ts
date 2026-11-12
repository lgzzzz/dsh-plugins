/**
 * `⌘⌥Y`（macOS）/ `Ctrl+Alt+Y`（Windows、Linux）打开右栏的变更页面：
 *
 *   - 当前会话的工作区**有本地变更**（forge 面板「本地变更」卡片的口径，即 `branch`
 *     范围内至少一个文件）时，直接打开「本地变更」diff 页；
 *   - 没有本地变更（或读不到 git / forge 服务缺席）时，退回打开「变更请求」面板，
 *     用户可以从那里的本地变更卡片与变更请求列表继续。
 *
 * 为什么是两条不同的页：「本地变更」是 forge 包注册的**资源页**
 * （kind `forge-changes`，`dsh-resource://forge-changes/<session>/local`），由
 * `openResource()` 打开；「变更请求」是**页面**（kind `forge-panel`），由
 * `openTab()` 打开。两者都由上游 forge 包声明，本插件只经公开的 Right-Sidebar 面
 * 触发，不复制面板内容。
 *
 * 判定「有本地变更」走 forge 的 Remote 方法 `localDiff(sessionId, {kind:'branch'})`：
 * 它与面板卡片同源（比较 fork point，包含未提交与未跟踪文件），只读、不改变任何状态。
 * 读失败、超时或 Remote 未挂载都按「没有本地变更」处理。Remote 服务按
 * `ctx.get('remote.forgePanel')` **惰性**读取：forge 包可能比本插件晚挂载，也可能被
 * 用户关掉；缺席时本键仍占用组合，但只退到「变更请求」面板。
 *
 * 固定行声明的是逻辑组合 `primary+alt`，注册表在 macOS 上展开成 `meta+alt`、在
 * Windows/Linux 上展开成 `control+alt`。固定行存在本身就是占用：本插件自己注册
 * `dsh-keyboard-shortcuts.changes-open`（group `application`）。
 *
 * 投递路径与其它桥一致：固定输入观察者处理 DOM 通道；落在 `.xterm` 内的按键在
 * window 捕获阶段被拦下（终端会在自己的处理器里停掉冒泡），两条路径共用同一份判定，
 * 一次按键只处理一次。模态层打开、没有屏幕会话、长按、输入法组合中都不动作、不消费。
 *
 * 机制与边界见 docs/dsh-keyboard-shortcuts.md 与 docs/dsh-keyboard-shortcuts/03-fixed-input-and-pane-keys.md。
 */
import {
  captureContext,
  captureGesture,
  composedElement,
  terminalTarget,
} from './capture.ts'
import { bindingKeycaps, fixedRowOwns } from './binding.ts'
import { isKeydown, name, warn, type KeydownInput } from './runtime.ts'
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
export const CHANGES_OPEN_ID: ShortcutCommandId = 'dsh-keyboard-shortcuts.changes-open' as ShortcutCommandId

/** 固定行占用的逻辑物理组合：`primary+alt+Y`（macOS 上即 `⌘⌥Y`，Windows 上即 `Ctrl+Alt+Y`）。 */
export const CHANGES_OPEN_BINDING: ShortcutFixedCommand['bindings'][number] = {
  code: 'KeyY',
  modifiers: ['primary', 'alt'],
}

/** 上游 forge 包注册的变更页 kind：资源地址由 `openResource()` 认领。 */
export const CHANGES_KIND = 'forge-changes'

/** 上游 forge 包注册的变更请求面板 kind：页面类型由 `openTab()` 打开。 */
export const FORGE_PANEL_KIND = 'forge-panel'

/** 「本地变更」资源地址前缀；与 forge 的 `dsh-resource://forge-changes/<session>/local` 同形。 */
const CHANGES_ADDRESS_PREFIX = 'dsh-resource://forge-changes/'

/** 判定 localDiff 需要的最长等待；超时按「没有本地变更」处理，不阻塞按键。 */
const LOCAL_DIFF_TIMEOUT_MS = 2000

/** 本插件挂载的固定行：占用按键并声明动作名称与分组；键帽按平台格式化。 */
export function changesOpenCommand(platform: ShortcutPlatform): ShortcutFixedCommand {
  return {
    id: CHANGES_OPEN_ID,
    label: () => '打开本地变更／变更请求',
    keys: bindingKeycaps(CHANGES_OPEN_BINDING, platform, 'Y'),
    bindings: [CHANGES_OPEN_BINDING],
    group: 'application',
  }
}

/** 某会话「本地变更」页的资源地址。 */
export function localChangesAddress(sessionId: string): string {
  return `${CHANGES_ADDRESS_PREFIX}${encodeURIComponent(sessionId)}/local`
}

/**
 * 一次按键能否打开变更页面：长按、输入法组合中、已被别处消费或存在模态层时让位。
 */
export function changesOpenEligible(gesture: ShortcutGesture, context: ShortcutContext): boolean {
  return !gesture.repeat
    && !gesture.composing
    && !gesture.defaultPrevented
    && context.modal === null
}

/**
 * 一次按键对应的屏幕会话；固定行未挂载、按键不命中、让位条件成立或没有屏幕会话时
 * 返回 undefined。
 */
export function changesOpenTarget(
  shortcuts: Shortcuts,
  sidebar: Sidebar,
  gesture: ShortcutGesture,
  context: ShortcutContext,
): ChangesOpenTarget | undefined {
  if (!changesOpenEligible(gesture, context)) return undefined
  if (!fixedRowOwns(shortcuts.fixedCatalog.getSnapshot(), CHANGES_OPEN_ID, gesture)) return undefined
  const sessionId = sidebar.mounted.getSnapshot()
  if (sessionId === undefined) return undefined
  return { sessionId }
}

/** 一次解析出的打开目标：要打开哪个会话的变更页。 */
export interface ChangesOpenTarget {
  readonly sessionId: string
}

/** forge 包暴露的 `remote.forgePanel` 面里本桥要用的部分。 */
export interface ForgeChangesRemote {
  /**
   * 读一个本地范围的变化；本桥只读 `branch` 范围（与面板的本地变更卡片同源）。
   * @param sessionId - 会话。
   * @param scope - `branch` 范围；`base` / `commits` 为 null 表示自动 fork point。
   * @param signal - 取消读取。
   */
  localDiff(
    sessionId: string,
    scope: { readonly kind: 'branch'; readonly base: null; readonly commits: null },
    signal?: AbortSignal,
  ): Promise<{ readonly ok: boolean; readonly value?: { readonly files: readonly unknown[] } }>
}

/** 读一个可选服务；服务缺席或尚未挂载时返回 undefined。 */
function serviceOf<T>(ctx: Context, key: string): T | undefined {
  if (typeof ctx.get !== 'function') return undefined
  const value = ctx.get(key)
  return value === undefined || value === null ? undefined : value as T
}

/**
 * 该会话当前是否有本地变更（`branch` 范围内至少一个文件）。
 *
 * 读失败、超时、被取消或 Remote 缺席都返回 false；调用方据此退回变更请求面板。
 * @param remote - forge 的 Remote 面。
 * @param sessionId - 会话。
 * @param lifetime - 插件的生命周期信号。
 */
export async function hasLocalChanges(
  remote: ForgeChangesRemote | undefined,
  sessionId: string,
  lifetime: AbortSignal,
): Promise<boolean> {
  if (remote === undefined || typeof remote.localDiff !== 'function') return false
  if (lifetime.aborted) return false
  const controller = new AbortController()
  const abort = (): void => { controller.abort() }
  lifetime.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(abort, LOCAL_DIFF_TIMEOUT_MS)
  try {
    const result = await remote.localDiff(
      sessionId,
      { kind: 'branch', base: null, commits: null },
      controller.signal,
    )
    return result.ok && (result.value?.files.length ?? 0) > 0
  } catch {
    return false
  } finally {
    clearTimeout(timer)
    lifetime.removeEventListener('abort', abort)
  }
}

/**
 * 打开右栏的变更页面：有本地变更打开「本地变更」，否则打开「变更请求」。
 *
 * 先消费按键再读 git，读取期间右栏可能已经变化；结果回来时若插件已卸载则不动。
 * @param ctx - 客户端 Context，用于惰性读取 forge Remote。
 * @param sidebar - Right-Sidebar 面。
 * @param sessionId - 会话。
 * @param lifetime - 插件的生命周期信号。
 */
export async function openChangesPage(
  ctx: Context,
  sidebar: Sidebar,
  sessionId: string,
  lifetime: AbortSignal,
): Promise<void> {
  const remote = serviceOf<ForgeChangesRemote>(ctx, 'remote.forgePanel')
  const local = await hasLocalChanges(remote, sessionId, lifetime)
  if (lifetime.aborted) return
  if (local) {
    // 读 git 期间用户可能切了会话：资源地址属于原会话，不能在别的会话里打开。
    if (sidebar.mounted.getSnapshot() !== sessionId) return
    // 变更页类型缺席（旧版 forge 包）时退回面板，而不是让这一按什么也不做。
    if (openLocalChanges(sidebar, sessionId)) return
  }
  openForgePanel(sidebar)
}

/**
 * 打开（或揭示已打开的）「本地变更」页。
 * @returns 是否交给了右栏；类型未注册或服务不可用时返回 false，调用方退回面板。
 */
function openLocalChanges(sidebar: Sidebar, sessionId: string): boolean {
  if (typeof sidebar.openResource !== 'function') {
    warn('sidebarRight exposes no openResource; local changes page not opened')
    return false
  }
  try {
    sidebar.openResource(localChangesAddress(sessionId))
    return true
  } catch (error) {
    warn('打开本地变更页失败：', error)
    return false
  }
}

/** 打开（或聚焦已打开的）「变更请求」面板。 */
function openForgePanel(sidebar: Sidebar): void {
  if (typeof sidebar.openTab !== 'function') {
    warn('sidebarRight exposes no openTab; forge panel not opened')
    return
  }
  try {
    sidebar.openTab(FORGE_PANEL_KIND)
  } catch (error) {
    warn('打开变更请求面板失败：', error)
  }
}

/**
 * 桥接变更页快捷键。
 *
 * 固定行先挂载（观察者只投递本行占用的按键），观察者处理 DOM 通道；落在 `.xterm`
 * 内的按键到不了那条通道，所以在 window 捕获阶段另装一条监听，命中时先吞掉按键再走
 * 同一个打开动作。两条路径共用 {@link changesOpenTarget}，一次按键只打开一次。
 */
export function installChangesOpenBridge(ctx: Context): void {
  ctx.inject(['shortcuts', 'sidebarRight'], (scope) => {
    const shortcuts: Shortcuts = scope.shortcuts
    const sidebar: Sidebar = scope.sidebarRight
    if (typeof shortcuts.observeFixedInput !== 'function') {
      warn('shortcuts service exposes no observeFixedInput; changes key not installed')
      return
    }
    const lifetime = new AbortController()
    scope.effect(() => () => { lifetime.abort() }, `${name}: changes key lifetime`)
    scope.effect(
      () => shortcuts.registerFixed(changesOpenCommand(shortcuts.platform)),
      `${name}: changes fixed row`,
    )
    scope.effect(
      () => shortcuts.observeFixedInput((input) => {
        if (!isKeydown(input)) return
        handleChangesOpenInput(ctx, shortcuts, sidebar, input, lifetime.signal)
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
        const target = changesOpenTarget(shortcuts, sidebar, captureGesture(event), captureContext(element))
        if (target === undefined) return
        // 先吞掉这一按：不把它当终端输入送进 shell，也不让别的处理器再执行一次。
        event.preventDefault()
        event.stopPropagation()
        void openChangesPage(ctx, sidebar, target.sessionId, lifetime.signal)
      }
      window.addEventListener('keydown', onKeydown, true)
      return () => window.removeEventListener('keydown', onKeydown, true)
    }, `${name}: changes key terminal capture`)
  })
}

/** 处理固定通道投递的一次 keydown；解析出目标时先消费再打开。 */
function handleChangesOpenInput(
  ctx: Context,
  shortcuts: Shortcuts,
  sidebar: Sidebar,
  input: KeydownInput,
  lifetime: AbortSignal,
): void {
  const target = changesOpenTarget(shortcuts, sidebar, input.gesture, input.context)
  if (target === undefined) return
  input.consume()
  void openChangesPage(ctx, sidebar, target.sessionId, lifetime)
}
