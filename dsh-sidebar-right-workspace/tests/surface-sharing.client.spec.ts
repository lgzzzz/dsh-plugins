/**
 * One docking surface per Workspace.
 *
 * The store mints one engine instance per Session, so these assertions are all
 * about the seam between them: a commit anywhere becomes the Workspace's
 * surface, every other Session of that Workspace reads the same object, a
 * Session outside every Workspace keeps a surface of its own, and a membership
 * that arrives late moves a Session onto its Workspace's surface instead of
 * leaving it alone. The Tab domain is scoped the same way, so a Workspace's
 * tabs, their navigation and their pins are shared too, and the service reads
 * its room rule and its store through the surface rather than the Session.
 */
import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { LayoutState, TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import { DockController } from '@deepseek-ai/dsh-client-ui-dockkit'
import { SidebarSurfaceScope, perSessionScope, type SurfaceMembership } from '../src/client/surface-scope.ts'
import { createSidebarRightStore } from '../src/client/stores.ts'
import { TabDomain, type SidebarRightNavigator } from '../src/client/tab-domain.ts'
import { createSidebarRightController } from '../src/client/service.ts'
import { SidebarRightTabRegistry } from '../src/client/tab-registry.ts'
import { guideDefinition } from '../src/client/tabs/guide/definition.ts'
import { sidebarPersistence } from '../src/client/persistence.ts'

const A = 'a' as SessionId
const B = 'b' as SessionId
const C = 'c' as SessionId
const W = 'w' as WorkspaceId

/** A Workspace projection a spec can populate and notify. */
function membership() {
  const listeners = new Set<() => void>()
  const items: { workspaceId: WorkspaceId; sessionIds: SessionId[] }[] = []
  const source: SurfaceMembership = {
    list: {
      getSnapshot: () => ({ items }),
      subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    },
  }
  return {
    source,
    scope: new SidebarSurfaceScope(source),
    account(workspaceId: WorkspaceId, sessionIds: readonly SessionId[]): void {
      items.push({ workspaceId, sessionIds: [...sessionIds] })
      for (const listener of [...listeners]) listener()
    },
  }
}

function storage() {
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) },
  })
  return values
}

const seed = () => ({ kind: 'guide', title: 'Start' })

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

it('holds one surface for every Session of a Workspace, whichever instance commits', () => {
  const spaces = membership()
  spaces.account(W, [A, B])
  const handle = createSidebarRightStore(seed, spaces.scope)
  const first = handle.create(A)
  const second = handle.create(B)
  first.actions.open(A)
  first.actions.setExpanded(A, true)
  expect(second.getSnapshot().bySession[B]!.layout.expanded).toBe(true)
  expect(second.getSnapshot().bySession[B]).toBe(first.getSnapshot().bySession[A])
  second.actions.toggleExpanded(B)
  expect(first.getSnapshot().bySession[A]!.layout.expanded).toBe(false)
  expect(spaces.scope.keyOf(A)).toBe(W)
  handle.dispose()
})

it('keeps a Session no Workspace accounts for on a surface of its own', () => {
  const spaces = membership()
  spaces.account(W, [A])
  const handle = createSidebarRightStore(seed, spaces.scope)
  const accounted = handle.create(A)
  const alone = handle.create(B)
  accounted.actions.open(A)
  accounted.actions.setExpanded(A, true)
  alone.actions.open(B)
  expect(alone.getSnapshot().bySession[B]!.layout.expanded).toBe(false)
  expect(alone.getSnapshot().bySession[B]).not.toBe(accounted.getSnapshot().bySession[A])
  handle.dispose()
})

it('shares nothing without a Workspace projection, and groups when one is attached', () => {
  // The plugin's own contract must not require the Workspace service: without
  // it every Session keeps the surface it had before Workspaces were consulted.
  const scope = new SidebarSurfaceScope()
  const alone = membership()
  const handle = createSidebarRightStore(seed, scope)
  const first = handle.create(A)
  const second = handle.create(B)
  expect(scope.keyOf(A)).toBe(A)
  first.actions.open(A)
  first.actions.setExpanded(A, true)
  second.actions.open(B)
  expect(second.getSnapshot().bySession[B]!.layout.expanded).toBe(false)
  scope.attach(alone.source)
  alone.account(W, [A, B])
  expect(scope.keyOf(A)).toBe(W)
  expect(second.getSnapshot().bySession[B]).toBe(first.getSnapshot().bySession[A])
  // Dropping the service leaves each Session the surface they last shared.
  scope.attach(undefined)
  expect(scope.keyOf(A)).toBe(A)
  second.actions.toggleExpanded(B)
  expect(first.getSnapshot().bySession[A]!.layout.expanded).toBe(true)
  handle.dispose()
})

it('moves a Session onto its Workspace surface when membership arrives late', () => {
  const spaces = membership()
  const handle = createSidebarRightStore(seed, spaces.scope)
  const first = handle.create(A)
  const second = handle.create(B)
  first.actions.open(A)
  second.actions.open(B)
  expect(spaces.scope.keyOf(A)).toBe(A)
  spaces.account(W, [A, B])
  expect(spaces.scope.keyOf(A)).toBe(W)
  expect(second.getSnapshot().bySession[B]).toBe(first.getSnapshot().bySession[A])
  handle.dispose()
})

it('saves a Workspace layout once and restores it for whichever Session opens first', () => {
  storage()
  const spaces = membership()
  spaces.account(W, [A, B])
  const first = createSidebarRightStore(seed, spaces.scope)
  const writer = first.create(A)
  writer.actions.open(A)
  writer.actions.setExpanded(A, true)
  let opened!: TabId
  writer.actions.openContent(A, { kind: 'text', contentId: 'file:a', title: 'a' }, (id) => { opened = id })
  first.dispose()
  const reopened = createSidebarRightStore(seed, spaces.scope).create(B)
  expect(reopened.getSnapshot().bySession[B]!.layout.tabs[opened]!.title).toBe('a')
  expect(reopened.getSnapshot().bySession[B]!.layout.expanded).toBe(true)
})

