/**
 * 挂载 fixed 行 `dsh-focus-free-shortcuts.page-cycle`(group `application`)，由
 * `⌘⌥←` / `⌘⌥→`(macOS)或 `Ctrl+Alt+←` / `Ctrl+Alt+→`(Windows、Linux)循环切换右栏
 * 当前页，并把键盘交给切换后的页面。声明的是逻辑组合 `primary+alt`，注册表按平台展开。
 *
 * 页面列表与切换取自 Right-Sidebar 公开面：`tabsIn(sessionId)` 按记录顺序列出页，
 * `active()` 给出当前页，`focus(tabId)` 与点击页签执行同一操作；方向为循环。
 * 切换后在渲染该页的 commit 之后定位可见 pane 并交还键盘，页面自身已取得焦点时
 * 不动它(`focusShownPage`)。
 *
 * 落在 `.xterm` 内的按键不会到达 window 上的 fixed-input 监听(终端在自己的
 * textarea 处理器里 `stopPropagation()`)，因此另外安装捕获阶段的 window
 * `keydown` 监听，在事件进入终端前判定；两条路径共用 `pageCycleTarget`，一次按键
 * 只被处理一次。
 *
 * 同一观察者还带一项非消费任务：按键为 `sidebar.right.toggle` 的生效绑定时，
 * 在有界窗口内轮询右栏展开，展开后把键盘交给当前显示页。
 */
