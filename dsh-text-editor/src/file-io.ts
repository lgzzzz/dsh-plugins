/**
 * 文件读写（右栏编辑器与宿主路由之间的唯一通道）：
 *
 *   - loadFile：GET /dsh-text-editor/read?path=&cwd= 整文件读取（宿主截断到 2MB），
 *     结果按 key 写回 store；带读取序号，防过期响应覆盖同路径重开后的新状态。
 *   - saveFile：POST /dsh-text-editor/write，内容取自传入的 Monaco 实例；
 *     宿主按 sessionId 解析该会话的沙箱策略，工作区外写入被拒（403）。
 *
 * 另附「当前挂载的编辑器」登记：右栏 pane 同一时刻只渲染活动 tab 的正文，故只需
 * 记住最近挂载的那一个实例，供全局 Ctrl/Cmd+S 与工具栏「保存」按钮取内容。
 */
import type { MonacoEditorInstance } from './monaco.ts'
import { basename } from './path.ts'
import { READ_ROUTE, WRITE_ROUTE } from './routes.ts'
import type { ReadResult, WriteResult } from './routes.ts'
import { getFileByKey, updateFileByKey } from './state.ts'

/** 每个文件 key 的读取序号（防过期响应覆盖同路径重开后的新状态）。 */
const loadSeqByKey = new Map<string, number>()

/** 从宿主读取路由读取文件内容并发布到 store（按 key 定位，防过期覆盖）。 */
export function loadFile(sessionId: string, key: string): void {
  const file = getFileByKey(sessionId, key)
  if (file === null) return
  const seq = (loadSeqByKey.get(key) ?? 0) + 1
  loadSeqByKey.set(key, seq)
  const url = `${READ_ROUTE}?path=${encodeURIComponent(file.path)}`
    + (file.cwd ? `&cwd=${encodeURIComponent(file.cwd)}` : '')
  fetch(url, { credentials: 'same-origin', cache: 'no-store' })
    .then((response) => response.json() as Promise<ReadResult>)
    .then((data) => {
      if (loadSeqByKey.get(key) !== seq) return
      if (!data.ok) throw new Error(data.error || '读取失败')
      updateFileByKey(sessionId, key, {
        path: data.path || file.path,
        label: basename(file.path),
        content: data.content ?? '',
        loading: false,
        saving: false,
        binary: !!data.binary,
        truncated: !!data.truncated,
        error: null,
        notice: null,
        dirty: false,
      })
    })
    .catch((error: unknown) => {
      if (loadSeqByKey.get(key) !== seq) return
      updateFileByKey(sessionId, key, {
        content: '',
        loading: false,
        saving: false,
        binary: false,
        truncated: false,
        error: error instanceof Error ? error.message : String(error),
        notice: null,
        dirty: false,
      })
    })
}

/** 把某个 Monaco 实例的当前内容保存回宿主（走会话沙箱策略）。 */
export async function saveFile(
  sessionId: string,
  key: string,
  editor: MonacoEditorInstance,
): Promise<void> {
  const file = getFileByKey(sessionId, key)
  if (file === null) return
  const content = editor.getValue()
  updateFileByKey(sessionId, key, { saving: true, error: null, notice: null })
  try {
    const response = await fetch(WRITE_ROUTE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: file.path,
        cwd: file.cwd,
        content,
        sessionId: file.sessionId ?? null,
      }),
    })
    const data = await response.json() as WriteResult
    if (!data.ok) throw new Error(data.error || '保存失败')
    updateFileByKey(sessionId, key, {
      saving: false,
      notice: '已保存',
      error: null,
      dirty: false,
      content,
    })
  } catch (error) {
    updateFileByKey(sessionId, key, {
      saving: false,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

// ── 当前挂载的编辑器 ─────────────────────────────────────────────────────────

let mountedEditor: MonacoEditorInstance | null = null
let mountedEditorKey: string | null = null

/** pane 正文挂载/卸载 Monaco 时登记（editor 为 null 即注销）。 */
export function setMountedEditor(key: string | null, editor: MonacoEditorInstance | null): void {
  mountedEditorKey = key
  mountedEditor = editor
}

export function getMountedEditor(): MonacoEditorInstance | null {
  return mountedEditor
}

export function getMountedEditorKey(): string | null {
  return mountedEditorKey
}

/** 保存当前挂载的编辑器内容（全局 Ctrl/Cmd+S 的落点）；无挂载实例即不动。 */
export async function saveMountedEditor(sessionId: string | undefined): Promise<void> {
  const key = mountedEditorKey
  const editor = mountedEditor
  if (sessionId === undefined || key === null || editor === null) return
  await saveFile(sessionId, key, editor)
}
