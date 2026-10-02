/**
 * Shortcut group 5 — a new key pair: `Ctrl+Alt+←` / `Ctrl+Alt+→` step the Right
 * Sidebar's shown page and hand the keyboard to the page they land on.
 *
 * Like `Ctrl+Alt+J` this pair has **no bundled owner at all**: nothing in the
 * application reserves it, so this plugin mounts its own fixed row
 * (`dsh-focus-free-shortcuts.page-cycle`, group `application`) — the same
 * read-only row mechanism `fixed.move` / `approval.allow` / `focus-composer`
 * use. One row carries both arrows, the way `fixed.move` carries `↑` and `↓`:
 * a mounted fixed row's presence *is* its reservation, and the two bindings of
 * one row are the two directions of one action.
 *
 * The page list and the switch come from the public Sidebar face — nothing in
 * the store is reached into. The on-screen Session (`sidebar.mounted`, the same
 * Session the whole column draws) owns the pages: `tabsIn(sessionId)` lists
 * them in record order, `active()` names the page shown now, and
 * `focus(tabId)` is exactly the operation a chip click runs (recorded in the
 * layout history, pane activated with the tab). Step direction is cyclic, so
 * `←` from the first page lands on the last, exactly like the chips' own
 * arrow-key navigation but usable from anywhere.
 *
 * The auto-focus half is what makes the pair useful: after the switch, the
 * keyboard is handed to the page the column now shows, so landing on the
 * terminal lets you type straight away and landing on a file tree lets the
 * arrow keys scroll it. Two rules keep that from fighting the page itself:
 * the hand-over happens **after** the commit that shows the page (`focus()`
 * commits a store change React renders asynchronously, so the pane is located
 * one animation frame later, never in the same keydown), and it never steals a
 * keyboard the page already took — a terminal body focuses its own xterm the
 * moment it becomes visible, and that focus is left alone. The pane choice
 * mirrors `visibleSidebarPane`'s own three-step rule (active marker, else the
 * first visible pane), re-derived from the same markup because that helper is
 * not on the package's public export surface.
 *
 * Being the page-stepper is why this group keeps working **from inside a
 * page**: the press is accepted in every input region, including `terminal`
 * and `editable`. But a focused terminal is also the one place the DOM channel
 * cannot reach: xterm owns every key it handles and calls `stopPropagation()`
 * on its textarea handler, so the keydown never ascends to the window-level
 * fixed-input listener — a press the observer never receives is a press the
 * observer cannot act on. This group therefore takes the extra step the other
 * four never need: a **capture-phase** `keydown` listener on the window that
 * runs *before* the event descends into the terminal, and withholds the press
 * exactly when the event would land inside `.xterm` — the one local control
 * the channel cannot outrun. Withholding there also stops the escape sequence
 * (`\x1b[1;7D` / `\x1b[1;7C`) xterm would otherwise send to the shell. Every
 * other press keeps flowing to the observer, so the two paths never act on the
 * same event; both paths run the same decision (`pageCycleTarget`).
 *
 * Fixed actions on every runtime (nothing configurable is dispatched by the
 * native keyboard bridge for these keys), so the bridge installs on Web and
 * Desktop alike.
 */
import { bindingMatches, fixedRowOwns } from './binding.ts'
import { isKeydown, name, warn, type KeydownInput } from './runtime.ts'
import type {
  ShortcutContext,
  ShortcutFixedCatalogEntry,
  ShortcutFixedCommand,
  ShortcutGesture,
  Shortcuts,
} from '@deepseek-ai/dsh-client-shortcuts/client'
import type {ShortcutCommandId} from '@deepseek-ai/dsh-client-shortcuts/protocol'
import type {Context} from '@deepseek-ai/cordis'
// 空导入(不引入任何名字):只为让 TS 加载本包的 `declare module '@deepseek-ai/cordis'`
// 增强 —— `ctx.sidebarRight` 由它声明。该面带 `mounted` / `tabsIn` / `active` /
// `focus` 的类并不在包的 `/client` 导出名单里,所以 `Context['sidebarRight']` 是取它的公开途径。
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'

/** The Right-Sidebar face, exactly as the Cordis augmentation declares it. */
type Sidebar = Context['sidebarRight']

