/**
 * 把已结束轮次的中间过程锁定为展开。
 *
 * 上游 `turnProcessOpen()` 的规则是：store 里有本轮记录且 `answerStep` 匹配时以记录为准
 * （`collapsed !== true` 即展开），否则回落到展示策略给的默认值。因此只要向 per-session
 * Chat store 写入 `{ turn, answerStep, collapsed: false }`，该轮就不会再被“新消息到达”
 * 或“回答结束后”折叠：既不会触发折叠动画、也不会做滚动补偿或重置 disclosure。
 *
 * 记录只能经 `actions.setTurnProcessOpen` 写（见 `fiber.ts`）。写入成功后给标题打上
 * `data-turn-process-locked`：
 *
 * - CSS 把指针交互与 hover 关掉（`cursor:default; pointer-events:none`），并隐藏标题右侧的
 *   展开箭头（`IconChevronDownOutlineRegular`）：锁定后标题恒为展开态、又不可操作，
 *   那个朝上的箭头只是一个指不动的假控件；
 * - `document` 捕获阶段的 `click` 只拦截可信事件（键盘 / 指针），放行插件降级路径
 *   合成的不可信点击；标题仍是可聚焦按钮，作为“已完成，用时 …”的标签保留；
 * - `dsh-keyboard-shortcuts` 的 `⌘⌥.` 会跳过带这个标记的标题（并把最新一轮封口成
 *   历史轮次的组头形态）。
 *
 * 失败路径全部收敛为“不锁”：fiber 找不到、写入口不可用或抛错、标题折叠之后重试耗尽，
 * 都会移除标记、保留可交互，并按需退到合成点击。任何一步失败都只影响该标题。
 * 如果连续多轮同步都见过可折标题、却始终锁不住任何标题，会告警一次（自检），
 * 避免上游结构变化后功能静默消失。
 *
 * 锁标记的值是本实例 id（`pin-<n>`）：卸载时只撤自己加的锁，开发期重复挂载也不会
 * 把另一个实例的锁一起清掉。状态里的 records 是 WeakMap，标题元素卸载后不拖住 DOM。
 *
 * 作用域是主会话：`[data-slot="main.conversation"]` 内的 `[data-conversation-scroll]`；
 * 槽位标记缺席且全文档只有一个滚动口时才使用它，避免误锁右栏会话。
 *
 * 上游锚点、已知边界与手工验证见 docs/dsh-turn-process-open.md。
 */
import { findTurnProcess, findTurnProcessActions } from './fiber.ts'
import type { TurnProcessHandle } from './fiber.ts'

/** 轮次过程标题按钮；`data-turn-process` 只出现在它的开合按钮上。 */
export const HEADER_SELECTOR = '[data-turn-process]'

/** 标题上的锁标记；由本插件写入，`dsh-keyboard-shortcuts` 与样式读取它。 */
export const PIN_ATTRIBUTE = 'data-turn-process-locked'

/** 已锁定标题的选择器（点击拦截用）。 */
export const PINNED_HEADER_SELECTOR = `${HEADER_SELECTOR}[${PIN_ATTRIBUTE}]`

/** 主会话槽位。 */
export const MAIN_SLOT_SELECTOR = '[data-slot="main.conversation"]'

/** 消息滚动口。 */
export const SCROLL_SELECTOR = '[data-conversation-scroll]'

/** 会话根；标题的会话 id 从最近的这个祖先读取。 */
export const SESSION_SELECTOR = '[data-conversation-session]'

/**
 * 本插件注入的样式：锁上之后不再有指针交互与 hover 反馈，右侧的展开箭头一并隐藏。
 *
 * 箭头有两条互相兜底的锚点：
 *
 * - 图标今天是标题按钮的直接子 `<svg>`（上游 `children: [label, canCollapse && chevron]`）；
 * - 同时也按 CSS Module 的 `chevron` 局部类名兜一层：生成名形如 `l_V-RG_chevron`，构建只换
 *   前缀、`_chevron` 不变（与侧栏时间戳的 `_time` 通配符是同一套写法）。上游把图标包进
 *   一层容器时第一条落空、第二条仍命中；局部类名改名时第二条落空、第一条仍命中。
 *
 * 两条都要求标题带锁标记：锁定失败的标题仍然可点，箭头是它唯一的操作提示，不能藏。
 * 上游若连图标都不再渲染，规则只是空转，没有副作用。
 */
