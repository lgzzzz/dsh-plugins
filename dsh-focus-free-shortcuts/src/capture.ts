/**
 * 捕获阶段共用层：在任何本地控件之前读取按键。
 *
 * 三个桥需要在页面自身处理器之前判定 keydown，因此在 window 上安装捕获监听：
 * `page-cycle.ts` 与 `session-cycle.ts` 处理聚焦终端吞掉按键的情形，`approval-keys.ts`
 * 处理聚焦卡片自行 `preventDefault()` 的情形。
 *
 * 捕获监听早于目标/冒泡处理器运行，读不到键盘适配器为冒泡路径构建的读数，这里重新
 * 推导同样三项：按键元素、物理手势与归属上下文(region + modal)。
 *
 * 仅以 `import type` 引用上游；modal 与文本控件作用域按适配器和 primitives 包共用的
 * 字面量复述。
 *
 * 捕获路径与固定通道的分工见 docs/dsh-focus-free-shortcuts/03-fixed-input-and-pane-keys.md。
 */
import type {
  ShortcutContext,
  ShortcutGesture,
} from '@deepseek-ai/dsh-client-shortcuts/client'

/** 模态作用域选择器；与 `modalSelector` 发布的字面量相同。 */
const MODAL_SELECTOR = '[role="dialog"][aria-modal="true"], [role="menu"]'

/** 保留自身按键的输入作用域；与适配器的 `closest()` 列表相同。 */
const TEXT_SELECTOR = 'input, textarea, select, [contenteditable="true"], [contenteditable=""]'

/**
 * 事件组合路径上的第一个 Element。
 *
 * 按 `closest` 这一项能力做鸭子类型判断，因此测试可以传入普通假元素。
 * @returns 路径中最内层的 Element，没有则返回 null。
 */
export function composedElement(event: KeyboardEvent): Element | null {
  for (const value of event.composedPath()) {
    if (typeof value === 'object' && value !== null && 'closest' in value) return value as Element
  }
  return null
}

/**
 * 文档当前聚焦的元素；没有文档时返回 null。
 */
function focusedElement(): Element | null {
  if (typeof document === 'undefined') return null
  return document.activeElement ?? null
}

/**
 * 一次捕获阶段按键所属的元素：优先按键自身元素，否则退回当前聚焦元素。
 */
export function pressElement(event: KeyboardEvent): Element | null {
  return composedElement(event) ?? focusedElement()
}

/**
 * 该次按键是否落入终端内，即是否位于 `.xterm` 内；这类按键不会到达 DOM 通道的
 * window 监听（终端在自己的 textarea 处理器里停掉了它）。
 *
 * 同时作为类型守卫：判断通过后 `element` 为 Element。
 */
export function terminalTarget(element: Element | null): element is Element {
  if (element === null) return false
  return element.closest('.xterm') !== null
}

/**
 * 构建捕获阶段 keydown 的手势事实，形状与共用判定读取的一致。
 *
 * 组合输入取自事件自身的 `isComposing`；捕获阶段尚无处理器运行，因此
 * `defaultPrevented` 恒为 false。
 */
export function captureGesture(event: KeyboardEvent): ShortcutGesture {
  return {
    code: event.code,
    secondCode: undefined,
    control: event.ctrlKey,
    alt: event.altKey,
    shift: event.shiftKey,
    meta: event.metaKey,
    repeat: event.repeat,
    composing: event.isComposing,
    defaultPrevented: false,
  }
}

/**
 * 一次按键落入的输入区域，判定顺序为终端、文本控件、页面。
 */
function regionOf(target: Element | null): ShortcutContext['region'] {
  if (target === null) return 'page'
  if (target.closest('.xterm') !== null) return 'terminal'
  if (target.closest(TEXT_SELECTOR) !== null) return 'editable'
  return 'page'
}

/**
 * 当前是否有模态层打开：即是否存在匹配 `[role="dialog"][aria-modal="true"]` 或
 * `[role="menu"]` 的元素。
 */
export function modalOpen(): boolean {
  if (typeof document === 'undefined') return false
  return document.querySelector(MODAL_SELECTOR) !== null
}

/**
 * 构建捕获阶段 keydown 的归属上下文：按键元素(无则退回当前聚焦元素)、其区域，
 * 以及其上方是否有模态。`modal` 只与 null 比较，未标记的模态统一取 `'other'`。
 */
export function captureContext(element: Element | null): ShortcutContext {
  const target = element ?? focusedElement()
  return {
    region: regionOf(target),
    modal: modalOpen() ? 'other' : null,
    target,
  }
}
