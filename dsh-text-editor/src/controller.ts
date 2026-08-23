/**
 * 编排层：会话作用域的标签注册 + 打开 / 读取 / 保存 / 关闭 + 差异视图生命周期。
 *
 * 组件（ui.ts）通过 commands.ts 触发这里的动作；本模块反过来 import ui.ts 的
 * TabLabel / FileView / DiffTabLabel / DiffView 完成标签注册——单向依赖，
 * 不构成环（controller → ui → commands / state / monaco）。
 *
 * 会话作用域：本模块订阅 sessions 服务的 currentProvideInfo 观察「当前活动会话」，
 * 并只按「当前活动会话」的打开文件注册 conversation.view 标签（reconcile）。
 * 于是切换会话时编辑器 tab 随之消失、切回时重新出现；每个会话各自保留自己的
 * 打开文件（最多 MAX_EDITOR_TABS 个）。
 */
import * as React from 'react'
import type { ShowDiffRequest } from './api.ts'
import {
  MAX_EDITOR_TABS,
  clearDiff,
  closeFileInSession,
  filesOf,
  getActiveFiles,
  getActiveIndex,
  getActiveSessionId,
  getDiffState,
  getFileAt,
  getFileByKey,
  getFileIndexByKey,
  openFileInSession,
  setActiveSessionId,
  setDiffStateForSession,
  subscribe,
  updateFileByKey,
} from './state.ts'
import { READ_ROUTE, WRITE_ROUTE } from './routes.ts'
import type { ReadResult, WriteResult } from './routes.ts'
import { getActiveEditor, getActiveFileKey } from './monaco.ts'
import { basename } from './path.ts'
import {
  setCloseHandler,
  setDiffCloseHandler,
  setDiffNextHandler,
  setDiffPrevHandler,
  setSaveHandler,
} from './commands.ts'
import { DiffTabLabel, DiffView, FileView, TabLabel } from './ui.ts'

const FILE_TAB_PREFIX = 'dsh-text-editor-'
const DIFF_TAB_ID = 'dsh-text-editor-diff'

/** slots 服务的最小面。 */
export interface SlotsFace {
  inject(key: string, callback: () => unknown): () => void
  register(options: Record<string, unknown>, component: unknown): () => void
}

/** sessions 服务的最小面（只用到 currentProvideInfo 观察当前活动会话）。 */
export interface SessionsFace {
  currentProvideInfo?: {
    getSnapshot(): unknown
    subscribe(fn: () => void): () => void
  }
}

let slotsRef: SlotsFace | null | undefined = null
let fileEntryDisposers: (() => void)[] = []
let diffEntryDisposer: (() => void) | null = null
let lastSig = ''
/** 每个文件 key 的读取序号（防过期响应覆盖同路径重开后的新状态）。 */
const loadSeqByKey = new Map<string, number>()

/**
 * 由入口 apply 调用：注入 slots 依赖、观察当前活动会话、注册命令处理函数。
 * @returns 清理函数（入口的 ctx.effect 析构时调用）。
 */
export function bind(slots: SlotsFace, sessions: SessionsFace | undefined): () => void {
  slotsRef = slots
  setSaveHandler((key?: string) => {
    const sid = getActiveSessionId()
    if (sid === undefined) return
    void saveFile(sid, key)
  })
  setCloseHandler(closeEditor)
  setDiffNextHandler(() => advanceDiff(1))
  setDiffPrevHandler(() => advanceDiff(-1))
  setDiffCloseHandler(closeDiff)

  // Ctrl/Cmd+S 保存当前打开的文件（本会话有打开文件时才拦截，避免弹出浏览器保存对话框）。
  const onKeyDown = (event: KeyboardEvent): void => {
    if (!(event.ctrlKey || event.metaKey)) return
    if (event.key.toLowerCase() !== 's') return
    if (getActiveIndex() < 0) return
    event.preventDefault()
    const sid = getActiveSessionId()
    if (sid === undefined) return
    // 只有正在查看某个文件（编辑器已挂载）时才真正保存；否则只是拦截。
    if (getActiveEditor() !== null) void saveFile(sid, undefined)
  }
  window.addEventListener('keydown', onKeyDown, true)

  // 观察当前活动会话：切会话时 activeSessionId 变化 → store emit → reconcile 重建标签。
  let unsubSessions: (() => void) | undefined
  if (sessions !== undefined && sessions.currentProvideInfo !== undefined) {
    const syncActiveSession = (): void => {
      const snap = sessions!.currentProvideInfo!.getSnapshot() as { sessionId?: string } | null | undefined
      setActiveSessionId(snap === null || snap === undefined ? undefined : snap.sessionId)
    }
    unsubSessions = sessions.currentProvideInfo.subscribe(syncActiveSession)
    syncActiveSession()
  }

  // 仅当「注册相关」状态变化（活动会话 / 文件列表 / 差异有无）才重建标签，
  // 避免内容/脏标记等高频变化导致标签反复重挂载。
  const unsubStore = subscribe(() => {
    const sig = registrationSignature()
    if (sig === lastSig) return
    lastSig = sig
    reconcile()
  })

  return () => {
    window.removeEventListener('keydown', onKeyDown, true)
    unsubSessions?.()
    unsubStore()
    setSaveHandler(null)
    setCloseHandler(null)
    setDiffNextHandler(null)
    setDiffPrevHandler(null)
    setDiffCloseHandler(null)
    disposeAllEntries()
    slotsRef = null
  }
}

