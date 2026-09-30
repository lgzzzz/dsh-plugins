/**
 * Pure, DOM-free decisions behind the two focus-free keyboard bridges.
 *
 * `src/client.ts` reads live state — the shortcut catalog, the Session list,
 * real Elements — and hands plain values to these functions. Keeping the whole
 * policy here means "which press belongs to the bundled command", "which press
 * this plugin may take over", and "when a second Escape completes a stop" are
 * testable without a browser or a Cordis runtime.
 */

/** Canonical modifier order the shortcut registry normalizes every binding into. */
export const MODIFIER_ORDER = ['control', 'alt', 'shift', 'meta'] as const

/** One normalized modifier name. */
export type ModifierName = (typeof MODIFIER_ORDER)[number]

/** The part of a shortcut gesture this plugin reads. */
export interface GestureLike {
  readonly code: string
  readonly secondCode?: string
  readonly control: boolean
  readonly alt: boolean
  readonly shift: boolean
  readonly meta: boolean
  readonly repeat: boolean
  readonly composing: boolean
  readonly defaultPrevented: boolean
}

/** A normalized physical binding as the catalog publishes it. */
export interface BindingLike {
  readonly code: string
  readonly secondCode?: string
  readonly modifiers: readonly ModifierName[]
}

/** The catalog fields that decide whether a command currently owns its keys. */
export interface CatalogRowLike {
  readonly id: string
  readonly binding: BindingLike | null
  readonly issue: unknown
  readonly conflicts: readonly string[]
}

/** The input-ownership facts a fixed handler receives. */
export interface InputContextLike {
  readonly modal: string | null
  readonly region: string
}

/** Ordered modifiers actually held for one gesture. */
export function modifiersOf(gesture: GestureLike): ModifierName[] {
  return MODIFIER_ORDER.filter((name) => gesture[name])
}

/**
 * Whether one gesture is exactly this binding. Two-key chords never match (both
 * bridged commands are single keys); modifiers compare as an unordered set, so
 * the decision does not depend on the catalog's canonical ordering.
 * @param binding - the catalog binding the command currently owns.
 * @param gesture - the physical press being routed.
 * @returns whether this press is that command's binding.
 */
export function bindingMatches(binding: BindingLike, gesture: GestureLike): boolean {
  if (binding.code !== gesture.code) return false
  if (binding.secondCode !== undefined || gesture.secondCode !== undefined) return false
  const held = modifiersOf(gesture)
  if (binding.modifiers.length !== held.length) return false
  return binding.modifiers.every((name) => held.includes(name))
}

/**
 * The binding a command currently owns, or undefined while the row is unbound,
 * reserved by an editor/system rule, or in conflict — the same predicate
 * `refreshLabels` applies before it publishes an enabled binding.
 * @param rows - the effective catalog snapshot.
 * @param id - registered command id.
 * @returns the effective binding, or undefined when the command owns no keys.
 */
export function enabledBinding(rows: readonly CatalogRowLike[], id: string): BindingLike | undefined {
  const row = rows.find((candidate) => candidate.id === id)
  if (row === undefined) return undefined
  if (row.binding === null || row.issue !== null || row.conflicts.length > 0) return undefined
  return row.binding
}

/** The two pane commands this plugin bridges, by their registered ids. */
export interface PaneCommandIds {
  readonly fullscreen: string
  readonly split: string
}

/** Which bundled pane action a press belongs to. */
export type PaneAction = 'fullscreen' | 'split'

/**
 * Which bundled pane command currently owns this press, if any.
 *
 * Reading the effective catalog instead of hardcoding a combination is what
 * keeps a rebound command authoritative and this bridge out of its way.
 * @param rows - the effective catalog snapshot.
 * @param gesture - the physical press being routed.
 * @param ids - the two command ids to test.
 * @returns the owned action, or undefined for any other press.
 */
export function paneActionFor(
  rows: readonly CatalogRowLike[],
  gesture: GestureLike,
  ids: PaneCommandIds,
): PaneAction | undefined {
  if (gesture.secondCode !== undefined) return undefined
  const candidates: readonly (readonly [PaneAction, string])[] = [
    ['fullscreen', ids.fullscreen],
    ['split', ids.split],
  ]
  for (const [action, id] of candidates) {
    const binding = enabledBinding(rows, id)
    if (binding !== undefined && bindingMatches(binding, gesture)) return action
  }
  return undefined
}

/**
 * Whether one press may start or complete this plugin's stop sequence: a bare
 * Escape, not a key repeat, not composing, not already consumed, outside a
 * terminal and with no modal open — the admission the bundled fixed sequence
 * applies before it even looks for its own target.
 * @param gesture - the physical press being routed.
 * @param context - modal and region ownership for this press.
 * @returns whether the press is eligible to stop a turn.
 */
