/**
 * 模块级状态 store，分两块、互不影响：
 *
 *   1. 文件状态（filesBySession）：右栏编辑器 tab 的内容/脏标记/错误等。条目由
 *      pane 正文挂载时 `ensureFile` 按需创建，tab 被关闭（AbortSignal 中止）时
 *      `forgetFile` 丢弃；正文卸载时 `commitFileContent` 回写内容并保留脏标记，
 *      于是同一右栏里切换 tab 再切回来不会丢未保存修改。
 *   2. 差异状态（diffBySession）：`showDiff` 能力在会话主区「差异」tab 里展示的
 *      一组文件 diff（与右栏编辑器无关）。
 *
 * 视图用 useSyncExternalStore(subscribe, getSnapshot) 反应式驱动。
 */
import type { DiffFile } from './api.ts'
import { basename } from './path.ts'

export interface FileState {
  /** 稳定标识（path 的哈希）：store 查找 / 编辑器登记统一用它。 */
  key: string
  path: string
  label: string
  content: string
  loading: boolean
  saving: boolean
  /** 是否有未保存的修改（编辑器内容自上次加载/保存后有变动）。 */
  dirty: boolean
  binary: boolean
  truncated: boolean
  error: string | null
  notice: string | null
  /** 解析相对路径用的工作区根（宿主读取/保存路由的 cwd 参数）。 */
  cwd: string
  /** 保存时解析沙箱策略所用的会话 id。 */
  sessionId: string | undefined
}

/** 会话作用域的差异视图状态（与右栏编辑器相互独立）。 */
export interface DiffState {
  files: DiffFile[]
  index: number
  sessionId: string | undefined
}

/** path → 稳定短哈希（双种子 djb2）。 */
export function hashKey(path: string): string {
  let h1 = 5381
  let h2 = 52711
  for (let i = 0; i < path.length; i++) {
    const c = path.charCodeAt(i)
    h1 = ((h1 << 5) + h1 + c) >>> 0
    h2 = ((h2 << 5) + h2 + c + 101) >>> 0
  }
  return h1.toString(36) + h2.toString(36)
}

let activeSessionId: string | undefined = undefined
const filesBySession = new Map<string, FileState[]>()
const diffBySession = new Map<string, DiffState>()
const listeners = new Set<() => void>()

function emit(): void {
  for (const fn of [...listeners]) fn()
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

// ── 活动会话（差异 tab 的会话作用域 + openFile 的缺省会话） ────────────────────

export function getActiveSessionId(): string | undefined {
  return activeSessionId
}

export function setActiveSessionId(id: string | undefined): void {
  if (id === activeSessionId) return
  activeSessionId = id
  emit()
}

// ── 文件状态 ─────────────────────────────────────────────────────────────────

export interface EnsureResult {
  key: string
  /** 本次调用是否新建了条目（新建即需要发起首次读取）。 */
  created: boolean
  file: FileState
}

/**
 * 确保指定会话里存在某路径的条目（不存在则以 loading 态新建）。
 * 右栏 tab 的数目由右栏自己的标签系统管理，这里不再做容量驱逐。
 */
export function ensureFile(sessionId: string, path: string, cwd: string): EnsureResult {
  const key = hashKey(path)
  let files = filesBySession.get(sessionId)
  if (files === undefined) {
    files = []
    filesBySession.set(sessionId, files)
  }
  const existing = files.find((f) => f.key === key)
  if (existing !== undefined) return { key, created: false, file: existing }
  const file: FileState = {
    key,
    path,
    label: basename(path),
    content: '',
    loading: true,
    saving: false,
    dirty: false,
    binary: false,
    truncated: false,
    error: null,
    notice: null,
    cwd,
    sessionId,
  }
  files.push(file)
  emit()
  return { key, created: true, file }
}

export function getFileByKey(sessionId: string | undefined, key: string): FileState | null {
  if (sessionId === undefined || key === '') return null
  const files = filesBySession.get(sessionId)
  if (files === undefined) return null
  return files.find((f) => f.key === key) ?? null
}

export function updateFileByKey(sessionId: string | undefined, key: string, patch: Partial<FileState>): void {
  if (sessionId === undefined) return
  const files = filesBySession.get(sessionId)
  if (files === undefined) return
  const index = files.findIndex((f) => f.key === key)
  if (index === -1) return
  files[index] = { ...files[index]!, ...patch }
  emit()
}

/**
 * Monaco 卸载时把当前编辑内容回写 store；脏标记按「与上次加载/保存的内容是否
 * 相同」重算，于是改回原样不算未保存（文件已关闭则忽略）。
 */
export function commitFileContent(sessionId: string, key: string, content: string): void {
  const file = getFileByKey(sessionId, key)
  if (file === null) return
  updateFileByKey(sessionId, key, { content, dirty: content !== file.content })
}

/** 忘掉一个文件的状态（右栏 tab 关闭时经 tab 的 AbortSignal 调用）。 */
export function forgetFile(sessionId: string, key: string): void {
  const files = filesBySession.get(sessionId)
  if (files === undefined) return
  const index = files.findIndex((f) => f.key === key)
  if (index === -1) return
  files.splice(index, 1)
  if (files.length === 0) filesBySession.delete(sessionId)
  emit()
}

// ── 差异视图 ─────────────────────────────────────────────────────────────────

/** 当前活动会话的差异状态（无差异或无可活动会话时 null）。 */
export function getDiffState(): DiffState | null {
  if (activeSessionId === undefined) return null
  return diffBySession.get(activeSessionId) ?? null
}

export function setDiffStateForSession(sessionId: string, next: DiffState): void {
  diffBySession.set(sessionId, next)
  emit()
}

export function clearDiff(sessionId: string): void {
  if (diffBySession.delete(sessionId)) emit()
}