/** 决定是否重建标签的签名：活动会话 id + 文件 key 列表 + 差异有无。 */
function registrationSignature(): string {
  const sid = getActiveSessionId() ?? ''
  const files = getActiveFiles()
  const diff = getDiffState()
  const fileSig = files.map((f) => f.key).join('|')
  const diffSig = diff !== null && diff.files.length > 0 ? '1' : '0'
  return `${sid}::${fileSig}::${diffSig}`
}

function disposeAllEntries(): void {
  for (const d of fileEntryDisposers) d()
  fileEntryDisposers = []
  if (diffEntryDisposer !== null) {
    diffEntryDisposer()
    diffEntryDisposer = null
  }
}

/**
 * 依据当前活动会话的打开文件与差异，重建 conversation.view 注册。
 * 先全部注销再按当前活动会话重注册：同一时刻只会有「当前会话」的标签存在。
 */
function reconcile(): void {
  if (slotsRef === null || slotsRef === undefined) return
  disposeAllEntries()
  const sid = getActiveSessionId()
  if (sid === undefined) return
  const files = getActiveFiles()
  files.forEach((file, index) => {
    const id = FILE_TAB_PREFIX + file.key
    fileEntryDisposers.push(slotsRef!.register({
      name: 'conversation.view',
      id,
      order: 100 + index,
      // label/body 都捕获 sid 与 key：标签按文件显示 basename（含脏标记）与 ×。
      label: () => React.createElement(TabLabel, { sessionId: sid, fileKey: file.key }),
    }, () => React.createElement(FileView, { sessionId: sid, fileKey: file.key })))
  })
  const diff = getDiffState()
  if (diff !== null && diff.files.length > 0) {
    diffEntryDisposer = slotsRef.register({
      name: 'conversation.view',
      id: DIFF_TAB_ID,
      order: 200,
      label: () => React.createElement(DiffTabLabel, null),
    }, () => React.createElement(DiffView, null))
  }
}

/**
 * 把一个文件载入当前/指定会话的编辑器 tab 并切过去（能力 1 的内核）。
 * 打开的会话即传入的 sessionId（缺省为当前活动会话）。
 */
export function openInEditor(path: string, cwd: string, sessionId: string | undefined): void {
  const sid = sessionId ?? getActiveSessionId()
  if (sid === undefined) return
  const result = openFileInSession(sid, path, cwd, sessionId)
  if (!result.ok) {
    if (result.reason === 'limit') {
      // 满 5 且全部有未保存修改：拒绝并在当前活动 tab 上提示。
      const index = getActiveIndex()
      const file = getFileAt(index)
      if (file !== null) {
        updateFileByKey(sid, file.key, {
          notice: `最多同时打开 ${MAX_EDITOR_TABS} 个文件，且当前打开的文件均有未保存修改`,
        })
      }
    }
    return
  }
  const isActive = sid === getActiveSessionId()
  if (!result.alreadyOpen) loadFile(sid, result.key)
  if (isActive) activateTab(result.key)
}

