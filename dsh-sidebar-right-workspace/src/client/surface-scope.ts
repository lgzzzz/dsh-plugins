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
 * The product's scope: `ctx.workspaces` membership, read live.
 *
 * Membership is read at every question rather than cached, because the
 * Workspace stream can arrive after the Sessions it accounts for: a Session
 * that was alone when its surface was minted joins its Workspace's surface as
 * soon as the row that accounts for it exists.
 */
export class SidebarSurfaceScope implements SurfaceScopeLike {
  /** @param workspaces - the Client Workspace projection (`ctx.workspaces`). */
  constructor(private readonly workspaces: SurfaceMembership) {}

  /**
   * @param sessionId - Session identity.
   * @returns the id of the Workspace accounting for it, or the Session id itself.
   */
  keyOf(sessionId: string): string {
    const accounting = this.workspaces.list.getSnapshot().items
      .find(item => (item.sessionIds as readonly string[]).includes(sessionId))
    return accounting === undefined ? sessionId : accounting.workspaceId
  }

  /**
   * @param listener - invalidation callback.
   * @returns unsubscribe function for the Workspace projection.
   */
  subscribe(listener: () => void): () => void {
    return this.workspaces.list.subscribe(listener)
  }
}

/**
 * The scope of a store nothing groups: one surface per Session.
 * @returns a scope whose key is always the Session itself.
 */
export function perSessionScope(): SurfaceScopeLike {
  return { keyOf: sessionId => sessionId, subscribe: () => () => {} }
}
