/**
 * 记住右栏「本地变更」/「变更请求」文件树的宽度。
 *
 * 上游 `FileTreePane` 的宽度只存在组件内的 `useState(240)` 里：拖动 / 键盘调整后，只要标签页
 * 还在挂载就保持；切走再切回、在另一个会话里重新打开，或刷新后恢复，宽度都会回到 240。上游
 * 明确把这当作「宽度属于当前挂载的标签页」，没有持久化入口。
 *
 * 本行为补上持久化，但不去改上游源码、也不合成指针事件：
 *
 *   - **写**：用户拖动结束（`pointerup`）或用方向键 / Home / End 调整结束（`keyup`）时，
 *     读分隔条上的 `aria-valuenow`（上游渲染的当前宽度），写入 `localStorage`；
 *   - **读**：新的 `[data-forge-changes]` 文件树挂载后，从分隔条的 React fiber 上找到
 *     `FileTreePane` 里 `useState` 的 dispatch，把宽度设回上次的值。上游的 `onWidth` 会照常
 *     更新工具栏的 `--forge-tree-width`，和用户手动拖动走同一条路径；
 *   - **只在用户操作结束时写**：面板变窄导致 `shown` 被 `maximum` 压小、窗口大小变化等
 *     非用户调整不写回，避免把用户选定的宽度悄悄改成「当前能放下的最大值」。
 *
 * 位置 / 隐藏状态仍由上游决定：文件树被工具栏切到右侧或隐藏，不额外写宽度；隐藏期间重新
 * 挂载的 pane 也按存储值恢复。只处理 `[data-forge-changes]` 里的文件树分隔条（带
 * `aria-controls`），右栏其它可拖动元素不碰。
 *
 * 上游锚点、手工验证方式与已知边界见 docs/dsh-changes-behavior.md。
 */
import { hasClosest } from './dom.ts'
import { findFileTreeWidthSetter } from './fiber.ts'

/** 插件 id：诊断前缀与标记命名都用它。 */
const NAME = 'dsh-changes-behavior'

/** 「本地变更」/「变更请求」标签页根元素。 */
export const ROOT_SELECTOR = '[data-forge-changes]'

/** 文件树分隔条：上游同时输出 `role="separator"` 与 `aria-controls`。 */
export const SEPARATOR_SELECTOR = '[role="separator"][aria-controls]'

/** 分隔条上由上游渲染的当前宽度（`shown`，已按可用空间收窄）。 */
export const WIDTH_ATTRIBUTE = 'aria-valuenow'

/** 本插件写在文件树 pane 上的诊断标记：值为最近一次恢复 / 记住的宽度。 */
export const PANE_MARKER = 'data-dsh-tree-width'

/** 本插件在文档根元素上的安装标记。 */
export const INSTALL_MARKER = 'data-dsh-changes-behavior-tree-width'

/** 宽度在 `localStorage` 里的键；一个浏览器 origin 共用一份。 */
export const STORAGE_KEY = 'dsh-changes-behavior:tree-width'

/** 上游 `FileTreePane` 的宽度下限（`MIN_WIDTH`）；读存储时用来清洗异常值。 */
export const MIN_WIDTH = 200

/** 上游 `FileTreePane` 的宽度上限（`MAX_WIDTH`）；读存储时用来清洗异常值。 */
export const MAX_WIDTH = 600

/** 用户调整宽度后可能触发的按键；与上游 `onKeyDown` 支持的一致。 */
export const RESIZE_KEYS: ReadonlySet<string> = new Set(['ArrowLeft', 'ArrowRight', 'Home', 'End'])

/** 从 React fiber 上取宽度 setter 连续失败时的重试帧数。 */
export const MAX_ATTEMPTS = 8

/** 一次恢复的结论，供测试与诊断。 */
export type TreeWidthOutcome =
  | 'restored'
  | 'already'
  | 'no-saved'
  | 'no-separator'
  | 'skipped'
  | 'detached'
  | 'retry'
  | 'gave-up'

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
  readonly parentElement?: ElementLike | null
  readonly isConnected?: boolean
}

/** 一次指针 / 键盘事件里本插件用到的字段。 */
export interface EventLike {
  readonly target?: unknown
  readonly key?: string
}

/** 存储面：生产环境是 `window.localStorage`，测试里是假替身。 */
export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
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
  addEventListener(type: string, listener: (event: EventLike) => void, capture: boolean): void
  removeEventListener(type: string, listener: (event: EventLike) => void, capture: boolean): void
  querySelectorAll?(selector: string): ArrayLike<ElementLike>
}

