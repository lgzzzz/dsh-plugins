/**
 * dsh-left-dock — 文件面板：会话工作区的一棵树，点击文件走 dsh-text-editor。
 *
 * 数据面只用**公开服务**：`remote.workspaceFiles.list(sessionId, path, signal)`
 * （与内置 ui-sidebar-files 取目录列表的是同一个 Remote 命名空间）。上游那棵树把
 * 状态放在 `dsh-client-store` 的 per-tab slot store 里、把行渲染交给
 * `dsh-client-ui-primitives` 的图标；本插件不复刻那两处私有面，改为组件内 React
 * 状态 + 内联 SVG（见 icons.ts），渲染结果与上游同构：
 *
 *   - 目录在前、文件在后，各自按自然名序（Intl.Collator numeric）；
 *   - 展开的目录惰性列表，折叠保留已加载层；
 *   - 每次 root / 会话变化换一份 AbortController，旧请求的落点被丢弃；
 *   - 点击文件 → `onOpen`（由调用方转成 dsh-text-editor 的 openFile 请求）。
 *
 * 与上游的差异（有意）：上游行点击走 `tabActions.openResource(fileAddressFor(...))`
 * 交给 `dsh-resource://file` 查看器认领；本插件的需求是「在对话区 tab 里用仓库内
 * 文本插件显示文件内容」，因此直接调用 dsh-text-editor 的能力面。
 */
