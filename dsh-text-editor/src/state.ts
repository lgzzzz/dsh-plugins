/**
 * 模块级状态 store：按会话维护「已打开的编辑器 tab」（每会话至多 5 个）+ 按会话的差异视图。
 * 用 useSyncExternalStore(subscribe, getSnapshot) 反应式驱动视图。
 *
 * 会话作用域规则：当前活动会话由 controller 从 sessions 服务观察并写入
 * （setActiveSessionId）；标签注册（controller.reconcile）只反映「当前活动会话」
 * 的打开文件 —— 因此切走会话时编辑器 tab 消失、切回时重新出现。
 */
import type { DiffFile } from './api.ts'
import { basename } from './path.ts'

/** 同一会话可同时打开的编辑器 tab 上限。 */
export const MAX_EDITOR_TABS = 5

export interface FileState {
  /** 稳定标识（path 的哈希）：注册 id / DOM 定位 / store 查找统一用它。 */
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
  cwd: string
  sessionId: string | undefined
}

/** 会话作用域的差异视图状态（与编辑器 tab 相互独立）。 */
export interface DiffState {
  files: DiffFile[]
  index: number
  sessionId: string | undefined
}

/** path → 稳定短哈希（双种子 djb2；同会话内 ≤5 个文件，碰撞可忽略）。 */
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
const activeIndexBySession = new Map<string, number>()
/** 每个会话的最近活跃顺序（file key，最近者在前）——容量满时用于驱逐。 */
const recencyBySession = new Map<string, string[]>()
const diffBySession = new Map<string, DiffState>()
const listeners = new Set<() => void>()