import { captureContext, captureGesture, composedElement, terminalTarget } from './capture.ts'
import { bindingKeycaps, bindingMatches, enabledBinding, fixedRowOwns } from './binding.ts'
import { isKeydown, name, warn, type KeydownInput } from './runtime.ts'
import type {
  ShortcutCatalogEntry,
  ShortcutContext,
  ShortcutFixedCatalogEntry,
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

/** 一次按键在页面循环中的方向。 */
export type PageStep = 'previous' | 'next'

/** 本桥挂载并跟随的 fixed 页面切换行 id。 */
export const PAGE_CYCLE_ID: ShortcutCommandId = 'dsh-focus-free-shortcuts.page-cycle' as ShortcutCommandId

/** `primary+alt+←`：向循环起点方向翻一页（macOS `⌘⌥←`，Windows `Ctrl+Alt+←`）。 */
export const PAGE_PREVIOUS_BINDING: ShortcutFixedCommand['bindings'][number] = {
  code: 'ArrowLeft',
  modifiers: ['primary', 'alt'],
}

/** `primary+alt+→`：向循环终点方向翻一页（macOS `⌘⌥→`，Windows `Ctrl+Alt+→`）。 */
export const PAGE_NEXT_BINDING: ShortcutFixedCommand['bindings'][number] = {
  code: 'ArrowRight',
  modifiers: ['primary', 'alt'],
}

/** 本插件挂载的 fixed 行：占用两个方向键并声明该操作；键帽按平台格式化。 */
export function pageCycleCommand(platform: ShortcutPlatform): ShortcutFixedCommand {
  return {
    id: PAGE_CYCLE_ID,
    label: () => '切换右栏页面',
    keys: bindingKeycaps(PAGE_PREVIOUS_BINDING, platform, '←/→'),
    bindings: [PAGE_PREVIOUS_BINDING, PAGE_NEXT_BINDING],
    group: 'application',
  }
}

/**
 * 展开交付所跟随的官方便捷命令 id。该命令可配置，因此按生效目录匹配，
 * 不硬编码按键。
 */
export const SIDEBAR_TOGGLE_ID = 'sidebar.right.toggle'

/**
 * 挂载行自己的绑定为该次按键指明的方向。
 *
 * 按行是否拥有该按键判定，并读取命中的 binding 的 `code`；行未挂载或未命中则返回
 * undefined。
 */
export function pageStepFor(
  rows: readonly ShortcutFixedCatalogEntry[],
  id: string,
  gesture: ShortcutGesture,
): PageStep | undefined {
  const row = rows.find((candidate) => candidate.id === id)
  if (row === undefined) return undefined
  const matched = row.bindings.find((binding) => bindingMatches(binding, gesture))
  if (matched === undefined) return undefined
  if (matched.code === PAGE_NEXT_BINDING.code) return 'next'
  if (matched.code === PAGE_PREVIOUS_BINDING.code) return 'previous'
  return undefined
}

/**
 * 该次按键能否在没有 DOM 焦点时切换页面。
 *
 * 任何输入区域都接受，已消费的按键(`defaultPrevented`)也照常处理；只保留输入法
 * 组合中、自动重复与存在模态这三项排除。
 */
export function pageCycleEligible(gesture: ShortcutGesture, context: ShortcutContext): boolean {
  return !gesture.repeat
    && !gesture.composing
    && context.modal === null
}

/**
 * 循环页列中与当前页相邻的一页；不足两页、当前页不在列表中时返回 undefined。
 */
export function steppedPageId<T extends string>(
  pages: readonly T[],
  currentId: T | undefined,
  step: PageStep,
): T | undefined {
  if (pages.length < 2) return undefined
  const index = currentId === undefined ? -1 : pages.indexOf(currentId)
  if (index < 0) return undefined
  const delta = step === 'next' ? 1 : -1
  return pages[(index + delta + pages.length) % pages.length]
}

/**
 * 把键盘交给右栏当前显示的页面，页面已自行取得焦点时不动它。
 *
 * 在相关 commit 之后运行：定位该 Session 的右栏根节点，选出可见 pane(优先 active
 * 标记，否则第一个可见 pane)并聚焦。pane 内部已有焦点则保持；仅 pane 元素自身
 * 持有焦点且页面有自己的输入面时，继续下探到该输入面。
 * @returns 是否找到可见 pane 并持有键盘。
 */
export function focusShownPage(sessionId: string): boolean {
  const root = sidebarRoot(sessionId)
  if (root === undefined) return false
  const pane = activePane(root)
  if (pane === undefined) return false
  const focused = typeof document === 'undefined' ? null : document.activeElement
  if (focused !== null && pane.contains(focused)) {
    // 页面自己取得焦点(如终端的 xterm 输入)时保持不变；只有 pane 元素自身持有
    // 焦点时才下探到页面的输入面。
    if (focused !== pane) return true
    const input = pageInput(pane)
    if (input === undefined) return true
    focusElement(input, { preventScroll: true })
    return true
  }
  focusPane(pane)
  const input = pageInput(pane)
  if (input !== undefined) focusElement(input, { preventScroll: true })
  return true
}

/**
 * 页面自己的输入面，若存在且接受键盘。
 *
 * 只认终端：`.xterm` 内的 `.xterm-helper-textarea`。该输入 `readOnly` 时视为页面
 * 没有自己的输入面，返回 undefined。
 */
function pageInput(pane: Element): Element | undefined {
  const screen = pane.querySelector('.xterm')
  const input = screen?.querySelector('.xterm-helper-textarea')
  if (input === null || input === undefined) return undefined
  return (input as { readOnly?: boolean }).readOnly === true ? undefined : input
}

/**
 * 某 Session 的右栏根节点：按 `data-sidebar-right-session` 属性值比较，而不是把 id
 * 拼进选择器。返回该根节点或 undefined。
 */
function sidebarRoot(sessionId: string): Element | undefined {
  if (typeof document === 'undefined') return undefined
  const roots = [...document.querySelectorAll('[data-sidebar-right-session]')]
    .filter((node) => node.getAttribute('data-sidebar-right-session') === sessionId)
  // SessionView 包装节点与其内部的面板 div 都带该标记；面板更深，且展开时带
  // `data-sidebar-right-open`，pane 在其内部。优先取带 open 的，否则取最深的。
  return roots.find((node) => node.hasAttribute('data-sidebar-right-open'))
    ?? roots[roots.length - 1]
}

/**
 * 右栏当前呈现的 pane：带 active 标记的，否则第一个可见 pane。
 *
 * `[data-dockkit-pane]` 需右栏展开，`[data-dockkit-float]` 始终可见；位于
 * `hidden` / `aria-hidden="true"` 下的不算。返回选中的 pane 或 undefined。
 */
export function activePane(root: Element): Element | undefined {
  const panes = [...root.querySelectorAll('[data-dockkit-pane], [data-dockkit-float]')]
    .filter((pane) => pane.closest('[hidden], [aria-hidden="true"]') === null
      && (pane.hasAttribute('data-dockkit-float') || root.hasAttribute('data-sidebar-right-open')))
  return panes.find((pane) => pane.hasAttribute('data-dockkit-pane-active') || pane.hasAttribute('data-dockkit-float-active'))
    ?? panes[0]
}

/** `Element.focus` 定义在 `HTMLElement` 上；页面 pane 一定是它。 */
function focusPane(pane: Element): void {
  const focusable = pane as unknown as { focus?: (options?: FocusOptions) => void }
  focusable.focus?.({ preventScroll: true })
}

/** 聚焦任意鸭子类型的可聚焦元素；测试元素形状相同。 */
function focusElement(element: Element | undefined, options?: FocusOptions): void {
  const focusable = element as unknown as { focus?: (options?: FocusOptions) => void }
  focusable.focus?.(options)
}

/** 页面切换反映到 DOM 之后、下一次绘制之前运行一次回调。 */
function whenShown(run: () => void): void {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => run())
  else run()
}

