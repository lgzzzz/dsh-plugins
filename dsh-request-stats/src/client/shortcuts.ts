/**
 * Shortcut row of the dashboard and its pure predicates.
 *
 * The row reserves primary+alt+H in the shortcut catalog; the predicates below
 * decide when a key event belongs to the dashboard. Nothing here touches a
 * service instance, so the same functions serve the fixed-input channel and
 * the window capture listener.
 *
 * @module dsh-request-stats/client/shortcuts
 */

import type {
  FixedShortcutRow,
  ShortcutBinding,
  ShortcutContext,
  ShortcutGesture,
  ShortcutProfile,
} from './types.ts'

/** Read-only shortcut row that toggles the dashboard. */
export const SHORTCUT_ID = 'dsh-request-stats.open-board'

/** Logical primary+alt+H: ⌘⌥H on macOS, Ctrl+Alt+H elsewhere. */
export const SHORTCUT_BINDING: ShortcutBinding = { code: 'KeyH', modifiers: ['primary', 'alt'] }

/** macOS Web fallback because the system menu owns ⌘⌥H in most browsers. */
export const SHORTCUT_WEB_MAC_FALLBACK: ShortcutBinding = { code: 'KeyH', modifiers: ['control', 'alt'] }

/** Modal roots that own the keyboard while open. */
export const MODAL_SELECTOR = '[role="dialog"][aria-modal="true"], [role="menu"]'

/** Keycaps for the dashboard shortcut on the receiving platform. */
export function shortcutKeys(platform: string | undefined): string[] {
  return platform === 'macos' ? ['⌘', '⌥', 'H'] : ['Ctrl', 'Alt', 'H']
}

/**
 * Physical combinations reserved by the fixed row.
 *
 * macOS Web keeps Ctrl+Alt+H as a fallback because the system menu usually
 * owns ⌘⌥H. The fallback is not advertised as the primary keycap.
 */
export function shortcutBindings(shortcuts: ShortcutProfile): ShortcutBinding[] {
  const bindings = [SHORTCUT_BINDING]
  if (shortcuts.runtime === 'web' && shortcuts.platform === 'macos') {
    bindings.push(SHORTCUT_WEB_MAC_FALLBACK)
  }
  return bindings
}

/** Whether a gesture is one of the row's combinations on this device. */
export function shortcutGesture(shortcuts: ShortcutProfile, gesture: ShortcutGesture | null | undefined): boolean {
  if (gesture === undefined || gesture === null) return false
  if (gesture.code !== SHORTCUT_BINDING.code || gesture.secondCode !== undefined) return false
  if (gesture.alt !== true || gesture.shift === true) return false
  if (shortcuts.platform === 'macos') {
    if (gesture.meta === true && gesture.control !== true) return true
    return shortcuts.runtime === 'web' && gesture.control === true && gesture.meta !== true
  }
  return gesture.control === true && gesture.meta !== true
}

/**
 * Whether one keyboard event belongs to the dashboard shortcut.
 *
 * The fixed row must still be mounted, so an unregistered row (duplicate
 * id or a failed registration) cannot swallow the combination. Long
 * presses, IME composition, consumed input, and modal layers all keep the
 * key.
 */
export function ownsShortcut(
  shortcuts: ShortcutProfile,
  gesture: ShortcutGesture | null | undefined,
  context?: ShortcutContext | null,
): boolean {
  if (gesture === undefined || gesture === null) return false
  if (gesture.repeat === true || gesture.composing === true || gesture.defaultPrevented === true) return false
  if (context !== undefined && context !== null && context.modal !== null) return false
  if (!shortcutGesture(shortcuts, gesture)) return false
  const rows: FixedShortcutRow[] | undefined = shortcuts.fixedCatalog?.getSnapshot?.()
  return Array.isArray(rows) && rows.some(row => row.id === SHORTCUT_ID)
}

/** Normalize a DOM keydown to the gesture shape the shortcut service publishes. */
export function eventGesture(event: KeyboardEvent): ShortcutGesture {
  return {
    code: event.code,
    secondCode: undefined,
    control: event.ctrlKey,
    alt: event.altKey,
    shift: event.shiftKey,
    meta: event.metaKey,
    repeat: event.repeat,
    composing: event.isComposing === true
      || event.keyCode === 229
      || (typeof event.getModifierState === 'function' && event.getModifierState('AltGraph') === true),
    defaultPrevented: event.defaultPrevented === true,
  }
}

/** Modal layers own the keyboard; a global panel must not open behind them. */
export function modalOpen(): boolean {
  if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return false
  return document.querySelector(MODAL_SELECTOR) !== null
}
