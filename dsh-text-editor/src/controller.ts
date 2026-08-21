/**
 * 编排层：标签生命周期 + 打开 / 读取 / 保存 / 关闭 + 差异视图生命周期。
 *
 * 组件（ui.ts）通过 commands.ts 触发这里的动作；本模块反过来 import ui.ts 的
 * TabLabel / FileView / DiffTabLabel / DiffView 完成标签注册——单向依赖，
 * 不构成环（controller → ui → commands / state / monaco）。
 *
 * 本插件只提供基础能力（openFile / showDiff），不再直接拦截文件链接点击；
 * 对外的能力面由 client.ts 用 ctx.provide('dsh-text-editor', …) 注册。
 */
import * as React from 'react'
import type { ShowDiffRequest } from './api.ts'
import { getDiffState, getState, setDiffState, setState } from './state.ts'
import { READ_ROUTE, WRITE_ROUTE } from './routes.ts'
import { getActiveEditor } from './monaco.ts'
import { basename } from './path.ts'
import {
  setCloseHandler,
  setDiffCloseHandler,
  setDiffNextHandler,
  setDiffPrevHandler,
  setSaveHandler,
} from './commands.ts'
import { DiffTabLabel, DiffView, FileView, TabLabel } from './ui.ts'
import type { FileState } from './state.ts'
import type { ReadResult, WriteResult } from './routes.ts'

const FILE_TAB_ID = 'dsh-text-editor'
const DIFF_TAB_ID = 'dsh-text-editor-diff'

/** slots 服务的最小面。 */
export interface SlotsFace {
  inject(key: string, callback: () => unknown): () => void
  register(options: Record<string, unknown>, component: unknown): () => void
}

let slotsRef: SlotsFace | null | undefined = null
let registeredDisposer: (() => void) | null = null
let diffRegisteredDisposer: (() => void) | null = null
let loadSeq = 0

/**
 * 由入口 apply 调用：注入 slots 依赖、注册命令处理函数。
 * @returns 清理函数（入口的 ctx.effect 析构时调用）。
 */
export function bind(slots: SlotsFace): () => void {
  slotsRef = slots
  setSaveHandler(() => {
    const state = getState()
    if (state !== null) void saveFile(state)
  })
  setCloseHandler(closeEditor)
  setDiffNextHandler(() => advanceDiff(1))
  setDiffPrevHandler(() => advanceDiff(-1))
  setDiffCloseHandler(closeDiff)
  // Ctrl/Cmd+S 保存当前打开的文件（有文件打开时才拦截，避免影响其他用途）。
  const onKeyDown = (event: KeyboardEvent): void => {
    if (!(event.ctrlKey || event.metaKey)) return
    if (event.key.toLowerCase() !== 's') return
    const state = getState()
    if (state === null) return
    event.preventDefault()
    void saveFile(state)
  }
  window.addEventListener('keydown', onKeyDown, true)
  return () => {
    window.removeEventListener('keydown', onKeyDown, true)
    setSaveHandler(null)
    setCloseHandler(null)
    setDiffNextHandler(null)
    setDiffPrevHandler(null)
    setDiffCloseHandler(null)
    slotsRef = null
  }
}

/** 注册「文件」conversation.view 条目（尚未注册时）。 */
function ensureTab(): void {
  if (registeredDisposer !== null || slotsRef === null || slotsRef === undefined) return
  registeredDisposer = slotsRef.register({
    name: 'conversation.view',
    id: FILE_TAB_ID,
    order: 100,
    // label 返回 React 元素（DSH 的 resolveSlotLabel 运行时不限类型，返回值
    // 直接作为标签按钮的 children）。内容由 TabLabel 组件渲染：显示被打开
    // 文件的 basename（而非固定「文件」），并带 × 关闭按钮。
    label: () => React.createElement(TabLabel, null),
  }, FileView)
}

/** 注册「差异」conversation.view 条目（尚未注册时；与文件 tab 并存）。 */
function ensureDiffTab(): void {
  if (diffRegisteredDisposer !== null || slotsRef === null || slotsRef === undefined) return
  diffRegisteredDisposer = slotsRef.register({
    name: 'conversation.view',
    id: DIFF_TAB_ID,
    order: 110,
    // 由 DiffTabLabel 渲染：显示「差异 · n」并带 × 关闭按钮。
    label: () => React.createElement(DiffTabLabel, null),
  }, DiffView)
}

