/**
 * Render half of `dsh-change-summary`: one labeled change row per group (the
 * stock ui-deliverables visual language), the two-group summary under the
 * closing message, the diff-then-open click routing, and the file-link
 * interception that opens Monaco「文件」tabs.
 */
import { useEffect, useState } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { basename, currentSessionInfo, splitByWorkspace } from './change-summary.js'

/* ── styles (same visual language as the stock ui-deliverables row) ────────── */
const CSS = [
  '.dscRoot{flex-direction:column;align-items:flex-start;gap:6px;font-size:13px;line-height:22px;display:flex;position:relative;min-width:0}',
  '.dscBlock{flex-direction:column;gap:16px;margin-top:16px;display:flex}',
  '.dscLabel{color:var(--dsw-alias-label-tertiary)}',
  '.dscList{list-style:none;flex-direction:column;gap:2px;margin:0;padding:0;display:flex;min-width:0;width:100%}',
  '.dscFile{text-overflow:ellipsis;white-space:nowrap;background:var(--dsw-alias-interactive-bg-hover);width:100%;color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer;border:none;border-radius:6px;margin:0;padding:2px 8px;overflow:hidden;text-align:left}',
  '.dscFile:hover{color:var(--dsw-alias-label-primary);text-decoration:underline}',
  '.dscFile:focus-visible{box-shadow:inset 0 0 0 2px var(--dsw-alias-border-l3);outline:none}',
].join('')

const tagId = 'dsh-change-summary/change-summary.css'
if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css="' + tagId + '"]') === null) {
  const tag = document.createElement('style')
  tag.dataset.plugin = 'dsh-change-summary'
  tag.dataset.pluginCss = tagId
  tag.textContent = CSS
  document.head.appendChild(tag)
}

const C = {
  root: 'dscRoot',
  block: 'dscBlock',
  label: 'dscLabel',
  list: 'dscList',
  file: 'dscFile',
} as const

/* ── diff-then-open: try the host diff route, fall back to the Monaco file tab ── */

/** The JSON body served by the host `/dsh-change-summary/diff` route. */
export interface DiffResponse {
  readonly ok: boolean
  readonly git: boolean
  readonly path?: string | undefined
  readonly before?: string | undefined
  readonly after?: string | undefined
  readonly reason?: string | undefined
  readonly error?: string | undefined
}

/** The `dsh-text-editor` capability surface this plugin consumes. */
interface TextEditorCapability {
  showDiff?(options: { files: readonly { path: string; before: string; after: string }[]; sessionId?: string | undefined }): void
  openFile?(options: { path: string; cwd?: string | undefined; sessionId?: string | undefined }): void
}

/** The open strategy passed into the change rows. */
export interface ChangeSummaryOpenDiff {
  (sessionId: string | undefined, path: string, openFile: (path: string) => void): Promise<void>
}

/**
 * Diff-then-open: in a git workspace the host answers with the staged-vs-worktree
 * diff (Monaco diff); in a non-git workspace — or when the diff is unavailable —
 * fall back to opening the file normally (the Monaco「文件」tab, 替代原来
 * host.openPath 的裸打开).
 */
export function openDiff(
  ctx: ClientContext,
  sessionId: string | undefined,
  path: string,
  openFile: (path: string) => void,
): Promise<void> {
  const url = '/dsh-change-summary/diff?session=' + encodeURIComponent(sessionId ?? '') + '&path=' + encodeURIComponent(path)
  return fetch(url, { cache: 'no-store' })
    .then((res) => res.json() as Promise<DiffResponse>)
    .then((body) => {
      if (body.ok !== true || body.git !== true || typeof body.before !== 'string' || typeof body.after !== 'string') {
        throw new Error('no diff')
      }
      const te = ctx.get('dsh-text-editor') as TextEditorCapability | undefined
      if (!te || typeof te.showDiff !== 'function') throw new Error('no editor')
      te.showDiff({ files: [{ path: body.path ?? path, before: body.before, after: body.after }], sessionId })
    })
    .catch(() => {
      // 非 git 仓库（或无 diff）时回退到 Monaco「文件」标签页(替代原来 host.openPath 的裸打开)。
      const te = ctx.get('dsh-text-editor') as TextEditorCapability | undefined
      if (te && typeof te.openFile === 'function') {
        const s = currentSessionInfo(ctx.get('sessions'))
        te.openFile({ path, cwd: s.cwd, sessionId: sessionId ?? s.sessionId })
      } else {
        openFile(path)
      }
    })
}

/* ── existence filtering: hide files created-then-deleted this turn ─────────── */

/** The JSON body served by the host `/dsh-change-summary/exists` route. */
export interface ExistsResponse {
  readonly ok: boolean
  readonly paths?: Readonly<Record<string, boolean>>
}

/**
 * Resolve which of `paths` still exist on disk (host-side). A path is reported
 * existing (true) whenever the host cannot answer — a transient failure must
 * never hide a real file.
 */
export function fetchExists(
  ctx: ClientContext,
  sessionId: string | undefined,
  paths: readonly string[],
): Promise<ReadonlyMap<string, boolean>> {
  const map = new Map<string, boolean>()
  for (const p of paths) map.set(p, true)
  if (paths.length === 0) return Promise.resolve(map)
  const query =
    'session=' +
    encodeURIComponent(sessionId ?? '') +
    paths.map((p) => '&path=' + encodeURIComponent(p)).join('')
  return fetch('/dsh-change-summary/exists?' + query, { cache: 'no-store' })
    .then((res) => (res.ok ? res.json() : null) as Promise<ExistsResponse | null>)
    .then((body) => {
      for (const p of paths) if (body?.paths?.[p] === false) map.set(p, false)
      return map
    })
    .catch(() => map)
}

