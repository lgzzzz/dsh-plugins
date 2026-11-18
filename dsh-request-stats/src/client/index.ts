/**
 * Browser half of `dsh-request-stats`: the sidebar entry, the dashboard panel
 * it opens, and the fixed shortcut row that toggles it.
 *
 * The page itself is Host-agnostic: it reads the ledger over the plugin's HTTP
 * bridge while the panel is mounted. The module loader treats the exports below
 * as the plugin body; `name` is also the module-table id.
 *
 * @module dsh-request-stats/client
 */

import { Dashboard, DashboardView } from './dashboard.ts'
import { NS, en, zh } from './i18n.ts'
import { PanelIcon } from './icons.ts'
import {
  SHORTCUT_ID,
  SHORTCUT_WEB_MAC_FALLBACK,
  eventGesture,
  modalOpen,
  ownsShortcut,
  shortcutBindings,
  shortcutKeys,
} from './shortcuts.ts'
import type { Context } from './types.ts'

/** Loader entry identity for the browser half. */
export const name = 'dsh-request-stats'

/** Services the browser half waits for before it starts. */
export const inject = ['slots', 'locale']

/** Shared identity of the sidebar entry and the main panel it opens. */
const PANEL_ID = 'requestStats'

// Test seam: the presentational page renders without a Host; the module
// loader ignores members it does not consume.
export const __test = {
  DashboardView,
  PanelIcon,
  en,
  zh,
  shortcutKeys,
  shortcutBindings,
  ownsShortcut,
  SHORTCUT_ID,
  SHORTCUT_WEB_MAC_FALLBACK,
}

/**
 * Activate the browser half: dictionaries, panel entries, and the shortcut.
 * @param ctx - the plugin context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-request-stats: dictionaries')
  const t = ctx.locale.bind(NS)

  // A global panel: the sidebar entry selects it and the main column
  // renders the dashboard under the same id.
  ctx.slots.inject('main', function* () {
    yield ctx.slots.register({
      name: 'main',
      key: PANEL_ID,
      locale: NS,
    }, Dashboard)
  })

  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: PANEL_ID,
    order: 30,
    label: () => t('panel'),
    locale: NS,
  }, PanelIcon))

  // Shortcut: primary+alt+H toggles the dashboard from anywhere on the
  // page. The fixed row reserves the combination in the shortcut
  // catalog; the fixed-input observer handles page focus, while the
  // capture listener covers xterm, whose handler stops the event before
  // it reaches the fixed-input channel.
  ctx.inject(['shortcuts', 'layout'], (scope) => {
    const shortcuts = scope.shortcuts
    const layout = scope.layout
    if (shortcuts === undefined || layout === undefined) return
    if (typeof shortcuts.registerFixed !== 'function' || typeof shortcuts.observeFixedInput !== 'function') return

    const toggleBoard = () => {
      try {
        const active = layout.panelInfo?.getSnapshot?.().activePanelId
        layout.selectPanel(active === PANEL_ID ? null : PANEL_ID)
      } catch (error) {
        console.warn('[dsh-request-stats] could not toggle the dashboard:', error)
      }
    }

    scope.effect(() => {
      try {
        return shortcuts.registerFixed({
          id: SHORTCUT_ID,
          label: () => t('shortcutOpen'),
          keys: shortcutKeys(shortcuts.platform),
          bindings: shortcutBindings(shortcuts),
          group: 'application',
        })
      } catch (error) {
        console.warn('[dsh-request-stats] shortcut registration failed:', error)
        return () => {}
      }
    }, 'dsh-request-stats: dashboard shortcut row')

    scope.effect(() => shortcuts.observeFixedInput((input) => {
      if (input.type !== 'keydown') return
      if (!ownsShortcut(shortcuts, input.gesture, input.context)) return
      input.consume()
      toggleBoard()
    }), 'dsh-request-stats: dashboard shortcut')

    scope.effect(() => {
      if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return () => {}
      const onKeydown = (event: KeyboardEvent) => {
        if (event.type !== 'keydown') return
        if (!ownsShortcut(shortcuts, eventGesture(event), { modal: modalOpen() ? 'other' : null })) return
        event.preventDefault()
        event.stopPropagation()
        toggleBoard()
      }
      window.addEventListener('keydown', onKeydown, true)
      return () => window.removeEventListener('keydown', onKeydown, true)
    }, 'dsh-request-stats: dashboard shortcut capture')
  })
}