/**
 * 一次按键切换页面所需的全部信息，按当前状态解析；返回 undefined 表示不动该按键。
 *
 * 两条投递路径(观察者与终端前的捕获拦截)共用本判定，结果包含要切换的 Session 与
 * 要聚焦的页。
 */
export function pageCycleTarget(
  shortcuts: Shortcuts,
  sidebar: Sidebar,
  gesture: ShortcutGesture,
  context: ShortcutContext,
): PageStepTarget | undefined {
  if (!pageCycleEligible(gesture, context)) return undefined
  const step: PageStep | undefined = pageStepFor(shortcuts.fixedCatalog.getSnapshot(), PAGE_CYCLE_ID, gesture)
  if (step === undefined) return undefined
  // 右栏折叠时不显示任何页：既没有可切换的页，也没有可聚焦的可见 pane，展开由
  // `sidebar.right.toggle` 自己负责。
  if (!sidebar.isExpanded()) return undefined
  const sessionId = sidebar.mounted.getSnapshot()
  if (sessionId === undefined) return undefined
  const pages = sidebar.tabsIn(sessionId).map((tab) => tab.id)
  const currentId = sidebar.active()?.id
  const nextId = steppedPageId(pages, currentId, step)
  // `nextId === undefined` 覆盖只有一页、无 active 页签、Session 未接管等情形；
  // `nextId === currentId` 作为兜底判断保留。
  if (nextId === undefined || nextId === currentId) return undefined
  return { sessionId, nextId }
}

/** 一次解析出的切换：所在 Session 与要聚焦的页。 */
export interface PageStepTarget {
  readonly sessionId: string
  readonly nextId: string
}

/**
 * 桥接页面切换键。
 *
 * 通过两条路径投递按键：观察者处理 DOM 通道收到的按键；捕获阶段 window
 * `keydown` 监听处理落在 `.xterm` 内、通道收不到的按键。两条路径运行同一判定
 * (`pageCycleTarget`)与同一切换，一次按键只被处理一次。
 *
 * 观察者还带一项非消费任务：交付 `sidebar.right.toggle` 展开后所显示的页面的焦点。
 */
export function installPageCycleBridge(ctx: Context): void {
  ctx.inject(['shortcuts', 'sidebarRight'], (scope) => {
    const shortcuts: Shortcuts = scope.shortcuts
    const sidebar: Sidebar = scope.sidebarRight
    if (typeof shortcuts.observeFixedInput !== 'function') {
      warn('shortcuts service exposes no observeFixedInput; page-cycle keys not installed')
      return
    }
    // 行必须先挂载，观察者才能读到它；两者同在本 scope，按同序销毁。
    scope.effect(() => shortcuts.registerFixed(pageCycleCommand(shortcuts.platform)), `${name}: page cycle fixed row`)
    scope.effect(() => shortcuts.observeFixedInput((input) => {
      if (!isKeydown(input)) return
      handlePageCycleInput(shortcuts, sidebar, input)
      // 展开交付跟随同一次按键：页面切换键匹配 fixed 行、toggle 匹配可配置行，
      // 两者不会同时成立，最多只有一个动作。
      handOverOnExpand(shortcuts, sidebar, input)
    }), `${name}: page cycle keys`)
    // 终端那一半：落在 `.xterm` 内的 keydown 到不了上面的 window 监听(终端在自己的
    // textarea 处理器里停掉了它)，本捕获监听早一个阶段看到它，且早于事件进入终端。
    // 只处理终端本会占用的按键，并复用观察者使用的同一判定函数。
    scope.effect(() => {
      if (typeof window === 'undefined') return () => {}
      const onKeydown = (event: KeyboardEvent): void => {
        if (event.type !== 'keydown') return
        const element = composedElement(event)
        if (!terminalTarget(element)) return
        const target = pageCycleTarget(shortcuts, sidebar, captureGesture(event), captureContext(element))
        if (target === undefined) return
        // 在终端自身处理器之前拦截：事件到此为止，xterm 既收不到该按键，也不会向
        // shell 发送转义序列。
        event.preventDefault()
        event.stopPropagation()
        switchPage(sidebar, target)
      }
      window.addEventListener('keydown', onKeydown, true)
      return () => window.removeEventListener('keydown', onKeydown, true)
    }, `${name}: page cycle terminal capture`)
  })
}

