/**
 * One drawer per surface.
 *
 * The panel of a Workspace lives in the view of one of its Sessions and stays
 * there while the user moves between them, so switching conversations never
 * remounts it — that is what keeps a tab body's own content, keyed by the
 * Session scope it renders under, the same one. These assertions are the
 * policy: which view draws, which are kept alive, and how the drawer is
 * remembered across a trip to another Workspace.
 */
import { expect, it, vi } from 'vitest'
import type { ISessions, SessionListState, SessionReference, SessionRetainOptions, SessionTarget } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { SidebarSessionViews } from '../src/client/session-views.ts'
import { SidebarSurfaceScope, type SurfaceMembership } from '../src/client/surface-scope.ts'

const A = 'a' as SessionId
const B = 'b' as SessionId
const C = 'c' as SessionId
const W = 'w' as WorkspaceId
const TAB = 'tab' as TabId

/** A Workspace projection a spec can populate. */
function membership(accounted: readonly SessionId[]): SidebarSurfaceScope {
  const items = [{ workspaceId: W, sessionIds: accounted }]
  const source: SurfaceMembership = {
    list: { getSnapshot: () => ({ items }), subscribe: () => () => {} },
  }
  return new SidebarSurfaceScope(source)
}

/** The Session services a view needs: catalog membership and one reference per retention. */
function sessions(listed: SessionId[]) {
  const catalog = (): SessionListState => ({
    ids: [...listed],
    byId: Object.fromEntries(listed.map(id => [id, { id, displayTitle: id, running: false, retainedBy: {}, blank: false, updatedAt: 0 }])),
    phase: 'ready',
    projectionsBySession: {},
  })
  const source = {
    list: { getSnapshot: catalog, subscribe: () => () => {} },
    retain: vi.fn((target: SessionTarget, _options: SessionRetainOptions): SessionReference => {
      const released = vi.fn()
      return {
        sessionId: target as SessionId,
        binding: {} as SessionReference['binding'],
        ready: Promise.resolve({} as SessionReference['binding']),
        release: released,
        [Symbol.dispose]: released,
      }
    }),
  }
  return { sessions: source as unknown as ISessions, source, listed }
}

it('draws a Workspace panel in the Session that owns it while its siblings are selected', () => {
  const spaces = membership([A, B])
  const r = sessions([A, B])
  const views = new SidebarSessionViews(r.sessions, spaces)
  views.select(A)
  const first = views.source.getSnapshot()
  expect(first.map(view => [view.sessionId, view.draws, view.onScreen, view.markerSession]))
    .toEqual([[A, true, true, A]])
  views.select(B)
  const second = views.source.getSnapshot()
  // Both Sessions are live; only the Workspace's own drawer draws.
  expect(second.map(view => [view.sessionId, view.draws, view.onScreen, view.markerSession]))
    .toEqual([[A, true, true, B], [B, false, true, B]])
  // The DOM marker is the conversation on screen, not the Session drawing it.
  expect(second.every(view => view.markerSession === B)).toBe(true)
  views.dispose()
})

it('keeps the drawing Session across a trip to another Workspace and back', () => {
  const spaces = membership([A, B])
  const r = sessions([A, B, C])
  const views = new SidebarSessionViews(r.sessions, spaces)
  views.select(A)
  views.select(C)
  // C is a surface of its own; the Workspace's drawer is retired, not forgotten.
  expect(views.source.getSnapshot().map(view => [view.sessionId, view.draws])).toEqual([[C, true]])
  views.select(B)
  expect(views.source.getSnapshot().map(view => [view.sessionId, view.draws, view.markerSession]))
    .toEqual([[A, true, B], [B, false, B]])
  // A was retained again for its surface, and only once.
  expect(r.source.retain.mock.calls.filter(([target]) => target === A)).toHaveLength(2)
  views.dispose()
})

it('keeps a Session outside every Workspace on a surface of its own', () => {
  const spaces = membership([A])
  const views = new SidebarSessionViews(sessions([A, B]).sessions, spaces)
  views.select(A)
  expect(views.source.getSnapshot().map(view => view.sessionId)).toEqual([A])
  views.select(B)
  // B is a surface of its own: A's view is retired like any unselected one.
  expect(views.source.getSnapshot().map(view => [view.sessionId, view.draws, view.onScreen]))
    .toEqual([[B, true, true]])
  expect(spaces.keyOf(A)).toBe(W)
  expect(spaces.keyOf(B)).toBe(B)
  views.dispose()
})

it('keeps a retired drawer while it holds an initialized body, and replaces an absent one', () => {
  const spaces = membership([A, B])
  const r = sessions([A, B])
  const views = new SidebarSessionViews(r.sessions, spaces)
  views.select(A)
  const lifetime = new AbortController()
  views.source.getSnapshot()[0]!.retainTab(TAB, lifetime.signal)
  views.select(B)
  expect(views.source.getSnapshot().map(view => view.sessionId)).toEqual([A, B])
  lifetime.abort()
  expect(views.source.getSnapshot().map(view => view.sessionId)).toEqual([A, B])
  // The drawer left the catalog: the selected Session takes its place.
  const absent = sessions([B])
  absent.source.retain = r.source.retain
  const replaced = new SidebarSessionViews(absent.sessions, spaces)
  replaced.select(A)
  replaced.select(B)
  expect(replaced.source.getSnapshot().map(view => [view.sessionId, view.draws]))
    .toEqual([[B, true]])
  views.dispose()
  replaced.dispose()
})
