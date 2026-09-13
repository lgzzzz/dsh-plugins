/**
 * 右栏编辑器：本插件的文件面所在。
 *
 * 组成（全部走服务，不碰 DOM 查询）：
 *
 *   1. **tab 类型**：`ctx.sidebarRightTabs.register({ id, kind, patterns:
 *      ['dsh-resource://file/**'], canOpen, title })`。不声明 `priority`，
 *      即上游最高档 `extension`——于是右栏文件树的每一行、以及对话区里的文件
 *      链接（都由上游调 `ctx.sidebarRight.openResource(address)` 落到右栏）
 *      都路由到本编辑器；图片 / PDF 由 `canOpen` 否决，继续交给内置预览器。
 *   2. **pane 正文**：以类型 id 为 key 注册到 keyed slot `sidebar.right.pane.tab`，
 *      经框架注入的 `useTabInfo()` 读 `tab.contentId`（地址）与
 *      `tab.navigation.params.line`；正文渲染一个可编辑、可保存的 Monaco 实例。
 *   3. **chip 标题**：同一 id 注册到 `sidebar.right.pane.tab.title`，显示文件名与
 *      未保存标记（●）。
 *
 * 文件内容状态住在 state.ts（按 会话 + path 哈希分条），因此右栏里切换 tab 再
 * 切回来仍保留未保存的修改：正文卸载时 commitFileContent 回写内容，tab 关闭时
 * tab 的 AbortSignal 中止 → forgetFile 丢弃该条状态。
 */
import * as React from 'react'
import { basename, languageFor } from './path.ts'
import { isTextFile, parseSessionFileAddress } from './address.ts'
import type { SlotsFace, SidebarRightTabsFace } from './faces.ts'
import {
  getMountedEditor,
  getMountedEditorKey,
  loadFile,
  saveFile,
  setMountedEditor,
} from './file-io.ts'
import {
  commitFileContent,
  ensureFile,
  forgetFile,
  getFileByKey,
  hashKey,
  subscribe,
  updateFileByKey,
} from './state.ts'
import { currentTheme, ensureMonaco, setActiveMonaco } from './monaco.ts'
import type { MonacoEditor, MonacoEditorInstance } from './monaco.ts'

/** 本类型在右栏 tab 系统里的唯一身份（也是正文 / 标题注册所用的 key）。 */
export const SIDEBAR_TAB_ID = 'dsh-text-editor/editor'
/** 本类型的 kind（右栏以 kind 记录 tab；与内置 `text` / `files` 等互不冲突）。 */
export const SIDEBAR_TAB_KIND = 'dsh-text-editor'
/** 认领的地址 glob：含 `:` 即整串匹配（`dsh-resource://file/**`）。 */
const FILE_ADDRESS_PATTERN = 'dsh-resource://file/**'

// ── 框架注入的 props（结构切片） ─────────────────────────────────────────────

interface TabNavigation {
  revision?: number
  params?: { line?: number }
}

interface TabRecord {
  id?: string
  kind?: string
  contentId?: string
  title?: string
  navigation?: TabNavigation
  signal?: AbortSignal
}

interface TabInfo {
  tab?: TabRecord
}

interface SessionsSnapshot {
  byId?: Record<string, { cwd?: string } | undefined>
}

interface PaneProps {
  /** 框架按 slot 声明的 hooks 注入：`useTabInfo()` → `{ sidebar, panel, tab }`。 */
  useTabInfo?: () => TabInfo
  /** 框架会话作用域标准注入：读 sessions 快照（用于取会话工作区根 cwd）。 */
  useSessions?: <T>(selector: (snapshot: SessionsSnapshot) => T) => T
  sessionId?: string
}

/** `useSessions` 缺席时的占位（保持 hook 调用次数恒定）。 */
function noSessions<T>(_selector: (snapshot: SessionsSnapshot) => T): T | undefined {
  return undefined
}

