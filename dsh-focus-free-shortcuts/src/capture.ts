/**
 * Capture-phase ground: the shared "read the press before any local control" layer.
 *
 * Two bridges must decide a keydown *before* the page's own handler sees it, so
 * both install a window capture listener:
 *
 *   - `page-cycle.ts` — a focused terminal handles every key it owns on its
 *     textarea and calls `stopPropagation()`, so the press never ascends to the
 *     window-level fixed-input channel;
 *   - `approval-keys.ts` — a focused process card (a tool card's
 *     `div[role="button"][tabindex="0"]`, a trajectory row's `tr[tabindex="0"]`)
 *     answers `Enter` in its own React handler and calls `preventDefault()`
 *     first, so by the time the fixed channel runs the card has already acted
 *     *and* the press reads as consumed — the observer would stand down.
 *
 * A capture listener runs before every target/bubble handler, so it cannot read
 * the readings the keyboard adapter builds for its own bubble path; it re-derives
 * the same three here: the press's element, its physical gesture, and its
 * ownership context (region + modal). Keeping them in one module means both
 * hooks read a press exactly the way the adapter does.
 *
 * Only `import type` reaches upstream: the modal and text-control scopes are
 * restated as the literals the adapter and the primitives package both use,
 * because this bundle carries no runtime dependency on either.
 */
import type {
  ShortcutContext,
  ShortcutGesture,
} from '@deepseek-ai/dsh-client-shortcuts/client'

/** The modal scopes the keyboard adapter reads; the same literal `modalSelector` publishes. */
const MODAL_SELECTOR = '[role="dialog"][aria-modal="true"], [role="menu"]'

/** The input scopes that keep their own keys; the adapter's own `closest()` list. */
const TEXT_SELECTOR = 'input, textarea, select, [contenteditable="true"], [contenteditable=""]'

/**
 * The first Element on the event's composed path.
 *
 * A capture hook needs the press's destination before any bubble listener has
 * run; `composedPath()` is the native way to name it. Entries are duck-typed by
 * the one capability the hooks need — `Element.prototype.closest` — so tests
 * may hand the hook plain fake elements.
 * @param event - the keydown in the capture phase.
 * @returns the innermost Element of the path, or null when there is none.
 */
export function composedElement(event: KeyboardEvent): Element | null {
  for (const value of event.composedPath()) {
    if (typeof value === 'object' && value !== null && 'closest' in value) return value as Element
  }
  return null
}

/**
 * The document's focused element, or null where there is no document.
 *
 * The same reading the keyboard adapter falls back to when a press carries no
 * Element of its own (`target instanceof Element ? target : document.activeElement`).
 * @returns the focused element, or null.
 */
function focusedElement(): Element | null {
  if (typeof document === 'undefined') return null
  return document.activeElement ?? null
}

/**
 * The element one capture-phase press belongs to.
 *
 * The press's own element, else the focused element — the same resolution
 * {@link captureContext} applies, exposed because a hook that takes a press also
 * needs the control it took it from (for example to withdraw the focus ring that
 * press would otherwise reveal).
 * @param event - the keydown in the capture phase.
 * @returns the press's element, or null when neither exists.
 */
export function pressElement(event: KeyboardEvent): Element | null {
  return composedElement(event) ?? focusedElement()
}

/**
 * Build the gesture facts a capture-phase keydown carries, in the shape the
 * shared decisions read.
 *
 * Composition is read from the event's own flag (`isComposing`) rather than the
 * keyboard adapter's live observer: at the capture phase the observer has not
 * run yet, and the flag is the same intent — do not steal half-typed input.
 * `defaultPrevented` is always false at the capture phase (nothing has run yet);
 * the bridges that ignore it do so deliberately, the others re-check it after
 * their own preconditions.
 * @param event - the keydown in the capture phase.
 * @returns the gesture in the shared decisions' shape.
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
 * The input region one press descends into, as the adapter classifies it.
 *
 * The order matters and mirrors the adapter: a terminal subtree is checked
 * first (xterm's helper textarea is a `<textarea>`, but the terminal owns it),
 * then the text controls that keep their own keys, then the page.
 * @param target - the press's own element, or null without one.
 * @returns the region name the keyboard adapter would publish for this press.
 */
function regionOf(target: Element | null): ShortcutContext['region'] {
  if (target === null) return 'page'
  if (target.closest('.xterm') !== null) return 'terminal'
  if (target.closest(TEXT_SELECTOR) !== null) return 'editable'
  return 'page'
}

/**
 * Whether a modal layer is currently open.
 *
 * Mirrors the primitives package's `modalSelector` — any element matching
 * `[role="dialog"][aria-modal="true"]` or `[role="menu"]` currently mounted — as
 * a boolean, which is all the shared eligibility checks consult
 * (`context.modal === null`).
 * @returns whether a modal is currently open.
 */
export function modalOpen(): boolean {
  if (typeof document === 'undefined') return false
  return document.querySelector(MODAL_SELECTOR) !== null
}

/**
 * Build the ownership context a capture-phase keydown carries.
 *
 * The same facts the keyboard adapter publishes for the bubble path: the press's
 * element (falling back to the focused element, exactly as the adapter does),
 * its region, and whether a modal sits above it. The `modal` field is the
 * adapter's opaque identifier; the shared checks only compare it against null,
 * so the single `'other'` label the adapter itself uses for unmarked modals is
 * the faithful value here.
 * @param element - the press's own element, or null to fall back to the focused one.
 * @returns the context in the shared decisions' shape.
 */
export function captureContext(element: Element | null): ShortcutContext {
  const target = element ?? focusedElement()
  return {
    region: regionOf(target),
    modal: modalOpen() ? 'other' : null,
    target,
  }
}
