/**
 * dsh-kbd-hotkeys — 动作实现层。
 *
 * 源码事实依据(以 <dsh>/node_modules/@deepseek-ai 各包 lib/client.js 为准,见
 * docs/dsh-hotkeys-proposal.md 第 5 节核实清单):
 * - 审批面板:[data-approval-key] 卡片,actionRow 两个按钮(拒绝在前、允许在后);
 *   服务级路径:uiSession.pendingSnapshot(sessionId → interaction,kind==='approval',
 *   answer('allowed-once' | 'rejected'));
 * - 问答卡片:[data-question-key],选项为 [data-question-scroll] 内
 *   role=radio/checkbox 的按钮;提交为主按钮(卡片内不在滚动区的最后一个按钮);
 *   计划评审:[data-plan-review-key],不在滚动区的按钮依次为 确认/拒绝/去聊;
 * - 对话滚动容器:[data-conversation-scroll];
 * - 输入框(Lexical 可编辑):[data-composer-input];
 * - 消息流条目:[data-chat-flow-kind](assistant / user / steering / command);
 * - 侧栏开关:layout 服务 toggleSidebar();设置触发:button[aria-haspopup="dialog"];
 * - 模型选择器:composer 卡片内 button[aria-haspopup="menu"];
 * - 会话切换:sessions.list 快照(ids/byId/current)+ sessions.open(id);
 * - 新建会话:uiWorkspace.startSession()(与 New Session 按钮同路径)。
 */
import type { PendingInteractionLike, Services } from './types.ts'

/** 在当前 DOM 中查审批/问答/计划评审卡片是否打开(分发态 A)。 */
export function detectStateA(): boolean {
  return document.querySelector('[data-approval-key], [data-question-key], [data-plan-review-key]') !== null
}

/** 焦点是否在文本编辑目标上(分发态 B 判定)。 */
export function isEditableTarget(target: EventTarget | null | undefined): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

function conversationScroll(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-conversation-scroll]')
}

/** 滚动指定页数(正数向下)。 */
export function scrollByPages(pages: number): void {
  const el = conversationScroll()
  if (el === null) return
  el.scrollTop += el.clientHeight * 0.85 * pages
}

/** 跳到对话最旧 / 最新消息。 */
export function scrollToEdge(edge: 'top' | 'bottom'): void {
  const el = conversationScroll()
  if (el === null) return
  el.scrollTop = edge === 'top' ? 0 : el.scrollHeight
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard !== undefined) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // 走降级路径
  }
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    return ok
  } catch {
    return false
  }
}

/** 复制最后一条 assistant 回复(渲染文本;最后回复为空时提示)。 */
export async function copyLastReply(): Promise<boolean> {
  const items = document.querySelectorAll<HTMLElement>('[data-chat-flow-kind="assistant"]')
  const last = items.length === 0 ? null : items[items.length - 1]
  const text = last === null ? '' : (last.innerText ?? '').trim()
  if (text === '') return false
  return copyText(text)
}

/** 复制对话里最后一个代码块(渲染文本)。 */
export async function copyLastCodeBlock(): Promise<boolean> {
  const root = conversationScroll() ?? document
  const blocks = root.querySelectorAll<HTMLElement>('pre')
  const last = blocks.length === 0 ? null : blocks[blocks.length - 1]
  const text = last === null ? '' : (last.innerText ?? '').trim()
  if (text === '') return false
  return copyText(text)
}

/** 聚焦输入框(Lexical contenteditable)。 */
export function focusComposer(): boolean {
  const input = document.querySelector<HTMLElement>('[data-composer-input]')
  if (input === null) return false
  input.focus({ preventScroll: true })
  return true
}

/** 打开模型选择器(composer 卡片内的 menu 触发按钮)。 */
export function openModelSelector(): boolean {
  const card = document.querySelector('[data-composer-card]')
  const trigger = (card ?? document).querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')
  if (trigger === null) return false
  trigger.click()
  return true
}

/** 打开设置(侧栏 footer 的 dialog 触发按钮;取最后一个匹配以避开其它 dialog)。 */
export function openSettings(): boolean {
  const triggers = document.querySelectorAll<HTMLButtonElement>('button[aria-haspopup="dialog"]')
  if (triggers.length === 0) return false
  const trigger = triggers[triggers.length - 1]
  if (trigger.disabled) return false
  trigger.click()
  return true
}

/** 开关侧栏(layout 服务)。 */
export function toggleSidebar(services: Services): boolean {
  const layout = services.layout
  if (layout === null || layout === undefined || typeof layout.toggleSidebar !== 'function') return false
  layout.toggleSidebar()
  return true
}

