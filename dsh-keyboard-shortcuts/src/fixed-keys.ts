/**
 * 固定键组：把八条快捷键注册成官方快捷键服务的固定行，按键命中后调用官方命令
 * 注册表的 `invoke()`，由官方命令自己的 `resolve()` / `run()` 执行对应功能。
 *
 * 为什么不写官方可配置绑定：Web/Linux 的官方校验 `isWebBindingAllowed()` 只放行
 * 极少数组合，`Ctrl+Alt+N` 这类组合会被标成 `unsupported-browser`，既不能保存也不能
 * 执行。固定行（`registerFixed`）不走那层校验，是保留这些组合的公开入口。
 *
 * 各层职责：
 *
 *   - `registerFixed()`：在官方快捷键目录里占住组合，显示为只读固定行；
 *   - `observeFixedInput()`：官方适配器把本地按键交给固定行观察者；
 *   - `registry.invoke()`：按官方命令 id 执行官方命令的 resolver/run，本插件不复制
 *     任何业务动作；
 *   - window 捕获阶段的 `.xterm` 监听：终端会截断冒泡，命中时先吞掉按键再走同一个
 *     `invoke()`，路径与页面焦点完全相同；
 *   - 全屏 / 关页免聚焦回退：焦点不在右栏时用 `commandTarget()` 解析活动 dock 面板，
 *     消费按键后直接执行官方命令的同一个动词。
 *
 * 官方服务没有公开的「按 id 调命令」API；`registry` 是服务实例上的内部字段。插件
 * 对它做结构检查，缺席时告警并不安装固定行，而不是退回自己执行动作。
 */
import { name, warn } from './runtime.ts'
import {
  TARGETS,
  bindingOf,
  fixedIdOf,
  keycaps,
  targetForGesture,
  type Gesture,
  type LogicalBinding,
  type ShortcutPlatform,
  type TargetSpec,
} from './shortcuts.ts'

/** 官方目录行里本插件用到的字段（标签跟随官方文案）。 */
export interface ShortcutCatalogRow {
  readonly id: string
  readonly label?: string
}

/** 固定行的形状（官方服务只读这一小块）。 */
export interface FixedCommand {
  readonly id: string
  readonly label: () => string
  readonly keys: readonly string[]
  readonly bindings: readonly LogicalBinding[]
  readonly group: 'application'
}

/** 固定输入里的按键上下文。 */
export interface FixedContext {
  readonly region?: string
  readonly modal?: string | null
  readonly target?: Element | null
}

/** 固定输入读数；`reset` 表示序列作废，不执行动作。 */
export interface FixedInput {
  readonly type: 'keydown' | 'reset'
  readonly gesture?: Gesture
  readonly context?: FixedContext
  consume?(): void
}

/** 右栏捕捉到的面板目标；插件只原样回传给 `sidebarRight`。 */
export interface PaneTarget {
  readonly sessionId: string
  readonly paneId: string
  readonly host: string
  readonly tabId?: string
  readonly occurrence?: unknown
  readonly navigationRevision?: number
}

/** 右侧栏公开面里面板全屏桥要用的部分。 */
export interface SidebarFace {
  isExpanded(): boolean
  focusedTarget(element?: Element | null): PaneTarget | undefined
  commandTarget(element?: Element | null): PaneTarget | undefined
  isTargetCurrent(target: PaneTarget): boolean
  toggleFullscreen(target: PaneTarget): void
  canCloseTarget(target: PaneTarget): boolean
  closeTarget(target: PaneTarget): void
}

/** 面板全屏 / 关闭页面的免聚焦桥；`handle` 返回 true 表示已消费并接管这一按。 */
export interface FocusFreeBridge {
  handle(input: FixedInput): boolean
}

/** 面板全屏桥的返回类型；与页面关闭桥同形。 */
export type FullscreenBridge = FocusFreeBridge

/** 官方命令注册表里本插件唯一要用的动词。 */
export interface RegistryFace {
  invoke(id: string, context: {
    readonly source?: string
    readonly region: string
    readonly modal: string | null
    readonly target: Element | null
  }): void
}

