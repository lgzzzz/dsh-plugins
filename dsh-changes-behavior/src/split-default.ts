/**
 * 右栏改动审查标签页的默认 diff 布局：非全屏（`push`）用单栏，全屏（`fullscreen`）用左右对比。
 *
 * 上游 `@deepseek-ai/dsh-client-ui-deliverables` 把分栏状态存在每个审查标签页自己的 review
 * store 记录里（`{ index, split: true, wrap: false, navigated }`），首次 seed 默认
 * `split: true`；唯一写入口是工具栏分栏按钮的 `onClick`（`actions.toggledSplit(tab.id)`）。
 * 右栏的呈现方式写在面板根的 `[data-sidebar-right-panel]` 上（`push` / `fullscreen`）。
 *
 * 本模块在审查标签页挂载时、以及面板的呈现方式变化时，按面板现值选择默认布局：
 *
 *   - **push → 单栏；fullscreen → 左右对比**。面板本来就是窄窗口自动全屏时同样读作
 *     `fullscreen`，因此窄窗口下的默认仍是左右对比。
 *   - **每个标签页每个呈现方式只设一次默认值**：同一标签页切走再切回、或用户手动点过
 *     分栏按钮时，不会被重新改写；关闭再打开得到新的占位实例 id，重新按默认值处理。
 *   - **首次挂载先等 store seed**：`aria-pressed` 在 seed 前是 `false`，直接读会把“还没
 *     seed”误判成“用户选了单栏”。上游首次 seed 恒为 `split: true`，所以等到按钮变成
 *     `true` 再决定；确认失败才下一帧重试。
 *   - **不合成点击**：直接调用分栏按钮在 React fiber 上的 `onClick`，异常收在本模块的
 *     `try/catch` 里，下一帧再试，不让它穿过 React 事件派发。
 *   - **失败收敛为保持上游默认**：找不到按钮 / 呈现方式 / onClick，或写入口连续抛错，
 *     只告警并放手，工具栏的分栏按钮仍然可用。
 *
 * 上游锚点与边界见 docs/dsh-changes-behavior.md。
 */
import { findClickHandler } from './fiber.ts'

/** 插件 id：诊断与 DOM 标记都用它。 */
export const name = 'dsh-changes-behavior'

/** 审查标签页根元素；只有 changes-review 这个槽位用它。 */
export const REVIEW_SELECTOR = '[data-changes-review]'

/** 工具栏里的分栏开关。 */
export const SPLIT_TOOL_SELECTOR = '[data-review-tool="split"]'

/** 右栏面板根；呈现方式写在它的属性上。 */
export const PANEL_SELECTOR = '[data-sidebar-right-panel]'

/** 面板根上的呈现方式属性。 */
export const PANEL_ATTRIBUTE = 'data-sidebar-right-panel'

/** 推挤呈现（非全屏）时的属性值。 */
export const PUSH = 'push'

/** 全屏呈现时的属性值；窄窗口的自动全屏同样用它。 */
export const FULLSCREEN = 'fullscreen'

/** 标签页占位实例（每个标签页的 store 记录与它同生共死），本插件用它作身份。 */
export const OCCURRENCE_SELECTOR = '[data-sidebar-right-occurrence]'

/** 标签页 id；占位实例缺席时的身份回退。 */
export const TAB_SELECTOR = '[data-sidebar-right-tab]'

/** 会话 id；与标签页 id 一起构成跨会话唯一的回退身份。 */
export const SESSION_SELECTOR = '[data-sidebar-right-session]'

/** 本插件在审查根元素上的生效标记，值是最近一次应用的呈现方式。 */
export const APPLIED_MARKER = 'data-dsh-review-split'

/** 本插件在文档根元素上的安装标记。 */
export const INSTALL_MARKER = 'data-dsh-changes-behavior-split'

/** 写入口连续失败时的重试帧数；约 12 帧足够跨过 `ReviewTab` 的 seed effect。 */
export const MAX_ATTEMPTS = 12

/** 右栏面板的呈现方式。 */
export type PanelMode = 'push' | 'fullscreen'

/** 一次同步的结论，供测试与诊断。 */
export type SplitOutcome = 'applied' | 'already' | 'skipped' | 'detached' | 'retry' | 'gave-up'

