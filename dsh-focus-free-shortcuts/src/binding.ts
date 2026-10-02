/**
 * Binding layer: the gesture/binding model both shortcut catalogs match against.
 *
 * Pure and DOM-free, and typed with the registry's own published declarations
 * (`@deepseek-ai/dsh-client-shortcuts`): `ShortcutGesture` for one physical press,
 * `NormalizedBinding` for a catalog binding, `ShortcutCatalogEntry` for an
 * editable row, and `ShortcutFixedCatalogEntry` for a mounted read-only row.
 * Nothing here restates an upstream shape.
 *
 * Every bridge asks the same question — "is this press the keys of that command?" —
 * and each group file asks it about a different catalog:
 *
 *   - `pane-keys.ts` reads the *effective* configurable row (`shortcuts.catalog`),
 *     so a rebound, disabled, or conflicted command no longer owns its keys;
 *   - `approval-keys.ts` reads the *mounted fixed* row (`shortcuts.fixedCatalog`),
 *     where a row's presence is its reservation.
 *
 * Keeping the match rules here means no bridge compares keys itself.
 */
import type {
  ShortcutCatalogEntry,
  ShortcutFixedCatalogEntry,
  ShortcutGesture,
} from '@deepseek-ai/dsh-client-shortcuts/client'
import type {NormalizedBinding} from '@deepseek-ai/dsh-client-shortcuts/protocol'

/** One normalized modifier name, exactly as the registry publishes it. */
export type ModifierName = NormalizedBinding['modifiers'][number]

/** Normalized modifier order is also the keycap order (`normalizeBinding`). */
export const MODIFIER_ORDER = ['control', 'alt', 'shift', 'meta'] as const satisfies readonly ModifierName[]

/** Ordered modifiers actually held for one gesture. */
export function modifiersOf(gesture: ShortcutGesture): ModifierName[] {
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
export function bindingMatches(binding: NormalizedBinding, gesture: ShortcutGesture): boolean {
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
export function enabledBinding(
  rows: readonly ShortcutCatalogEntry[],
  id: string,
): NormalizedBinding | undefined {
  const row = rows.find((candidate) => candidate.id === id)
  if (row === undefined) return undefined
  if (row.binding === null || row.issue !== null || row.conflicts.length > 0) return undefined
  return row.binding
}

/**
 * Whether one mounted fixed row still reserves exactly this press.
 *
 * A fixed row carries no overrides and no enabled flag of its own: its presence
 * *is* its reservation, and it disappears with its owning plugin. Following the
 * row instead of hardcoding the keys keeps a bridge out of a combination the
 * assembled Client no longer declares.
 * @param rows - the mounted fixed catalog snapshot.
 * @param id - registered fixed command id.
 * @param gesture - the physical press being routed.
 * @returns whether a mounted row reserves this press.
 */
export function fixedRowOwns(
  rows: readonly ShortcutFixedCatalogEntry[],
  id: string,
  gesture: ShortcutGesture,
): boolean {
  const row = rows.find((candidate) => candidate.id === id)
  if (row === undefined) return false
  return row.bindings.some((binding) => bindingMatches(binding, gesture))
}