/**
 * 处理 DOM 通道投递的一次 keydown：解析全部条件后消费该按键并执行切换。
 */
function handlePageCycleInput(shortcuts: Shortcuts, sidebar: Sidebar, input: KeydownInput): void {
  const target = pageCycleTarget(shortcuts, sidebar, input.gesture, input.context)
  if (target === undefined) return
  // 先消费再动作，避免该按键同时被页面内的输入控件处理。
  input.consume()
  switchPage(sidebar, target)
}

/**
 * 执行一次已解析的切换：聚焦目标页，再在显示该页的 commit 之后把键盘交给它。
 *
 * `sidebar.focus(nextId)` 与点击页签是同一操作，其 commit 由渲染器异步绘制，因此
 * pane 在下一动画帧才定位。
 */
function switchPage(sidebar: Sidebar, target: PageStepTarget): void {
  sidebar.focus(target.nextId)
  whenShown(() => {
    focusShownPage(target.sessionId)
  })
}

/**
 * 该次按键是否为生效目录中 `sidebar.right.toggle` 当前的绑定。不消费按键。
 */
export function expansionPress(
  rows: readonly ShortcutCatalogEntry[],
  gesture: ShortcutGesture,
  context: ShortcutContext,
): boolean {
  if (gesture.repeat || gesture.composing || context.modal !== null) return false
  const binding = enabledBinding(rows, SIDEBAR_TOGGLE_ID)
  return binding !== undefined && bindingMatches(binding, gesture)
}

/**
 * 一次 keydown 的展开交付：轮询右栏展开状态，展开后把键盘交给当前显示页。
 *
 * 观察者在可配置分发之前运行，故这里的 `isExpanded()` 读到的是按键前的状态，
 * `false` 表示这一次就是展开动作。不消费按键(`sidebar.right.toggle` 保留归属)。
 */
function handOverOnExpand(shortcuts: Shortcuts, sidebar: Sidebar, input: KeydownInput): void {
  if (!expansionPress(shortcuts.catalog.getSnapshot(), input.gesture, input.context)) return
  if (sidebar.isExpanded()) return
  const sessionId = sidebar.mounted.getSnapshot()
  if (sessionId === undefined) return
  expandHandOver(sidebar, sessionId)
}

/** 展开交付等待右栏报告展开的最长时间(毫秒)。 */
const EXPAND_WINDOW_MS = 800

/** 展开交付轮询右栏展开状态的间隔(毫秒)。 */
const EXPAND_PROBE_MS = 50

/** 同一窗口内只运行一次展开交付(后续按键合并)。 */
let expandHandOverActive = false

/**
 * 展开交付：按有界调度轮询右栏是否展开，一旦展开就把键盘交给当前显示页。
 *
 * 在下一帧运行交付(在 toggle 留下的 pane 焦点之后)；pane 容器自身持有焦点时补上
 * 页面自己的输入面，页面已自行取得焦点则不动。窗口内始终未展开则放弃。
 */
function expandHandOver(sidebar: Sidebar, sessionId: string): void {
  if (expandHandOverActive) return
  expandHandOverActive = true
  let remaining = Math.ceil(EXPAND_WINDOW_MS / EXPAND_PROBE_MS)
  const step = (): void => {
    if (sidebar.isExpanded()) {
      expandHandOverActive = false
      whenShown(() => {
        if (!sidebar.isExpanded()) return
        focusShownPage(sessionId)
      })
      return
    }
    if (remaining === 0) {
      expandHandOverActive = false
      return
    }
    remaining -= 1
    whenLater(EXPAND_PROBE_MS, step)
  }
  whenLater(0, step)
}

/** 展开交付的一次延迟探测；无定时器环境下不做任何事。 */
function whenLater(ms: number, run: () => void): void {
  if (typeof window !== 'undefined' && typeof window.setTimeout === 'function') {
    window.setTimeout(run, ms)
  }
}