/**
 * tab 关闭（pane 的 AbortSignal 中止）时丢弃该文件的状态；切换 tab 只是卸载正文，
 * 不中止信号，因此未保存修改会连同 state.ts 里的条目一起保留。
 *
 * 正文与 chip 标题都挂这个监听：非活动 tab 的正文是卸载的，而 chip 标题在标签条里
 * 始终渲染，于是关闭任何 tab 都能及时清理。
 */
function useForgetOnTabClose(signal: AbortSignal | undefined, sessionId: string, key: string): void {
  React.useEffect(() => {
    if (signal === undefined || sessionId === '' || key === '') return
    const forget = (): void => { forgetFile(sessionId, key) }
    signal.addEventListener('abort', forget)
    return () => { signal.removeEventListener('abort', forget) }
  }, [signal, sessionId, key])
}

/**
 * 注册右栏编辑器类型、正文与标题。
 * @param slots - slots 服务。
 * @param tabs - 右栏 tab 类型注册表。
 * @returns 注销函数（三个注册全部释放）。
 */
export function registerSidebarEditor(slots: SlotsFace, tabs: SidebarRightTabsFace): () => void {
  const definition = {
    id: SIDEBAR_TAB_ID,
    kind: SIDEBAR_TAB_KIND,
    patterns: [FILE_ADDRESS_PATTERN],
    // 只接管文本类文件地址；图片 / PDF 交回内置预览器（documentpreview 的 builtin 渲染器）。
    canOpen: (address: string): boolean => {
      const ref = parseSessionFileAddress(address)
      return ref !== undefined && ref.path !== '' && isTextFile(ref.path)
    },
    // 标签文案在打开时捕获；未保存标记由下面的 chip 标题实时补上。
    title: (address: string): string => {
      const ref = parseSessionFileAddress(address)
      return ref === undefined || ref.path === '' ? '编辑器' : basename(ref.path)
    },
  }
  const disposeType = tabs.register(definition)
  const disposeBody = slots.inject('sidebar.right.pane.tab', () => slots.register({
    name: 'sidebar.right.pane.tab',
    key: SIDEBAR_TAB_ID,
  }, EditorPane))
  const disposeTitle = slots.inject('sidebar.right.pane.tab.title', () => slots.register({
    name: 'sidebar.right.pane.tab.title',
    key: SIDEBAR_TAB_ID,
  }, EditorChip))
  return () => {
    disposeTitle()
    disposeBody()
    disposeType()
  }
}

// ── 视图 ─────────────────────────────────────────────────────────────────────

function note(text: string): React.ReactElement {
  return React.createElement('div', { className: 'dsh-te-pane' },
    React.createElement('div', { className: 'dsh-te-root dsh-te-empty' },
      React.createElement('div', { className: 'dsh-te-note' }, text)))
}

/** 右栏 pane 正文入口：拿到框架 hook 后交给正文组件（不在条件分支里调 hook）。 */
function EditorPane(props: PaneProps): React.ReactElement {
  const useTabInfo = props.useTabInfo
  if (typeof useTabInfo !== 'function') return note('编辑器不可用：缺少 tab 信息')
  return React.createElement(EditorPaneBody, { ...props, useTabInfo })
}

