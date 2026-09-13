/**
 * 编排层（只剩「差异」tab）：会话作用域的 conversation.view 注册 + 差异视图生命周期。
 *
 * 文件面（可编辑 Monaco）不再注册到会话主区，而是注册为右栏的资源 tab 类型，
 * 见 sidebar.ts。这里保留：
 *
 *   - `bind(slots, sessions)`：订阅 sessions.list 观察「当前活动会话」（差异视图
 *     按会话保存），注册差异命令处理函数与全局 Ctrl/Cmd+S；
 *   - showDiffInTab：能力 2 的内核（写差异状态 + 切到「差异」标签）；
 *   - advanceDiff / hunkJump / closeDiff：差异视图内的推进与关闭。
 *
 * 组件（ui.ts）通过 commands.ts 触发这里的动作；本模块反过来 import ui.ts 的
 * DiffTabLabel / DiffView 完成标签注册——单向依赖，不构成环。
 */
import * as React from 'react'
import type { ShowDiffRequest } from './api.ts'
import { clearDiff, getActiveSessionId, getDiffState, setActiveSessionId, setDiffStateForSession, subscribe } from './state.ts'
import { getActiveDiffEditor, setPendingDiffReveal } from './monaco.ts'
import { getMountedEditor, saveMountedEditor } from './file-io.ts'
import type { SessionsFace, SlotsFace } from './faces.ts'
import {
  setDiffCloseHandler,
  setDiffHunkNextHandler,
  setDiffHunkPrevHandler,
  setDiffNextHandler,
  setDiffPrevHandler,
} from './commands.ts'
import { DiffTabLabel, DiffView } from './ui.ts'

const DIFF_TAB_ID = 'dsh-text-editor-diff'

let slotsRef: SlotsFace | null | undefined = null
let diffEntryDisposer: (() => void) | null = null
let lastSig = ''

/**
 * 由入口 apply 调用：观察当前活动会话、注册差异命令处理函数。
 * @returns 清理函数（入口的 ctx.effect 析构时调用）。
 */
export function bind(slots: SlotsFace, sessions: SessionsFace | undefined): () => void {
  slotsRef = slots
  setDiffNextHandler(() => advanceDiff(1))
  setDiffPrevHandler(() => advanceDiff(-1))
  setDiffCloseHandler(closeDiff)
  setDiffHunkNextHandler(() => hunkJump(1))
  setDiffHunkPrevHandler(() => hunkJump(-1))

  // Ctrl/Cmd+S 保存右栏编辑器里当前挂载的文件（有挂载实例时才拦截，避免弹出浏览器保存对话框）。
  const onKeyDown = (event: KeyboardEvent): void => {
    if (!(event.ctrlKey || event.metaKey)) return
    if (event.key.toLowerCase() !== 's') return
    if (getMountedEditor() === null) return
    event.preventDefault()
    void saveMountedEditor(getActiveSessionId())
  }
  window.addEventListener('keydown', onKeyDown, true)

  // 观察当前活动会话：切会话时 activeSessionId 变化 → store emit → reconcile 重建标签。
  // sessions.list 是当前版本 sessions 服务的快照 store：getSnapshot().current 即当前
  // 会话 id（旧版的 currentProvideInfo 观察面已随 dsh 升级移除，勿再引用）。
  let unsubSessions: (() => void) | undefined
  if (sessions !== undefined && sessions.list !== undefined) {
    const syncActiveSession = (): void => {
      const snap = sessions!.list!.getSnapshot() as { current?: string } | null | undefined
      setActiveSessionId(snap === null || snap === undefined ? undefined : snap.current)
    }
    unsubSessions = sessions.list.subscribe(syncActiveSession)
    syncActiveSession()
  }

  // 仅当「注册相关」状态变化（活动会话 / 差异有无）才重建标签。
  const unsubStore = subscribe(() => {
    const sig = registrationSignature()
    if (sig === lastSig) return
    lastSig = sig
    reconcile()
  })
  reconcile()

  return () => {
    window.removeEventListener('keydown', onKeyDown, true)
    unsubSessions?.()
    unsubStore()
    setDiffNextHandler(null)
    setDiffPrevHandler(null)
    setDiffCloseHandler(null)
    setDiffHunkNextHandler(null)
    setDiffHunkPrevHandler(null)
    disposeDiffEntry()
    slotsRef = null
  }
}

/** 决定是否重建标签的签名：活动会话 id + 差异有无。 */
function registrationSignature(): string {
  const sid = getActiveSessionId() ?? ''
  const diff = getDiffState()
  const diffSig = diff !== null && diff.files.length > 0 ? '1' : '0'
  return `${sid}::${diffSig}`
}