/** Which way along the page cycle one press steps. */
export type PageStep = 'previous' | 'next'

/** Registered id of the fixed page-cycle row this bridge mounts and follows. */
export const PAGE_CYCLE_ID: ShortcutCommandId = 'dsh-focus-free-shortcuts.page-cycle' as ShortcutCommandId

/** `Ctrl+Alt+←`: one page towards the cycle's start. */
export const PAGE_PREVIOUS_BINDING: ShortcutFixedCommand['bindings'][number] = {
  code: 'ArrowLeft',
  modifiers: ['control', 'alt'],
}

/** `Ctrl+Alt+→`: one page towards the cycle's end. */
export const PAGE_NEXT_BINDING: ShortcutFixedCommand['bindings'][number] = {
  code: 'ArrowRight',
  modifiers: ['control', 'alt'],
}

/** The fixed row this plugin mounts: it reserves both arrows and names the action. */
export const PAGE_CYCLE_COMMAND: ShortcutFixedCommand = {
  id: PAGE_CYCLE_ID,
  label: () => '切换右栏页面',
  keys: ['Ctrl', 'Alt', '←/→'],
  bindings: [PAGE_PREVIOUS_BINDING, PAGE_NEXT_BINDING],
  group: 'application',
}

/**
 * Which direction the mounted row's own reservation names for this press.
 *
 * The row's bindings *are* this module's constants — a fixed row cannot be
 * rebound — so matching the press against the row and reading the matched
 * binding's code is following the row, not hardcoding a combination: a row
 * that failed to mount leaves the key alone.
 * @param rows - the mounted fixed catalog snapshot.
 * @param id - the registered fixed command id.
 * @param gesture - the physical press being routed.
 * @returns the step direction, or undefined when the row does not own it.
 */
export function pageStepFor(
  rows: readonly ShortcutFixedCatalogEntry[],
  id: string,
  gesture: ShortcutGesture,
): PageStep | undefined {
  const row = rows.find((candidate) => candidate.id === id)
  if (row === undefined) return undefined
  const matched = row.bindings.find((binding) => bindingMatches(binding, gesture))
  if (matched === undefined) return undefined
  if (matched.code === PAGE_NEXT_BINDING.code) return 'next'
  if (matched.code === PAGE_PREVIOUS_BINDING.code) return 'previous'
  return undefined
}

/**
 * Whether one press may step the column without DOM focus.
 *
 * Deliberately the opposite of the other four groups at two points: **every
 * region is accepted** (`page`, `editable`, and `terminal`) and **an already
 * consumed press is still acted on** (`defaultPrevented` is not consulted). The
 * point of the pair is to work from inside the page it is about to leave — a
 * terminal keeps this shortcut usable only if the press is taken even when a
 * local control handled it first. Only the guards that would make the switch
 * meaningless stay: composing input, an autorepeat flood, and a modal above
 * the page.
 * @param gesture - the physical press being routed.
 * @param context - modal and region ownership for this press.
 * @returns whether the press may step the shown page.
 */
export function pageCycleEligible(gesture: ShortcutGesture, context: ShortcutContext): boolean {
  return !gesture.repeat
    && !gesture.composing
    && context.modal === null
}

/**
 * The page one step from the shown page in a cyclic strip.
 * @param pages - the session's page ids, in record order.
 * @param currentId - the page shown now; `undefined` when none is shown.
 * @param step - which way to move.
 * @returns the page to focus, or undefined when there is nothing to switch to
 *   (fewer than two pages, or the shown page is not in the list).
 */
export function steppedPageId<T extends string>(
  pages: readonly T[],
  currentId: T | undefined,
  step: PageStep,
): T | undefined {
  if (pages.length < 2) return undefined
  const index = currentId === undefined ? -1 : pages.indexOf(currentId)
  if (index < 0) return undefined
  const delta = step === 'next' ? 1 : -1
  return pages[(index + delta + pages.length) % pages.length]
}