/** 可被本插件读写的最小元素形状（生产环境是 `Element`）。 */
export interface ElementLike {
  getAttribute?(name: string): string | null
  setAttribute?(name: string, value: string): void
  removeAttribute?(name: string): void
  hasAttribute?(name: string): boolean
  closest?(selector: string): ElementLike | null
  querySelector?(selector: string): ElementLike | null
  querySelectorAll?(selector: string): ArrayLike<ElementLike>
  matches?(selector: string): boolean
  readonly isConnected?: boolean
  readonly disabled?: boolean
}

/** 一条变更记录里本插件用到的字段。 */
export interface MutationRecordLike {
  readonly target?: ElementLike | null
  readonly addedNodes?: ArrayLike<unknown>
}

/** 可观察节点树的最小文档形状；生产环境是 `Document`。 */
export interface DocumentLike {
  readonly body?: ElementLike | null
  readonly documentElement?: ElementLike | null
  readonly defaultView?: unknown
  querySelectorAll?(selector: string): ArrayLike<ElementLike>
}

/** 观察器的最小子集（生产环境是 `MutationObserver`）。 */
export interface ObserverLike {
  observe(target: ElementLike, options: {
    childList: boolean
    subtree: boolean
    attributes?: boolean
    attributeFilter?: string[]
  }): void
  disconnect(): void
}

/** 观察器构造器；生产环境是 `MutationObserver`。 */
export type ObserverConstructor = new (callback: (records: MutationRecordLike[]) => void) => ObserverLike

/** 运行期可注入项：测试用它替换调度器与告警。 */
export interface SplitRuntime {
  /** 安排一次下一帧的重试。 */
  readonly schedule?: (callback: () => void) => void
  /** 输出一条带插件前缀的诊断。 */
  readonly warn?: (message: string) => void
}

/** 运行期缓存。 */
export interface SplitState {
  /** 已按默认值处理过、且记住了当时呈现方式的标签页身份。 */
  readonly applied: Map<string, PanelMode>
  /** 正在重试的标签页身份。 */
  readonly pending: Set<string>
  /** 已经成功同步过至少一次的标签页身份：用来区分首次挂载与切页重挂。 */
  readonly seen: Set<string>
  /** 重试期间每个身份的最新根元素（切页重挂时旧节点会断开）。 */
  readonly roots: Map<string, ElementLike>
  /** 已告警过的 topic，避免同一失败反复刷屏。 */
  readonly warned: Set<string>
  readonly schedule: (callback: () => void) => void
  readonly warn: (message: string) => void
}

/** 一个普通对象。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** 默认调度器：有 `requestAnimationFrame` 就等下一帧，否则退回 16ms 定时器。 */
function defaultSchedule(callback: () => void): void {
  const raf = (globalThis as { requestAnimationFrame?: (handler: () => void) => unknown }).requestAnimationFrame
  if (typeof raf === 'function') raf(() => callback())
  else setTimeout(callback, 16)
}

/** 默认告警：统一加插件前缀。 */
function defaultWarn(message: string): void {
  console.warn(`[${name}] ${message}`)
}

/** 创建一份空状态。 */
export function createSplitState(runtime: SplitRuntime = {}): SplitState {
  return {
    applied: new Map(),
    pending: new Set(),
    seen: new Set(),
    roots: new Map(),
    warned: new Set(),
    schedule: runtime.schedule ?? defaultSchedule,
    warn: runtime.warn ?? defaultWarn,
  }
}

/** 把一个 ArrayLike 展开成数组（不依赖 `Array.from` 的 DOM 特例）。 */
function toArray<T>(list: ArrayLike<T> | undefined | null): T[] {
  if (list === undefined || list === null) return []
  const out: T[] = []
  for (let index = 0; index < list.length; index += 1) out.push(list[index])
  return out
}

/** 读取最近的祖先上的属性值；取不到或为空串时返回 null。 */
function closestAttribute(element: ElementLike, selector: string, attribute: string): string | null {
  const holder = typeof element.closest === 'function' ? element.closest(selector) : null
  const value = holder?.getAttribute?.(attribute)
  return typeof value === 'string' && value !== '' ? value : null
}

/**
 * 一个审查标签页的身份。
 *
 * 优先占位实例 id：它跨会话唯一，且切页重挂时保持不变，恰好对应“这条 review store 记录”。
 * 占位实例属性缺席时退回「会话 id + 标签页 id」；两者都取不到就不猜。
 * @param root - `[data-changes-review]` 根元素。
 * @returns 稳定身份字符串，或 null。
 */