import { createElement as h, useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type {
  DirectoryEntryLike, DirectoryListingLike, RemoteFailureLike, RemoteResultLike, Translate,
} from './context.ts'
import { IconChevron, IconDir, IconFile, IconRefresh } from './icons.ts'

/** 列一个目录（调用方已把服务缺失收敛成失败结果）。 */
export type ListDirectory = (
  sessionId: string,
  path: string,
  signal: AbortSignal,
) => Promise<RemoteResultLike<DirectoryListingLike>>

/** 文件面板 props。 */
export interface FilesPanelProps {
  /** 当前活动会话 id；无会话时面板显示提示行。 */
  sessionId: string | undefined
  /** 会话工作区根（绝对路径）。 */
  root: string
  /**
   * 文件服务是否就绪（`ctx.inject(['remote','remote.workspaceFiles'])` 已绑定 list）。
   * 未就绪时不发请求、显示「服务未就绪」；本值翻转成 true 时面板自动重新加载。
   */
  serviceReady: boolean
  t: Translate
  listDirectory: ListDirectory
  /** 打开一个文件；返回 false 表示文本编辑器服务不可用。 */
  openFile: (path: string) => boolean
}

/** 一层目录的加载状态。 */
type LevelState =
  | { kind: 'loading' }
  | { kind: 'ready'; listing: DirectoryListingLike }
  | { kind: 'failed'; failure: RemoteFailureLike }

/** 自然、大小写不敏感的名序（`file2` 在 `file10` 前）。 */
const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/**
 * 一层目录的展示顺序：目录在前，其余在后，组内按自然名序。
 * @param entries - endpoint 返回的条目。
 * @returns 新数组（不修改入参）。
 */
export function orderEntries(entries: readonly DirectoryEntryLike[]): DirectoryEntryLike[] {
  return [...entries].sort((left, right) => {
    const group = Number(right.type === 'directory') - Number(left.type === 'directory')
    return group !== 0 ? group : byName.compare(left.name, right.name)
  })
}

/**
 * 一个子条目的绝对路径（上游 face.ts 的同名规则：`/` 拼接、容忍父路径尾分隔符）。
 * @param parent - 父目录绝对路径。
 * @param name - 条目名。
 * @returns 子路径。
 */
export function childPath(parent: string, name: string): string {
  return `${parent.replace(/[/\\]+$/, '')}/${name}`
}

/**
 * 把 Remote 失败码翻成一句人话（与内置 ui-sidebar-files 的 failureLine 同规则）。
 * @param t - 文案函数。
 * @param failure - 失败体。
 * @returns 展示行。
 */
export function failureLine(t: Translate, failure: RemoteFailureLike): string {
  switch (failure.code) {
    case 'workspace-file/not-found': return t('files.error.notFound')
    case 'workspace-file/outside-workspace': return t('files.error.outsideWorkspace')
    case 'workspace-file/not-directory': return t('files.error.notDirectory')
    default: return t('files.error.unavailable', { message: failure.message ?? '' })
  }
}

/**
 * 拆一个绝对路径为「目录前缀 + 末段」，供头部展示。
 * @param path - 绝对路径。
 * @returns 目录前缀（含尾分隔符，可能为空）与末段名。
 */
function splitPath(path: string): { directory: string; name: string } {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return cut < 0
    ? { directory: '', name: path }
    : { directory: path.slice(0, cut + 1), name: path.slice(cut + 1) }
}

/** 一行说明（加载中 / 失败 / 空 / 截断）。 */
function note(text: string, kind: string, key: string): ReactNode {
  return h('li', { key, className: 'dsh-ld-note', 'data-dsh-ld-note': kind }, text)
}

/**
 * 文件面板主体。
 * @param props - 见 {@link FilesPanelProps}。
 * @returns 面板元素树。
 */
export function FilesPanel({ sessionId, root, serviceReady, t, listDirectory, openFile }: FilesPanelProps): ReactNode {
  const ready = sessionId !== undefined && root !== '' && serviceReady
  const [levels, setLevels] = useState<Record<string, LevelState>>({})
  const [expanded, setExpanded] = useState<readonly string[]>(() => (root === '' ? [] : [root]))
  const [revision, setRevision] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)
  const controller = useRef<AbortController | null>(null)

  // root / 会话切换：换 AbortController 并重置整棵树（旧请求的落点因此写不进来）。
  useEffect(() => {
    if (!ready) return undefined
    const active = new AbortController()
    controller.current = active
    setLevels({})
    setExpanded([root])
    setRevision(value => value + 1)
    return () => {
      active.abort()
      if (controller.current === active) controller.current = null
    }
  }, [ready, root, sessionId])

  const load = useCallback((path: string) => {
    const active = controller.current
    if (active === null || active.signal.aborted || sessionId === undefined) return
    setLevels(previous => ({ ...previous, [path]: { kind: 'loading' } }))
    const settle = (state: LevelState): void => {
      if (active.signal.aborted) return
      setLevels(previous => ({ ...previous, [path]: state }))
    }
    void listDirectory(sessionId, path, active.signal).then(
      (result) => {
        settle(result.ok
          ? { kind: 'ready', listing: result.value ?? {} }
          : { kind: 'failed', failure: result.error ?? {} })
      },
      (error: unknown) => {
        settle({ kind: 'failed', failure: { message: error instanceof Error ? error.message : String(error) } })
      },
    )
  }, [listDirectory, sessionId])

  // 展开集变化：把还没有状态的层补上（已加载的层折叠后再展开不重复请求）。
  useEffect(() => {
    if (!ready) return
    for (const path of expanded) {
      if (levels[path] === undefined) load(path)
    }
  }, [ready, expanded, levels, load, revision])

  const toggleDir = useCallback((path: string) => {
    setExpanded(previous => (
      previous.includes(path) ? previous.filter(item => item !== path) : [...previous, path]
    ))
  }, [])

  const reload = useCallback(() => {
    setLevels({})
    setNotice(null)
    setRevision(value => value + 1)
  }, [])

  const open = useCallback((path: string) => {
    setNotice(openFile(path) ? null : t('files.openFailed'))
  }, [openFile, t])

  if (!ready) {
    // 两种未就绪原因分开说：会话没有工作区目录 / 文件服务（remote.workspaceFiles）
    // 还没绑定。后者一旦就绪（serviceReady 翻转）本组件会自动重新加载整棵树。
    const noWorkspace = sessionId === undefined || root === ''
    return h('div', { className: 'dsh-ld-files', 'data-dsh-ld-files': noWorkspace ? 'empty' : 'no-service' },
      h('div', { className: 'dsh-ld-status' },
        h('p', { className: 'dsh-ld-statusLine' }, noWorkspace ? t('files.noWorkspace') : t('files.noService'))))
  }

  const renderLevel = (path: string, depth: number): ReactNode[] => {
    const level = levels[path]
    if (level === undefined || level.kind === 'loading') return [note(t('files.loading'), 'loading', `${path}::loading`)]
    if (level.kind === 'failed') {
      return [h('li', {
        key: `${path}::failed`,
        className: 'dsh-ld-note',
        'data-dsh-ld-note': 'failed',
        'data-dsh-ld-code': level.failure.code ?? '',
      }, failureLine(t, level.failure))]
    }
    const entries = orderEntries(level.listing.entries ?? [])
    const rows: ReactNode[] = []
    if (entries.length === 0) rows.push(note(t('files.empty'), 'empty', `${path}::empty`))
    for (const entry of entries) {
      const child = childPath(path, entry.name)
      const indent = { paddingLeft: `${6 + depth * 14}px` }
      if (entry.type === 'directory') {
        const open2 = expanded.includes(child)
        rows.push(h('li', { key: child, className: 'dsh-ld-item' },
          h('button', {
            type: 'button',
            className: 'dsh-ld-row',
            style: indent,
            'data-dsh-ld-entry': 'directory',
            'data-dsh-ld-path': child,
            'aria-expanded': open2,
            onClick: () => { toggleDir(child) },
          },
          h('span', { className: 'dsh-ld-glyph' }, h(IconChevron, { size: 12, open: open2 })),
          h('span', { className: 'dsh-ld-glyph' }, h(IconDir, { size: 15 })),
          h('span', { className: 'dsh-ld-name' }, entry.name))))
        if (open2) rows.push(...renderLevel(child, depth + 1))
        continue
      }
      if (entry.type === 'file') {
        rows.push(h('li', { key: child, className: 'dsh-ld-item' },
          h('button', {
            type: 'button',
            className: 'dsh-ld-row',
            style: indent,
            title: child,
            'data-dsh-ld-entry': 'file',
            'data-dsh-ld-path': child,
            onClick: () => { open(child) },
          },
          h('span', { className: 'dsh-ld-glyph' }),
          h('span', { className: 'dsh-ld-glyph' }, h(IconFile, { size: 15 })),
          h('span', { className: 'dsh-ld-name' }, entry.name))))
        continue
      }
      rows.push(h('li', { key: child, className: 'dsh-ld-item' },
        h('span', {
          className: 'dsh-ld-row',
          style: indent,
          'data-dsh-ld-entry': 'other',
          'data-dsh-ld-path': child,
          'aria-disabled': 'true',
          title: t('files.other'),
        },
        h('span', { className: 'dsh-ld-glyph' }),
        h('span', { className: 'dsh-ld-name' }, entry.name))))
    }
    if (level.listing.truncated === true) rows.push(note(t('files.truncated'), 'truncated', `${path}::truncated`))
    return rows
  }

  const { directory, name } = splitPath(root)
  return h('div', { className: 'dsh-ld-files', 'data-dsh-ld-files': 'tree', 'data-dsh-ld-root': root },
    h('div', { className: 'dsh-ld-filesHead' },
      h('div', { className: 'dsh-ld-path', title: root, 'data-dsh-ld-path': root },
        h('span', { className: 'dsh-ld-pathInner' },
          directory === '' ? null : h('span', { className: 'dsh-ld-pathDir' }, directory),
          h('span', { className: 'dsh-ld-pathName' }, name))),
      h('button', {
        type: 'button',
        className: 'dsh-ld-tool',
        title: t('files.reload'),
        'aria-label': t('files.reload'),
        'data-dsh-ld-reload': '',
        onClick: reload,
      }, h(IconRefresh, { size: 14 }))),
    notice === null ? null : h('div', { className: 'dsh-ld-note', 'data-dsh-ld-note': 'notice' }, notice),
    h('div', { className: 'dsh-ld-tree' },
      h('ul', { className: 'dsh-ld-level' }, renderLevel(root, 0))))
}