/**
 * Hand the keyboard to the page the column is showing now, unless the page
 * already took it.
 *
 * Runs after the switch committed: locate the on-screen Session's root, pick
 * its visible pane (active marker first, else the first visible one — the same
 * three-step rule `visibleSidebarPane` applies), and focus that pane. A page
 * that focused itself (the terminal focuses its xterm when it becomes visible)
 * keeps the keyboard: focus is only filled in when nothing inside the pane
 * holds it.
 * @param sessionId - the Session whose column should own the keyboard.
 * @returns whether a visible pane was found and holds the keyboard.
 */
export function focusShownPage(sessionId: string): boolean {
  const root = sidebarRoot(sessionId)
  if (root === undefined) return false
  const pane = activePane(root)
  if (pane === undefined) return false
  const focused = typeof document === 'undefined' ? null : document.activeElement
  if (focused !== null && pane.contains(focused)) return true
  focusPane(pane)
  return true
}

/**
 * The mounted column's root for one Session, matched by identity rather than
 * by interpolating the id into a selector.
 * @param sessionId - the Session whose column to locate.
 * @returns its `[data-sidebar-right-session]` root, or undefined.
 */
function sidebarRoot(sessionId: string): Element | undefined {
  if (typeof document === 'undefined') return undefined
  return [...document.querySelectorAll('[data-sidebar-right-session]')]
    .find((node) => node.getAttribute('data-sidebar-right-session') === sessionId)
}

/**
 * The pane the column currently presents, or the first visible one.
 *
 * The same election `visibleSidebarPane` makes when called without a preferred
 * pane: docked panes require the column open, floats are always visible, and
 * anything under `hidden` / `aria-hidden` is not a target. Re-derived from the
 * same markup because that helper is not exported from the package's `/client`
 * surface.
 * @param root - the Session's column root.
 * @returns the elected pane element, or undefined when none is visible.
 */
export function activePane(root: Element): Element | undefined {
  const panes = [...root.querySelectorAll('[data-dockkit-pane], [data-dockkit-float]')]
    .filter((pane) => pane.closest('[hidden], [aria-hidden="true"]') === null
      && (pane.hasAttribute('data-dockkit-float') || root.hasAttribute('data-sidebar-right-open')))
  return panes.find((pane) => pane.hasAttribute('data-dockkit-pane-active') || pane.hasAttribute('data-dockkit-float-active'))
    ?? panes[0]
}

/** `Element.focus` lives on `HTMLElement`; a page pane is always one. */
function focusPane(pane: Element): void {
  const focusable = pane as unknown as { focus?: (options?: FocusOptions) => void }
  focusable.focus?.({ preventScroll: true })
}

/** Run once the page switch has reached the DOM, before the next paint. */
function whenShown(run: () => void): void {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => run())
  else run()
}

/**
 * Everything one press needs in order to switch pages, resolved against live
 * state and checked *before* the event is touched.
 *
 * Shared by both delivery paths — the DOM fixed-input observer and the
 * capture-phase withholding in front of a terminal — so the two can never
 * disagree about what the press does. A press that resolves yields the Session
 * to switch inside and the page to focus; `undefined` means the press must be
 * left alone.
 * @param shortcuts - keyboard service (the mounted fixed row is the guard).
 * @param sidebar - Right-Sidebar face (expansion, Session, pages, active page).
 * @param gesture - the physical press being routed.
 * @param context - modal and region ownership for this press.
 * @returns the switch target, or undefined when nothing should switch.
 */
export function pageCycleTarget(
  shortcuts: Shortcuts,
  sidebar: Sidebar,
  gesture: ShortcutGesture,
  context: ShortcutContext,
): PageStepTarget | undefined {
  if (!pageCycleEligible(gesture, context)) return undefined
  const step: PageStep | undefined = pageStepFor(shortcuts.fixedCatalog.getSnapshot(), PAGE_CYCLE_ID, gesture)
  if (step === undefined) return undefined
  // A collapsed column shows no page: there is nothing to step and no visible
  // pane to focus. The expand key already focuses the active pane.
  if (!sidebar.isExpanded()) return undefined
  const sessionId = sidebar.mounted.getSnapshot()
  if (sessionId === undefined) return undefined
  const pages = sidebar.tabsIn(sessionId).map((tab) => tab.id)
  const currentId = sidebar.active()?.id
  const nextId = steppedPageId(pages, currentId, step)
  // `nextId === undefined` covers a single page, a missing active tab, and an
  // unadopted session alike. `nextId === currentId` is unreachable for a
  // wrapping step (length >= 2 makes the offset non-zero), kept as a guard.
  if (nextId === undefined || nextId === currentId) return undefined
  return { sessionId, nextId }
}