function emit(): void {
  for (const fn of [...listeners]) fn()
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

// ── 活动会话 ────────────────────────────────────────────────────────────────

export function getActiveSessionId(): string | undefined {
  return activeSessionId
}

export function setActiveSessionId(id: string | undefined): void {
  if (id === activeSessionId) return
  activeSessionId = id
  emit()
}

// ── 文件列表 ─────────────────────────────────────────────────────────────────

export function filesOf(sessionId: string | undefined): FileState[] {
  if (sessionId === undefined) return []
  return filesBySession.get(sessionId) ?? []
}

export function getActiveFiles(): FileState[] {
  return filesOf(activeSessionId)
}

export function getFileAt(index: number): FileState | null {
  const files = getActiveFiles()
  return index >= 0 && index < files.length ? files[index]! : null
}

/** 当前活动会话正在查看的文件下标（无文件时 -1）。 */
export function getActiveIndex(): number {
  const files = getActiveFiles()
  if (files.length === 0) return -1
  const stored = activeSessionId !== undefined ? activeIndexBySession.get(activeSessionId) : undefined
  if (stored === undefined || stored < 0 || stored >= files.length) return 0
  return stored
}

export function getFileIndexByKey(sessionId: string | undefined, key: string): number {
  const files = filesOf(sessionId)
  return files.findIndex((f) => f.key === key)
}

export function getFileByKey(sessionId: string | undefined, key: string): FileState | null {
  const index = getFileIndexByKey(sessionId, key)
  return index === -1 ? null : filesOf(sessionId)[index]!
}

function touchRecency(sessionId: string, key: string): void {
  let rec = recencyBySession.get(sessionId)
  if (rec === undefined) { rec = []; recencyBySession.set(sessionId, rec) }
  const at = rec.indexOf(key)
  if (at !== -1) rec.splice(at, 1)
  rec.unshift(key)
}

/** 视图挂载时上报「当前正在看哪个文件」（FileView mount 时调用）。 */
export function noteActiveFile(sessionId: string, key: string): void {
  const index = getFileIndexByKey(sessionId, key)
  if (index === -1) return
  activeIndexBySession.set(sessionId, index)
  touchRecency(sessionId, key)
  emit()
}

export interface OpenResult {
  ok: boolean
  key: string
  index: number
  alreadyOpen: boolean
  /** 容量满时被驱逐的 tab 下标（无则 null）。 */
  evictedIndex: number | null
  /** 失败原因：'limit'（满 5 且全部有未保存修改）等。 */
  reason: string | null
}

/**
 * 在指定会话打开一个文件：
 * - 已打开 → 选中它（不重复开）；
 * - 未满 5 个 → 追加新 tab；
 * - 已满 → 驱逐「最近未使用的非脏」tab；全脏则拒绝（reason: 'limit'）。
 */
export function openFileInSession(
  sessionId: string,
  path: string,
  cwd: string,
  fileSessionId: string | undefined,
): OpenResult {
  const key = hashKey(path)
  let files = filesBySession.get(sessionId)
  if (files === undefined) { files = []; filesBySession.set(sessionId, files) }
  const existing = files.findIndex((f) => f.key === key)
  if (existing !== -1) {
    activeIndexBySession.set(sessionId, existing)
    touchRecency(sessionId, key)
    emit()
    return { ok: true, key, index: existing, alreadyOpen: true, evictedIndex: null, reason: null }
  }
  let evictedIndex: number | null = null
  if (files.length >= MAX_EDITOR_TABS) {
    const rec = recencyBySession.get(sessionId) ?? []
    const candidates = files
      .map((f, i) => ({ f, i }))
      .filter(({ f }) => !f.dirty)
    if (candidates.length === 0) {
      emit()
      return { ok: false, key, index: -1, alreadyOpen: false, evictedIndex: null, reason: 'limit' }
    }
    candidates.sort((a, b) => {
      const ra = rec.indexOf(a.f.key)
      const rb = rec.indexOf(b.f.key)
      const sa = ra === -1 ? Number.MAX_SAFE_INTEGER : ra
      const sb = rb === -1 ? Number.MAX_SAFE_INTEGER : rb
      return sb - sa // 越不常用越靠前 → 优先驱逐
    })
    evictedIndex = candidates[0]!.i
    files.splice(evictedIndex, 1)
    const activeIdx = activeIndexBySession.get(sessionId)
    if (activeIdx !== undefined) {
      if (activeIdx === evictedIndex) activeIndexBySession.delete(sessionId)
      else if (activeIdx > evictedIndex) activeIndexBySession.set(sessionId, activeIdx - 1)
    }
  }
  const newIndex = files.length
  files.push({
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
    sessionId: fileSessionId ?? sessionId,
  })
  activeIndexBySession.set(sessionId, newIndex)
  touchRecency(sessionId, key)
  emit()
  return { ok: true, key, index: newIndex, alreadyOpen: false, evictedIndex, reason: null }
}

/** 关闭指定会话的某个文件 tab。返回是否关掉了「当前正在查看」的 tab。 */
export function closeFileInSession(sessionId: string, index: number): boolean {
  const files = filesBySession.get(sessionId)
  if (files === undefined || index < 0 || index >= files.length) return false
  const wasActive = activeIndexBySession.get(sessionId) === index
  files.splice(index, 1)
  const activeIdx = activeIndexBySession.get(sessionId)
  if (activeIdx !== undefined) {
    if (activeIdx === index) activeIndexBySession.delete(sessionId)
    else if (activeIdx > index) activeIndexBySession.set(sessionId, activeIdx - 1)
  }
  emit()
  return wasActive
}

export function updateFileAt(sessionId: string, index: number, patch: Partial<FileState>): void {
  const files = filesOf(sessionId)
  if (index < 0 || index >= files.length) return
  files[index] = { ...files[index]!, ...patch }
  emit()
}

export function updateFileByKey(sessionId: string | undefined, key: string, patch: Partial<FileState>): void {
  if (sessionId === undefined) return
  const index = getFileIndexByKey(sessionId, key)
  if (index === -1) return
  updateFileAt(sessionId, index, patch)
}

/** Monaco 卸载时把当前编辑内容回写 store（保留脏标记；文件已关闭则忽略）。 */
export function commitFileContent(sessionId: string, key: string, content: string): void {
  const index = getFileIndexByKey(sessionId, key)
  if (index === -1) return
  const files = filesOf(sessionId)
  const file = files[index]!
  const dirty = content !== file.content
  files[index] = { ...file, content, dirty }
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
