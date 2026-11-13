/**
 * 让右栏的改动审查标签页默认开启自动换行。
 *
 * 上游把换行状态存在每个审查标签页自己的 review store 记录里（`{ index, split, wrap, navigated }`），
 * 默认 `wrap: false`；唯一写入口是工具栏换行按钮的 `onClick`（`actions.toggledWrap(tab.id)`）。
 * 本插件在每个新审查标签页第一次挂载时替用户按一次那个动作，之后不再干预：
 *
 * - **一个标签页只改一次**：以最近的 `[data-sidebar-right-occurrence]`（标签页占位实例的随机 id）
 *   作为身份；切走再切回时 React 会卸载 / 重挂标签页正文，但 store 记录还在，用户关掉的换行不会被
 *   重新打开。关闭标签页会同时结束 store 记录，重新打开得到新的占位 id，于是重新按默认开启。
 * - **不合成点击**：直接调用换行按钮在 fiber 上的 `onClick`，避免在 review store 还没 seed 完时
 *   让 `no review state for tab …` 穿过 React 事件派发；调用失败就下一帧再试，并保留手动开关。
 * - **失败收敛为“不换行”**：找不到按钮 / onClick、写入口连续抛错，都只告警并放手，不改 DOM 布局。
 *
 * 上游锚点与已知边界见 docs/dsh-changes-behavior.md。
 */
import { findClickHandler } from './fiber.ts'

/** 插件 id：诊断前缀与样式 / 标记命名都用它。 */
export const name = 'dsh-changes-behavior'

/** 审查标签页根元素；只有 changes-review 这个槽位用它。 */
export const REVIEW_SELECTOR = '[data-changes-review]'

/** 工具栏里的换行开关。 */
export const WRAP_TOOL_SELECTOR = '[data-review-tool="wrap"]'

/** diff 正文根元素；`data-review-wrap` 挂在它身上。 */
export const WRAP_BODY_SELECTOR = '[data-review-view]'

/** 换行开启时上游写在正文根元素上的属性（渲染值是 `"true"`）。 */
export const WRAP_ATTRIBUTE = 'data-review-wrap'

/** 标签页占位实例（每个标签页的 store 记录与它同生共死），本插件用它作身份。 */
export const OCCURRENCE_SELECTOR = '[data-sidebar-right-occurrence]'

/** 标签页 id；占位实例缺席时的身份回退，也是 `toggledWrap(tab.id)` 的参数来源。 */
export const TAB_SELECTOR = '[data-sidebar-right-tab]'

/** 会话 id；与标签页 id 一起构成跨会话唯一的回退身份。 */
export const SESSION_SELECTOR = '[data-sidebar-right-session]'

/** 本插件在审查根元素上的生效标记；存在即表示这个标签页已按默认值处理过。 */
export const APPLIED_MARKER = 'data-dsh-review-wrap'

/** 本插件在文档根元素上的安装标记。 */
export const INSTALL_MARKER = 'data-dsh-changes-behavior-wrap'

/** 写入口连续失败时的重试帧数；约 8 帧足够跨过 `ReviewTab` 的 seed effect。 */
export const MAX_ATTEMPTS = 8

/** 一次同步的结论，供测试与诊断。 */
export type WrapOutcome = 'wrapped' | 'already' | 'skipped' | 'detached' | 'retry' | 'gave-up'

/** 可被本插件读写的最小元素形状（生产环境是 `Element`；上游无公开类型，测试接缝）。 */
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

/** 变更记录里本插件用到的字段（MutationRecord 的测试接缝）。 */
export interface MutationRecordLike {
  readonly addedNodes?: ArrayLike<unknown>
}

/** 可观察节点树的最小文档形状；生产环境是 `Document`（上游无公开类型，测试接缝）。 */
export interface DocumentLike {
  readonly body?: ElementLike | null
  readonly documentElement?: ElementLike | null
  readonly defaultView?: unknown
  querySelectorAll?(selector: string): ArrayLike<ElementLike>
}

/** 观察器的最小子集（生产环境是 `MutationObserver`；测试接缝）。 */
export interface ObserverLike {
  observe(target: ElementLike, options: { childList: boolean; subtree: boolean }): void
  disconnect(): void
}

/** 观察器构造器；生产环境是 `MutationObserver`（测试接缝）。 */
export type ObserverConstructor = new (callback: (records: MutationRecordLike[]) => void) => ObserverLike

/** 运行期可注入项（测试接缝）：替换调度器与告警，上游没有对应类型。 */
export interface WrapRuntime {
  /** 安排一次下一帧的重试。 */
  readonly schedule?: (callback: () => void) => void
  /** 输出一条带插件前缀的诊断。 */
  readonly warn?: (message: string) => void
}

