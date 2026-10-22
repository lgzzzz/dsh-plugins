/**
 * 终端内的捕获阶段按键：读取落点元素、手势与归属上下文，早于 xterm 自己的处理器。
 *
 * 终端在自己的 textarea 处理器里对每个经手的键 `preventDefault()+stopPropagation()`，
 * 落在 `.xterm` 内的 keydown 到不了官方固定输入通道，所以折叠键另装 window 捕获监听。
 * 这里只推导固定通道同样给出的三项事实（落点、手势、区域 + 模态），不做业务判断。
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

/** 文档当前聚焦的元素；没有文档时返回 null。 */
function focusedElement(): Element | null {
  if (typeof document === 'undefined') return null
  return document.activeElement ?? null
}

/** 该次按键是否落入终端内，即是否位于 `.xterm` 内。 */
export function terminalTarget(element: Element | null): element is Element {
  if (element === null) return false
  return element.closest('.xterm') !== null
}

/** 构建捕获阶段 keydown 的手势事实，形状与固定输入通道读取的一致。 */
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

/** 一次按键落入的输入区域，判定顺序为终端、文本控件、页面。 */
function regionOf(target: Element | null): ShortcutContext['region'] {
  if (target === null) return 'page'
  if (target.closest('.xterm') !== null) return 'terminal'
  if (target.closest(TEXT_SELECTOR) !== null) return 'editable'
  return 'page'
}

/** 当前是否有模态层打开。 */
function modalOpen(): boolean {
  if (typeof document === 'undefined') return false
  return document.querySelector(MODAL_SELECTOR) !== null
}

/**
 * 构建捕获阶段 keydown 的归属上下文：按键元素（无则退回当前聚焦元素）、其区域，
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