export const PIN_CSS = [
  '[data-turn-process][data-turn-process-locked] { cursor: default; pointer-events: none; }',
  '[data-turn-process][data-turn-process-locked] > svg,',
  '[data-turn-process][data-turn-process-locked] [class*="_chevron"] { display: none; }',
].join('\n')

/** 注入样式的标识（`data-plugin-css`），便于排查与去重。 */
export const STYLE_ID = 'dsh-turn-process-open/pin.css'

/** 观察的属性：开合、禁用与三个计数（计数变化说明轮次内容更新）。 */
export const OBSERVED_ATTRIBUTES: readonly string[] = [
  'aria-expanded',
  'disabled',
  'data-turn-process',
  'data-turn-process-messages',
  'data-turn-process-tool-calls',
  'data-turn-process-subagents',
]

/** 同一个 key 重试写入 / 重开的上限；超过就放弃这一代，等 `answerStep` 变化再试。 */
export const MAX_ATTEMPTS = 3

/** 自检窗口：连续这么多次同步都“有可折标题、却没锁住任何标题”时告警一次。 */
export const WATCHDOG_ROUNDS = 30

/** 实例序号：锁标记的值写本实例 id，卸载时只撤自己加的锁。 */
let instanceSeq = 0

/** 每个标题上一次处理过的 key 与重试次数。 */
export interface HeaderRecord {
  readonly key: string
  attempts: number
}

/** 插件运行期的缓存；卸载时整体丢弃。 */
export interface PinState {
  /** 本实例的锁归属标记，写进 `data-turn-process-locked` 的值。 */
  readonly id: string
  /** 标题 → 上次处理过的 key 与重试次数；弱引用，元素卸载后不拖住 DOM。 */
  readonly records: WeakMap<Element, HeaderRecord>
  readonly warned: Set<string>
  /** 本次安装是否锁住过至少一个标题（自检用）。 */
  lockedSeen: boolean
  /** 本轮同步是否看到了可折标题（带 `aria-expanded`）（自检用）。 */
  foldableThisSync: boolean
  /** 看到可折标题、但还没锁住任何标题的同步轮次（自检用）。 */
  unlockedRounds: number
  /** 自检是否已经下过结论（告警过，或已经不需要）。 */
  diagnosed: boolean
}

/** 一次同步里单个标题的结论，供测试与诊断。 */
export type SeedOutcome = 'skip' | 'pinned' | 'retry' | 'fallback' | 'gave-up' | 'missing' | 'unwritable'

/** 可被本插件读写的标题元素（生产环境是 `HTMLButtonElement`）。 */
interface HeaderElement extends Element {
  readonly disabled?: boolean
  click?: () => void
  focus?: (...args: unknown[]) => void
}

/** 一个普通对象。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** 元素是否具备本插件用到的最小 DOM 能力。 */
function isHeader(value: unknown): value is HeaderElement {
  if (!isRecord(value)) return false
  return typeof value.getAttribute === 'function'
    && typeof value.setAttribute === 'function'
    && typeof value.removeAttribute === 'function'
    && typeof value.hasAttribute === 'function'
}

/** 创建一份空状态。 */
export function createPinState(): PinState {
  instanceSeq += 1
  return {
    id: `pin-${instanceSeq}`,
    records: new WeakMap(),
    warned: new Set(),
    lockedSeen: false,
    foldableThisSync: false,
    unlockedRounds: 0,
    diagnosed: false,
  }
}

/**
 * 当前主会话的滚动口。优先 `main.conversation` 槽位内的那份；槽位标记缺席时，
 * 只有全文档恰好一个滚动口才使用它（不猜右栏）。
 * @param doc - 文档（测试可注入假 document）。
 * @returns 滚动口列表，可能为空。
 */
export function conversationRoots(doc: Document | undefined = globalThis.document as Document | undefined): Element[] {
  if (doc === undefined || typeof doc.querySelectorAll !== 'function') return []
  const scrolls = [...doc.querySelectorAll(SCROLL_SELECTOR)]
  const scoped = scrolls.filter((element) => typeof element.closest === 'function' && element.closest(MAIN_SLOT_SELECTOR) !== null)
  if (scoped.length > 0) return scoped
  return scrolls.length === 1 ? scrolls : []
}

/**
 * 标题所属会话的 id（没有会话根时为空串，仍可参与 key）。
 * @param header - 标题元素。
 * @returns 会话标记的值。
 */