/** 把一个文件载入编辑器标签页并切换过去（能力 1 的内核）。 */
export function openInEditor(path: string, cwd: string, sessionId: string | undefined): void {
  ensureTab()
  loadFile(path, cwd, sessionId)
  activateTab()
}

/** 在「差异」tab 展示一组文件的 diff 并切换过去（能力 2 的内核）。 */
export function showDiffInTab(request: ShowDiffRequest): void {
  ensureDiffTab()
  setDiffState({ files: request.files, index: 0, sessionId: request.sessionId })
  activateDiffTab()
}

/** 差异视图内推进（clamp 到 [0, files.length-1]）。 */
function advanceDiff(delta: number): void {
  const state = getDiffState()
  if (state === null || state.files.length === 0) return
  const index = Math.min(Math.max(state.index + delta, 0), state.files.length - 1)
  setDiffState({ ...state, index })
}

/** 从宿主路由读取文件内容并发布到 store。 */
function loadFile(path: string, cwd: string, sessionId: string | undefined): void {
  const seq = ++loadSeq
  setState({
    path, label: basename(path), content: '', loading: true, saving: false,
    binary: false, truncated: false, error: null, notice: null, cwd, sessionId,
    dirty: false,
  })
  const url = `${READ_ROUTE}?path=${encodeURIComponent(path)}`
    + (cwd ? `&cwd=${encodeURIComponent(cwd)}` : '')
  fetch(url, { credentials: 'same-origin', cache: 'no-store' })
    .then((response) => response.json() as Promise<ReadResult>)
    .then((data) => {
      if (seq !== loadSeq) return
      if (!data.ok) throw new Error(data.error || '读取失败')
      setState({
        path: data.path || path, label: basename(path), content: data.content ?? '',
        loading: false, saving: false, binary: !!data.binary, truncated: !!data.truncated,
        error: null, notice: null, cwd, sessionId, dirty: false,
      })
    })
    .catch((error: unknown) => {
      if (seq !== loadSeq) return
      setState({
        path, label: basename(path), content: '', loading: false, saving: false,
        binary: false, truncated: false,
        error: error instanceof Error ? error.message : String(error),
        notice: null, cwd, sessionId, dirty: false,
      })
    })
}

/** 保存当前编辑器内容回宿主（走会话沙箱策略）。 */
async function saveFile(state: FileState): Promise<void> {
  const editor = getActiveEditor()
  if (editor === null) return
  const content = editor.getValue()
  setState({ ...state, saving: true, error: null, notice: null })
  try {
    const response = await fetch(WRITE_ROUTE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: state.path,
        cwd: state.cwd,
        content,
        sessionId: state.sessionId ?? null,
      }),
    })
    const data = await response.json() as WriteResult
    if (!data.ok) throw new Error(data.error || '保存失败')
    const next = getState()
    if (next === null) return
    setState({ ...next, saving: false, notice: '已保存', error: null, dirty: false })
  } catch (error) {
    const next = getState()
    if (next === null) return
    setState({
      ...next, saving: false,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/** 关闭编辑器：移除标签页并回到「对话」视图。 */
export function closeEditor(): void {
  if (registeredDisposer !== null) {
    registeredDisposer()
    registeredDisposer = null
  }
  setState(null)
  fallbackToChat()
}

/** 关闭差异视图：移除标签页并回到「对话」视图。 */
export function closeDiff(): void {
  if (diffRegisteredDisposer !== null) {
    diffRegisteredDisposer()
    diffRegisteredDisposer = null
  }
  setDiffState(null)
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

/** 等标签栏重渲染后激活「文件」标签。 */
function activateTab(): void {
  let attempts = 0
  const tryClick = (): void => {
    // 通过我们自己注入的文字 span 定位（标签里含 ×，不能用 textContent 精确匹配）。
    const label = document.querySelector('.dsh-te-tab-label')
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
