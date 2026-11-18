/**
 * Local type surface of the browser half.
 *
 * The upstream client packages are not dependencies of this plugin, so every
 * cordis service this half touches is described structurally here and read as
 * a plain property of the plugin context. Only the shared JSON contract and the
 * locale keys are imported; those imports are type-only and leave no runtime
 * dependency behind.
 *
 * @module dsh-request-stats/client/types
 */

import type { ComponentType, ReactNode } from 'react'
import type { ConnectionKind, RecordStatus, SeriesPoint, Summary, WindowKey } from '../shared/types.ts'
import type { Dictionary, Translate } from './i18n.ts'

// ----------------------------------------------------------------- services

/** Disposer returned by `ctx.effect` bodies. */
export type EffectDispose = () => void

/** Body accepted by `ctx.effect`: an installer that may return its disposer. */
export type EffectCallback = () => EffectDispose | void

/** Slot registration options; only the fields this half actually passes. */
export interface SlotRegistration {
  /** Slot name, e.g. `main` or `sidebar.panellist`. */
  name: string
  /** Selection key of a main panel entry. */
  key?: string
  /** Stable id of a sidebar entry. */
  id?: string
  /** Ordering hint among sidebar entries. */
  order?: number
  /** Label lookup evaluated by the slot renderer. */
  label?: () => string
  /** Locale namespace the renderer binds for the component. */
  locale?: string
}

/** The slot service: renders components in named regions of the shell. */
export interface SlotsFace {
  /**
   * Declare that this plugin contributes to a slot.
   *
   * The callback is either a generator that yields registrations or a plain
   * installer; the returned disposer removes the contribution.
   */
  inject(owner: string, callback: () => unknown): () => void
  /** Register one entry under a slot; the returned disposer removes it. */
  register<P extends object>(options: SlotRegistration, component: ComponentType<P>): () => void
}

/** Dictionaries handed to the locale service under one namespace. */
export interface LocaleDictionaries {
  /** Chinese dictionary. */
  zh: Dictionary
  /** English dictionary. */
  en: Dictionary
}

/** The locale service: dictionary registration and per-namespace lookup. */
export interface LocaleFace {
  /** Register the plugin dictionaries; the returned disposer removes them. */
  register(namespace: string, dictionaries: LocaleDictionaries): () => void
  /** Bind a lookup for one namespace. */
  bind(namespace: string): Translate
}

/** One row of the shortcut service's read-only fixed catalog. */
export interface FixedShortcutRow {
  /** Stable row id; the dashboard row must stay mounted. */
  id: string
}

/** Snapshot source of the fixed shortcut catalog. */
export interface FixedCatalogFace {
  /** Current rows, or `undefined` while the catalog is not ready. */
  getSnapshot?: () => FixedShortcutRow[]
}

/** A logical key combination reserved by a fixed row. */
export interface ShortcutBinding {
  /** Physical `KeyboardEvent.code` of the combination. */
  code: string
  /** Modifiers that must be held, with `primary` meaning Command on macOS. */
  modifiers: ShortcutModifier[]
}

/** Modifier names understood by the shortcut service. */
export type ShortcutModifier = 'primary' | 'control' | 'alt' | 'shift' | 'meta'

/** Platform facts the shortcut functions need. */
export interface ShortcutProfile {
  /** Clipboard platform (`macos` switches the primary modifier to Command). */
  platform?: string
  /** Runtime kind (`web` additionally reserves the macOS fallback). */
  runtime?: string
  /** Read-only fixed catalog, used to prove the row is still mounted. */
  fixedCatalog?: FixedCatalogFace
}

/** One keyboard gesture as published by the shortcut service. */
export interface ShortcutGesture {
  /** Physical key code. */
  code?: string
  /** Second key of a chord, when the gesture is one. */
  secondCode?: string
  /** Control (or Command on macOS) held. */
  control?: boolean
  /** Alt/Option held. */
  alt?: boolean
  /** Shift held. */
  shift?: boolean
  /** Meta/Command held. */
  meta?: boolean
  /** Auto-repeat from a long press. */
  repeat?: boolean
  /** IME composition in progress. */
  composing?: boolean
  /** An earlier listener already consumed the event. */
  defaultPrevented?: boolean
}

/** Focus context of one keyboard event. */
export interface ShortcutContext {
  /** Modal layer currently owning the keyboard. */
  modal: string | null
  /** Focus region reported by the fixed-input channel. */
  region?: string
  /** Event target, opaque here. */
  target?: unknown
}

/** Command description of one fixed shortcut row. */
export interface FixedShortcutCommand {
  /** Stable row id. */
  id: string
  /** Locale label lookup. */
  label: () => string
  /** Keycaps shown in the shortcut documentation. */
  keys: string[]
  /** Physical combinations the row reserves. */
  bindings: ShortcutBinding[]
  /** Group the row belongs to. */
  group: string
}

/** One fixed input delivered to an observer. */
export interface FixedShortcutInput {
  /** Input kind; only `keydown` is actionable. */
  type: string
  /** The gesture, when the input is a key event. */
  gesture?: ShortcutGesture
  /** Focus context of the event. */
  context?: ShortcutContext
  /** Mark the input consumed so no later handler sees it. */
  consume(): void
}