/** 本插件用到的官方快捷键服务面。 */
export interface ShortcutsFace {
  readonly platform?: ShortcutPlatform
  readonly runtime?: 'desktop' | 'web'
  readonly catalog: {
    getSnapshot(): readonly ShortcutCatalogRow[]
  }
  registerFixed(command: FixedCommand): () => void
  observeFixedInput(listener: (input: FixedInput) => void): () => void
  readonly registry?: RegistryFace
}

/** Cordis 客户端上下文里本插件实际用到的最小面。 */
export interface ClientContext {
  effect(callback: () => undefined | (() => void), label?: string): unknown
  inject?<T>(deps: readonly string[], callback: (scope: T) => void): unknown
}

/** `inject` 回调拿到的子上下文；`shortcuts` 由官方快捷键服务提供。 */
export interface ClientScope {
  readonly shortcuts: ShortcutsFace
  effect(callback: () => undefined | (() => void), label?: string): unknown
}

/** 右栏服务注入回调拿到的子上下文。 */
export interface SidebarScope {
  readonly sidebarRight: SidebarFace
  effect(callback: () => undefined | (() => void), label?: string): unknown
}

/**
 * 固定键分组：挂八条固定行、接固定输入、补终端捕获。
 *
 * 面板全屏与关闭当前页面在 Web 上另有免聚焦回退：焦点不在右栏时用
 * `sidebarRight.commandTarget()` 解析活动 dock 面板，消费按键后执行与官方命令相同的
 * 动作；解析不出目标时仍交回官方命令。
 */
export function installFixedKeyBridge(ctx: ClientContext): void {
  ctx.inject?.(['shortcuts'], (scope: ClientScope) => {
    const shortcuts = scope.shortcuts
    const registry = shortcuts.registry
    if (registry === undefined || registry === null) {
      warn('官方命令注册表不可用：固定行未安装')
      return
    }
    if (!hasShortcutApi(shortcuts)) {
      warn('官方快捷键服务不可用：固定行未安装')
      return
    }
    const platform: ShortcutPlatform = shortcuts.platform ?? 'linux'

    // 面板全屏 / 关页的免聚焦桥：右栏服务可选挂载，缺席时这些键仍走官方命令。
    let fullscreen: FocusFreeBridge | undefined
    let pageClose: FocusFreeBridge | undefined
    ctx.inject?.(['sidebarRight'], (sidebarScope: SidebarScope) => {
      if (scope.shortcuts.runtime !== 'web') return
      const sidebar = sidebarScope.sidebarRight
      const fullscreenBridge = createFullscreenBridge(sidebar)
      const pageCloseBridge = createPageCloseBridge(sidebar)
      fullscreen = fullscreenBridge
      pageClose = pageCloseBridge
      sidebarScope.effect(() => () => {
        if (fullscreen === fullscreenBridge) fullscreen = undefined
        if (pageClose === pageCloseBridge) pageClose = undefined
      }, `${name}: focus-free bridges`)
    })

    for (const target of TARGETS) {
      scope.effect(() => {
        try {
          return shortcuts.registerFixed(fixedCommand(shortcuts, target, platform))
        } catch (error) {
          warn(`固定行注册失败（${keycaps(target, platform).join('+')} 未占用）：`, error)
          return undefined
        }
      }, `${name}: ${fixedIdOf(target)}`)
    }

    scope.effect(
      () => shortcuts.observeFixedInput((input) => {
        handleFixedInput(registry, platform, input, fullscreen, pageClose)
      }),
      `${name}: fixed input`,
    )

    scope.effect(() => installTerminalCapture(registry, platform), `${name}: terminal capture`)
  })
}

/** 一条固定行：官方命令的标签、平台键帽与逻辑绑定。 */
export function fixedCommand(
  shortcuts: ShortcutsFace,
  target: TargetSpec,
  platform: ShortcutPlatform,
): FixedCommand {
  return {
    id: fixedIdOf(target),
    label: () => officialLabel(shortcuts, target.id),
    keys: keycaps(target, platform),
    bindings: [bindingOf(target)],
    group: 'application',
  }
}

/** 固定行显示官方命令自己的本地化标签；命令尚未注册时退回 id。 */
function officialLabel(shortcuts: ShortcutsFace, id: string): string {
  const row = shortcuts.catalog.getSnapshot().find((candidate) => candidate.id === id)
  const label = row?.label
  return typeof label === 'string' && label !== '' ? label : id
}