/** 观察器的最小子集（生产环境是 `MutationObserver`；测试接缝）。 */
export interface ObserverLike {
  observe(target: ElementLike, options: { childList: boolean; subtree: boolean }): void
  disconnect(): void
}

/** 观察器构造器；生产环境是 `MutationObserver`（测试接缝）。 */
export type ObserverConstructor = new (callback: (records: MutationRecordLike[]) => void) => ObserverLike

/** 运行期可注入项（测试接缝）：替换存储、调度器与告警，上游没有对应类型。 */
export interface TreeWidthRuntime {
  /** 存储面；省略时从文档所属 window / 全局 `localStorage` 取。 */
  readonly storage?: StorageLike
  /** 安排一次下一帧的重试。 */
  readonly schedule?: (callback: () => void) => void
  /** 把一次宽度读取推迟到 React 提交之后（默认下一微任务）。 */
  readonly defer?: (callback: () => void) => void
  /** 输出一条带插件前缀的诊断。 */
  readonly warn?: (message: string) => void
}

/** 运行期缓存。 */
export interface TreeWidthState {
  readonly storage?: StorageLike
  /** 已恢复（或确认无需恢复）的 pane，避免同一次挂载重复处理。 */
  readonly done: WeakSet<object>
  /** 正在等待重试的 pane。 */
  readonly pending: WeakSet<object>
  readonly schedule: (callback: () => void) => void
  readonly defer: (callback: () => void) => void
  readonly warn: (message: string) => void
}

/** 一个普通对象。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** 鸭子类型判定「可查询 / 可匹配的元素」。 */
function isElementLike(value: unknown): value is ElementLike {
  return isRecord(value)
    && (typeof value.getAttribute === 'function' || typeof value.querySelector === 'function')
}

/** 默认调度器：有 `requestAnimationFrame` 就等下一帧，否则退回 16ms 定时器。 */
function defaultSchedule(callback: () => void): void {
  const raf = (globalThis as { requestAnimationFrame?: (handler: () => void) => unknown }).requestAnimationFrame
  if (typeof raf === 'function') raf(() => callback())
  else setTimeout(callback, 16)
}

/** 默认推迟：下一微任务；没有 `queueMicrotask` 时退回 0ms 定时器。 */
function defaultDefer(callback: () => void): void {
  const queue = (globalThis as { queueMicrotask?: (handler: () => void) => void }).queueMicrotask
  if (typeof queue === 'function') queue(callback)
  else setTimeout(callback, 0)
}

/** 默认告警：统一加插件前缀。 */
function defaultWarn(message: string): void {
  console.warn(`[${NAME}] ${message}`)
}

/** 把存储里的原始宽度清洗成上游允许的整数；异常值 / 缺席返回 null。 */
export function readStoredWidth(storage: StorageLike | undefined): number | null {
  if (storage === undefined) return null
  let raw: string | null
  try {
    raw = storage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
  if (raw === null) return null
  return sanitizeWidth(Number(raw))
}

/** 写入存储；localStorage 禁用 / 隐私模式抛错时静默放弃。 */
export function writeStoredWidth(storage: StorageLike | undefined, width: number): number | null {
  const safe = sanitizeWidth(width)
  if (storage === undefined || safe === null) return null
  try {
    storage.setItem(STORAGE_KEY, String(safe))
  } catch {
    return null
  }
  return safe
}

/** 把有限数字取整并夹到上游的 `[MIN_WIDTH, MAX_WIDTH]`。 */
export function sanitizeWidth(value: number): number | null {
  if (!Number.isFinite(value)) return null
  return Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, value)))
}

/** 读分隔条上由上游渲染的当前宽度。 */
export function widthOf(separator: ElementLike): number | null {
  const raw = separator.getAttribute?.(WIDTH_ATTRIBUTE) ?? null
  if (raw === null) return null
  const value = Number(raw)
  return Number.isFinite(value) ? Math.round(value) : null
}

/**
 * 记住分隔条当前宽度。
 *
 * 只在事件监听的回调里调用，因此记录的是用户刚完成的那次调整；面板变窄 / 窗口缩放等
 * 非用户操作不会写回。分隔条必须位于 `[data-forge-changes]` 内且带 `aria-controls`，
 * 避免误记别的可拖动元素。
 *
 * @param separator - 文件树分隔条。
 * @param state - 运行期缓存（存储面）。
 * @returns 写入的宽度；不是文件树分隔条 / 读不到宽度 / 写不进存储时为 null。
 */
