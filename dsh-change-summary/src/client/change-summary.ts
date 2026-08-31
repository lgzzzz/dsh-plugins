/**
 * Turn-scoped change-summary Definition and readers. Client-only and
 * model-free: the vocabulary is the mutation tools' successful calls
 * (write / edit / str_replace_editor), never the closing prose. Mirrors
 * ui-deliverables, except that the matched paths are split into
 * current-workspace and outside-workspace groups at render time (see
 * `ChangeSummary.tsx`).
 */
import type { ConversationNodeDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { TurnTailOwnerProps } from '@deepseek-ai/dsh-client-ui-chat/client'

/** One produced-file fact: the path plus the tool/result seq that settled it. */
interface ProducedPath {
  readonly seq: number
  readonly path: string
}

/** Immutable change facts published against one Turn. */
export interface ChangeSummaryTurnData {
  readonly produced: readonly ProducedPath[]
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ConversationTurnDataMap {
    'change-summary': ChangeSummaryTurnData
  }
}

interface ChangeSummaryState extends ChangeSummaryTurnData {
  readonly turn: number
  /** callId → the mutation path parsed from that call's arguments (null when the call is not a mutation). */
  readonly calls: ReadonlyMap<string, string | null>
}

/* ── runtime surface guard ───────────────────────────────────────────────────
 * Inlined from `dsh-session`'s `surface.ts`: client bundles must not value-import
 * across plugin boundaries, and the old `dsh-client-runtime` module is gone. */
const SURFACE_EVENT_TYPES = new Set<string>(['user/message', 'assistant/message', 'tool/result'])

function isSurfaceEvent(event: { type: string; surfaceOp?: unknown }): boolean {
  if (!SURFACE_EVENT_TYPES.has(event.type)) return false
  return event.surfaceOp !== undefined
}

function isAppendSurfaceEvent(event: { type: string; surfaceOp?: unknown }): boolean {
  return isSurfaceEvent(event) && event.surfaceOp === 'append'
}

/* ── success-mutation argument parsing (mirrors ui-deliverables) ─────────────── */

function pathValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validEditArgs(args: Record<string, unknown>): boolean {
  return (
    typeof args.old_string === 'string' &&
    args.old_string.length > 0 &&
    typeof args.new_string === 'string' &&
    args.old_string !== args.new_string &&
    (args.replace_all === undefined || typeof args.replace_all === 'boolean')
  )
}

function editorMutationPath(args: Record<string, unknown>): string | null {
  const path = pathValue(args.path)
  if (path === null) return null
  switch (args.command) {
    case 'create':
      return typeof args.file_text === 'string' ? path : null
    case 'str_replace':
      return typeof args.old_str === 'string' &&
        args.old_str.length > 0 &&
        (args.new_str === undefined || typeof args.new_str === 'string')
        ? path
        : null
    case 'insert':
      return typeof args.insert_line === 'number' &&
        Number.isInteger(args.insert_line) &&
        args.insert_line >= 0 &&
        typeof args.new_str === 'string'
        ? path
        : null
    default:
      return null
  }
}

/** Extract the mutated path from a supported first-party mutation call. */
function mutationPath(name: string, argsRaw: string): string | null {
  let args: unknown
  try {
    args = JSON.parse(argsRaw)
  } catch {
    return null
  }
  if (!isRecord(args)) return null
  switch (name) {
    case 'write':
      return typeof args.content === 'string' ? pathValue(args.file_path) : null
    case 'edit':
      return validEditArgs(args) ? pathValue(args.file_path) : null
    case 'str_replace_editor':
      return editorMutationPath(args)
    default:
      return null
  }
}

/* ── workspace-path resolution ────────────────────────────────────────────────
 * Inlined from `dsh-util-workspace-path` (browser-safe, pure). */
function resolveWorkspacePath(cwd: string | undefined, path: string): string {
  if (path.startsWith('/') || /^[A-Za-z]:[/\\]/.test(path) || path.startsWith('\\\\')) return path
  if (cwd === undefined || cwd === '') return path
  return `${cwd.replace(/[/\\]+$/, '')}/${path.replace(/^[/\\]+/, '')}`
}

/**
 * Files produced by one Turn data value.
 *
 * The source is the arguments of successful `write`, `edit`, and mutating
 * `str_replace_editor` calls, not the closing prose. Paths keep first-seen
 * order and appear once, so a file written and then edited in the same turn is
 * one entry.
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
      calls: new Map<string, string | null>(),
      produced: [],
    }
  },
  update: (context, match) => {
    if (match.event.type === 'tool/call') {
      const calls = new Map(context.state.calls)
      calls.set(String(match.event.data.callId), mutationPath(match.event.data.name, match.event.data.arguments))
      return { ...context.state, calls }
    }
    if (match.event.type !== 'tool/result') return context.state
    if (match.event.data.message.content[0]?.isError === true) return context.state
    const callId = String(match.event.data.message.source.callId)
    const path = context.state.calls.get(callId)
    return path === null || path === undefined
      ? context.state
      : { ...context.state, produced: [...context.state.produced, { seq: match.event.seq, path }] }
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