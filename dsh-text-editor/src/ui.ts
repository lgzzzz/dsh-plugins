/**
 * 视图层：会话主区的「差异」tab（`showDiff` 能力面）。
 *
 * 文件面（可编辑 Monaco）在 sidebar.ts——右栏 pane 正文与 chip 标题；本模块只保留
 * 差异视图：DiffTabLabel（标签）/ DiffView（工具栏 + 正文）/ DiffHost（Monaco 双栏
 * diff 容器）。
 *
 * 组件不反向 import controller.ts（避免依赖成环）：动作经 commands.ts 的
 * requestDiff* 命令总线触发，由 controller.bind() 注册处理函数。
 */
import * as React from 'react'
import type { DiffFile } from './api.ts'
import { getDiffState, subscribe } from './state.ts'
import {
  consumePendingDiffReveal,
  currentTheme,
  ensureMonaco,
  getActiveDiffEditor,
  getActiveMonaco,
  setActiveDiffEditor,
  setActiveMonaco,
} from './monaco.ts'
import { basename, languageFor } from './path.ts'
import {
  requestDiffClose,
  requestDiffHunkNext,
  requestDiffHunkPrev,
  requestDiffNext,
  requestDiffPrev,
} from './commands.ts'

// ── 差异视图标签 ────────────────────────────────────────────────────────────
/** 差异文件的可读名：label 优先，其次 basename(path)，最后「文件 N」。 */
function diffFileLabel(file: DiffFile, index: number): string {
  if (file.label !== undefined && file.label !== '') return file.label
  if (file.path !== undefined && file.path !== '') return basename(file.path)
  return `文件 ${index + 1}`
}

/**
 * 「差异」tab 标签：显示当前正在查看的 diff 文件的「文件名·diff」（随 上一个/下一个
 * 实时更新），不显示「差异 · N」这类计数——文件总览与进度在视图内工具栏可见。
 */
export function DiffTabLabel(): React.ReactElement {
  const state = React.useSyncExternalStore(subscribe, getDiffState)
  const index = state !== null ? Math.min(Math.max(state.index, 0), state.files.length - 1) : 0
  const file = state !== null && state.files.length > 0 ? state.files[index]! : null
  const text = file !== null ? `${diffFileLabel(file, index)}·diff` : 'diff'
  const title = file !== null
    ? (file.path !== undefined && file.path !== '' ? file.path : file.label)
    : undefined
  return React.createElement('span', { className: 'dsh-te-tab' },
    React.createElement('span', { className: 'dsh-te-diff-tab-label', title }, text),
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

// ── 差异视图 ────────────────────────────────────────────────────────────────
/** 「差异」tab 视图：顶部 上一处/下一处修改 + 文件名 + 上一个/下一个 + 进度，正文 Monaco 双栏 diff。 */
export function DiffView(): React.ReactElement | null {
  const state = React.useSyncExternalStore(subscribe, getDiffState)
  if (state === null || state.files.length === 0) {
    return React.createElement('div', { className: 'dsh-te-root dsh-te-empty' },
      React.createElement('div', { className: 'dsh-te-note' }, '未显示差异'))
  }
  const index = Math.min(Math.max(state.index, 0), state.files.length - 1)
  const file = state.files[index]!
  const label = diffFileLabel(file, index)
  const hasNext = index < state.files.length - 1
  const hasPrev = index > 0
  return React.createElement('div', { className: 'dsh-te-root' },
    React.createElement('div', { className: 'dsh-te-toolbar' },
      React.createElement('button', {
        type: 'button',
        className: 'dsh-te-diff-nav',
        title: '上一处修改（第一处时跳到上一个文件的最后一处）',
        onClick: () => { requestDiffHunkPrev() },
      }, '上一处修改'),
      React.createElement('button', {
        type: 'button',
        className: 'dsh-te-diff-nav',
        title: '下一处修改（最后一处时跳到下一个文件的第一处）',
        onClick: () => { requestDiffHunkNext() },
      }, '下一处修改'),
      React.createElement('span', { className: 'dsh-te-diff-divider' }),
      React.createElement('span', { className: 'dsh-te-path', title: label }, label),
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
        fontSize: 14,
        lineNumbers: 'on',
        minimap: { enabled: false },
        readOnly: true,
        scrollBeyondLastLine: false,
        renderSideBySide: true,
        enableSplitViewResizing: true,
        // 只隐藏两侧文件的竖直滚动条；横向滚动条保留；diff 位置条（共享 overview ruler）保留。
        scrollbar: { vertical: 'hidden' },
        renderOverviewRuler: true,
        // 不框全角标点（（），等被判定为「易混淆字符」）；零宽字符继续框。
        unicodeHighlight: { ambiguousCharacters: false, invisibleCharacters: true },
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
    // 跨文件跳转（上一处/下一处修改 越过文件边界）时，等本文件的 diff 计算完成后
    // 定位到第一处/最后一处修改——意图由 controller.hunkJump 在切文件前写入。
    let revealDisp: { dispose(): void } | null = null
    const applyReveal = (): void => {
      revealDisp?.dispose()
      revealDisp = null
      const intent = consumePendingDiffReveal()
      if (intent === null) return
      const changes = editor.getLineChanges()
      if (changes === null || changes.length === 0) return
      const target = intent === 'first' ? changes[0]! : changes[changes.length - 1]!
      const m = editor.getModifiedEditor()
      m.setPosition({ lineNumber: target.modifiedStartLineNumber, column: 1 })
      m.revealLineInCenter(target.modifiedStartLineNumber)
    }
    revealDisp = editor.onDidUpdateDiff(applyReveal)
    // 同步兜底：极小 diff 可能在订阅建立前就已同步计算完成（onDidUpdateDiff 不会再触发）。
    if (editor.getLineChanges() !== null) applyReveal()
    return () => { revealDisp?.dispose() }
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
