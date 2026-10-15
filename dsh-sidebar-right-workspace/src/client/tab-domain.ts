/**
 * The Tab domain: what a tab record carries that the layout does not.
 *
 * One `TabOccurrence` per open record, keyed by (surface, tab id) — the surface
 * being the Workspace a Session draws into, or the Session itself when no
 * Workspace accounts for it: where the tab was navigated to, an abort signal
 * spanning the record's life, and the actions the tab may take on itself.
 * Holding a record also pins its address in the resource model, so switching
 * tabs unmounts a body without dropping its content. Records are therefore
 * shared by every Session of one sidebar, exactly as the layout that lists them
 * is: a tab opened from one Session's conversation is the same occurrence,
 * with the same opener's parameters, in every other.
 *
 * `sync` reconciles occurrences against one surface's layout after every
 * commit: a record that appeared is pinned, one that vanished (closed, or its
 * open undone) is aborted and dropped. A record restored by undo is a new
 * occurrence and is fetched again if the resource model already let it go. The
 * controller syncs each adopted store on every commit, on screen or not, so a
 * record closed from one Session's seat is aborted on that commit. The slot
 * framework binds the navigation sources for each record's `useTabInfo` reader.
 */
import type { Branded } from '@deepseek-ai/dsh-brand'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type { LayoutState, PaneId, TabId, TabRecord } from '@deepseek-ai/dsh-client-ui-dockkit'
import { findTabPane } from '@deepseek-ai/dsh-client-ui-dockkit'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SidebarRightNavigationParams } from './contract/params.ts'
import type { SidebarRightTabActions, SidebarRightTabCommands, SidebarRightTabNavigation, SidebarRightTabPlacement } from './contract/slots.ts'
import type { SidebarRightOpenResourceOptions, SidebarRightOpenTabOptions, SidebarRightPlacement } from './service.ts'

/**
 * The navigation face a tab's actions call back into, aimed at the Session the
 * record was opened under; the controller resolves that to a live Session of
 * the same surface, and does nothing when the surface has none.
 */
export interface SidebarRightNavigator {
  /** Open a resource in one session; see `ISidebarRight.openResource`. */
  openResourceIn(sessionId: SessionId, address: string, options?: SidebarRightOpenResourceOptions): void
  /** Open a page type in one session; see `ISidebarRight.openTab`. */
  openTabIn(sessionId: SessionId, kind: string, options?: SidebarRightOpenTabOptions): void
  /** Close a tab of one session. */
  closeIn(sessionId: SessionId, tabId: TabId): void
}

/** `ctx.resources.pin`: hold an address's content open for as long as `signal` lives. */
export type PinResource = (address: string, signal: AbortSignal) => void

/** Identity of one open lifetime; a restored tab receives a new value. */
export type SidebarRightOccurrenceId = Branded<'SidebarRightOccurrenceId'>

/** What one open tab record holds beyond its layout entry. */
export interface TabOccurrence {
  /** Operations of the currently mounted page body. */
  readonly commands: SidebarRightTabCommands

  /** Distinguishes a reopened record from its previous lifetime. */
  readonly id: SidebarRightOccurrenceId
  /**
   * The Session whose commit first held this record — its surface's opener,
   * not necessarily the Session currently drawing it. A tab action aimed here
   * lands on the record's surface whichever of its Sessions runs it.
   */
  readonly sessionId: SessionId
  readonly tabId: TabId
  /** Aborted when the record disappears or this package unloads. */
  readonly signal: AbortSignal
  /** The latest navigation aimed at the record; `set` on every `navigate`. */
  readonly navigation: SnapshotStore<SidebarRightTabNavigation>
  /** Stable for the occurrence's life, so a body may hold it. */
  readonly tabActions: SidebarRightTabActions
}

/** An occurrence plus what only the domain touches. */
interface Held extends TabOccurrence {
  commands: SidebarRightTabCommands

  readonly controller: AbortController
  /** The docked pane holding the record at the last sync; `undefined` while it floats or before any sync. */
  paneId: PaneId | undefined
  /** Whether the resource model has been asked to hold the address. */
  pinned: boolean
}

/** Every surface's occurrences. */
export class TabDomain {
  private readonly bySurface = new Map<string, Map<TabId, Held>>()

  /**
   * @param navigator - where tab actions go, aimed at the tab's session; the navigation controller.
   * @param pin - `ctx.resources.pin`, called once per occurrence at its first sync.
   * @param keyOf - the surface a Session draws into; without one, every Session is its own surface.
   */
  constructor(
    private readonly navigator: SidebarRightNavigator,
    private readonly pin: PinResource,
    private readonly keyOf: (sessionId: SessionId) => string = sessionId => sessionId,
  ) {}