it('adopts a Session\'s own saved layout as its Workspace\'s', () => {
  const values = storage()
  const legacy = createSidebarRightStore(seed, perSessionScope())
  const saved = legacy.create(A)
  saved.actions.open(A)
  saved.actions.setExpanded(A, true)
  expect(values.has(`${sidebarPersistence}.${A}`)).toBe(true)
  const spaces = membership()
  spaces.account(W, [A, B])
  const handle = createSidebarRightStore(seed, spaces.scope)
  const adopted = handle.create(A)
  expect(adopted.getSnapshot().bySession[A]!.layout.expanded).toBe(true)
  expect(values.has(`${sidebarPersistence}.${W}`)).toBe(true)
  const sibling = handle.create(B)
  expect(sibling.getSnapshot().bySession[B]).toBe(adopted.getSnapshot().bySession[A])
  handle.dispose()
})

it('gives one tab one occurrence per surface, whatever Session reads or navigates it', () => {
  const spaces = membership()
  spaces.account(W, [A, B])
  const navigator = { openResourceIn: vi.fn(), openTabIn: vi.fn(), closeIn: vi.fn() } satisfies
    SidebarRightNavigator & Record<string, ReturnType<typeof vi.fn>>
  const pin = vi.fn<(address: string, signal: AbortSignal) => void>()
  const domain = new TabDomain(navigator, pin, sessionId => spaces.scope.keyOf(sessionId))
  const controller = new DockController({
    makeInitialTab: id => ({ id, kind: 'text', contentId: 'dsh-resource://file/session/a/a.txt', title: 'a' }),
    makePaneTab: id => ({ id, kind: 'text', contentId: 'dsh-resource://file/session/a/a.txt', title: 'a' }),
  })
  const tabId = controller.openContent({ kind: 'text', contentId: 'dsh-resource://file/session/a/a.txt', title: 'a' })
  domain.sync(A, controller.getSnapshot().state)
  const pinnedOnFirstSync = pin.mock.calls.length
  // The tab list is the Workspace's: the other Session reads the same occurrence.
  const held = domain.occurrence(B, { id: tabId })
  expect(domain.occurrence(A, { id: tabId })).toBe(held)
  expect(pin.mock.calls.filter(([address]) => address === 'dsh-resource://file/session/a/a.txt')).toHaveLength(1)
  domain.navigate(B, tabId, { address: 'dsh-resource://file/session/a/a.txt', params: { line: 9 } })
  expect(held.navigation.getSnapshot().revision).toBe(1)
  // A Session outside the Workspace is another surface: its own occurrence, its own pin.
  const other = new DockController({
    makeInitialTab: id => ({ id, kind: 'text', contentId: 'dsh-resource://file/session/c/c.txt', title: 'c' }),
    makePaneTab: id => ({ id, kind: 'text', contentId: 'dsh-resource://file/session/c/c.txt', title: 'c' }),
  })
  const otherTab = other.openContent({ kind: 'text', contentId: 'dsh-resource://file/session/c/c.txt', title: 'c' })
  domain.sync(C, other.getSnapshot().state)
  expect(domain.occurrence(C, { id: otherTab })).not.toBe(held)
  expect(pin.mock.calls.length).toBeGreaterThan(pinnedOnFirstSync)
  domain.dispose()
})

/** A controller over an adopted store, with a scope the spec controls. */
function harness(scope: SidebarSurfaceScope) {
  const ctx = new Context()
  const tabs = new SidebarRightTabRegistry(ctx)
  tabs.register(guideDefinition(((key: string) => key) as Parameters<typeof guideDefinition>[0]))
  const { controller, adopt, show, measure } = createSidebarRightController(tabs, vi.fn(), {
    autoFullscreen: () => false,
    openWithFocus: (_sessionId, open) => { open() },
    closeWithFocus: (_sessionId, _paneId, close) => { close() },
  }, scope)
  const instance = createSidebarRightStore(seed, scope).create(A)
  adopt(A, instance)
  // The seat materializes the surface on its first active render.
  instance.actions.open(A)
  const layout = (): LayoutState => {
    const surface = instance.getSnapshot().bySession[A]
    if (surface === undefined) throw new Error('expected a surface')
    return surface.layout
  }
  return { controller, show, measure, instance, layout, ctx }
}

it('acts for an on-screen Session through the live store of its surface', () => {
  const spaces = membership()
  spaces.account(W, [A, B])
  const h = harness(spaces.scope)
  // B is on screen but the runtime minted no store for it: the surface's own
  // store answers, and it is written under its own Session id.
  h.show(B)
  expect(h.controller.isExpanded()).toBe(false)
  h.controller.toggleExpanded()
  expect(h.layout().expanded).toBe(true)
  expect(h.instance.getSnapshot().bySession[B]).toBeUndefined()
  h.controller.toggleExpanded()
  expect(h.layout().expanded).toBe(false)
})

it('applies the room rule its panel reported to every Session of the surface', () => {
  const spaces = membership()
  spaces.account(W, [A, B])
  const wide = harness(spaces.scope)
  wide.show(B)
  wide.controller.toggleExpanded()
  expect(wide.layout().expanded).toBe(true)
  wide.measure(A, () => true)
  expect(wide.controller.split()).toBeDefined()
  const narrow = harness(spaces.scope)
  narrow.show(B)
  narrow.controller.toggleExpanded()
  narrow.measure(A, () => false)
  expect(narrow.controller.split()).toBeUndefined()
})