/* ── one labeled change row listing every file ─────────────────────────────── */

interface ChangeRowProps {
  label: string
  paths: readonly string[]
  t: (key: string, params?: Record<string, string>) => string
  sessionId: string | undefined
  openFile: (path: string) => void
  openDiff: ChangeSummaryOpenDiff
}

function ChangeRow(props: ChangeRowProps): JSX.Element {
  const { label, paths, openFile, t, openDiff, sessionId } = props
  const activate = (path: string): void => {
    void openDiff(sessionId, path, openFile)
  }
  return (
    <div className={C.root}>
      <span className={C.label}>{label}</span>
      <ul className={C.list} data-produced-files-row>
        {paths.map((path) => (
          <li key={path}>
            <button
              type="button"
              className={C.file}
              title={path}
              aria-label={t('change.open', { name: path })}
              onClick={() => activate(path)}
            >
              {basename(path)}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ── the two-group summary under the closing message ───────────────────────── */

/** Structural slice of the sessions list snapshot the summary reads. */
interface SessionsStateLike {
  byId?: Readonly<Record<string, { cwd?: string } | undefined>>
}

/** Resolve which produced paths still exist on disk (host-backed). */
interface ChangeSummaryExists {
  (sessionId: string | undefined, paths: readonly string[]): Promise<ReadonlyMap<string, boolean>>
}

interface ChangeSummaryProps {
  matched: readonly string[]
  openFile: (path: string) => void
  useSessions: <T>(selector: (state: SessionsStateLike) => T) => T
  sessionId: string | undefined
  t: (key: string, params?: Record<string, string>) => string
  openDiff: ChangeSummaryOpenDiff
  exists: ChangeSummaryExists
}

export function ChangeSummary(props: ChangeSummaryProps): JSX.Element | null {
  const { matched, openFile, useSessions, sessionId, t, openDiff, exists } = props
  const cwd = useSessions((s) => {
    const record = s.byId?.[sessionId ?? '']
    return record !== undefined ? record.cwd : undefined
  })
  // Files created and then deleted during the turn are dropped from the list
  // once the host confirms they no longer exist. While the answer is pending
  // (null) everything is shown — the fetch is loopback-fast, and a host failure
  // must never hide a real file.
  const matchedKey = matched.join('\u0000')
  const [existing, setExisting] = useState<ReadonlySet<string> | null>(null)
  useEffect(() => {
    if (matched.length === 0) {
      setExisting(new Set())
      return
    }
    let alive = true
    void exists(sessionId, matched).then((map) => {
      if (!alive) return
      setExisting(new Set(matched.filter((p) => map.get(p) !== false)))
    })
    return () => {
      alive = false
    }
  }, [sessionId, exists, matchedKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const visible = (paths: readonly string[]): string[] =>
    existing === null ? [...paths] : paths.filter((p) => existing.has(p))
  const split = splitByWorkspace(cwd, matched)
  const children: JSX.Element[] = []
  const inside = visible(split.inside)
  if (inside.length > 0) {
    children.push(
      <ChangeRow
        key="inside"
        label={t('change.workspace')}
        paths={inside}
        openFile={openFile}
        t={t}
        openDiff={openDiff}
        sessionId={sessionId}
      />,
    )
  }
  const outside = visible(split.outside)
  if (outside.length > 0) {
    children.push(
      <ChangeRow
        key="outside"
        label={t('change.outside')}
        paths={outside}
        openFile={openFile}
        t={t}
        openDiff={openDiff}
        sessionId={sessionId}
      />,
    )
  }
  if (children.length === 0) return null
  return <div className={C.block}>{children}</div>
}

/* ── file-link interception: file mentions → Monaco「文件」tab ─────────────── */

const TOOL_LINK_SELECTOR = [
  '[data-tool="read"] button[class*="_fileLink"]',
  '[data-tool="write"] button[class*="_fileLink"]',
  '[data-tool="edit"] button[class*="_fileLink"]',
].join(', ')

/**
 * 承接原 dsh-te-file-link-opener 的能力：捕获文件链接点击 → Monaco「文件」标签打开。
 * Returns the click-listener disposer, or undefined when no text-editor is present.
 */
export function installFileLinkInterception(ctx: ClientContext): (() => void) | undefined {
  const te = ctx.get('dsh-text-editor') as TextEditorCapability | undefined
  if (te === null || te === undefined || typeof te.openFile !== 'function') return undefined
  // Capture before the closure: property narrowings reset inside callbacks.
  const openFileTab = te.openFile
  const sessions = ctx.get('sessions')
  const onClick = (event: MouseEvent): void => {
    if (event.button !== 0) return
    const target = event.target
    if (target === null || typeof (target as Element).closest !== 'function') return
    const element = target as Element
    // 本插件自己的列表自带 onClick(→ openDiff)，不在这里重复拦截。
    if (element.closest('.dscList') !== null) return
    let path: string | null = null
    const chip = element.closest('[data-produced-files-row] button[title]')
    if (chip !== null) {
      path = chip.getAttribute('title')
    } else {
      const link = element.closest(TOOL_LINK_SELECTOR)
      if (link !== null) {
        const text = (link.textContent ?? '').trim()
        if (text !== '') path = text
      }
    }
    if (path === null || path === '') return
    const s = currentSessionInfo(sessions)
    event.preventDefault()
    event.stopPropagation()
    openFileTab({ path, cwd: s.cwd, sessionId: s.sessionId })
  }
  document.addEventListener('click', onClick, true)
  return () => {
    document.removeEventListener('click', onClick, true)
  }
}