export function sessionIdOf(header: Element): string {
  if (typeof header.closest !== 'function') return ''
  const session = header.closest(SESSION_SELECTOR)
  return session?.getAttribute('data-conversation-session') ?? ''
}

/** 标题此刻是否被上游标为不可操作。 */
function isDisabled(header: HeaderElement): boolean {
  if (header.disabled === true) return true
  if (header.getAttribute('aria-disabled') === 'true') return true
  return header.hasAttribute('disabled')
}

/**
 * 打上本实例的锁标记。
 * 标记值是实例 id：另一个实例接管后会改写它，本实例卸载时便不会误撤。
 */
function pin(header: HeaderElement, state: PinState): void {
  if (header.getAttribute(PIN_ATTRIBUTE) !== state.id) header.setAttribute(PIN_ATTRIBUTE, state.id)
  state.lockedSeen = true
}

/** 只移除本实例加的锁标记。 */
function unpin(header: HeaderElement, state: PinState): void {
  if (header.getAttribute(PIN_ATTRIBUTE) === state.id) header.removeAttribute(PIN_ATTRIBUTE)
}

/**
 * 点击标题，并临时屏蔽它自己的 `focus()`：合成点击是降级路径，不该把键盘从
 * composer / 终端抢走。只覆盖元素自身的属性，结束按原样恢复。
 * @param header - 标题元素。
 * @returns 是否真的调用了 `click()`。
 */
function clickWithoutFocus(header: HeaderElement): boolean {
  if (typeof header.click !== 'function') return false
  const hadOwnFocus = Object.prototype.hasOwnProperty.call(header, 'focus')
  const originalFocus = header.focus
  if (typeof originalFocus === 'function') header.focus = () => {}
  try {
    header.click()
    return true
  } catch {
    return false
  } finally {
    if (typeof originalFocus === 'function') {
      if (hadOwnFocus) header.focus = originalFocus
      else delete header.focus
    }
  }
}

/** 实际用到的写入口。 */
export type WriteVia = 'actions' | 'setOpen' | null

/**
 * 把“展开”写进 store：优先绕过 `alwaysOpen` 的绑定动作，其次 `turnProcess.setOpen`。
 *
 * 两个入口都可能在上游会话卸载 / store 重建的竞态里抛错；这里逐个 try，
 * 失败就换下一个，绝不把异常抛给同步循环。
 * @param header - 标题元素。
 * @param handle - 该标题的 turn process handle。
 * @returns 实际用到的写入口，或 null（两个入口都不可用 / 都抛错）。
 */
export function writeOpen(header: Element, handle: TurnProcessHandle): WriteVia {
  const actions = findTurnProcessActions(header)
  if (actions !== null) {
    try {
      actions(handle.turn, handle.answerStep, true)
      return 'actions'
    } catch { /* 降级到 setOpen */ }
  }
  if (typeof handle.setOpen === 'function') {
    try {
      handle.setOpen(true)
      return 'setOpen'
    } catch { /* 两个入口都失败 */ }
  }
  return null
}

/** 告警一次（同一个 key 不重复刷屏）。 */
function warnOnce(state: PinState, key: string, message: string): void {
  if (state.warned.has(key)) return
  state.warned.add(key)
  console.warn(`[dsh-turn-process-open] ${message}`)
}

/** 写入口不可用时的告警文本：不加锁，自动折叠仍会生效。 */
function warnUnwritable(state: PinState, key: string, turn: number): void {
  warnOnce(
    state,
    `unwritable|${key}`,
    `第 ${turn} 轮的展开记录写不进去（setTurnProcessOpen / setOpen 都不可用或抛错），该标题不加锁，新消息到达时仍会被自动折叠`,
  )
}

/**
 * 同步一个标题：写入展开记录、验证后加锁；折叠时重试；fiber 不可用时退到合成点击。
 *
 * @param header - 标题元素。
 * @param state - 运行期缓存。
 * @returns 本次结论。
 */