/** 在「差异」tab 展示一组文件的 diff 并切过去（能力 2 的内核）。 */
export function showDiffInTab(request: ShowDiffRequest): void {
  const sid = request.sessionId ?? getActiveSessionId()
  if (sid === undefined) return
  const count = request.files.length
  // 初始展示的下标：由调用方 initialIndex 指定（0 起）；越界/缺省时回落 0（第一个文件）。
  const initial = count > 0
    ? Math.min(Math.max(request.initialIndex ?? 0, 0), count - 1)
    : 0
  setDiffStateForSession(sid, { files: request.files, index: initial, sessionId: sid })
  if (sid === getActiveSessionId()) activateDiffTab()
}

/** 差异视图内推进（clamp 到 [0, files.length-1]）。 */
function advanceDiff(delta: number): void {
  const state = getDiffState()
  if (state === null || state.files.length === 0) return
  const sid = state.sessionId
  if (sid === undefined) return
  const index = Math.min(Math.max(state.index + delta, 0), state.files.length - 1)
  setDiffStateForSession(sid, { ...state, index })
}

/** 从宿主路由读取文件内容并发布到 store（按 key 定位，防过期覆盖）。 */
function loadFile(sessionId: string, key: string): void {
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

/** 保存当前挂载编辑器对应的文件内容回宿主（走会话沙箱策略）。 */
async function saveFile(sessionId: string | undefined, key: string | undefined): Promise<void> {
  if (sessionId === undefined) return
  const editor = getActiveEditor()
  if (editor === null) return
  // 内容来自当前挂载的编辑器 → 以挂载的 file key 为准（避免陈旧活动索引存错文件）。
  const targetKey = getActiveFileKey() ?? key
  if (targetKey === undefined) return
  const file = getFileByKey(sessionId, targetKey)
  if (file === null) return
  const content = editor.getValue()
  updateFileByKey(sessionId, targetKey, { saving: true, error: null, notice: null })
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
    updateFileByKey(sessionId, targetKey, {
      saving: false,
      notice: '已保存',
      error: null,
      dirty: false,
      content,
    })
  } catch (error) {
    updateFileByKey(sessionId, targetKey, {
      saving: false,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * 关闭一个文件 tab（key 缺省为当前正在查看的文件）。标签注销由 store 订阅的
 * reconcile 完成；若关掉的是正在查看的 tab，视图回落到「对话」。
 */
export function closeEditor(key?: string): void {
  const sid = getActiveSessionId()
  if (sid === undefined) return
  const files = filesOf(sid)
  let index = -1
  if (key !== undefined) index = getFileIndexByKey(sid, key)
  else index = getActiveIndex()
  if (index === -1 || index >= files.length) return
  const wasActive = closeFileInSession(sid, index)
  if (wasActive) fallbackToChat()
}

/** 关闭差异视图：清除当前会话的差异并回到「对话」视图。 */
export function closeDiff(): void {
  const sid = getActiveSessionId()
  if (sid !== undefined) clearDiff(sid)
  fallbackToChat()
}

/** 标签消失后会话体回落到 Chat；点一下当前选中的标签把 store.view 写回 chat。 */
function fallbackToChat(): void {
  let attempts = 0
  const tryClick = (): void => {
    const tab = document.querySelector('[role="tablist"] [role="tab"][aria-selected="true"]')
    if (tab instanceof HTMLElement) { tab.click(); return }
    if (++attempts < 20) setTimeout(tryClick, 30)
  }
  tryClick()
}

/** 等标签栏重渲染后激活指定文件的「文件」标签（通过 data-dsh-te-key 定位）。 */
function activateTab(key: string): void {
  let attempts = 0
  const tryClick = (): void => {
    const label = document.querySelector(`[data-dsh-te-key="${key}"]`)
    const tab = label instanceof HTMLElement ? label.closest('[role="tab"]') : null
    if (tab instanceof HTMLElement) { tab.click(); return }
    if (++attempts < 40) setTimeout(tryClick, 25)
  }
  tryClick()
}

/** 等标签栏重渲染后激活「差异」标签。 */
function activateDiffTab(): void {
  let attempts = 0
  const tryClick = (): void => {
    const label = document.querySelector('.dsh-te-diff-tab-label')
    const tab = label instanceof HTMLElement ? label.closest('[role="tab"]') : null
    if (tab instanceof HTMLElement) { tab.click(); return }
    if (++attempts < 40) setTimeout(tryClick, 25)
  }
  tryClick()
}
