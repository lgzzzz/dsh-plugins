/**
 * 模块级文件状态 store（同一时刻一个打开的文件）。
 * 用 useSyncExternalStore(subscribe, getState) 反应式驱动视图。
 */
import type { DiffFile } from './api.ts'

export interface FileState {
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

let fileState: FileState | null = null
const listeners = new Set<() => void>()

function emit(): void {
  for (const fn of listeners) fn()
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

export function getState(): FileState | null {
  return fileState
}

export function setState(next: FileState | null): void {
  fileState = next
  emit()
}

// ── 差异视图状态 store（与文件编辑状态相互独立） ────────────────────────────

/** 「差异」tab 的展示状态：一组文件的顺序索引。 */
export interface DiffState {
  files: DiffFile[]
  index: number
  sessionId: string | undefined
}

let diffState: DiffState | null = null
const diffListeners = new Set<() => void>()

function emitDiff(): void {
  for (const fn of diffListeners) fn()
}

export function subscribeDiff(fn: () => void): () => void {
  diffListeners.add(fn)
  return () => { diffListeners.delete(fn) }
}

export function getDiffState(): DiffState | null {
  return diffState
}

export function setDiffState(next: DiffState | null): void {
  diffState = next
  emitDiff()
}