/** One resolved switch: the Session to switch inside and the page to focus. */
export interface PageStepTarget {
  readonly sessionId: string
  readonly nextId: string
}

/**
 * Bridge the page-cycle keys.
 *
 * Fixed keys are reserved by their owning feature, and fixed input comes from
 * the DOM channel on every runtime — nothing here is a configurable binding a
 * native keyboard bridge would dispatch — so, like the focus-composer and
 * approval bridges, this bridge installs on Web and Desktop alike.
 *
 * The bridge delivers the press through **two** paths because the DOM channel
 * cannot reach every keyboard: the observer (below) handles presses the channel
 * receives, and the capture-phase listener (added by the effect below it)
 * handles the one press the channel can never receive — a keydown whose target
 * sits inside `.xterm`, where the terminal's own handler stops the event before
 * it ascends. Both paths run the shared decision (`pageCycleTarget`) and the
 * same switch, so a press is acted on exactly once: a capture hook that steps
 * swallows the event (the observer never sees it), and a hook that does not
 * step leaves it flowing (the observer then decides, identically).
 * @param ctx - client root context.
 */
export function installPageCycleBridge(ctx: Context): void {
  ctx.inject(['shortcuts', 'sidebarRight'], (scope) => {
    const shortcuts: Shortcuts = scope.shortcuts
    const sidebar: Sidebar = scope.sidebarRight
    if (typeof shortcuts.observeFixedInput !== 'function') {
      warn('shortcuts service exposes no observeFixedInput; page-cycle keys not installed')
      return
    }
    // The row must be mounted before the observer reads it; both live in this
    // scope, and the disposer pair tears them down in the same order.
    scope.effect(() => shortcuts.registerFixed(PAGE_CYCLE_COMMAND), `${name}: page cycle fixed row`)
    scope.effect(() => shortcuts.observeFixedInput((input) => {
      if (!isKeydown(input)) return
      handlePageCycleInput(shortcuts, sidebar, input)
    }), `${name}: page cycle keys`)
    // The terminal half: a keydown inside `.xterm` never reaches the window
    // listener above (the terminal stops it on its textarea handler), so this
    // window capture listener — installed after the shortcuts bridge, hence
    // after its own capture reset — sees it one phase earlier, before it
    // descends into the terminal. It acts only on presses a terminal would
    // otherwise own, and it hands the decision to the very function the
    // observer uses.
    scope.effect(() => {
      if (typeof window === 'undefined') return () => {}
      const onKeydown = (event: KeyboardEvent): void => {
        if (event.type !== 'keydown') return
        const element = composedElement(event)
        if (!terminalTarget(element)) return
        const target = pageCycleTarget(shortcuts, sidebar, captureGesture(event), captureContext(element))
        if (target === undefined) return
        // Withhold before the terminal's own handler: the event stops here, so
        // xterm neither receives it nor sends an escape sequence to the shell.
        event.preventDefault()
        event.stopPropagation()
        switchPage(sidebar, target)
      }
      window.addEventListener('keydown', onKeydown, true)
      return () => window.removeEventListener('keydown', onKeydown, true)
    }, `${name}: page cycle terminal capture`)
  })
}

/**
 * Handle one keydown the DOM channel delivered, against the mounted
 * page-cycle row.
 *
 * Resolve everything the action needs *before* consuming: the row must still
 * own the press, the column must be showing a page, the on-screen Session must
 * be unambiguous, and the stepped page must actually differ from the one shown.
 * Only then is the press consumed and the switch performed (the same recorded
 * operation a chip click runs, with the keyboard handed to the page the commit
 * reveals).
 * @param shortcuts - keyboard service.
 * @param sidebar - Right-Sidebar face.
 * @param input - one fixed keydown.
 */
function handlePageCycleInput(shortcuts: Shortcuts, sidebar: Sidebar, input: KeydownInput): void {
  const target = pageCycleTarget(shortcuts, sidebar, input.gesture, input.context)
  if (target === undefined) return
  // Consume before acting: this press is the page-cycle key pair's alone, and a
  // half-consumed step from inside a text field would also type into that field.
  input.consume()
  switchPage(sidebar, target)
}