/** 新建会话(uiWorkspace.startSession,与 New Session 按钮同路径)。 */
export function startNewSession(services: Services): boolean {
  const uiWorkspace = services.uiWorkspace
  if (uiWorkspace === null || uiWorkspace === undefined || typeof uiWorkspace.startSession !== 'function') return false
  uiWorkspace.startSession()
  return true
}

/** 上/下一个会话(按列表顺序取邻座并打开)。 */
export function openNeighborSession(services: Services, delta: number): boolean {
  const sessions = services.sessions
  const snapshot = sessions?.list?.getSnapshot?.()
  if (sessions === null || sessions === undefined || snapshot === null || snapshot === undefined) return false
  const ids = snapshot.ids
  if (ids === undefined || ids.length === 0 || typeof sessions.open !== 'function') return false
  const current = snapshot.current
  const index = current === undefined ? -1 : ids.indexOf(current)
  const nextIndex = index < 0 ? (delta > 0 ? 0 : ids.length - 1) : Math.min(ids.length - 1, Math.max(0, index + delta))
  if (nextIndex === index) return false
  const target = ids[nextIndex]
  if (target === undefined) return false
  sessions.open(target)
  return true
}

/** 从 uiSession 服务取当前会话(或任意)的待处理交互。 */
function pendingInteraction(services: Services): PendingInteractionLike | undefined {
  const uiSession = services.uiSession
  const snapshot = uiSession === null || uiSession === undefined ? undefined : uiSession.pendingSnapshot
  if (snapshot === undefined || snapshot.size === 0) return undefined
  const current = services.sessions?.list?.getSnapshot?.().current
  if (current !== undefined) {
    const scoped = snapshot.get(current)
    if (scoped !== undefined) return scoped
  }
  const first = snapshot.values().next()
  return first.done === true ? undefined : first.value
}

/** 审批:优先服务级 answer(),失败回退 DOM 点击对应按钮。 */
export function answerApproval(services: Services, outcome: 'allowed-once' | 'rejected'): boolean {
  const pending = pendingInteraction(services)
  if (
    pending !== undefined &&
    pending.kind === 'approval' &&
    typeof pending.answer === 'function'
  ) {
    try {
      void Promise.resolve(pending.answer(outcome)).catch(() => {})
      return true
    } catch {
      // 回退 DOM 路径
    }
  }
  const cards = document.querySelectorAll<HTMLElement>('[data-approval-key]')
  if (cards.length === 0) return false
  const card = cards[cards.length - 1]
  const buttons = [...card.querySelectorAll<HTMLButtonElement>('button')].filter((b) => !b.disabled)
  if (buttons.length < 2) return false
  // actionRow 顺序:拒绝(outline)在前、允许(primary)在后
  const button = outcome === 'allowed-once' ? buttons[buttons.length - 1] : buttons[0]
  button.click()
  return true
}

/** 问答/计划评审卡片:数字键选择第 n 个选项(1 起)。 */
export function pickQuestionOption(n: number): boolean {
  const question = document.querySelector<HTMLElement>('[data-question-key]')
  if (question !== null) {
    const options = question.querySelectorAll<HTMLButtonElement>(
      '[data-question-scroll] button[role="radio"], [data-question-scroll] button[role="checkbox"]',
    )
    const option = options[n - 1]
    if (option !== undefined && !option.disabled) {
      option.click()
      return true
    }
    return false
  }
  const plan = document.querySelector<HTMLElement>('[data-plan-review-key]')
  if (plan !== null) {
    const buttons = planButtons(plan)
    const button = buttons[n - 1]
    if (button !== undefined && !button.disabled) {
      button.click()
      return true
    }
  }
  return false
}

/** 问答/计划评审卡片:Enter 确认(问答 = 主提交按钮;计划评审 = 确认执行)。 */
export function submitQuestion(): boolean {
  const question = document.querySelector<HTMLElement>('[data-question-key]')
  if (question !== null) {
    const buttons = footerButtons(question, '[data-question-scroll]')
    const submit = buttons[buttons.length - 1]
    if (submit !== undefined && !submit.disabled) {
      submit.click()
      return true
    }
    return false
  }
  const plan = document.querySelector<HTMLElement>('[data-plan-review-key]')
  if (plan !== null) {
    const approve = planButtons(plan)[0]
    if (approve !== undefined && !approve.disabled) {
      approve.click()
      return true
    }
  }
  return false
}

/** 卡片内不在滚动区的按钮(即 footer 操作行)。 */
function footerButtons(card: HTMLElement, scrollSelector: string): HTMLButtonElement[] {
  return [...card.querySelectorAll<HTMLButtonElement>('button')].filter(
    (b) => b.closest(scrollSelector) === null,
  )
}

/** 计划评审的操作按钮(确认 / 拒绝 / 去聊)。 */
function planButtons(card: HTMLElement): HTMLButtonElement[] {
  return footerButtons(card, '[data-plan-review-scroll]')
}