  /**
   * Reconcile one surface's occurrences with its committed layout.
   *
   * Called by the controller after every commit of any store instance that
   * draws into the surface, and only then: aborting a vanished record runs the
   * types' cleanup, which writes their stores. A Session whose surface already
   * reconciled that layout reconciles nothing.
   * @param sessionId - the Session whose store committed.
   * @param layout - that Session's layout as committed.
   */
  sync(sessionId: SessionId, layout: LayoutState): void {
    const held = this.surface(this.keyOf(sessionId))
    for (const [tabId, occurrence] of held) {
      if (layout.tabs[tabId] !== undefined) continue
      held.delete(tabId)
      occurrence.controller.abort()
    }
    for (const tab of Object.values(layout.tabs)) {
      const occurrence = held.get(tab.id) ?? this.hold(sessionId, tab.id, { address: tab.contentId, params: undefined, revision: 0 })
      const pane = findTabPane(layout, tab.id)
      occurrence.paneId = pane.host === 'dock' ? pane.id : undefined
      if (occurrence.pinned) continue
      occurrence.pinned = true
      this.pin(occurrence.navigation.getSnapshot().address, occurrence.signal)
    }
  }

  /**
   * Read an occurrence created by navigation or committed-store reconciliation.
   * @param sessionId - the Session the record is shown in.
   * @param tab - the record being drawn.
   * @returns its surface's occurrence.
   * @throws when the record has not been reconciled or has disappeared.
   */
  occurrence(sessionId: SessionId, tab: Pick<TabRecord, 'id'>): TabOccurrence {
    const occurrence = this.bySurface.get(this.keyOf(sessionId))?.get(tab.id)
    if (occurrence === undefined) throw new Error(`sidebarRight: tab "${tab.id}" has no committed occurrence in session "${sessionId}"`)
    return occurrence
  }

  /**
   * Record that an `open` settled on a tab.
   *
   * A record the layout has not yet shown the seat gets its occurrence here, so
   * the body's first render already carries the opener's `params`.
   * @param sessionId - the Session opened into.
   * @param tabId - the tab the open settled on.
   * @param target - the address and the opener's params.
   */
  navigate(sessionId: SessionId, tabId: TabId, target: { address: string; params: SidebarRightNavigationParams }): void {
    const existing = this.surface(this.keyOf(sessionId)).get(tabId)
    if (existing === undefined) {
      this.hold(sessionId, tabId, { ...target, revision: 1 })
      return
    }
    existing.navigation.set({ ...target, revision: existing.navigation.getSnapshot().revision + 1 })
  }

  /** Abort every occurrence of every surface; the package is unloading. */
  dispose(): void {
    for (const held of this.bySurface.values()) {
      for (const occurrence of held.values()) occurrence.controller.abort()
    }
    this.bySurface.clear()
  }

  private surface(key: string): Map<TabId, Held> {
    let held = this.bySurface.get(key)
    if (held === undefined) {
      held = new Map()
      this.bySurface.set(key, held)
    }
    return held
  }

  private hold(sessionId: SessionId, tabId: TabId, navigation: SidebarRightTabNavigation): Held {
    const controller = new AbortController()
    const { navigator } = this
    // Where an open from this tab lands, read at call time because the tab may
    // have been dragged since: `replaceTab: true` names this tab; otherwise the
    // pane holding it, unless the caller named another.
    const place = (placement: SidebarRightTabPlacement): SidebarRightPlacement => ({
      ...placement.replaceTab === true
        ? { replaceTab: tabId }
        : held.paneId === undefined ? {} : { paneId: held.paneId },
      ...placement.paneId === undefined ? {} : { paneId: placement.paneId },
      ...placement.preferNewPane === undefined ? {} : { preferNewPane: placement.preferNewPane },
      ...placement.revealIfOpened === undefined ? {} : { revealIfOpened: placement.revealIfOpened },
    })
    const held: Held = {
      id: randomUUID() as SidebarRightOccurrenceId,
      sessionId,
      tabId,
      controller,
      commands: {},
      signal: controller.signal,
      navigation: createSnapshotStore(navigation),
      paneId: undefined,
      pinned: false,
      tabActions: {
        bindCommands: (commands) => {
          if (controller.signal.aborted) return () => {}
          held.commands = commands
          const release = (): void => {
            if (held.commands === commands) held.commands = {}
            controller.signal.removeEventListener('abort', release)
          }
          controller.signal.addEventListener('abort', release, { once: true })
          return release
        },
        openResource: (address, options = {}) => {
          navigator.openResourceIn(sessionId, address, { ...place(options), params: options.params })
        },
        openTab: (kind, options = {}) => {
          navigator.openTabIn(sessionId, kind, { ...place(options), params: options.params })
        },
        close: () => { navigator.closeIn(sessionId, tabId) },
      },
    }
    this.surface(this.keyOf(sessionId)).set(tabId, held)
    return held
  }
}
