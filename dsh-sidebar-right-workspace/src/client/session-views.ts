/**
 * Selection, retention and drawing policy for the Sidebar's Session views.
 *
 * One view per Session that has one, but one *drawer* per surface: a Workspace's
 * panel lives in the view of the Session that owns the surface — its anchor —
 * and stays there while the user moves between that Workspace's Sessions. That
 * is what makes the sidebar one panel per Workspace rather than one per
 * conversation: switching Sessions only changes which conversation is shown,
 * never which Session scope the panel's tab bodies render under, so their
 * content (a terminal, a preview) is the very same one.
 *
 * The anchor is remembered per surface for the plugin's lifetime, and so
 * survives its view being retired: returning to a Workspace draws its panel
 * under the same Session again, which is what keeps a tab body's identity
 * stable across a trip to another Workspace. The anchor is only replaced when
 * the Session that holds it is no longer in the Session catalog.
 *
 * A view is retired when nothing needs it: not selected, not the anchor of a
 * displayed surface, and holding no initialized tab body. The anchor of a
 * displayed surface is thereby kept mounted whether or not the user has it
 * selected.
 */
import type { ISessions, SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { SidebarSessionView } from './session-view.ts'
import type { SurfaceScopeLike } from './surface-scope.ts'

/** The reference is exclusively a framework SessionProvider target, not a business-component service. */
export interface SidebarSessionViewSnapshot {
  readonly sessionId: SessionId
  readonly reference: SessionReference
  readonly selected: boolean
  /** Whether the selected Session draws into this view's surface: its panel is the displayed one. */
  readonly onScreen: boolean
  /** Whether this view draws its surface's panel; exactly one view per displayed surface does. */
  readonly draws: boolean
  /** The Session whose sidebar this panel is: the selected one of its surface, or the drawer's own while that surface is away. */
  readonly markerSession: SessionId
  /** Stable for this View's lifetime, independently of Session injection bindings. */
  readonly retainTab: SidebarSessionView['retainTab']
}

/** Selects, anchors and retires views; the Sidebar plugin's injected dependencies own global teardown. */
export class SidebarSessionViews {
  /** Selected, anchored and retained View targets observed by the root renderer. */
  readonly source = createSnapshotStore<readonly SidebarSessionViewSnapshot[]>([])
  private readonly views = new Map<SessionId, SidebarSessionView>()
  private readonly viewsByReference = new Map<SessionReference, SidebarSessionView>()
  /** The Session drawing each surface's panel; remembered past its view's retirement. */
  private readonly anchors = new Map<string, SessionId>()
  private selected: SessionId | undefined
  private closed = false
  private readonly unsubscribeScope: () => void

  /**
   * @param sessions - Session catalog and reference allocator.
   * @param scope - which surface a Session draws into.
   */
  constructor(private readonly sessions: ISessions, private readonly scope: SurfaceScopeLike) {
    // Membership can arrive after the Sessions it accounts for: the anchor of a
    // surface is re-read then, exactly as the store re-reads its keys.
    this.unsubscribeScope = scope.subscribe(() => { if (!this.closed) this.reconcile() })
  }

  /**
   * Change the foreground Session while preserving retained background Views.
   * @param sessionId - main selection, or absence.
   */
  select(sessionId: SessionId | undefined): void {
    if (this.closed || this.selected === sessionId) return
    this.selected = sessionId
    this.reconcile()
  }

  /**
   * Bind a committed root; release retired references after that root unmounts.
   * @param reference - framework target published by this owner.
   * @returns releases this committed mount.
   */
  mount(reference: SessionReference): () => void {
    const view = this.viewsByReference.get(reference)
    if (view === undefined) {
      if (this.closed) return () => {}
      throw new Error('Sidebar Session view reference is no longer owned')
    }
    return view.mount()
  }

  /** Plugin shutdown releases every view, including any awaiting a React unmount. */
  dispose(): void {
    this.closed = true
    this.unsubscribeScope()
    this.views.clear()
    this.anchors.clear()
    this.source.set([])
    for (const view of this.viewsByReference.values()) view.dispose()
  }

  /**
   * Bring the live view set in line with the selection: the selected Session
   * and the displayed surface's anchor both need a view, everything else is
   * kept only while it draws or holds a body.
   */
  private reconcile(): void {
    const selected = this.selected
    if (selected !== undefined) {
      this.view(selected)
      const key = this.scope.keyOf(selected)
      const anchor = this.anchorFor(key, selected)
      if (anchor !== selected) this.view(anchor)
    }
    for (const view of [...this.views.values()]) this.prune(view)
    this.publish()
  }

  /**
   * The Session drawing one surface's panel, remembered across its view's
   * retirement and replaced only when its Session left the catalog.
   * @param key - surface key.
   * @param fallback - the selected Session of that surface.
   * @returns the anchor's Session id.
   */
  private anchorFor(key: string, fallback: SessionId): SessionId {
    const held = this.anchors.get(key)
    if (held !== undefined && this.listed(held)) return held
    this.anchors.set(key, fallback)
    return fallback
  }

  /** Whether the Session catalog still carries one Session. */
  private listed(sessionId: SessionId): boolean {
    return this.sessions.list.getSnapshot().byId[sessionId] !== undefined
  }

  /** The view of one Session, minted on first need. */
  private view(sessionId: SessionId): SidebarSessionView {
    const held = this.views.get(sessionId)
    if (held !== undefined) return held
    const view = new SidebarSessionView(sessionId, this.sessions, (disposed) => {
      this.viewsByReference.delete(disposed.reference)
    }, (released) => { this.prune(released) })
    this.views.set(sessionId, view)
    this.viewsByReference.set(view.reference, view)
    return view
  }

  private prune(view: SidebarSessionView): void {
    const key = this.scope.keyOf(view.sessionId)
    const onScreen = this.selected !== undefined && this.scope.keyOf(this.selected) === key
    const draws = this.anchors.get(key) === view.sessionId
    if (view.sessionId === this.selected || view.hasRetainedTabs || (draws && onScreen)) return
    this.views.delete(view.sessionId)
    // Render targets must be withdrawn before an unmounted view can release its reference.
    this.publish()
    view.retire()
  }

  private publish(): void {
    const selected = this.selected
    const screenKey = selected === undefined ? undefined : this.scope.keyOf(selected)
    const next = [...this.views.values()]
      .filter((view) => {
        const key = this.scope.keyOf(view.sessionId)
        return this.anchors.get(key) === view.sessionId || key === screenKey
      })
      .sort((a, b) => a.sessionId.localeCompare(b.sessionId))
      .map((view) => {
        const key = this.scope.keyOf(view.sessionId)
        const onScreen = screenKey !== undefined && screenKey === key
        return {
          sessionId: view.sessionId,
          reference: view.reference,
          selected: view.sessionId === selected,
          onScreen,
          draws: this.anchors.get(key) === view.sessionId,
          markerSession: onScreen && selected !== undefined ? selected : view.sessionId,
          retainTab: view.retainTab,
        }
      })
    // Membership moves arrive often and change nothing here most of the time;
    // an unchanged projection must not re-render the whole right column.
    const held = this.source.getSnapshot()
    if (held.length === next.length && next.every((view, index) => {
      const was = held[index]
      return was !== undefined && was.sessionId === view.sessionId && was.reference === view.reference
        && was.selected === view.selected && was.onScreen === view.onScreen && was.draws === view.draws
        && was.markerSession === view.markerSession
    })) return
    this.source.set(next)
  }
}