/** 运行期缓存。 */
export interface WrapState {
  /** 已按默认值处理过的标签页身份。 */
  readonly done: Set<string>
  /** 正在重试的标签页身份。 */
  readonly pending: Set<string>
  /** 已告警过的 topic，避免同一失败反复刷屏。 */
  readonly warned: Set<string>
  /** 重试期间每个身份的最新根元素（切页重挂时旧节点会断开）。 */
  readonly roots: Map<string, ElementLike>
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
export function createWrapState(runtime: WrapRuntime = {}): WrapState {
  return {
    done: new Set(),
    pending: new Set(),
    warned: new Set(),
    roots: new Map(),
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

/** 告警一次（同一个 topic 不重复）。 */
function warnOnce(state: WrapState, topic: string, message: string): void {
  if (state.warned.has(topic)) return
  state.warned.add(topic)
  state.warn(message)
}

/** 正文是否已经被上游渲染成换行态。 */
function isWrapped(button: ElementLike | null, body: ElementLike | null): boolean {
  if (button?.getAttribute?.('aria-pressed') === 'true') return true
  if (body === null) return false
  if (typeof body.hasAttribute === 'function') return body.hasAttribute(WRAP_ATTRIBUTE)
  return body.getAttribute?.(WRAP_ATTRIBUTE) !== null
}

/** 按钮是否不可操作（上游当前不会禁用换行按钮，保留判断以防日后加锁）。 */
function isDisabled(button: ElementLike): boolean {
  if (button.disabled === true) return true
  return button.getAttribute?.('aria-disabled') === 'true'
}

/** 成功：记住身份、移除重试登记、给根元素留一个生效标记。 */
function settle(root: ElementLike, key: string, state: WrapState): void {
  state.done.add(key)
  state.pending.delete(key)
  state.roots.delete(key)
  root.setAttribute?.(APPLIED_MARKER, '')
}

/**
 * 处理一个审查标签页；身份已处理过时直接跳过。
 * @param root - `[data-changes-review]` 根元素。
 * @param state - 运行期缓存。
 * @returns 本次结论。
 */
export function defaultReviewWrap(root: ElementLike, state: WrapState): WrapOutcome {
  const key = reviewKey(root)
  if (key === null) {
    warnOnce(state, 'identity', '找不到审查标签页的占位 id / 标签页 id，无法判断默认换行的作用范围，已跳过')
    return 'skipped'
  }
  if (state.done.has(key)) return 'skipped'
  state.roots.set(key, root)
  if (state.pending.has(key)) return 'skipped'
  state.pending.add(key)
  return attempt(root, key, state, 0)
}

/**
 * 尝试把换行打开一次。
 *
 * 只有“确认失败”才重试：取不到按钮 / onClick、按钮不可操作、onClick 抛错。一次成功的调用不再复核，
 * 否则外部 store 的异步重渲染会让复核误判成失败，再点一次反而把换行关掉。
 */
function attempt(root: ElementLike, key: string, state: WrapState, tries: number): WrapOutcome {
  const current = state.roots.get(key) ?? root
  if (current.isConnected === false) {
    state.pending.delete(key)
    state.roots.delete(key)
    return 'detached'
  }
  const button = current.querySelector?.(WRAP_TOOL_SELECTOR) ?? null
  const body = current.querySelector?.(WRAP_BODY_SELECTOR) ?? null
  if (isWrapped(button, body)) {
    settle(current, key, state)
    return 'already'
  }
  if (button === null) return retry(current, key, state, tries, '审查标签页里找不到换行按钮（[data-review-tool="wrap"]）')
  if (isDisabled(button)) return retry(current, key, state, tries, '换行按钮处于不可操作状态')
  const handler = findClickHandler(button)
  if (handler === null) return retry(current, key, state, tries, '在换行按钮的 React fiber 上取不到 onClick')
  try {
    handler()
  } catch {
    return retry(current, key, state, tries, '写入换行状态时抛错（review store 可能还没有这个标签页的记录）')
  }
  settle(current, key, state)
  return 'wrapped'
}

/** 安排一次重试；帧数用尽后告警并放手。 */
function retry(root: ElementLike, key: string, state: WrapState, tries: number, reason: string): WrapOutcome {
  const next = tries + 1
  if (next >= MAX_ATTEMPTS) {
    state.pending.delete(key)
    state.roots.delete(key)
    warnOnce(state, key, `${reason}；已重试 ${MAX_ATTEMPTS} 帧，这个审查标签页保持未换行，可手动点工具栏的“自动换行”`)
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
 * 装上默认换行：扫一遍现有审查根元素，然后观察 `<body>` 里的挂载。
 * @param doc - 文档；省略时取 `globalThis.document`。
 * @param runtime - 测试可注入的调度器 / 告警。
 * @returns 卸载函数（断开观察并移除安装标记）。
 */
export function installReviewWrapDefault(
  doc: DocumentLike = globalThis.document as unknown as DocumentLike,
  runtime: WrapRuntime = {},
): () => void {
  const body = doc.body
  const Observer = observerOf(doc)
  if (body === undefined || body === null || Observer === null) return () => {}

  const state = createWrapState(runtime)
  const observer = new Observer((records) => {
    for (const record of records) {
      for (const node of toArray(record.addedNodes)) {
        for (const root of reviewRootsIn(node)) defaultReviewWrap(root, state)
      }
    }
  })
  observer.observe(body, { childList: true, subtree: true })
  doc.documentElement?.setAttribute?.(INSTALL_MARKER, '')
  for (const root of toArray(doc.querySelectorAll?.(REVIEW_SELECTOR))) defaultReviewWrap(root, state)

  return () => {
    observer.disconnect()
    doc.documentElement?.removeAttribute?.(INSTALL_MARKER)
  }
}