export function rememberTreeWidth(separator: ElementLike, state: TreeWidthState): number | null {
  if ((separator.closest?.(ROOT_SELECTOR) ?? null) === null) return null
  if ((separator.getAttribute?.('aria-controls') ?? null) === null) return null
  const pane = separator.parentElement ?? null
  const width = widthOf(separator)
  if (pane === null || width === null) return null
  const written = writeStoredWidth(state.storage, width)
  if (written !== null) pane.setAttribute?.(PANE_MARKER, String(written))
  return written
}

/**
 * 把新挂载的文件树恢复成上次记住的宽度。
 *
 * 通过分隔条 fiber 上的 `FileTreePane` 宽度 state 写回；这是上游 `onWidth` / 工具栏
 * `--forge-tree-width` 的同一条更新路径，不直接改内联样式。取不到 fiber 时下一帧再试，
 * 连续失败后告警并放手（保持上游默认 240），不影响手动拖动。
 *
 * @param pane - 文件树 pane（分隔条的父元素）。
 * @param state - 运行期缓存。
 * @param separator - 已知的分隔条；省略时从 pane 里查。
 * @returns 本次结论。
 */
export function restoreTreeWidth(
  pane: ElementLike,
  state: TreeWidthState,
  separator?: ElementLike | null,
): TreeWidthOutcome {
  if (state.done.has(pane)) return 'skipped'
  if (state.pending.has(pane)) return 'skipped'
  const saved = readStoredWidth(state.storage)
  if (saved === null) {
    state.done.add(pane)
    return 'no-saved'
  }
  const found = separator ?? pane.querySelector?.(SEPARATOR_SELECTOR) ?? null
  if (found === null || found.getAttribute?.('aria-controls') === null) return 'no-separator'
  return attemptRestore(pane, found, saved, state, 0)
}

/** 尝试把宽度写回 React state；fiber / dispatch 暂时取不到时安排一次重试。 */
function attemptRestore(
  pane: ElementLike,
  separator: ElementLike,
  saved: number,
  state: TreeWidthState,
  tries: number,
): TreeWidthOutcome {
  if (pane.isConnected === false) {
    state.pending.delete(pane)
    return 'detached'
  }
  if (widthOf(separator) === saved) {
    settle(pane, state, saved)
    return 'already'
  }
  const setter = findFileTreeWidthSetter(separator)
  if (setter === null) {
    return retryRestore(pane, separator, saved, state, tries, '在文件树分隔条的 React fiber 上取不到宽度 setState')
  }
  try {
    setter(saved)
  } catch {
    return retryRestore(pane, separator, saved, state, tries, '写入文件树宽度 state 时抛错')
  }
  settle(pane, state, saved)
  return 'restored'
}

/** 安排一次重试；帧数用尽后告警并放手。 */
function retryRestore(
  pane: ElementLike,
  separator: ElementLike,
  saved: number,
  state: TreeWidthState,
  tries: number,
  reason: string,
): TreeWidthOutcome {
  if (tries + 1 >= MAX_ATTEMPTS) {
    state.pending.delete(pane)
    state.done.add(pane)
    state.warn(`${reason}；已重试 ${MAX_ATTEMPTS} 帧，这个文件树保持上游默认宽度，手动拖动仍照常`)
    return 'gave-up'
  }
  state.pending.add(pane)
  state.schedule(() => {
    if (!state.pending.has(pane)) return
    state.pending.delete(pane)
    attemptRestore(pane, separator, saved, state, tries + 1)
  })
  return 'retry'
}

/** 记下已恢复的 pane，并留下诊断标记。 */
function settle(pane: ElementLike, state: TreeWidthState, width: number): void {
  pane.setAttribute?.(PANE_MARKER, String(width))
  state.done.add(pane)
  state.pending.delete(pane)
}

/** 存储面：优先文档所属 window，其次全局 `localStorage`；取不到时静默降级。 */
function storageOf(doc: DocumentLike): StorageLike | undefined {
  try {
    const view = doc.defaultView
    const scoped = isRecord(view) ? view.localStorage : undefined
    if (isStorage(scoped)) return scoped as unknown as StorageLike
  } catch {
    /* 访问 window.localStorage 被拒绝：继续找全局 */
  }
  try {
    const global = (globalThis as { localStorage?: unknown }).localStorage
    if (isStorage(global)) return global as unknown as StorageLike
  } catch {
    /* 隐私模式 / 被禁用：没有存储面 */
  }
  return undefined
}

