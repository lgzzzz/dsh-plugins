/**
 * Lineage resolution for per-turn billing identity.
 *
 * A delegated child (subagent, fork, workflow worker) records its direct parent
 * in the durable session header (`header.parentSession`). Walking that chain to
 * the root lets the turn tracker key the whole tree on the conversation the user
 * actually prompted, so one user turn — including every child it spawned — bills
 * onto one Qoder usage record.
 *
 * @module dsh-qoder-connect/turn-lineage
 */

/** The slice of the host session store this resolver reads. */
export interface LineageSessionStore {
  get(id: string): { header?: { parentSession?: string } } | undefined
}

/** Hard stop for a corrupted or hostile lineage chain; real delegation is far shallower. */
const MAX_LINEAGE_DEPTH = 64

/**
 * Build a synchronous child→root resolver over the host session store.
 *
 * The store is read per call (never captured), because the sessions service may
 * mount after this plugin. A missing store, a missing session, a self-parent, or
 * a cycle stops the walk at the last resolvable id — never at an unrelated
 * conversation, and never with an exception on the request path.
 *
 * @param store - resolves the live session store, when the host has one.
 * @returns a resolver mapping a session id to its root ancestor, or undefined
 *   when the session has no parent (it already is its own run key).
 */
export function createRunSessionResolver(
  store: () => LineageSessionStore | undefined,
): (sessionId: string) => string | undefined {
  return sessionId => {
    const sessions = store()
    if (sessions === undefined) return undefined
    let current = sessionId
    const seen = new Set<string>([current])
    for (let depth = 0; depth < MAX_LINEAGE_DEPTH; depth++) {
      let parent: string | undefined
      try {
        parent = sessions.get(current)?.header?.parentSession
      } catch {
        // A store failure must not fail the request; bill on what resolved so far.
        break
      }
      if (parent === undefined || parent.length === 0 || seen.has(parent)) break
      seen.add(parent)
      current = parent
    }
    return current === sessionId ? undefined : current
  }
}