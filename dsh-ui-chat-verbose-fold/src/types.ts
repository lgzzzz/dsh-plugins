/**
 * Structural view of the two client services this plugin touches.
 *
 * Deliberately not imported from `@deepseek-ai/dsh-client-ui-slots` /
 * `@deepseek-ai/dsh-client-ui-renderer`: the patch reaches into a live
 * registration's `inject` field and mutates the observable it returns, both of
 * which the published types describe with `never[]`-style erasure. Naming only
 * the fields actually read keeps the plugin building against upstream type
 * churn and makes the runtime contract explicit — and the pure logic testable
 * with plain fakes.
 */

/** Cordis client context slice used here. */
export interface ClientContext {
  get?(name: string): unknown
}

/**
 * One live presentation policy. `foldCompletedTurns` is the only field this
 * plugin reads or writes; the rest of the policy travels untouched through the
 * spread in `foldCompletedForVerbose`.
 */
export interface PresentationPolicyLike {
  mode?: string
  foldCompletedTurns?: boolean
  [field: string]: unknown
}

/** Bare observable source: the shape `bindSnapshotSelector` consumes. */
export interface PresentationSourceLike {
  getSnapshot(): PresentationPolicyLike
  subscribe(listener: () => void): () => void
}

/** One stored slot registration, as the ledger exposes it to registrants. */
export interface SlotEntryLike {
  options?: { id?: string } | undefined
  inject?: ((...args: unknown[]) => unknown) | undefined
}

/** The `slots` registry surface this plugin reads and watches. */
export interface SlotsLike {
  /** Snapshot the registered entries for a key (stable between mutations). */
  entries?(key: string): readonly SlotEntryLike[] | undefined | null
  /** Run `callback` once the slot key is declared; returns a disposer. */
  inject?(key: string, callback: () => (() => void) | void): unknown
  /** Subscribe to a key's registration changes; returns an unsubscribe. */
  subscribe?(key: string, listener: () => void): (() => void) | undefined
}