export function reviewKey(root: ElementLike): string | null {
  const occurrence = closestAttribute(root, OCCURRENCE_SELECTOR, 'data-sidebar-right-occurrence')
  if (occurrence !== null) return `occurrence:${occurrence}`
  const tab = closestAttribute(root, TAB_SELECTOR, 'data-sidebar-right-tab')
  if (tab === null) return null
  const session = closestAttribute(root, SESSION_SELECTOR, 'data-sidebar-right-session') ?? ''
  return `tab:${session}|${tab}`
}

/**
 * 审查标签页所在右栏面板的呈现方式。
 *
 * 面板根的 `[data-sidebar-right-panel]` 是布局状态 `mode` 的 DOM 读数；窄窗口的自动全屏也
 * 输出 `fullscreen`。浮动面板同样挂在面板根内，读数沿用所属面板。
 * @param root - `[data-changes-review]` 根元素。
 * @returns `push`、`fullscreen`，或还读不到面板时的 undefined。
 */
export function panelModeOf(root: ElementLike): PanelMode | undefined {
  const panel = typeof root.closest === 'function' ? root.closest(PANEL_SELECTOR) : null
  const value = panel?.getAttribute?.(PANEL_ATTRIBUTE)
  if (value === FULLSCREEN) return 'fullscreen'
  if (value === PUSH) return 'push'
  return undefined
}

/** 告警一次（同一个 topic 不重复）。 */
function warnOnce(state: SplitState, topic: string, message: string): void {
  if (state.warned.has(topic)) return
  state.warned.add(topic)
  state.warn(message)
}

/** 成功或确认已符合默认值：记住身份与呈现方式，给根元素留一个生效标记。 */
function settle(root: ElementLike, key: string, state: SplitState, mode: PanelMode, outcome: 'applied' | 'already'): SplitOutcome {
  state.seen.add(key)
  state.pending.delete(key)
  state.roots.delete(key)
  state.applied.set(key, mode)
  root.setAttribute?.(APPLIED_MARKER, mode)
  return outcome
}

/**
 * 处理一个审查标签页；已经按当前呈现方式设过默认值时直接跳过。
 *
 * 跳过是“尊重用户”的关键：切页重挂时 React 会卸载 / 重挂标签页正文，但 store 记录还在，
 * 用户手动关掉的分栏不会被重新打开。
 * @param root - `[data-changes-review]` 根元素。
 * @param state - 运行期缓存。
 * @returns 本次结论。
 */
export function syncReviewSplit(root: ElementLike, state: SplitState): SplitOutcome {
  const key = reviewKey(root)
  if (key === null) {
    warnOnce(state, 'identity', '找不到审查标签页的占位 id / 标签页 id，无法判断默认分栏的作用范围，已跳过')
    return 'skipped'
  }
  state.roots.set(key, root)
  const mode = panelModeOf(root)
  if (mode !== undefined && state.applied.get(key) === mode) {
    root.setAttribute?.(APPLIED_MARKER, mode)
    return 'skipped'
  }
  if (state.pending.has(key)) return 'skipped'
  state.pending.add(key)
  return attempt(root, key, state, 0)
}

/**
 * 尝试把分栏状态写成当前呈现方式对应的默认值。
 *
 * 只有“确认失败或还没到可判断的时候”才重试：读不到按钮 / 呈现方式、首次挂载时 store 还没
 * seed、取不到 onClick、按钮不可操作、onClick 抛错。一次成功调用之后不再复核：切换分栏本身
 * 就是 toggle，复核失败时再调一次会把刚设好的布局又翻回去。
 */