/** 判定一个值是否具备 localStorage 的读写面。 */
function isStorage(value: unknown): value is StorageLike {
  return isRecord(value) && typeof value.getItem === 'function' && typeof value.setItem === 'function'
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

/** 按分隔条找到它所属的 pane，并确认它在 forge 根里。 */
function considerSeparator(separator: ElementLike, state: TreeWidthState): void {
  if ((separator.getAttribute?.('aria-controls') ?? null) === null) return
  if ((separator.closest?.(ROOT_SELECTOR) ?? null) === null) return
  const pane = separator.parentElement ?? null
  if (pane === null) return
  restoreTreeWidth(pane, state, separator)
}

/** 从一个 forge 根里找出当前文件树分隔条。 */
function considerRoot(root: ElementLike, state: TreeWidthState): void {
  const separators = root.querySelectorAll?.(SEPARATOR_SELECTOR) ?? []
  const list = Array.from(separators)
  const single = root.querySelector?.(SEPARATOR_SELECTOR) ?? null
  if (single !== null && list.length === 0) list.push(single)
  for (const separator of list) considerSeparator(separator, state)
}

/**
 * 处理一个新增节点：只有它本身是 forge 根 / 位于 forge 根内，且可能带来文件树分隔条时才动作。
 *
 * 文件树通常在标签页根之后单独挂载，所以「根已存在、pane 后插入」也必须能命中；同时避免
 * diff 正文流式追加时每个节点都做一次全根扫描。
 */
function considerAdded(node: unknown, state: TreeWidthState): void {
  if (!isElementLike(node)) return
  const root = node.matches?.(ROOT_SELECTOR) === true
    ? node
    : node.closest?.(ROOT_SELECTOR) ?? null
  if (root === null) return
  const direct = node.matches?.(SEPARATOR_SELECTOR) === true ? node : null
  const descendant = direct ?? node.querySelector?.(SEPARATOR_SELECTOR) ?? null
  if (descendant !== null) {
    considerSeparator(descendant, state)
    return
  }
  if (node === root) considerRoot(root, state)
}

/** 事件目标是否落在文件树分隔条上。 */
function separatorFromEvent(event: EventLike): ElementLike | null {
  const target = event.target
  if (!hasClosest(target)) return null
  return target.closest?.(SEPARATOR_SELECTOR) ?? null
}

/**
 * 装上文件树宽度记忆：扫一遍现有 forge 根，观察后续挂载，并在用户调整结束时写入存储。
 *
 * @param doc - 文档；省略时取 `globalThis.document`。
 * @param runtime - 测试可注入的存储 / 调度器 / 告警。
 * @returns 卸载函数（断开观察、移除监听与安装标记）。
 */
export function installTreeWidthMemory(
  doc: DocumentLike = globalThis.document as unknown as DocumentLike,
  runtime: TreeWidthRuntime = {},
): () => void {
  const body = doc.body
  const Observer = observerOf(doc)
  if (body === undefined || body === null || Observer === null) return () => {}

  const state: TreeWidthState = {
    storage: runtime.storage ?? storageOf(doc),
    done: new WeakSet<object>(),
    pending: new WeakSet<object>(),
    schedule: runtime.schedule ?? defaultSchedule,
    defer: runtime.defer ?? defaultDefer,
    warn: runtime.warn ?? defaultWarn,
  }
  const observer = new Observer((records) => {
    for (const record of records) {
      const added = record.addedNodes
      if (added === undefined || added === null) continue
      for (const node of Array.from(added)) considerAdded(node, state)
    }
  })
  observer.observe(body, { childList: true, subtree: true })
  doc.documentElement?.setAttribute?.(INSTALL_MARKER, '')
  for (const root of Array.from(doc.querySelectorAll?.(ROOT_SELECTOR) ?? [])) considerRoot(root, state)

  // 读宽度要等 React 提交：`onPointerUp` / `onKeyDown` 里的最后一次 setState 可能在事件冒泡到
  // document 之后才 flush；同步读 `aria-valuenow` 会拿到上一帧的值。
  const onPointerUp = (event: EventLike): void => {
    const separator = separatorFromEvent(event)
    if (separator !== null) state.defer(() => { rememberTreeWidth(separator, state) })
  }
  const onKeyUp = (event: EventLike): void => {
    if (!RESIZE_KEYS.has(event.key ?? '')) return
    const separator = separatorFromEvent(event)
    if (separator !== null) state.defer(() => { rememberTreeWidth(separator, state) })
  }
  doc.addEventListener('pointerup', onPointerUp, false)
  doc.addEventListener('keyup', onKeyUp, false)

  return () => {
    observer.disconnect()
    doc.removeEventListener('pointerup', onPointerUp, false)
    doc.removeEventListener('keyup', onKeyUp, false)
    doc.documentElement?.removeAttribute?.(INSTALL_MARKER)
  }
}