/**
 * 面板全屏的免聚焦桥。
 *
 * 官方 `pane.fullscreen.toggle` 的 resolver 只认 `sidebar.focusedTarget(element)`；焦点在
 * 输入框 / 消息区时返回 `command.noFocus`，固定行也就跟着不动作。这里改用
 * `sidebar.commandTarget(element)`：面板已聚焦时仍优先，未聚焦时回退到当前 Session 的
 * 活动 dock 面板，然后执行与官方命令同一个 `toggleFullscreen()`。
 *
 * 只在 Web 运行时安装：Desktop 上这些键由原生键盘桥接另外派发，DOM 侧再执行一次会切换两次。
 */
export function createFullscreenBridge(sidebar: SidebarFace): FullscreenBridge {
  return {
    handle(input: FixedInput): boolean {
      if (input.type !== 'keydown' || input.gesture === undefined) return false
      if (!isActionable(input.gesture)) return false
      if ((input.context?.modal ?? null) !== null) return false
      // 右栏折叠时没有可见面板；交回官方命令，保持原来的 noFocus 行为。
      if (!sidebar.isExpanded()) return false
      const element = input.context?.target ?? activeElement()
      // 面板已聚焦时交给官方命令，保留它自己的可用性判断与失败原因。
      if (sidebar.focusedTarget(element) !== undefined) return false
      const target = sidebar.commandTarget(element)
      if (target === undefined) return false
      // 先消费再动作：否则官方命令会解析为 command.noFocus 并自行 preventDefault。
      input.consume?.()
      if (!sidebar.isTargetCurrent(target)) return true
      sidebar.toggleFullscreen(target)
      return true
    },
  }
}

/**
 * 关闭当前页面的免聚焦桥。
 *
 * 官方 `page.close` 的 resolver 只认 `sidebar.focusedTarget(element)`；焦点在输入框 / 消息区
 * 时返回 `blocked / command.noFocus`，固定行会先消费按键再得到一个空动作。这里按与全屏桥
 * 相同的口径回退到 `sidebar.commandTarget(element)`：面板已聚焦、右栏折叠、有模态、解析不出
 * 目标或目标不可关时都交回官方命令；只有确实能关时才消费并执行同一个 `closeTarget()`。
 *
 * 只在 Web 运行时安装：Desktop 上窗口那一半由原生命令处理，DOM 侧再执行一次会多关一层。
 */
export function createPageCloseBridge(sidebar: SidebarFace): FocusFreeBridge {
  return {
    handle(input: FixedInput): boolean {
      if (input.type !== 'keydown' || input.gesture === undefined) return false
      if (!isActionable(input.gesture)) return false
      // 模态下这一按归弹窗：`page.close` 声明了模态，官方命令会关掉最上面那层。
      if ((input.context?.modal ?? null) !== null) return false
      const element = input.context?.target ?? activeElement()
      // 面板已聚焦时交给官方命令，保留它自己的可用性判断与失败原因。
      if (sidebar.focusedTarget(element) !== undefined) return false
      // 折叠时没有「当前显示的页面」；展开本身会把焦点交给活动面板。
      if (!sidebar.isExpanded()) return false
      const target = sidebar.commandTarget(element)
      if (target === undefined) return false
      // 关不掉的页面（空面板 / 身份已变）不消费：内置命令会照原样收场。
      if (!sidebar.canCloseTarget(target)) return false
      // 先消费再执行：否则内置命令会解析为 `command.noFocus` 并自行 preventDefault。
      input.consume?.()
      if (!sidebar.isTargetCurrent(target)) return true
      sidebar.closeTarget(target)
      return true
    },
  }
}

/** 当前文档焦点；无 DOM 环境时返回 undefined。 */
function activeElement(): Element | undefined {
  if (typeof document === 'undefined') return undefined
  return document.activeElement ?? undefined
}

/** 处理固定通道投递的一次 keydown：命中本插件组合时先消费再调官方命令。 */
export function handleFixedInput(
  registry: RegistryFace,
  platform: ShortcutPlatform,
  input: FixedInput,
  fullscreen?: FocusFreeBridge,
  pageClose?: FocusFreeBridge,
): void {
  if (input.type !== 'keydown' || input.gesture === undefined) return
  if (!isActionable(input.gesture)) return
  const target = targetForGesture(platform, input.gesture)
  if (target === undefined) return
  if (target.id === 'pane.fullscreen.toggle' && fullscreen?.handle(input) === true) return
  if (target.id === 'page.close' && pageClose?.handle(input) === true) return
  input.consume?.()
  invoke(registry, target.id, {
    region: input.context?.region ?? 'page',
    modal: input.context?.modal ?? null,
    target: input.context?.target ?? null,
  })
}

