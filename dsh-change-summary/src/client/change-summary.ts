/**
 * Turn-scoped change-summary Definition and readers. Client-only and
 * model-free: the vocabulary is the mutation tools' own follow-along
 * `locations`, never the closing prose. Mirrors ui-deliverables, except that
 * the matched paths are split into current-workspace and outside-workspace
 * groups at render time (see `ChangeSummary.tsx`).
 */
import {
  isAppendSurfaceEvent,
  resolveWorkspacePath,
  type ConversationMatchResult,
  type ConversationNodeContext,
  type ConversationNodeDefinition,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { TurnTailOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ToolCallView } from '@deepseek-ai/dsh-tools/presentation'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'

/** One produced-file fact: the path plus the tool/result seq that settled it. */
interface ProducedPath {
  readonly seq: number
  readonly path: string
}

/** Immutable change facts published against one Turn. */
export interface ChangeSummaryTurnData {
  readonly produced: readonly ProducedPath[]
}

declare module '@deepseek-ai/dsh-client-runtime/client' {
  interface ConversationTurnDataMap {
    'change-summary': ChangeSummaryTurnData
  }
}

interface ChangeSummaryState extends ChangeSummaryTurnData {
  readonly turn: number
  /** callId → the call's follow-along view (null when the call has none). */
  readonly calls: ReadonlyMap<string, ToolCallView | null>
}

/**
 * Paths a call view reports having created or changed, by render intent rather
 * than tool name: a diff card, or a generic card whose `kind` is `edit` (the
 * shape `str_replace_editor`'s insert presents). Every other card produces
 * nothing to open — a read looked, a delete removed, a terminal ran.
 */
export function producedPaths(view: ToolCallView | null): string[] {
  if (view === null) return []
  if (view.card === 'diff') return (view.locations ?? []).map((location) => location.path)
  if (view.card === 'generic' && view.kind === 'edit') return (view.locations ?? []).map((location) => location.path)
  return []
}

/**
 * Files produced by one Turn data value.
 *
 * The source is the mutation tools' own follow-along `locations`, not the
 * closing prose. Paths keep first-seen order and appear once, so a file written
 * and then edited in the same turn is one entry.
 * @param data - engine-published change-summary data for one Turn.
 * @param seq - closing Assistant seq; later Tool settlements are excluded.
 * @returns Produced paths in first-seen order; empty when the turn wrote nothing.
 */
export function producedForClosing(data: Readonly<ChangeSummaryTurnData> | undefined, seq: number): string[] {
  if (data === undefined) return []
  const paths: string[] = []
  const seen = new Set<string>()
  for (const produced of data.produced) {
    if (produced.seq > seq || seen.has(produced.path)) continue
    seen.add(produced.path)
    paths.push(produced.path)
  }
  return paths
}

/**
 * Claim the turn-tail chain only when its closing turn produced files.
 * @param owner - Turn-tail owner currency for the closing assistant.
 * @returns Produced paths as the component's match, or null to decline before mount.
 */
export function selectChangeFiles(owner: TurnTailOwnerProps): readonly string[] | null {
  const paths = producedForClosing(owner.turn.data.get('change-summary'), owner.seq)
  return paths.length === 0 ? null : paths
}

/** Turn-local successful mutation accumulator; it publishes no view Node. */
export const changeSummaryDefinition: ConversationNodeDefinition<ChangeSummaryState> = {
  kind: 'change-summary',
  match: (event) => {
    if (event.type === 'turn/start') return { id: String(event.data.turn), role: 'start' }
    if (event.type === 'tool/call') return { id: String(event.data.turn), role: 'update' }
    if (event.type === 'tool/result' && isAppendSurfaceEvent(event)) return { id: String(event.data.turn), role: 'update' }
    return null
  },
  start: (_context, match) => {
    if (match.event.type !== 'turn/start') throw new Error('change-summary start requires turn/start')
    return {
      turn: match.event.data.turn,
      calls: new Map<string, ToolCallView | null>(),
      produced: [],
    }
  },
  update: (context, match) => {
    if (match.event.type === 'tool/call') {
      const calls = new Map(context.state.calls)
      calls.set(
        String(match.event.data.callId),
        match.view !== undefined && match.view.for === 'call' ? match.view.view : null,
      )
      return { ...context.state, calls }
    }
    if (match.event.type !== 'tool/result') return context.state
    if (match.event.data.message.content[0]?.isError === true) return context.state
    const callId = String(match.event.data.message.source.callId)
    const additions = producedPaths(context.state.calls.get(callId) ?? null).map((path) => ({
      seq: match.event.seq,
      path,
    }))
    return additions.length === 0
      ? context.state
      : { ...context.state, produced: [...context.state.produced, ...additions] }
  },
  buildLocationData: (context, scope) =>
    scope !== 'turn' || context.state === undefined
      ? null
      : {
          kind: 'turn',
          turn: context.state.turn,
          key: 'change-summary',
          value: { produced: context.state.produced },
        },
}

/* ── helpers ───────────────────────────────────────────────────────────────── */

/** Trailing path segment, the part that identifies the file at a glance. */
export function basename(path: string): string {
  const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return at === -1 ? path : path.slice(at + 1)
}

/** The single produced path whose basename is exactly `value`, else undefined. */
function onlyPathWithBasename(paths: readonly string[], value: string): string | undefined {
  const matches = paths.filter((path) => basename(path) === value)
  return matches.length === 1 ? matches[0] : undefined
}

/**
 * Normalize a slash/backslash path: lowercase a Windows drive root, collapse
 * `.`/`..` segments, and force forward slashes. Pure path-join logic for the
 * workspace membership test.
 */
export function normPath(path: string): string {
  const isWinAbs = /^[A-Za-z]:/.test(path)
  const isUnc = /^[/\\]{2}/.test(path)
  const root = isWinAbs
    ? path.slice(0, 2).toLowerCase() + '/'
    : isUnc
      ? '//'
      : path.charAt(0) === '/' || path.charAt(0) === '\\'
        ? '/'
        : ''
  const parts = path.split(/[\\/]+/).filter(Boolean)
  const out: string[] = []
  for (const part of parts) {
    if (part === '.') continue
    if (part === '..') {
      if (out.length > 0 && out[out.length - 1] !== '..') out.pop()
      else out.push(part)
    } else {
      out.push(part)
    }
  }
  return root + out.join('/')
}

/** Whether `path` resolves inside the session `cwd` (the workspace root). */
export function inWorkspace(cwd: string | undefined, path: string): boolean {
  if (!cwd) return true
  const resolved = resolveWorkspacePath(cwd, path)
  const c = normPath(cwd)
  const r = normPath(resolved)
  if (r === c) return true
  return r.startsWith(c.endsWith('/') ? c : c + '/')
}

/** Split paths into current-workspace and outside-workspace groups. */
export function splitByWorkspace(
  cwd: string | undefined,
  paths: readonly string[],
): { inside: string[]; outside: string[] } {
  const inside: string[] = []
  const outside: string[] = []
  for (const path of paths) (inWorkspace(cwd, path) ? inside : outside).push(path)
  return { inside, outside }
}

/** One resolved file mention: an inline-code token that opens the file it names. */
export interface ProducedFileMention {
  open(): void
  label: string
  title: string
}

/**
 * File-mention vocabulary over one turn's produced paths, for the closing
 * message's prose: an inline-code token opens the file it names. A token
 * resolves by exact path, or by being exactly the basename of exactly one
 * produced path — a basename two paths share stays inert rather than guessing.
 * @param paths - The turn's produced paths (tool order, already deduped).
 * @param openFile - The chat view's file opener.
 * @param label - Localizes the accessible open-label for a resolved path.
 * @returns The resolver the closing prose consumes; the full path rides `title`.
 */
export function producedFileMentions(
  paths: readonly string[],
  openFile: (path: string) => void,
  label: (path: string) => string,
): { resolve: (value: string) => ProducedFileMention | undefined } {
  return {
    resolve: (value) => {
      const path = paths.includes(value) ? value : onlyPathWithBasename(paths, value)
      if (path === undefined) return undefined
      return {
        open: () => {
          openFile(path)
        },
        label: label(path),
        title: path,
      }
    },
  }
}

/** Best-effort session identity: the current session id and workspace cwd. */
export interface SessionInfo {
  sessionId: string | undefined
  cwd: string | undefined
}

/** Structural slice of the sessions list snapshot this plugin reads. */
interface SessionListSnapshotLike {
  readonly current: string | undefined
  readonly byId?: Readonly<Record<string, { cwd?: string } | undefined>>
}

/** Structural slice of the `sessions` service this plugin reads. */
interface SessionListLike {
  list: {
    getSnapshot(): SessionListSnapshotLike
  }
}

/** 读取当前活动会话的 sessionId + cwd（尽力而为，失败返回空对象）。 */
export function currentSessionInfo(sessions: unknown): SessionInfo {
  try {
    const list = (sessions as SessionListLike | null | undefined)?.list
    const snapshot = list?.getSnapshot()
    const id = snapshot?.current
    const record = id !== undefined && snapshot?.byId !== undefined ? snapshot.byId[id] : undefined
    return { sessionId: id, cwd: record !== undefined ? record.cwd : undefined }
  } catch {
    return { sessionId: undefined, cwd: undefined }
  }
}