function disposeDiffEntry(): void {
  if (diffEntryDisposer !== null) {
    diffEntryDisposer()
    diffEntryDisposer = null
  }
}

/**
 * 依据当前活动会话的差异状态重建 conversation.view 注册（同一时刻只保留
 * 「当前会话」的差异标签）。文件面已移到右栏，不再走这里。
 */
function reconcile(): void {
  if (slotsRef === null || slotsRef === undefined) return
  disposeDiffEntry()
  const sid = getActiveSessionId()
  if (sid === undefined) return
  const diff = getDiffState()
  if (diff === null || diff.files.length === 0) return
  diffEntryDisposer = slotsRef.register({
    name: 'conversation.view',
    id: DIFF_TAB_ID,
    order: 200,
    label: () => React.createElement(DiffTabLabel, null),
  }, () => React.createElement(DiffView, null))
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
  // 新差异视图：丢弃任何残留的跨文件定位意图。
  setPendingDiffReveal(null)
  if (sid === getActiveSessionId()) activateDiffTab()
}

/**
 * 差异视图内推进文件（clamp 到 [0, files.length-1]）。
 * reveal 只在「上一处/下一处修改」跨文件时传入：切到新文件后由 DiffHost 定位到
 * 第一处（'first'）或最后一处（'last'）修改；普通文件切换/关闭会清掉旧意图。
 */
function advanceDiff(delta: number, reveal?: 'first' | 'last'): void {
  const state = getDiffState()
  if (state === null || state.files.length === 0) return
  const sid = state.sessionId
  if (sid === undefined) return
  const index = Math.min(Math.max(state.index + delta, 0), state.files.length - 1)
  if (index === state.index) {
    // 已在边界、没有切到别的文件：本次不产生定位，丢弃意图（避免残留到下次打开）。
    if (reveal !== undefined) setPendingDiffReveal(null)
    return
  }
  if (reveal !== undefined) setPendingDiffReveal(reveal)
  else setPendingDiffReveal(null)
  setDiffStateForSession(sid, { ...state, index })
}

/**
 * 在当前文件的 diff 内按「修改块」跳转：下一处/上一处修改。
 * 光标已在最后一处修改（或之后无修改）→ 切到下一个文件并定位其第一处修改；
 * 光标已在第一处修改（或之前无修改）→ 切到上一个文件并定位其最后一处修改（对称）。
 * 已在最前/最后文件、或本文件无修改、或 diff 尚未计算完成：不动。
 */
function hunkJump(dir: 1 | -1): void {
  const diff = getActiveDiffEditor()
  if (diff === null) return
  const changes = diff.getLineChanges()
  if (changes === null || changes.length === 0) return
  const modified = diff.getModifiedEditor()
  const cursorLine = modified.getPosition().lineNumber
  // 光标落在第几处修改（按 modified 侧行号区间判断；不在任何修改块内为 -1）。
  let idx = -1
  for (let i = 0; i < changes.length; i++) {
    const c = changes[i]!
    if (cursorLine >= c.modifiedStartLineNumber && cursorLine <= c.modifiedEndLineNumber) { idx = i; break }
  }
  const jumpTo = (i: number): void => {
    const c = changes[i]!
    // 先落光标再滚动到居中，保证后续「下一处/上一处」以本次跳转处为基准。
    modified.setPosition({ lineNumber: c.modifiedStartLineNumber, column: 1 })
    modified.revealLineInCenter(c.modifiedStartLineNumber)
  }
  if (dir === 1) {
    if (idx !== -1 && idx < changes.length - 1) { jumpTo(idx + 1); return }
    if (idx === -1) {
      // 光标在修改块之外：跳到光标之后的第一处修改。
      const next = changes.findIndex((c) => c.modifiedStartLineNumber > cursorLine)
      if (next !== -1) { jumpTo(next); return }
    }
    const state = getDiffState()
    if (state !== null && state.index < state.files.length - 1) advanceDiff(1, 'first')
  } else {
    if (idx > 0) { jumpTo(idx - 1); return }
    if (idx === -1) {
      // 光标在修改块之外：跳到光标之前的最后一处修改。
      let prev = -1
      for (let i = 0; i < changes.length; i++) {
        if (changes[i]!.modifiedStartLineNumber < cursorLine) prev = i
      }
      if (prev !== -1) { jumpTo(prev); return }
    }
    const state = getDiffState()
    if (state !== null && state.index > 0) advanceDiff(-1, 'last')
  }
}

/** 关闭差异视图：清除当前会话的差异并回到「对话」视图。 */
export function closeDiff(): void {
  const sid = getActiveSessionId()
  if (sid !== undefined) clearDiff(sid)
  setPendingDiffReveal(null)
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