function EditorPaneBody(props: PaneProps & { useTabInfo: () => TabInfo }): React.ReactElement {
  const useSessions = props.useSessions ?? noSessions
  const info = props.useTabInfo()
  const tab = info.tab ?? {}
  const ref = parseSessionFileAddress(tab.contentId ?? '')
  const sessionId = ref !== undefined ? ref.sessionId : (props.sessionId ?? '')
  const path = ref !== undefined ? ref.path : ''
  const key = path === '' ? '' : hashKey(path)
  // 相对路径按会话工作区根解析；绝对路径用不到 cwd（宿主直接解析绝对路径）。
  const cwd = useSessions((snapshot) => snapshot.byId?.[sessionId]?.cwd) ?? ''
  const state = React.useSyncExternalStore(subscribe, () => getFileByKey(sessionId, key))

  // 确保 store 有条目：新建（首次打开）、上次读取未完成、或 cwd 迟到后需要重解析时，
  // 发起一次读取。sessions 快照可能晚于正文挂载一帧，此时相对路径会先按无 cwd 解析失败。
  React.useEffect(() => {
    if (sessionId === '' || path === '' || key === '') return
    const entry = ensureFile(sessionId, path, cwd)
    if (entry.created || entry.file.loading) {
      loadFile(sessionId, entry.key)
      return
    }
    if (entry.file.cwd !== cwd && entry.file.error !== null && !entry.file.dirty) {
      updateFileByKey(sessionId, entry.key, { cwd, loading: true, error: null, notice: null })
      loadFile(sessionId, entry.key)
    }
  }, [sessionId, path, key, cwd])

  // tab 关闭（AbortSignal 中止）→ 丢弃该文件的状态；切 tab 只是卸载，不中止。
  useForgetOnTabClose(tab.signal, sessionId, key)

  if (ref === undefined || path === '') return note('无法识别的文件地址')
  if (state === null) return note('加载中…')

  const statusText = state.loading
    ? '加载中…'
    : state.saving
      ? '保存中…'
      : state.error !== null
        ? state.error
        : state.notice
  const navigation = tab.navigation
  return React.createElement('div', { className: 'dsh-te-pane' },
    React.createElement('div', { className: 'dsh-te-root' },
      React.createElement('div', { className: 'dsh-te-toolbar' },
        React.createElement('span', { className: 'dsh-te-path', title: state.path }, state.path),
        React.createElement('button', {
          type: 'button',
          className: state.dirty ? 'dsh-te-save dsh-te-save-dirty' : 'dsh-te-save',
          title: '保存 (Ctrl+S)',
          disabled: state.loading || state.error !== null,
          onClick: () => { requestSave(sessionId, key) },
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
              ? '该文件是二进制文件，无法以文本方式编辑。'
              : `无法读取文件：${state.error}`)
          : React.createElement(EditorHost, {
            sessionId,
            fileKey: key,
            path: state.path,
            content: state.content,
            line: navigation?.params?.line,
            revision: navigation?.revision,
          }),
        state.error !== null && !state.binary
          ? React.createElement('div', { className: 'dsh-te-actions' },
            React.createElement('button', {
              type: 'button',
              className: 'dsh-te-save',
              onClick: () => { reload(sessionId, key) },
            }, '重试'))
          : null,
        state.truncated
          ? React.createElement('div', { className: 'dsh-te-note' }, '文件较大，仅显示前 2MB。')
          : null,
      ),
    ),
  )
}

/** chip 标题入口（同 EditorPane：先判 hook 再交给正文组件）。 */
function EditorChip(props: PaneProps): React.ReactElement | null {
  const useTabInfo = props.useTabInfo
  if (typeof useTabInfo !== 'function') return null
  return React.createElement(EditorChipBody, { useTabInfo })
}

function EditorChipBody({ useTabInfo }: { useTabInfo: () => TabInfo }): React.ReactElement {
  const info = useTabInfo()
  const ref = parseSessionFileAddress(info.tab?.contentId ?? '')
  const key = ref === undefined ? '' : hashKey(ref.path)
  // chip 在标签条里始终渲染（含非活动 tab）→ 关闭非活动 tab 也能在这里清理状态。
  useForgetOnTabClose(info.tab?.signal, ref?.sessionId ?? '', key)
  const state = React.useSyncExternalStore(subscribe, () => getFileByKey(ref?.sessionId, key))
  const label = state !== null && state.label !== '' ? state.label : (ref !== undefined ? basename(ref.path) : '编辑器')
  const dirty = state !== null && state.dirty
  return React.createElement('span', {
    className: dirty ? 'dsh-te-chip dsh-te-chip-dirty' : 'dsh-te-chip',
  }, dirty ? `${label} ●` : label)
}

/** 保存当前挂载的编辑器（工具栏「保存」按钮）。 */
function requestSave(sessionId: string, key: string): void {
  const editor = getMountedEditorKey() === key ? getMountedEditor() : null
  if (editor === null) return
  void saveFile(sessionId, key, editor)
}

/** 重新从宿主读取（错误态下的「重试」）。 */
function reload(sessionId: string, key: string): void {
  updateFileByKey(sessionId, key, { loading: true, error: null, notice: null })
  loadFile(sessionId, key)
}

/** 承载 Monaco 实例的容器：懒加载 Monaco，随内容/路径更新；卸载时回写内容并释放。 */
function EditorHost({
  sessionId, fileKey, path, content, line, revision,
}: {
  sessionId: string
  fileKey: string
  path: string
  content: string
  line: number | undefined
  revision: number | undefined
}): React.ReactElement {
  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const editorRef = React.useRef<MonacoEditorInstance | null>(null)
  const monacoRef = React.useRef<MonacoEditor | null>(null)
  const [ready, setReady] = React.useState(false)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  // 程序化 setValue（换文件/重载）会触发 content change 事件，用该标志忽略，
  // 避免把「刚加载的文件」误标为未保存。
  const suppressChangeRef = React.useRef(false)
  /** 已响应的导航 revision（同一个 revision 只定位一次）。 */
  const revealedRef = React.useRef<number | undefined>(undefined)

  React.useEffect(() => {
    let cancelled = false
    let changeSub: { dispose(): void } | null = null
    void ensureMonaco().then((monaco) => {
      if (cancelled || containerRef.current === null) return
      monacoRef.current = monaco
      setActiveMonaco(monaco)
      const editor = monaco.editor.create(containerRef.current, {
        value: content,
        language: languageFor(path),
        theme: currentTheme(),
        automaticLayout: true,
        fontSize: 14,
        lineNumbers: 'on',
        minimap: { enabled: false },
        readOnly: false,
        scrollBeyondLastLine: false,
        wordWrap: 'off',
        tabSize: 2,
        // 不框全角标点（（），等被判定为「易混淆字符」）；零宽字符继续框。
        unicodeHighlight: { ambiguousCharacters: false, invisibleCharacters: true },
      })
      editorRef.current = editor
      setMountedEditor(fileKey, editor)
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
      const editor = editorRef.current
      editorRef.current = null
      if (editor !== null) {
        // 卸载前把当前编辑内容回写 store（切 tab 时保留未保存修改）。
        commitFileContent(sessionId, fileKey, editor.getValue())
        editor.dispose()
      }
      if (getMountedEditorKey() === fileKey) setMountedEditor(null, null)
      monacoRef.current = null
    }
    // 挂载时创建一次；内容/路径变化走下面的更新 effect。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 新内容（加载/重载）到达时更新编辑器内容与语言。
  React.useEffect(() => {
    if (!ready) return
    const editor = editorRef.current
    if (editor === null) return
    if (editor.getValue() !== content) {
      suppressChangeRef.current = true
      editor.setValue(content)
      suppressChangeRef.current = false
      // 程序化重载后视为已保存状态。
      const s = getFileByKey(sessionId, fileKey)
      if (s !== null && s.dirty) updateFileByKey(sessionId, fileKey, { dirty: false })
    }
    const monaco = monacoRef.current
    if (monaco !== null) {
      const model = editor.getModel()
      if (model !== null && model !== undefined) monaco.editor.setModelLanguage(model, languageFor(path))
    }
  }, [content, path, ready, sessionId, fileKey])

  // 对话里的文件链接 / 带行号的导航：每个 revision 定位一次（Monaco 会自行 clamp 越界行号）。
  React.useEffect(() => {
    if (!ready || line === undefined) return
    if (revealedRef.current === revision) return
    revealedRef.current = revision
    const editor = editorRef.current
    if (editor === null) return
    editor.setPosition({ lineNumber: line, column: 1 })
    editor.revealLineInCenter(line)
  }, [ready, line, revision])

  if (loadError !== null) {
    return React.createElement('div', { className: 'dsh-te-note' },
      `Monaco 加载失败：${loadError}`)
  }
  return React.createElement('div', { className: 'dsh-te-monaco' },
    React.createElement('div', { ref: containerRef, className: 'dsh-te-monaco-host' }),
    !ready ? React.createElement('div', { className: 'dsh-te-note' }, '加载 Monaco 编辑器…') : null,
  )
}
