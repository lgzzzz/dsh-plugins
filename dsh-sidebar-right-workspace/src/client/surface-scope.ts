/**
 * Which docking surface a Session draws into.
 *
 * The surface belongs to the Workspace: every Session accounted to one
 * Workspace shares a single surface — its layout, its tab records, its recorded
 * sequence and its mint counter — while a Session no Workspace accounts for
 * keeps a surface of its own. The key names the surface, its storage scope, and
 * the Tab domain's occurrence scope, so one Workspace is one sidebar wherever
 * it is drawn from.
 *
 * The key stays a Session id outside a Workspace on purpose: that is the scope
 * layouts were saved under before surfaces were Workspace-bound, so an
 * ungrouped Session, and the first grouped Session to arrive after an upgrade,
 * still find what they left behind.
 */
import type { WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'

/** What the shared-surface machinery needs from a scope: one key per Session, and change notifications. */
export interface SurfaceScopeLike {
  /**
   * The surface one Session draws into.
   * @param sessionId - Session identity.
   * @returns its Workspace id, or the Session id when no Workspace accounts for it.
   */
  keyOf(sessionId: string): string
  /**
   * Observe membership changes; the stored key of a Session may change with them.
   * @param listener - invalidation callback.
   * @returns unsubscribe function.
   */
  subscribe(listener: () => void): () => void
}

/** The membership face a scope reads: whose Sessions each Workspace accounts for. */
export interface SurfaceMembership {
  readonly list: {
    getSnapshot(): { readonly items: readonly Pick<WorkspaceView, 'workspaceId' | 'sessionIds'>[] }
    subscribe(listener: () => void): () => void
  }
}

/**
 * The product's scope: `ctx.workspaces` membership while that service is
 * mounted, and one surface per Session while it is not.
 *
 * The Workspace service is read opportunistically rather than injected as a
 * requirement. This package's own contract — the faces other packages consume,
 * and the point at which it applies at all — must not depend on a service it
 * merely consults: a composition without the Workspace projection keeps the
 * per-Session sidebars it had, instead of losing the right column entirely.
 *
 * Membership is read at every question rather than cached, because the
 * Workspace stream can arrive after the Sessions it accounts for: a Session
 * that was alone when its surface was minted joins its Workspace's surface as
 * soon as the row that accounts for it exists.
 */
export class SidebarSurfaceScope implements SurfaceScopeLike {
  private membership: SurfaceMembership | undefined
  private unsubscribeMembership: (() => void) | undefined
  private readonly listeners = new Set<() => void>()

  /** @param workspaces - the Client Workspace projection, when it is already mounted. */
  constructor(workspaces?: SurfaceMembership) {
    if (workspaces !== undefined) this.attach(workspaces)
  }

  /**
   * Adopt the Workspace projection, or drop it when that service goes away.
   *
   * Adopting or dropping re-reads every Session's key on the next question and
   * notifies the subscribers, so a store that was already mirroring per-Session
   * surfaces re-groups onto the Workspace's.
   * @param workspaces - `ctx.workspaces`, or `undefined` while it is absent.
   */
  attach(workspaces: SurfaceMembership | undefined): void {
    this.unsubscribeMembership?.()
    this.membership = workspaces
    this.unsubscribeMembership = workspaces?.list.subscribe(() => { this.notify() })
    this.notify()
  }

  /**
   * @param sessionId - Session identity.
   * @returns the id of the Workspace accounting for it, or the Session id itself.
   */
  keyOf(sessionId: string): string {
    const items = this.membership?.list.getSnapshot().items
    if (items === undefined) return sessionId
    const accounting = items.find(item => (item.sessionIds as readonly string[]).includes(sessionId))
    return accounting === undefined ? sessionId : accounting.workspaceId
  }

  /**
   * @param listener - invalidation callback.
   * @returns unsubscribe function for this scope.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener()
  }
}

/**
 * The scope of a store nothing groups: one surface per Session.
 * @returns a scope whose key is always the Session itself.
 */
export function perSessionScope(): SurfaceScopeLike {
  return { keyOf: sessionId => sessionId, subscribe: () => () => {} }
}