export function seedHeader(header: Element, state: PinState): SeedOutcome {
  if (!isHeader(header)) return 'skip'
  if (isDisabled(header)) {
    unpin(header, state)
    return 'skip'
  }
  // `aria-expanded` 只在有内容时出现；没有它不是可折标题。
  if (!header.hasAttribute('aria-expanded')) {
    unpin(header, state)
    return 'skip'
  }
  state.foldableThisSync = true
  const expanded = header.getAttribute('aria-expanded') === 'true'
  const record = state.records.get(header) as HeaderRecord | undefined

  // 已展开且带本实例的锁：这一代不需要再走 fiber。
  if (record !== undefined && expanded && header.getAttribute(PIN_ATTRIBUTE) === state.id) return 'pinned'

  const handle = findTurnProcess(header)
  if (handle === null) {
    unpin(header, state)
    // 结构变化：不拦点击，折叠后合成一次点击把它重新打开。
    if (expanded) return 'missing'
    const key = `missing|${sessionIdOf(header)}`
    const attempt = record?.attempts ?? 0
    if (attempt >= MAX_ATTEMPTS) {
      state.records.set(header, { key, attempts: attempt })
      return 'gave-up'
    }
    state.records.set(header, { key, attempts: attempt + 1 })
    if (clickWithoutFocus(header)) {
      warnOnce(state, key, '找不到轮次过程的 React 状态，退化为折叠后合成点击：新消息到达时可能先折一下再展开')
      return 'fallback'
    }
    return 'missing'
  }

  const key = `${sessionIdOf(header)}|${handle.turn}|${handle.answerStep}`
  let current = record
  if (current === undefined || current.key !== key) {
    current = { key, attempts: 0 }
    state.records.set(header, current)
  }

  if (expanded) {
    // 每一代只在第一次展开时写一次；之后由记录维持。
    if (current.attempts === 0) {
      if (writeOpen(header, handle) === null) {
        warnUnwritable(state, key, handle.turn)
        return 'unwritable'
      }
      current.attempts += 1
    }
    pin(header, state)
    return current.attempts > 1 ? 'retry' : 'pinned'
  }

  // 折叠着：先撤锁，再按上限重写。写不进去就不加锁，免得按钮被吞掉却仍会折叠。
  unpin(header, state)
  if (current.attempts >= MAX_ATTEMPTS) {
    warnOnce(state, key, `第 ${handle.turn} 轮写入展开记录后仍被折叠，已放弃锁定（不拦截点击）`)
    return 'gave-up'
  }
  if (writeOpen(header, handle) === null) {
    warnUnwritable(state, key, handle.turn)
    return 'unwritable'
  }
  current.attempts += 1
  return 'retry'
}

/** 每个结论的计数。 */
export type SeedCounts = Record<SeedOutcome, number>

/**
 * 同步一个滚动口里的所有标题。
 * @param root - 主会话滚动口。
 * @param state - 运行期缓存。
 * @returns 每个结论的计数，便于告警与测试。
 */
export function syncRoot(root: Element, state: PinState): SeedCounts {
  const counts: SeedCounts = {
    skip: 0, pinned: 0, retry: 0, fallback: 0, 'gave-up': 0, missing: 0, unwritable: 0,
  }
  if (typeof root.querySelectorAll !== 'function') return counts
  for (const header of root.querySelectorAll(HEADER_SELECTOR)) counts[seedHeader(header, state)] += 1
  return counts
}

/**
 * 自检：本轮看到了可折标题、却始终没锁住任何标题时，fiber 读取或 store 写入多半已经失效。
 * 只在连续多轮同步后告警一次，避免把“首帧还没渲染完”当成故障。
 * @param state - 运行期缓存。
 */
function diagnose(state: PinState): void {
  if (state.diagnosed) return
  if (state.lockedSeen) {
    state.diagnosed = true
    return
  }
  if (!state.foldableThisSync) return
  state.unlockedRounds += 1
  if (state.unlockedRounds < WATCHDOG_ROUNDS) return
  state.diagnosed = true
  warnOnce(
    state,
    'watchdog',
    `连续 ${WATCHDOG_ROUNDS} 次同步都没能锁定任何轮次过程（本轮仍看到可折标题）：上游锚点或写入口可能已变，功能已退化为官方自动折叠`,
  )
}

/** 安装期依赖的最小 document 形状（测试可注入）。 */
export interface PinDocument {
  querySelectorAll(selector: string): ArrayLike<Element>
  createElement?(tag: string): {
    dataset?: Record<string, string>
    textContent?: string
    remove?: () => void
  }
  head?: { append?(node: unknown): void }
  addEventListener?(type: string, listener: (event: unknown) => void, capture?: boolean): void
  removeEventListener?(type: string, listener: (event: unknown) => void, capture?: boolean): void
  documentElement?: Element
  defaultView?: { MutationObserver?: typeof MutationObserver; setTimeout?: typeof setTimeout; clearTimeout?: typeof clearTimeout }
}

