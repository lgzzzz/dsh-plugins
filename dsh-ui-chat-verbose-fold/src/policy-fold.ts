/**
 * Pure logic for the Verbose work-details fold patch.
 *
 * The plugin does not replace ui-chat, it reuses the live slot ledger. A
 * registered view entry carries its own `inject` factory, and ui-renderer's
 * `bindSnapshotSelector` reads `source.getSnapshot()` dynamically rather than
 * capturing it once, so wrapping the shared presentation source *in place*
 * reaches every existing `usePresentation` selector without a remount.
 *
 * Everything here is side-effect free except the deliberate in-place writes to
 * the two live objects (the entry's `inject` and the source's `getSnapshot`),
 * which keeps the decisions testable against plain fakes.
 */
import type {
  PresentationPolicyLike, PresentationSourceLike, SlotEntryLike, SlotsLike,
} from './types.ts'

/** Slot that renders the conversation target's body. */
export const CHAT_VIEW_SLOT = 'conversation.view'

/** Registration id ui-chat uses for its Chat target inside that slot. */
export const CHAT_VIEW_ID = 'chat'

/** Work-details mode whose normally completed Turns should fold. */
export const VERBOSE_MODE = 'verbose'

/** Diagnostic sink; tests capture it instead of touching the console. */
export type FoldWarn = (message: string, detail?: unknown) => void

/** Mutable bookkeeping for one installed patch. */
export interface FoldPatchState {
  /** Sources already wrapped, so one source is wrapped at most once. */
  readonly patchedSources: WeakSet<object>
  /** Entries whose inject factory is already ours, so re-scans do not stack wrappers. */
  readonly wrappedEntries: WeakSet<object>
  /** Distinct sources wrapped (a WeakSet cannot report its size). */
  patchedCount: number
  /** Distinct chat-view entries wrapped. */
  wrappedCount: number
  /** Whether the missing-presentation warning already fired. */
  shapeWarned: boolean
}

/** Empty bookkeeping for one install. */
export function createFoldPatchState(): FoldPatchState {
  return {
    patchedSources: new WeakSet(),
    wrappedEntries: new WeakSet(),
    patchedCount: 0,
    wrappedCount: 0,
    shapeWarned: false,
  }
}

/**
 * Project one live policy: Verbose always folds completed Turns. Every other
 * value passes through by identity, so selectors over unrelated modes keep
 * their stable references and re-render only on real mode changes.
 * @param policy - the current policy read from the presentation source.
 * @returns the same policy, or a folded copy when Verbose still had it open.
 */
export function foldCompletedForVerbose(policy: PresentationPolicyLike): PresentationPolicyLike {
  if (policy.mode !== VERBOSE_MODE || policy.foldCompletedTurns === true) return policy
  return { ...policy, foldCompletedTurns: true }
}

/**
 * Read the presentation source out of one inject face, when the shape matches.
 * A face without a usable `hooks.presentation` is reported as absent rather
 * than guessed at, so a shape change degrades to a no-op plus one warning.
 * @param face - whatever the wrapped inject factory returned.
 * @returns the source, or undefined when the face does not carry one.
 */
export function presentationOf(face: unknown): PresentationSourceLike | undefined {
  if (face === null || typeof face !== 'object') return undefined
  const hooks = (face as { hooks?: unknown }).hooks
  if (hooks === null || typeof hooks !== 'object') return undefined
  const source = (hooks as { presentation?: unknown }).presentation
  if (source === null || typeof source !== 'object') return undefined
  const candidate = source as { getSnapshot?: unknown; subscribe?: unknown }
  if (typeof candidate.getSnapshot !== 'function' || typeof candidate.subscribe !== 'function') return undefined
  return source as PresentationSourceLike
}

/**
 * Locate ui-chat's Chat view registration in the live ledger.
 * @param slots - the slots registry.
 * @returns the entry, or undefined while it is absent or the ledger is unreadable.
 */
export function findChatViewEntry(slots: SlotsLike): SlotEntryLike | undefined {
  if (typeof slots.entries !== 'function') return undefined
  const entries = slots.entries(CHAT_VIEW_SLOT)
  if (entries === undefined || entries === null) return undefined
  return entries.find(entry => entry.options?.id === CHAT_VIEW_ID)
}

/**
 * Wrap one live source in place. Reads arriving through `getSnapshot` pick the
 * fold up immediately, including selectors bound before this call, because the
 * renderer re-reads `source.getSnapshot()` on every snapshot.
 * @param source - the presentation observable returned by ui-chat's inject factory.
 * @param state - bookkeeping that keeps the wrap single-shot.
 * @returns whether this call performed the wrap.
 */
export function wrapPresentationSource(source: PresentationSourceLike, state: FoldPatchState): boolean {
  if (state.patchedSources.has(source)) return false
  state.patchedSources.add(source)
  const original = source.getSnapshot.bind(source)
  source.getSnapshot = () => foldCompletedForVerbose(original())
  state.patchedCount += 1
  return true
}

/** Outcome of one patch attempt against the live ledger. */
export type PatchOutcome =
  /** The chat entry was found and its inject factory wrapped. */
  | 'patched'
  /** The chat entry was already wrapped by an earlier scan. */
  | 'already'
  /** No chat entry (or no inject factory) is on the ledger yet. */
  | 'pending'

/**
 * Wrap the Chat view's inject factory so every face it returns carries the
 * folded policy. Re-runnable: a later registration is a fresh entry object and
 * gets wrapped, while an already-wrapped entry is left alone.
 * @param slots - the slots registry.
 * @param state - bookkeeping shared across scans.
 * @param warn - optional diagnostic sink for a shape change.
 * @returns what this scan did.
 */
export function patchChatView(slots: SlotsLike, state: FoldPatchState, warn?: FoldWarn): PatchOutcome {
  const entry = findChatViewEntry(slots)
  if (entry === undefined || entry.inject === undefined) return 'pending'
  if (state.wrappedEntries.has(entry)) return 'already'
  state.wrappedEntries.add(entry)
  state.wrappedCount += 1
  const original = entry.inject
  entry.inject = (...args: unknown[]): unknown => {
    const face = original(...args)
    const source = presentationOf(face)
    if (source === undefined) {
      if (!state.shapeWarned) {
        state.shapeWarned = true
        warn?.(`${CHAT_VIEW_SLOT}#${CHAT_VIEW_ID} 的注入面没有 hooks.presentation;ui-chat 形状可能已变`)
      }
      return face
    }
    wrapPresentationSource(source, state)
    return face
  }
  return 'patched'
}
