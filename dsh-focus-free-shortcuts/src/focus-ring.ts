/**
 * 抑制刚被夺走按键的控件的焦点环。
 *
 * 应用只在 `:focus-visible` 时画焦点环，并在指针持有焦点时让其不可见：`ui-theme` 的
 * `focus.css` 在 `html[data-input-modality='pointer'] body :focus-visible:not(:read-write)`
 * 下把环色设为透明，`ui-primitives` 的输入模态跟踪器在非组合导航键（或其后焦点落到
 * 其他控件）出现前一直发布 `pointer`。
 *
 * 本模块给元素加上 `data-dsh-automatic-focus`：主题在该标记存在期间把 outline 设为
 * none，标记在 blur 或导航键时释放，恢复正常键盘样式。释放规则在此复刻而不导入，
 * 因此打包产物对 primitives 包没有运行时依赖。
 *
 * 两块拼图的同源事实见 docs/dsh-focus-free-shortcuts/06-boundaries-and-contracts.md。
 */

/** `focusWithoutRing` 发布的标记；存在期间主题抑制 outline。 */
const RING_SUPPRESSION_ATTRIBUTE = 'data-dsh-automatic-focus'

/** 释放标记、恢复正常焦点样式的导航键。 */
const RING_RELEASE_KEYS = new Set([
  'Tab',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
])

/** 每个元素只保留一个释放函数，重复按键时先执行并替换上一个。 */
const ringReleases = new WeakMap<Element, () => void>()

/** 文档当前聚焦的元素；没有 document 时返回 null。 */
function focusedElement(): Element | null {
  if (typeof document === 'undefined') return null
  return document.activeElement ?? null
}

/**
 * 让一个控件不画焦点环，且不移动焦点：元素为 null、没有 document、是 body 或
 * documentElement、不是当前焦点、或不支持 `setAttribute` / `addEventListener` 时直接返回。
 */
export function suppressFocusRing(element: Element | null): void {
  if (element === null) return
  const control = element as Partial<Element>
  if (typeof control.setAttribute !== 'function' || typeof control.addEventListener !== 'function') return
  if (typeof document === 'undefined') return
  if (element === document.body || element === document.documentElement) return
  if (focusedElement() !== element) return
  // 上面的守卫已排除不能承载标记与释放监听的元素，这里只会是真实控件。
  const target = element as HTMLElement

  function release(): void {
    target.removeAttribute(RING_SUPPRESSION_ATTRIBUTE)
    target.removeEventListener('blur', release)
    target.removeEventListener('keydown', navigate, true)
    ringReleases.delete(target)
  }
  function navigate(event: KeyboardEvent): void {
    if (event.isComposing || event.ctrlKey || event.altKey || event.metaKey) return
    if (RING_RELEASE_KEYS.has(event.key)) release()
  }

  ringReleases.get(target)?.()
  ringReleases.set(target, release)
  target.setAttribute(RING_SUPPRESSION_ATTRIBUTE, '')
  target.addEventListener('blur', release)
  target.addEventListener('keydown', navigate, true)
  // 检查与标记之间焦点可能已经移走；不再聚焦的控件不画环，撤销其标记。
  if (focusedElement() !== target) release()
}
