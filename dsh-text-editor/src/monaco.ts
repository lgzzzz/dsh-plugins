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

export function getActiveMonaco(): MonacoEditor | null { return activeMonaco }
export function setActiveMonaco(monaco: MonacoEditor | null): void { activeMonaco = monaco }
export function getActiveEditor(): MonacoEditorInstance | null { return activeEditor }
export function setActiveEditor(editor: MonacoEditorInstance | null): void { activeEditor = editor }
export function getActiveDiffEditor(): MonacoDiffEditorInstance | null { return activeDiffEditor }
export function setActiveDiffEditor(editor: MonacoDiffEditorInstance | null): void { activeDiffEditor = editor }

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