/** The shortcut service: fixed rows plus the fixed-input channel. */
export interface ShortcutsFace extends ShortcutProfile {
  /** Reserve one fixed row; the returned disposer removes it. */
  registerFixed(command: FixedShortcutCommand): () => void
  /** Observe fixed input; the returned disposer stops the observer. */
  observeFixedInput(listener: (input: FixedShortcutInput) => void): () => void
}

/** One panel selection snapshot of the layout service. */
export interface LayoutPanelInfo {
  /** Currently selected panel id, or `null` when none is open. */
  activePanelId?: string | null
}

/** Snapshot source of the layout panel selection. */
export interface LayoutPanelInfoFace {
  /** Current selection. */
  getSnapshot: () => LayoutPanelInfo
}

/** The layout service: which panel is open and how to switch it. */
export interface LayoutFace {
  /** Panel selection source. */
  panelInfo?: LayoutPanelInfoFace
  /** Select a panel, or `null` to return to the conversation. */
  selectPanel(id: string | null): void
}

/**
 * The plugin context slice this half consumes.
 *
 * `slots` and `locale` arrive through `inject`, while `shortcuts` and `layout`
 * only exist inside the `ctx.inject([...])` scope; the intersection keeps one
 * shape for both call sites.
 */
export interface Context {
  /** Run an installer and tie its disposer to the plugin lifetime. */
  effect(callback: EffectCallback, label: string): void
  /** Wait for services, then run the callback with a context that has them. */
  inject(services: readonly string[], callback: (scope: Context) => void): void
  /** Locale service. */
  locale: LocaleFace
  /** Slot service. */
  slots: SlotsFace
  /** Shortcut service; only present inside the injected scope. */
  shortcuts?: ShortcutsFace
  /** Layout service; only present inside the injected scope. */
  layout?: LayoutFace
}

// ------------------------------------------------------------- presentation

/** Sidebar entry glyph props. */
export interface PanelIconProps {
  /** Glyph edge length in pixels. */
  size?: number
  /** Highlight the glyph as the selected panel. */
  active?: boolean
}

/** Inline alert glyph props. */
export interface AlertIconProps {
  /** Glyph edge length in pixels. */
  size?: number
}

/** One KPI tile. */
export interface KpiProps {
  /** Tile caption. */
  label: ReactNode
  /** Large value. */
  value: ReactNode
  /** Optional supporting line. */
  hint?: ReactNode
}

/** Chart series key of one trend. */
export type TrendKind = 'ttft' | 'tps'

/** One labelled sparkline over the most recent measured requests. */
export interface TrendProps {
  /** Locale lookup. */
  t: Translate
  /** Requests to plot; points without the measured field are skipped. */
  values: readonly SeriesPoint[]
  /** Which measurement to plot. */
  kind: TrendKind
}

/** Status chip of one request row. */
export interface StatusChipProps {
  /** Locale lookup. */
  t: Translate
  /** Outcome of the request. */
  status: RecordStatus
}

/** Server identity fields shared by a server row and a request record. */
export interface ServerIdentity {
  /** Directly observed peer address. */
  ip?: string
  /** Cloudflare edge code. */
  colo?: string
  /** Transport kind of the connection. */
  connection?: ConnectionKind
}

/** Server cell shared by the server and recent tables. */
export interface ServerCellProps {
  /** Locale lookup. */
  t: Translate
  /** Row carrying the server identity. */
  row: ServerIdentity
}

/** Empty state shown before the first request lands, or for an empty window. */
export interface EmptyStateProps {
  /** Locale lookup. */
  t: Translate
  /** The selected window is empty while the ledger is not. */
  scoped: boolean
  /** Switch the range control back to `all`. */
  onShowAll: () => void
}

/** Transient result of a clear action. */
export interface Notice {
  /** Outcome kind; errors keep the notice visible in the error tone. */
  tone: 'ok' | 'error'
  /** Already localized message. */
  text: string
}

/** Props the slot renderer passes to the state container; only `t` is read. */
export interface DashboardProps {
  /** Locale lookup supplied by the slot renderer. */
  t?: Translate
}

/** Props of the presentational dashboard; the test renders it directly. */
export interface DashboardViewProps {
  /** Locale lookup; missing means the keys render themselves. */
  t?: Translate
  /** Latest summary, or `null` before the first poll. */
  data: Summary | null
  /** Transport error of the latest poll, or `null`. */
  error: string | null
  /** No summary has arrived yet. */
  loading: boolean
  /** A manual refresh is in flight. */
  refreshing?: boolean
  /** Transient notice shown below the page notes. */
  notice?: Notice | null
  /** Selected history window. */
  windowKey: WindowKey
  /** Whether auxiliary calls are included. */
  includeAuxiliary: boolean
  /** A clear request is in flight. */
  clearing?: boolean
  /** The destructive action is asking for confirmation. */
  confirmClear?: boolean
  /** Range control handler. */
  onWindow: (key: WindowKey) => void
  /** Auxiliary-call toggle handler. */
  onToggleAux?: () => void
  /** Manual refresh handler. */
  onRefresh: () => void
  /** Confirmed clear handler. */
  onClear: () => void
  /** First press of the destructive action. */
  onRequestClear: () => void
  /** Cancel the pending confirmation. */
  onCancelClear?: () => void
}
