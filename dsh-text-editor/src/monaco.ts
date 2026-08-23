/**
 * Monaco 封装：AMD loader 注入（幂等）+ 当前编辑器实例的模块级单例。
 *
 * 注意：Monaco 的 API 入口在 `monaco.editor` 下（`monaco.editor.create`、
 * `setTheme`、`setModelLanguage`），不是 `monaco.create`。
 */
import { MONACO_BASE } from './routes.ts'

/** Monaco `monaco` 全局的最小面。 */
export interface MonacoEditor {
  editor: {
    create(el: HTMLElement, options: Record<string, unknown>): MonacoEditorInstance
    createDiffEditor(el: HTMLElement, options: Record<string, unknown>): MonacoDiffEditorInstance
    createModel(value: string, languageId: string): MonacoTextModel
    setTheme(theme: string): void
    setModelLanguage(model: unknown, languageId: string): void
  }
  Uri: { file(path: string): unknown }
}

/** 一个 Monaco 编辑器实例的最小面。 */
export interface MonacoEditorInstance {
  dispose(): void
  getValue(): string
  setValue(value: string): void
  getModel(): unknown
  onDidChangeModelContent(listener: () => void): { dispose(): void }
  getPosition(): { lineNumber: number; column: number }
  setPosition(position: { lineNumber: number; column: number }): void
  revealLineInCenter(lineNumber: number): void
}

/** Monaco `ILineChange` 的最小面（修改块；只用 modified 侧行号区间做定位跳转）。 */
export interface ILineChange {
  modifiedStartLineNumber: number
  modifiedEndLineNumber: number
}

/** Monaco 文本模型的最小面。 */
export interface MonacoTextModel {
  dispose(): void
}

/** Monaco 双栏 diff 编辑器实例的最小面（能力 2 用）。 */
export interface MonacoDiffEditorInstance {
  dispose(): void
  setModel(model: { original: MonacoTextModel; modified: MonacoTextModel }): void
  getModel(): { original: MonacoTextModel; modified: MonacoTextModel } | null
  /** 当前 diff 的修改块列表；diff 尚未计算完成时返回 null（与 Monaco 行为一致）。 */
  getLineChanges(): ILineChange[] | null
  getModifiedEditor(): MonacoEditorInstance
  onDidUpdateDiff(listener: () => void): { dispose(): void }
}

/** window 上的 Monaco AMD 全局。 */
interface MonacoWindow {
  monaco?: MonacoEditor
  require?: {
    config(options: Record<string, unknown>): void
    (deps: readonly string[], callback: () => void): void
  }
  MonacoEnvironment?: { getWorkerUrl?: () => string }
}

let monacoPromise: Promise<MonacoEditor> | null = null
let activeMonaco: MonacoEditor | null = null
let activeEditor: MonacoEditorInstance | null = null
let activeDiffEditor: MonacoDiffEditorInstance | null = null
/** 当前挂载的文件编辑器对应的文件 key（保存以它为准，避免用陈旧的活动索引）。 */
let activeFileKey: string | null = null

export function getActiveMonaco(): MonacoEditor | null { return activeMonaco }
export function setActiveMonaco(monaco: MonacoEditor | null): void { activeMonaco = monaco }
export function getActiveEditor(): MonacoEditorInstance | null { return activeEditor }
export function setActiveEditor(editor: MonacoEditorInstance | null): void { activeEditor = editor }
export function getActiveDiffEditor(): MonacoDiffEditorInstance | null { return activeDiffEditor }
export function setActiveDiffEditor(editor: MonacoDiffEditorInstance | null): void { activeDiffEditor = editor }
export function getActiveFileKey(): string | null { return activeFileKey }
export function setActiveFileKey(key: string | null): void { activeFileKey = key }

// ── 跨文件 diff 跳转的定位意图 ────────────────────────────────────────────────
// 「上一处/下一处修改」在当前文件最后一处/第一处修改时跨文件：先写意图（'first'/'last'），
// 再由新文件的 DiffHost 在 diff 计算完成后定位到第一处/最后一处修改。
let pendingDiffReveal: 'first' | 'last' | null = null

export function setPendingDiffReveal(v: 'first' | 'last' | null): void { pendingDiffReveal = v }

/** 取出并清空意图（DiffHost 在 diff 计算完成后消费）。 */
export function consumePendingDiffReveal(): 'first' | 'last' | null {
  const v = pendingDiffReveal
  pendingDiffReveal = null
  return v
}

function getMonacoWindow(): MonacoWindow {
  return window as unknown as MonacoWindow
}

/** 注入 Monaco AMD loader 并解析出 `monaco` 全局（幂等）。 */
export function ensureMonaco(): Promise<MonacoEditor> {
  if (monacoPromise !== null) return monacoPromise
  monacoPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = `${MONACO_BASE}/loader.js`
    script.onload = () => {
      const amd = getMonacoWindow().require
      if (amd === undefined || typeof amd.config !== 'function') {
        reject(new Error('Monaco AMD loader missing'))
        return
      }
      amd.config({ paths: { vs: MONACO_BASE } })
      getMonacoWindow().MonacoEnvironment = {
        getWorkerUrl: () => `${MONACO_BASE}/base/worker/workerMain.js`,
      }
      amd(['vs/editor/editor.main'], () => {
        const monaco = getMonacoWindow().monaco
        if (monaco === undefined) reject(new Error('Monaco editor missing'))
        else resolve(monaco)
      })
    }
    script.onerror = () => reject(new Error('Monaco loader failed to load'))
    document.head.appendChild(script)
  })
  return monacoPromise
}

/** 当前 DSH 主题 → Monaco 主题。 */
export function currentTheme(): string {
  return document.body.hasAttribute('data-ds-dark-theme') ? 'vs-dark' : 'vs'
}
