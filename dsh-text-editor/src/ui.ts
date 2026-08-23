/**
 * 视图层：文件标签、编辑器视图、差异视图、Monaco 容器。
 *
 * 本插件只提供基础能力（openFile / showDiff），不再直接拦截文件链接点击；
 * 所有「动作」都经 commands.ts 触发（requestSave / requestClose /
 * requestDiffNext / requestDiffPrev / requestDiffClose），由 controller.ts 注册
 * 处理——组件不反向 import 编排层，避免依赖成环。
 *
 * 会话作用域：每个文件标签/视图都携带（sessionId, fileKey）——由 controller 注册
 * 时闭包捕获。文件内容等高频状态变化走 store 订阅（uSES），不触发标签重挂载。
 */
import * as React from 'react'
import type { DiffFile } from './api.ts'
import {
  commitFileContent,
  getDiffState,
  getFileByKey,
  noteActiveFile,
  subscribe,
  updateFileByKey,
} from './state.ts'
import {
  currentTheme,
  ensureMonaco,
  getActiveDiffEditor,
  getActiveEditor,
  getActiveMonaco,
  setActiveDiffEditor,
  setActiveEditor,
  setActiveFileKey,
  setActiveMonaco,
} from './monaco.ts'
import { basename, languageFor } from './path.ts'
import {
  requestClose,
  requestDiffClose,
  requestDiffNext,
  requestDiffPrev,
  requestSave,
} from './commands.ts'

// ── 标签 ────────────────────────────────────────────────────────────────────
/** 标签内容：被打开文件的 basename（脏时带 ● 标记）+ × 关闭按钮。 */
export function TabLabel({ sessionId, fileKey }: { sessionId: string; fileKey: string }): React.ReactElement {
  const state = React.useSyncExternalStore(subscribe, () => getFileByKey(sessionId, fileKey))
  const label = state !== null && state.label !== '' ? state.label : '文件'
  return React.createElement('span', { className: 'dsh-te-tab' },
    React.createElement('span', {
      className: state !== null && state.dirty ? 'dsh-te-tab-label dsh-te-tab-dirty' : 'dsh-te-tab-label',
      'data-dsh-te-key': fileKey,
      title: state !== null ? state.path : undefined,
    }, state !== null && state.dirty ? `${label} ●` : label),
    React.createElement('span', {
      role: 'button',
      className: 'dsh-te-tab-close',
      title: '关闭',
      'aria-label': '关闭编辑器',
      onClick: (event: React.MouseEvent<HTMLSpanElement>) => {
        // 阻止冒泡到外层 tab 按钮（否则会触发 setView 切换标签）。
        event.stopPropagation()
        requestClose(fileKey)
      },
    }, '×'),
  )
}

// ── 差异视图标签 ────────────────────────────────────────────────────────────
/** 「差异」tab 标签：文件数 + × 关闭按钮（反应式跟随当前会话的 diffState）。 */
export function DiffTabLabel(): React.ReactElement {
  const state = React.useSyncExternalStore(subscribe, getDiffState)
  const count = state !== null ? state.files.length : 0
  const label = count > 0 ? `差异 · ${count}` : '差异'
  return React.createElement('span', { className: 'dsh-te-tab' },
    React.createElement('span', {
      className: 'dsh-te-diff-tab-label',
      title: state !== null ? `当前 ${state.index + 1} / ${count}` : undefined,
    }, label),
    React.createElement('span', {
      role: 'button',
      className: 'dsh-te-tab-close',
      title: '关闭',
      'aria-label': '关闭差异视图',
      onClick: (event: React.MouseEvent<HTMLSpanElement>) => {
        event.stopPropagation()
        requestDiffClose()
      },
    }, '×'),
  )
}

