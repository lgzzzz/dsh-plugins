/**
 * Node half of the local `dsh-change-summary` patch row.
 *
 * Two jobs, both git-aware:
 * 1. Stage the worktree (`git add .`) the moment a direct human prompt is
 *    admitted for a session — keyed off the `session/event` firehose's
 *    `user/message` events whose `source.kind === 'user'` — so the baseline for
 *    "what did this round change" is the index right before the agent ran.
 * 2. Serve a staged-vs-worktree diff over one loopback route: clicking a
 *    workspace-changed file opens a Monaco diff (via the `dsh-text-editor`
 *    `showDiff` capability) whose `before` is the index blob and `after` the
 *    current worktree file — exactly the agent round's changes.
 *
 * Non-git workspaces have no diff: the route answers `git: false` and the
 * browser half opens the file normally instead.
 *
 * The browser half (src/client) does the rendering and the click routing;
 * this half is purely the stage + serve side.
 */
import type { Context } from '@deepseek-ai/cordis'
// Declaration-merge triggers: importing a type from `@deepseek-ai/dsh-session`
// loads its `Context.sessions` / `Events['session/event']` augmentations so
// the members below are visible in the host program. Host-only — the client
// program never compiles this file.
import type { Session } from '@deepseek-ai/dsh-session'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type { ServerResponse } from 'node:http'
import {
  absolutePath,
  diffStagedVsWorktree,
  isInsideWorkTree,
  pathExists,
  relativeTo,
  stageAll,
  workTreeRoot,
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
 * Plugin body: stage on user messages, serve the staged-vs-worktree diff.
 * @param ctx - host root context (webServer + sessions injected via the patch row).
 */
export function apply(ctx: Context): void {
  ctx.on('session/event', (session: Session, event) => {
    if (event.type !== 'user/message') return
    if (event.data.source?.kind !== 'user') return
    const cwd = session.header.cwd
    if (cwd === undefined || cwd === '') return
    void stageAll(cwd).catch((error) => {
      // Soft failure: the round baseline is just missing; clicks fall back to
      // whatever the index held. Log for diagnostics.
      const message = error instanceof Error ? error.message : String(error)
      console.warn('[dsh-change-summary] git add . failed for', cwd, message)
    })
  })

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
      // No workspace to diff against: browser falls back to a normal open.
      json(res, 200, { ok: false, git: false, reason: 'no-cwd' })
      return
    }
    if (!(await isInsideWorkTree(cwd))) {
      // Non-git workspace: per the spec, open the file normally (no diff).
      json(res, 200, { ok: false, git: false, reason: 'not-git' })
      return
    }
    const root = await workTreeRoot(cwd)
    if (root === undefined) {
      json(res, 200, { ok: false, git: false, reason: 'no-root' })
      return
    }
    const rel = relativeTo(root, absolutePath(cwd, path))
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
 * browser half can hide files that were created and then deleted during a turn
 * from the workspace-changes list. Failures default to "exists" (show) — a
 * transient error must never hide a real file.
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
