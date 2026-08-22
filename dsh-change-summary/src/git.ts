/**
 * Git helpers for `dsh-change-summary` (host half).
 *
 * All git commands run through `node:child_process` `execFile` (no shell), each
 * scoped to a working directory with `-C`, and their output is captured as
 * UTF-8 text. Every helper fails soft — it returns `false` / `undefined` /
 * `null` instead of throwing — so the diff route can fall back to a normal
 * open without breaking the click.
 *
 * Two commands are the whole surface:
 * - `git add .` stages the current worktree the moment a direct human prompt is
 *   admitted, establishing the round baseline;
 * - clicking a changed file later reads the staged blob (`git show :<rel>`) as
 *   the `before` and the current worktree file as the `after` — i.e. the diff
 *   between the index and the working tree.
 */
import { execFile } from 'node:child_process'
import { access, readFile } from 'node:fs/promises'
import { posix } from 'node:path'

/** Combined before+after size cap per diff; larger files fall back to a normal open. */
export const MAX_DIFF_CHARS = 4_000_000

/** One staged-vs-worktree snapshot; both sides are LF-normalized text. */
export interface GitDiff {
  readonly before: string
  readonly after: string
}

/** Run `git -C cwd <args>` and resolve its stdout, or undefined on any failure. */
function gitText(cwd: string, args: readonly string[]): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['-C', cwd, ...args],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true },
      (error, stdout) => {
        if (error !== null) resolve(undefined)
        else resolve(stdout)
      },
    )
  })
}

/** Whether `cwd` lies inside a git work tree. Never throws; false on any failure. */
export async function isInsideWorkTree(cwd: string): Promise<boolean> {
  const out = await gitText(cwd, ['rev-parse', '--is-inside-work-tree'])
  return out !== undefined && out.trim() === 'true'
}

/** Stage every change under `cwd` (`git add .`). Never throws. */
export async function stageAll(cwd: string): Promise<void> {
  await gitText(cwd, ['add', '.'])
}

/** The git work-tree root containing `cwd` (forward-slash absolute), or undefined. */
export async function workTreeRoot(cwd: string): Promise<string | undefined> {
  const out = await gitText(cwd, ['rev-parse', '--show-toplevel'])
  if (out === undefined) return undefined
  const root = out.trim()
  return root === '' ? undefined : root
}

/** Content of repo-relative `rel` from the index (the staged blob), or undefined. */
export async function readIndex(root: string, rel: string): Promise<string | undefined> {
  return gitText(root, ['show', ':' + rel])
}

/** Normalize CRLF/CR to LF so line-ending conversions don't pollute the diff. */
export function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

/**
 * Resolve a model-facing `path` (as a tool reported it) against the session
 * `cwd`, returning a normalized forward-slash absolute path.
 */
export function absolutePath(cwd: string, p: string): string {
  const forward = p.replace(/\\/g, '/')
  const abs =
    /^([A-Za-z]:)?\//.test(forward) || /^\/\//.test(forward)
      ? forward
      : cwd.replace(/\\/g, '/') + '/' + forward
  return posix.normalize(abs)
}

/** Repo-relative forward-slash path of `abs` inside `root`, or undefined outside. */
export function relativeTo(root: string, abs: string): string | undefined {
  const r = posix.normalize(root.replace(/\\/g, '/')).replace(/\/+$/, '')
  const rel = posix.relative(r, abs)
  if (rel === '' || rel === '.' || rel.startsWith('..')) return undefined
  return rel
}

/**
 * Whether the model-facing `path` currently exists on disk (resolved against
 * `cwd`). Used to hide files that were created and then deleted during a turn
 * from the workspace-changes list. Never throws; false on any failure.
 */
export async function pathExists(cwd: string, p: string): Promise<boolean> {
  try {
    await access(absolutePath(cwd, p))
    return true
  } catch {
    return false
  }
}

/**
 * Staged-vs-worktree diff for one repo-relative `rel` path. `before` is the
 * index content ('' when the file is untracked), `after` the current worktree
 * content ('' when deleted). Returns undefined when there is nothing
 * meaningful to diff — untracked and missing, unchanged, binary, oversized, or
 * an I/O failure.
 */
export async function diffStagedVsWorktree(root: string, rel: string): Promise<GitDiff | undefined> {
  const before = await readIndex(root, rel)
  let after: string | null = null
  try {
    after = await readFile(posix.join(root, rel), 'utf8')
  } catch {
    after = null
  }
  if (before === undefined && after === null) return undefined
  const b = before === undefined ? '' : normalizeLineEndings(before)
  const a = after === null ? '' : normalizeLineEndings(after)
  if (b.length + a.length > MAX_DIFF_CHARS) return undefined
  if (b.includes('\u0000') || a.includes('\u0000')) return undefined
  if (b === a) return undefined
  return { before: b, after: a }
}