// ── 编辑器视图 ──────────────────────────────────────────────────────────────
export function FileView({ sessionId, fileKey }: { sessionId: string; fileKey: string }): React.ReactElement | null {
  const state = React.useSyncExternalStore(subscribe, () => getFileByKey(sessionId, fileKey))
  // 该视图被挂载即意味着用户正在看这个文件 → 上报为当前活动文件（供保存等使用）。
  React.useEffect(() => {
    noteActiveFile(sessionId, fileKey)
  }, [sessionId, fileKey])
  if (state === null) {
    return React.createElement('div', { className: 'dsh-te-root dsh-te-empty' },
      React.createElement('div', { className: 'dsh-te-note' }, '未打开文件'))
  }
  const statusText = state.loading
    ? '加载中…'
    : state.saving
      ? '保存中…'
      : state.error !== null
        ? state.error
        : state.notice
  return React.createElement('div', { className: 'dsh-te-root' },
    React.createElement('div', { className: 'dsh-te-toolbar' },
      React.createElement('span', { className: 'dsh-te-path', title: state.path }, state.path),
      React.createElement('button', {
        type: 'button',
        className: state.dirty ? 'dsh-te-save dsh-te-save-dirty' : 'dsh-te-save',
        title: '保存 (Ctrl+S)',
        onClick: () => { void requestSave(fileKey) },
        disabled: state.loading || state.error !== null,
      }, state.dirty ? '未保存' : '保存'),
      statusText !== undefined && statusText !== null && statusText !== ''
        ? React.createElement('span', {
          className: state.error !== null ? 'dsh-te-status dsh-te-status-error' : 'dsh-te-status',
        }, statusText)
        : null,
      state.binary
        ? React.createElement('span', { className: 'dsh-te-status dsh-te-status-error' }, '二进制文件')
        : null,
    ),
    React.createElement('div', { className: 'dsh-te-body' },
      state.binary || state.error !== null
        ? React.createElement('div', { className: 'dsh-te-note' },
          state.binary
            ? '该文件是二进制文件，无法以文本方式查看。'
            : `无法读取文件：${state.error}`)
        : React.createElement(MonacoHost, { sessionId, fileKey, content: state.content, path: state.path }),
      state.truncated
        ? React.createElement('div', { className: 'dsh-te-note' }, '文件较大，仅显示前 2MB。')
        : null,
    ),
  )
}