/**
 * 终端内的捕获阶段拦截：xterm 会先于固定通道停掉按键，必须在这里拦下。
 *
 * 只认落点在 `.xterm` 内的事件；命中时 `preventDefault()` + `stopPropagation()`，
 * 既不让终端收到这一按，也不让固定通道再执行一次。执行仍走官方的 `registry.invoke()`。
 */
export function installTerminalCapture(
  registry: RegistryFace,
  platform: ShortcutPlatform,
): () => void {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
    return () => {}
  }
  const onKeydown = (event: KeyboardEvent): void => {
    if (event.type !== 'keydown') return
    if (event.isComposing === true || event.repeat === true || event.defaultPrevented === true) return
    const element = composedElement(event)
    if (element === null || element.closest('.xterm') === null) return
    const target = targetForGesture(platform, gestureFromEvent(event))
    if (target === undefined) return
    // 在 xterm 自己的处理器之前拿走这一按：不让它变成终端输入（Linux 上
    // Ctrl+Alt 常被当作 AltGr，会直接送字符进 shell）。
    event.preventDefault()
    event.stopPropagation()
    invoke(registry, target.id, {
      region: 'terminal',
      modal: currentModal(),
      target: element,
    })
  }
  window.addEventListener('keydown', onKeydown, true)
  return () => window.removeEventListener('keydown', onKeydown, true)
}

/** 调官方命令；命令不存在、被模态层拒绝或 resolver 抛错都不影响后续按键。 */
function invoke(
  registry: RegistryFace,
  id: string,
  context: { region: string; modal: string | null; target: Element | null },
): void {
  try {
    registry.invoke(id, { ...context, source: 'keyboard' })
  } catch (error) {
    warn(`调用官方命令 ${id} 失败：`, error)
  }
}

/** 长按、输入法组合中、已被前面的处理器消费的按键都不执行。 */
function isActionable(gesture: Gesture): boolean {
  return gesture.repeat !== true && gesture.composing !== true && gesture.defaultPrevented !== true
}

/** 从浏览器键盘事件读出一次手势。 */
function gestureFromEvent(event: KeyboardEvent): Gesture {
  return {
    code: event.code,
    control: event.ctrlKey === true,
    alt: event.altKey === true,
    shift: event.shiftKey === true,
    meta: event.metaKey === true,
    repeat: event.repeat === true,
    composing: event.isComposing === true,
    defaultPrevented: event.defaultPrevented === true,
  }
}

/** 事件组合路径里的第一个 Element。 */
function composedElement(event: KeyboardEvent): Element | null {
  for (const value of event.composedPath()) {
    if (typeof value === 'object' && value !== null && 'closest' in value) return value as Element
  }
  return null
}

/**
 * 终端捕获路径的模态读数。
 *
 * 官方适配器用 `dsh-client-ui-primitives` 的 `modalSelector`；这里只覆盖带
 * `data-shortcut-modal` 的设置 / 快捷键面板与标准 `aria-modal` 对话框。终端通常
 * 不会在模态层下获得焦点，读不到时按无模态处理。
 */
function currentModal(): string | null {
  if (typeof document === 'undefined') return null
  const node = document.querySelector('[data-shortcut-modal], [role="dialog"][aria-modal="true"]')
  if (node === null || typeof node.getAttribute !== 'function') return null
  return node.getAttribute('data-shortcut-modal') ?? 'other'
}

/** 检查官方快捷键服务面是否齐全。 */
function hasShortcutApi(shortcuts: ShortcutsFace | undefined): shortcuts is ShortcutsFace {
  return shortcuts !== undefined
    && shortcuts !== null
    && shortcuts.catalog !== undefined
    && typeof shortcuts.catalog.getSnapshot === 'function'
    && typeof shortcuts.registerFixed === 'function'
    && typeof shortcuts.observeFixedInput === 'function'
}