/**
 * Perform a resolved switch: focus the stepped page, then hand the keyboard to
 * the page the commit reveals.
 *
 * `sidebar.focus(nextId)` is the same recorded operation a chip click runs: it
 * activates the pane with the tab and commits a layout the renderer draws
 * asynchronously, so the pane is located one animation frame later, never in
 * the same keydown. A page that focuses itself keeps the keyboard; the
 * hand-over only fills the gap.
 * @param sidebar - Right-Sidebar face.
 * @param target - the resolved switch.
 */
function switchPage(sidebar: Sidebar, target: PageStepTarget): void {
  sidebar.focus(target.nextId)
  whenShown(() => {
    focusShownPage(target.sessionId)
  })
}

/**
 * The first Element on the event's composed path.
 *
 * The capture hook needs the press's destination before any bubble listener has
 * run; `composedPath()` is the native way to name it. Entries are duck-typed by
 * the one capability the hook needs — `Element.prototype.closest` — so tests
 * may hand the hook plain fake elements.
 * @param event - the keydown in the capture phase.
 * @returns the innermost Element of the path, or null when there is none.
 */
function composedElement(event: KeyboardEvent): Element | null {
  for (const value of event.composedPath()) {
    if (typeof value === 'object' && value !== null && 'closest' in value) return value as Element
  }
  return null
}

/**
 * Whether the press would land inside a terminal — the one local control the
 * DOM channel cannot outrun.
 *
 * A terminal handles every key it owns and calls `stopPropagation()` from its
 * textarea handler, so the fixed-input listener on the window never receives
 * such a press; this is exactly what the capture hook exists for. The `.xterm`
 * class is the same scope the keyboard adapter uses to name the `terminal`
 * region, so "the channel cannot deliver" and "capture hook takes it" agree.
 * Also a type guard: after the hook's `if (!terminalTarget(element)) return`
 * passes, TypeScript knows `element` is a real Element.
 * @param element - the press's innermost element.
 * @returns whether the press descends into a terminal.
 */
function terminalTarget(element: Element | null): element is Element {
  if (element === null) return false
  return element.closest('.xterm') !== null
}

/**
 * The same modal facts the keyboard adapter computes for the observer path,
 * re-derived because a capture-phase listener runs before the adapter's
 * context is built.
 *
 * Mirrors the primitives package's `modalSelector` — any element matching
 * `[role="dialog"][aria-modal="true"]` or `[role="menu"]` currently mounted —
 * as a boolean, which is all the eligibility check consults (`modal === null`).
 * @returns whether a modal is currently open.
 */
function modalOpen(): boolean {
  if (typeof document === 'undefined') return false
  return document.querySelector('[role="dialog"][aria-modal="true"], [role="menu"]') !== null
}

/**
 * Build the gesture facts a capture-phase keydown carries, in the shape the
 * shared decision reads.
 *
 * Composition is read from the event's own flag (`isComposing`) rather than the
 * keyboard adapter's live observer: at the capture phase the observer has not
 * run yet, and the flag is the same intent — do not steal half-typed input.
 * `defaultPrevented` is always false at the capture phase (nothing has run
 * yet), and the decision does not consult it anyway.
 * @param event - the keydown in the capture phase.
 * @returns the gesture in the shared decision's shape.
 */
function captureGesture(event: KeyboardEvent): ShortcutGesture {
  return {
    code: event.code,
    secondCode: undefined,
    control: event.ctrlKey,
    alt: event.altKey,
    shift: event.shiftKey,
    meta: event.metaKey,
    repeat: event.repeat,
    composing: event.isComposing,
    defaultPrevented: false,
  }
}

/**
 * Build the ownership context a capture-phase keydown carries: the press's own
 * terminal region (the terminal-subtree scope is implied by the `.xterm` gate)
 * and the modal facts `modalOpen()` derives.
 * @param element - the press's innermost element.
 * @returns the context in the shared decision's shape.
 */
function captureContext(element: Element): ShortcutContext {
  return {
    region: 'terminal',
    modal: modalOpen() ? 'other' : null,
    target: element,
  }
}