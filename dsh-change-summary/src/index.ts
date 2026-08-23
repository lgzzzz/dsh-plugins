/**
 * Node half of the local `dsh-change-summary` patch row.
 *
 * Two jobs, git-aware:
 *
 * 1. `/dsh-change-summary/diff` — serve a staged-vs-worktree diff. Clicking a
 *    listed file opens a Monaco diff (via the `dsh-text-editor` `showDiff`
 *    capability) whose `before` is the index blob and `after` the current
 *    worktree file. Git-ness is decided by the FILE's own directory, not the
 *    session workspace: whenever the file's directory lies inside a git work
 *    tree (workspace file or not), the click diffs index vs working tree as-is;
 *    otherwise (non-git directory) the route answers `git: false` and the
 *    browser half opens the file normally. The plugin never stages the worktree
 *    itself — the index holds whatever state it was left in (committed or
 *    manually staged), and the diff shows index vs working tree as-is. A
 *    tracked file deleted from the worktree therefore diffs as before = full
 *    index content, after = empty (everything deleted). Non-git directories
 *    have no diff: the route answers `git: false` and the browser half opens
 *    the file normally.
 *
 * 2. `/dsh-change-summary/exists` — report which produced paths still exist.
 *    The browser half lists every produced path regardless (git workspace or
 *    not) and uses this answer to mark the deleted ones with a deleted badge;
 *    git decides only what a click does (see job 1), never whether a deleted
 *    file is listed.
 *
 * The browser half (src/client) does the rendering and the click routing;
 * this half is purely the serve side.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type { ServerResponse } from 'node:http'
import {
  absolutePath,
  diffStagedVsWorktree,
  pathExists,
  relativeTo,
  workTreeRootOfFile,
} from './git.js'

export const name = 'dsh-change-summary'

/** Structural slice of the `SessionStore` this plugin reads (cwd lookup only). */
interface SessionStoreFace {
  get(id: string): { readonly header?: { readonly cwd?: string } } | undefined
}

/** The `webServer` service face this plugin consumes: exactly the `register`
 * surface of the Host webserver service (version-agnostic; the runtime injects
 * it via the patch row's `inject: [webServer]`). */
interface WebRouteHost {
  register(route: WebRoute): () => void
}

/** Write a JSON response (no caching). */
function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  res.end(JSON.stringify(body))
}

/**
 * Plugin body: serve the staged-vs-worktree diff (no auto-staging — the plugin
 * never runs `git add` on user messages; the index is whatever state it holds).
 * @param ctx - host root context (webServer + sessions injected via the patch row).
 */
export function apply(ctx: Context): void {
  ctx.effect(() => {
    const webServer = ctx.get('webServer') as WebRouteHost | undefined
    if (webServer === undefined || typeof webServer.register !== 'function') return () => undefined
    const stopDiff = webServer.register({
      kind: 'exact',
      path: '/dsh-change-summary/diff',
      handler: (req, res) => {
        void handleDiff(ctx, req, res)
      },
    })
    const stopExists = webServer.register({
      kind: 'exact',
      path: '/dsh-change-summary/exists',
      handler: (req, res) => {
        void handleExists(ctx, req, res)
      },
    })
    return () => {
      stopDiff()
      stopExists()
    }
  }, 'dsh-change-summary: diff + exists routes')
}

/** Serve the staged-vs-worktree diff for one session + path (or a no-diff answer). */
async function handleDiff(
  ctx: Context,
  req: { url?: string | undefined },
  res: ServerResponse,
): Promise<void> {
  try {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const sessionId = url.searchParams.get('session') ?? ''
    const path = url.searchParams.get('path') ?? ''
    if (sessionId === '' || path === '') {
      json(res, 400, { ok: false, git: false, error: 'missing session/path query parameters' })
      return
    }
    const store =
      (ctx.get('sessions') as SessionStoreFace | undefined) ??
      (ctx as { sessions?: SessionStoreFace }).sessions
    const cwd = store?.get(sessionId)?.header?.cwd
    if (cwd === undefined || cwd === '') {
      // No workspace to resolve the path against: browser falls back to a normal open.
      json(res, 200, { ok: false, git: false, reason: 'no-cwd' })
      return
    }
    const abs = absolutePath(cwd, path)
    // Git-ness is decided by the FILE's own directory (not the session cwd): a
    // file outside the workspace still diffs when its directory is a git work
    // tree, and a workspace file whose directory is not git never diffs.
    const root = await workTreeRootOfFile(abs)
    if (root === undefined) {
      // The file's directory is not a git work tree: open the file normally.
      json(res, 200, { ok: false, git: false, reason: 'not-git' })
      return
    }
    const rel = relativeTo(root, abs)
    if (rel === undefined) {
      json(res, 200, { ok: false, git: true, reason: 'outside-repo' })
      return
    }
    const diff = await diffStagedVsWorktree(root, rel)
    if (diff === undefined) {
      json(res, 200, { ok: false, git: true, reason: 'no-diff' })
      return
    }
    json(res, 200, { ok: true, git: true, path, before: diff.before, after: diff.after })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    json(res, 500, { ok: false, git: false, error: message })
  }
}

/**
 * Serve which of the requested produced paths still exist on disk, so the
 * browser half can mark the deleted ones with a deleted badge in the
 * workspace-changes list (every produced path is listed, existing or deleted,
 * git workspace or not; the git branch lives in the click, not the list).
 * Failures default to "exists" (show) — a transient error must never hide a
 * real file.
 */
async function handleExists(
  ctx: Context,
  req: { url?: string | undefined },
  res: ServerResponse,
): Promise<void> {
  try {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const sessionId = url.searchParams.get('session') ?? ''
    const paths = url.searchParams.getAll('path')
    const store =
      (ctx.get('sessions') as SessionStoreFace | undefined) ??
      (ctx as { sessions?: SessionStoreFace }).sessions
    const cwd = sessionId === '' ? undefined : store?.get(sessionId)?.header?.cwd
    const result: Record<string, boolean> = {}
    for (const p of paths) {
      result[p] = cwd !== undefined && cwd !== '' ? await pathExists(cwd, p) : true
    }
    json(res, 200, { ok: true, paths: result })
  } catch {
    // Unknown existence must not hide files: answer an empty map (client treats
    // any path absent from the map as existing).
    json(res, 200, { ok: true, paths: {} })
  }
}