/** 安装期依赖的最小 MutationObserver 形状。 */
interface ObserverLike {
  observe(target: Element, options: MutationObserverInit): void
  disconnect(): void
}

/** 安装后返回的控制器：`sync()` 立即同步一次，`dispose()` 释放全部副作用。 */
export interface PinController {
  sync(): void
  dispose(): void
}

/** 注入样式；承载不了标签的极简假 DOM 直接跳过。 */
function installStyle(doc: PinDocument): (() => void) | null {
  if (typeof doc.createElement !== 'function' || typeof doc.head?.append !== 'function') return null
  const existing = doc.querySelectorAll(`style[data-plugin-css="${STYLE_ID}"]`)
  if (existing.length > 0) return null
  const element = doc.createElement('style')
  if (element.dataset !== undefined) {
    element.dataset.plugin = 'dsh-turn-process-open'
    element.dataset.pluginCss = STYLE_ID
  }
  element.textContent = PIN_CSS
  doc.head.append(element)
  return () => element.remove?.()
}

/**
 * 拦截落在已锁定标题上的可信点击。
 *
 * 只拦 `isTrusted === true`：鼠标点击已被 `pointer-events:none` 挡在命中测试之外，
 * 键盘 Space / Enter 仍会派发可信 click；辅助技术可能派发不可信 click，那条路径
 * 留给降级 / 可访问性场景，不拦截。
 * @param event - 原生事件。
 * @returns 是否拦截。
 */
export function interceptLockedClick(event: unknown): boolean {
  if (!isRecord(event) || event.isTrusted !== true) return false
  const target = event.target
  if (!isRecord(target) || typeof target.closest !== 'function') return false
  const header = target.closest(PINNED_HEADER_SELECTOR) as Element | null
  if (header === null) return false
  if (typeof event.preventDefault === 'function') event.preventDefault()
  if (typeof event.stopPropagation === 'function') event.stopPropagation()
  return true
}

/**
 * 装上锁定器：初始同步、MutationObserver、点击拦截、样式与卸载清理。
 *
 * 观察 `document.documentElement` 而不是当前的滚动口：会话切换会换掉滚动口，
 * 观察整棵文档才能在新会话挂载后继续 seed；回调按帧合并，流式输出不会逐 token 跑。
 * @param doc - 文档（默认取全局 `document`）。
 * @returns 卸载函数（`ctx.effect` 的清理）。
 */
export function installPin(doc: PinDocument | undefined = globalThis.document as unknown as PinDocument | undefined): PinController {
  const noop: PinController = { sync: () => {}, dispose: () => {} }
  if (doc === undefined) return noop
  const state = createPinState()
  const removeStyle = installStyle(doc)
  let disposed = false
  let scheduled = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const sync = (): void => {
    if (disposed) return
    state.foldableThisSync = false
    for (const root of conversationRoots(doc as unknown as Document)) syncRoot(root, state)
    diagnose(state)
  }

  const schedule = (): void => {
    if (disposed || scheduled) return
    scheduled = true
    const later = (): void => {
      scheduled = false
      sync()
    }
    const view = doc.defaultView
    const set = view?.setTimeout ?? setTimeout
    timer = set(later, 16)
  }

  const onClick = (event: unknown): void => {
    interceptLockedClick(event)
  }

  doc.addEventListener?.('click', onClick, true)

  const Observer = doc.defaultView?.MutationObserver
    ?? (globalThis as { MutationObserver?: typeof MutationObserver }).MutationObserver
  let observer: ObserverLike | null = null
  if (typeof Observer === 'function') {
    const target = doc.documentElement
    if (target !== null && target !== undefined) {
      observer = new Observer(schedule) as unknown as ObserverLike
      observer.observe(target, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: [...OBSERVED_ATTRIBUTES],
      })
    }
  }

  sync()

  return {
    sync,
    dispose: () => {
      if (disposed) return
      disposed = true
      observer?.disconnect()
      observer = null
      if (timer !== undefined) clearTimeout(timer)
      doc.removeEventListener?.('click', onClick, true)
      removeStyle?.()
      // 只撤本实例加的锁：另一个实例接管过的标题（标记值不是本实例 id）保持不动。
      for (const header of Array.from(doc.querySelectorAll(PINNED_HEADER_SELECTOR))) {
        if (header.getAttribute(PIN_ATTRIBUTE) === state.id) header.removeAttribute(PIN_ATTRIBUTE)
      }
      state.warned.clear()
    },
  }
}