function attempt(root: ElementLike, key: string, state: SplitState, tries: number): SplitOutcome {
  const current = state.roots.get(key) ?? root
  if (current.isConnected === false) {
    state.pending.delete(key)
    state.roots.delete(key)
    return 'detached'
  }
  const mode = panelModeOf(current)
  const button = current.querySelector?.(SPLIT_TOOL_SELECTOR) ?? null
  if (button === null) return retry(current, key, state, tries, '审查标签页里找不到分栏按钮（[data-review-tool="split"]）')
  if (mode === undefined) return retry(current, key, state, tries, '找不到右栏面板的呈现方式（[data-sidebar-right-panel]）')
  const pressed = button.getAttribute?.('aria-pressed') === 'true'
  // 首次挂载：seed 前按钮是 false，等上游写入默认的 split:true 再决定。
  if (!state.seen.has(key) && !pressed) {
    return retry(current, key, state, tries, '等待审查标签页的 review store 写入默认分栏状态')
  }
  const desired = mode === FULLSCREEN
  if (pressed === desired) return settle(current, key, state, mode, 'already')
  if (button.disabled === true) return retry(current, key, state, tries, '分栏按钮处于不可操作状态')
  if (button.getAttribute?.('aria-disabled') === 'true') return retry(current, key, state, tries, '分栏按钮处于不可操作状态')
  const handler = findClickHandler(button)
  if (handler === null) return retry(current, key, state, tries, '在分栏按钮的 React fiber 上取不到 onClick')
  try {
    handler()
  } catch {
    return retry(current, key, state, tries, '写入分栏状态时抛错（review store 可能还没有这个标签页的记录）')
  }
  return settle(current, key, state, mode, 'applied')
}

/** 安排一次重试；帧数用尽后告警并放手。 */
function retry(root: ElementLike, key: string, state: SplitState, tries: number, reason: string): SplitOutcome {
  const next = tries + 1
  if (next >= MAX_ATTEMPTS) {
    state.pending.delete(key)
    state.roots.delete(key)
    warnOnce(state, key, `${reason}；已重试 ${MAX_ATTEMPTS} 帧，这个审查标签页保持上游的默认分栏设置，可手动点工具栏的“左右对比”`)
    return 'gave-up'
  }
  state.schedule(() => {
    if (!state.pending.has(key)) return
    attempt(state.roots.get(key) ?? root, key, state, next)
  })
  return 'retry'
}

/** 从一棵新插入的子树里找出审查根元素。 */
function reviewRootsIn(node: unknown): ElementLike[] {
  if (typeof node !== 'object' || node === null) return []
  const element = node as ElementLike
  const roots: ElementLike[] = []
  if (typeof element.matches === 'function' && element.matches(REVIEW_SELECTOR)) roots.push(element)
  roots.push(...toArray(element.querySelectorAll?.(REVIEW_SELECTOR)))
  return roots
}

/** 观察器构造器：优先文档所属 window，其次全局。 */
function observerOf(doc: DocumentLike): ObserverConstructor | null {
  const view = doc.defaultView
  if (isRecord(view) && typeof view.MutationObserver === 'function') {
    return view.MutationObserver as ObserverConstructor
  }
  const globalObserver = (globalThis as { MutationObserver?: ObserverConstructor }).MutationObserver
  return typeof globalObserver === 'function' ? globalObserver : null
}

/**
 * 装上默认分栏：扫一遍现有审查根元素，然后观察标签页挂载与面板呈现方式的变化。
 * @param doc - 文档；省略时取 `globalThis.document`。
 * @param runtime - 测试可注入的调度器 / 告警。
 * @returns 卸载函数（断开观察并移除安装标记）。
 */
export function installReviewSplitDefault(
  doc: DocumentLike = globalThis.document as unknown as DocumentLike,
  runtime: SplitRuntime = {},
): () => void {
  const body = doc.body
  const Observer = observerOf(doc)
  if (body === undefined || body === null || Observer === null) return () => {}

  const state = createSplitState(runtime)
  const observer = new Observer((records) => {
    for (const record of records) {
      // 标签页正文新挂载：可能是审查标签页自己，也可能包含它。
      for (const node of toArray(record.addedNodes)) {
        for (const root of reviewRootsIn(node)) syncReviewSplit(root, state)
      }
      // 面板的呈现方式变了：重新按新值设该面板里已挂载审查标签页的默认值。
      const target = record.target
      if (target !== null && target !== undefined && target.hasAttribute?.(PANEL_ATTRIBUTE) === true) {
        for (const root of toArray(target.querySelectorAll?.(REVIEW_SELECTOR))) syncReviewSplit(root, state)
      }
    }
  })
  observer.observe(body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: [PANEL_ATTRIBUTE],
  })
  doc.documentElement?.setAttribute?.(INSTALL_MARKER, '')
  for (const root of toArray(doc.querySelectorAll?.(REVIEW_SELECTOR))) syncReviewSplit(root, state)

  return () => {
    observer.disconnect()
    doc.documentElement?.removeAttribute?.(INSTALL_MARKER)
  }
}