/** 承载 Monaco 实例的容器组件（懒加载 Monaco，随内容/路径更新；卸载时回写内容）。 */
function MonacoHost({
  sessionId, fileKey, content, path,
}: { sessionId: string; fileKey: string; content: string; path: string }): React.ReactElement {
  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const [ready, setReady] = React.useState(false)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  // 程序化 setValue（换文件/重载）会触发 content change 事件，用该标志忽略，
  // 避免把「刚加载的文件」误标为未保存。
  const suppressChangeRef = React.useRef(false)

  React.useEffect(() => {
    let cancelled = false
    let changeSub: { dispose(): void } | null = null
    void ensureMonaco().then((monaco) => {
      if (cancelled || containerRef.current === null) return
      setActiveMonaco(monaco)
      const editor = monaco.editor.create(containerRef.current, {
        value: content,
        language: languageFor(path),
        theme: currentTheme(),
        automaticLayout: true,
        fontSize: 13,
        lineNumbers: 'on',
        minimap: { enabled: false },
        readOnly: false,
        scrollBeyondLastLine: false,
        wordWrap: 'off',
        tabSize: 2,
      })
      setActiveEditor(editor)
      setActiveFileKey(fileKey)
      // 用户编辑（内容变动）→ 标记为未保存（不自动保存），并清掉旧的「已保存」提示。
      changeSub = editor.onDidChangeModelContent(() => {
        if (suppressChangeRef.current) return
        const s = getFileByKey(sessionId, fileKey)
        if (s !== null && !s.dirty) updateFileByKey(sessionId, fileKey, { dirty: true, notice: null })
      })
      setReady(true)
    }).catch((error: unknown) => {
      if (!cancelled) setLoadError(error instanceof Error ? error.message : String(error))
    })
    return () => {
      cancelled = true
      changeSub?.dispose()
      changeSub = null
      const editor = getActiveEditor()
      if (editor !== null) {
        // 卸载前把当前编辑内容回写 store（换 tab / 切会话时保留未保存修改）。
        commitFileContent(sessionId, fileKey, editor.getValue())
        editor.dispose()
        setActiveEditor(null)
      }
      setActiveFileKey(null)
      setActiveMonaco(null)
    }
    // 挂载时创建一次；内容/路径变化走下面的更新 effect。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 新内容（加载/重载）到达时更新编辑器内容与语言。
  React.useEffect(() => {
    if (!ready) return
    const editor = getActiveEditor()
    if (editor === null) return
    if (editor.getValue() !== content) {
      suppressChangeRef.current = true
      editor.setValue(content)
      suppressChangeRef.current = false
      // 程序化重载后视为已保存状态。
      const s = getFileByKey(sessionId, fileKey)
      if (s !== null && s.dirty) updateFileByKey(sessionId, fileKey, { dirty: false })
    }
    const monaco = getActiveMonaco()
    if (monaco !== null) {
      const model = editor.getModel()
      if (model !== null && model !== undefined) monaco.editor.setModelLanguage(model, languageFor(path))
    }
  }, [content, path, ready, sessionId, fileKey])

  if (loadError !== null) {
    return React.createElement('div', { className: 'dsh-te-note' },
      `Monaco 加载失败：${loadError}`)
  }
  return React.createElement('div', { className: 'dsh-te-monaco' },
    React.createElement('div', { ref: containerRef, className: 'dsh-te-monaco-host' }),
    !ready ? React.createElement('div', { className: 'dsh-te-note' }, '加载 Monaco 编辑器…') : null,
  )
}

// ── 差异视图 ────────────────────────────────────────────────────────────────
/** 「差异」tab 视图：顶部 上一个/下一个 + 进度，正文 Monaco 双栏 diff。 */
export function DiffView(): React.ReactElement | null {
  const state = React.useSyncExternalStore(subscribe, getDiffState)
  if (state === null || state.files.length === 0) {
    return React.createElement('div', { className: 'dsh-te-root dsh-te-empty' },
      React.createElement('div', { className: 'dsh-te-note' }, '未显示差异'))
  }
  const index = Math.min(Math.max(state.index, 0), state.files.length - 1)
  const file = state.files[index]!
  const label = file.label !== undefined && file.label !== ''
    ? file.label
    : (file.path !== undefined && file.path !== '' ? basename(file.path) : `文件 ${index + 1}`)
  const hasNext = index < state.files.length - 1
  const hasPrev = index > 0
  return React.createElement('div', { className: 'dsh-te-root' },
    React.createElement('div', { className: 'dsh-te-toolbar' },
      React.createElement('button', {
        type: 'button',
        className: 'dsh-te-diff-nav',
        title: '上一个文件',
        disabled: !hasPrev,
        onClick: () => { requestDiffPrev() },
      }, '上一个'),
      React.createElement('button', {
        type: 'button',
        className: 'dsh-te-diff-nav',
        title: '下一个文件',
        disabled: !hasNext,
        onClick: () => { requestDiffNext() },
      }, '下一个'),
      React.createElement('span', { className: 'dsh-te-diff-counter' }, `${index + 1} / ${state.files.length}`),
      React.createElement('span', { className: 'dsh-te-path', title: label }, label),
    ),
    React.createElement('div', { className: 'dsh-te-body' },
      file.before === '' && file.after === ''
        ? React.createElement('div', { className: 'dsh-te-note' }, '前后内容均为空，无差异可显示。')
        : React.createElement(DiffHost, { file }),
    ),
  )
}

/** 承载 Monaco 双栏 diff 实例的容器（懒加载 Monaco，随当前文件切换模型）。 */
function DiffHost({ file }: { file: DiffFile }): React.ReactElement {
  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const [ready, setReady] = React.useState(false)
  const [loadError, setLoadError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    void ensureMonaco().then((monaco) => {
      if (cancelled || containerRef.current === null) return
      setActiveMonaco(monaco)
      const editor = monaco.editor.createDiffEditor(containerRef.current, {
        theme: currentTheme(),
        automaticLayout: true,
        fontSize: 13,
        lineNumbers: 'on',
        minimap: { enabled: false },
        readOnly: true,
        scrollBeyondLastLine: false,
        renderSideBySide: true,
        enableSplitViewResizing: true,
        // 只隐藏两侧文件的竖直滚动条；横向滚动条保留；diff 位置条（共享 overview ruler）保留。
        scrollbar: { vertical: 'hidden' },
        renderOverviewRuler: true,
      })
      setActiveDiffEditor(editor)
      setReady(true)
    }).catch((error: unknown) => {
      if (!cancelled) setLoadError(error instanceof Error ? error.message : String(error))
    })
    return () => {
      cancelled = true
      const editor = getActiveDiffEditor()
      if (editor !== null) {
        editor.dispose()
        setActiveDiffEditor(null)
      }
      setActiveMonaco(null)
    }
    // 挂载时创建一次；文件切换走下面的模型更新 effect。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 当前文件变化时：建原文/新文模型并交给 diff 编辑器，替换并释放旧模型。
  React.useEffect(() => {
    if (!ready) return
    const editor = getActiveDiffEditor()
    if (editor === null) return
    const monaco = getActiveMonaco()
    if (monaco === null) return
    const language = languageFor(file.path ?? file.label ?? '')
    const original = monaco.editor.createModel(file.before, language)
    const modified = monaco.editor.createModel(file.after, language)
    const previous = editor.getModel()
    editor.setModel({ original, modified })
    if (previous !== null) {
      previous.original.dispose()
      previous.modified.dispose()
    }
  }, [file, ready])

  if (loadError !== null) {
    return React.createElement('div', { className: 'dsh-te-note' },
      `Monaco 加载失败：${loadError}`)
  }
  return React.createElement('div', { className: 'dsh-te-monaco' },
    React.createElement('div', { ref: containerRef, className: 'dsh-te-monaco-host' }),
    !ready ? React.createElement('div', { className: 'dsh-te-note' }, '加载 Monaco 差异视图…') : null,
  )
}