export function escapeEligible(gesture: GestureLike, context: InputContextLike): boolean {
  return gesture.code === 'Escape'
    && !gesture.repeat
    && !gesture.composing
    && !gesture.defaultPrevented
    && !gesture.control
    && !gesture.alt
    && !gesture.shift
    && !gesture.meta
    && context.modal === null
    && context.region !== 'terminal'
}

/**
 * Whether the bundled stop sequence owns this press by target.
 *
 * Mirrors the bundled guard: an Element inside both conversation markers, and
 * not an approval control, an embedding frame, a terminal, or inert content.
 * When this holds, the bundled handler has strictly better evidence (turn
 * identity, which is not public) than this plugin can read, so this plugin must
 * stand down instead of running a second cancel.
 * @param target - the keydown target, or null without one.
 * @returns whether the bundled fixed sequence owns the press.
 */
export function conversationOwnsTarget(target: Element | null): boolean {
  if (target === null || typeof target.closest !== 'function') return false
  const occurrence = target.closest('[data-conversation-session]')
  const region = target.closest('[data-conversation-region]')
  if (occurrence === null || region === null) return false
  if (typeof occurrence.contains !== 'function' || !occurrence.contains(region)) return false
  return target.closest('[data-approval-key], iframe, .xterm, [inert]') === null
}

/**
 * The one Session the main view currently retains, read without DOM focus.
 *
 * `sessions.list.byId[id].retainedBy.mainView` is the same fact `UiSession`
 * reads in `isMain`. More than one retained id means a Session switch is in
 * flight, and no answer is safer than cancelling the wrong turn.
 * @param list - the Session list snapshot.
 * @returns the retained main-view Session id, or undefined when it is ambiguous.
 */
export function mainViewSessionId<Id extends string>(
  list: {
    readonly ids: readonly Id[]
    readonly byId: Readonly<Record<string, { readonly retainedBy?: unknown } | undefined>>
  },
): Id | undefined {
  const mains = list.ids.filter((id) => hasMainViewRetention(list.byId[id]?.retainedBy))
  return mains.length === 1 ? mains[0] : undefined
}

/**
 * Read the positive `mainView` source count off an untyped retention record.
 * @param retainedBy - a Session summary's retention counts.
 * @returns whether the main view retains that Session.
 */
function hasMainViewRetention(retainedBy: unknown): boolean {
  if (typeof retainedBy !== 'object' || retainedBy === null) return false
  const count = (retainedBy as Record<string, unknown>).mainView
  return typeof count === 'number' && count > 0
}

/** One press's identity for the stop sequence: a Session and its binding generation. */
export interface StopToken {
  readonly sessionId: string
  /** The Session binding object itself; identity is the generation. */
  readonly binding: unknown
}

/**
 * The two presses must name the same Session generation.
 * @param left - the pending first press.
 * @param right - the press being considered.
 * @returns whether both presses address the same generation.
 */
export function sameStopToken(left: StopToken, right: StopToken): boolean {
  return left.sessionId === right.sessionId && left.binding === right.binding
}

/** Clock and equality seams, so the sequence is testable without real time. */
export interface StopSequenceOptions {
  /** Maximum time between the two independent presses, from the shortcut service. */
  readonly intervalMs: number
  now?: () => number
  same?: (left: StopToken, right: StopToken) => boolean
}

/** One short-lived first press. */
export interface StopSequence {
  /**
   * Record one eligible press.
   * @param token - the Session generation this press would stop.
   * @returns whether this press completes the sequence.
   */
  press(token: StopToken): boolean
  /** Drop the pending first press and its expiry timer. */
  reset(): void
}

/**
 * Mirror of the bundled `StopSequence`: remember one press for at most
 * `intervalMs`, and treat a second press inside that window against the same
 * Session generation as the stop request.
 * @param options - interval plus optional clock/equality seams.
 * @returns the press/reset pair.
 */
export function createStopSequence(options: StopSequenceOptions): StopSequence {
  const now = options.now ?? (() => performance.now())
  const same = options.same ?? sameStopToken
  let first: { token: StopToken; deadline: number } | undefined
  let timer: ReturnType<typeof setTimeout> | undefined

  const reset = (): void => {
    first = undefined
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
  }

  return {
    press(token) {
      const previous = first
      reset()
      if (previous !== undefined && now() <= previous.deadline && same(previous.token, token)) return true
      first = { token, deadline: now() + options.intervalMs }
      timer = setTimeout(reset, options.intervalMs + 1)
      return false
    },
    reset,
  }
}
