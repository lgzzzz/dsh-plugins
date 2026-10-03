/**
 * Ring suppression for a control the keyboard was taken from.
 *
 * The app paints focus rings from `:focus-visible` alone, and keeps them
 * invisible while a pointer owns focus: `ui-theme`'s `focus.css` makes the ring
 * colour transparent under
 * `html[data-input-modality='pointer'] body :focus-visible:not(:read-write)`,
 * and the shell's `ui-primitives` input-modality tracker publishes `pointer`
 * until a non-composing navigation key, or a non-composing key followed by
 * focus landing on a different control, restores keyboard styling.
 *
 * Answering an approval moves focus — the composer takeover belongs to the
 * Session and hands the keyboard back when it unloads — so the press this plugin
 * takes is immediately followed by exactly that focus move. The app flips to
 * keyboard modality, the ring colour stops being transparent, and a control that
 * is still `:focus-visible` (the process card the user had just clicked) starts
 * painting its outline. That is the artifact: the press itself was consumed, yet
 * the visual state reads as "keyboard navigation happened".
 *
 * The app already owns the tool for this. `focusWithoutRing(element)` marks an
 * element with `data-dsh-automatic-focus`; the theme turns that marker into
 * `outline: none` for as long as the element keeps focus, and the marker is
 * released on blur or on a navigation key, so normal keyboard styling resumes.
 * Marking the control whose press was taken keeps focus exactly where the user
 * put it and removes only the ring the taken press would otherwise reveal. The
 * release rule is mirrored here rather than imported: this bundle carries no
 * runtime dependency on the primitives package (see `docs/06` §8).
 */

/** The marker `focusWithoutRing` publishes; the theme suppresses the outline while it is present. */
const RING_SUPPRESSION_ATTRIBUTE = 'data-dsh-automatic-focus'

/** Navigation keys that release the marker and restore normal focus styling. */
const RING_RELEASE_KEYS = new Set([
  'Tab',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
])

/** One live release per marked element, so a repeated press replaces the previous marker. */
const ringReleases = new WeakMap<Element, () => void>()

/**
 * The document's focused element, or null where there is no document.
 * @returns the focused element, or null.
 */
function focusedElement(): Element | null {
  if (typeof document === 'undefined') return null
  return document.activeElement ?? null
}

/**
 * Keep one control from painting a focus ring, without moving focus.
 *
 * Only the element that currently holds focus can paint a ring, and only a real
 * control benefits: the document element and `<body>` are left untouched, and an
 * element that already lost focus is left alone rather than marked. Repeat calls
 * for the same element replace the previous marker, and the marker itself is
 * withdrawn again on blur or on the first navigation key.
 * @param element - the control whose press was taken, or null without one.
 */
export function suppressFocusRing(element: Element | null): void {
  if (element === null) return
  const control = element as Partial<Element>
  if (typeof control.setAttribute !== 'function' || typeof control.addEventListener !== 'function') return
  if (typeof document === 'undefined') return
  if (element === document.body || element === document.documentElement) return
  if (focusedElement() !== element) return
  // Only a real control reaches this point: the guards above reject anything
  // that cannot carry the marker and its release listeners.
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
  // Focus can move between the check above and the marker landing; a control that
  // is no longer focused paints nothing, so its marker is withdrawn again.
  if (focusedElement() !== target) release()
}
