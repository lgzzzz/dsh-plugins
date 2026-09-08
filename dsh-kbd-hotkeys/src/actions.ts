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
 * - 输入框(Lexical 可编辑):[data-composer-input];
 * - 侧栏开关:layout 服务 toggleSidebar();设置触发:button[aria-haspopup="dialog"];
 * - 模型选择器:composer 卡片内 button[aria-haspopup="menu"];
 * - 会话切换(↑/↓):在「活跃会话」之间跳转。活跃定义为:正在运行
 *   (running=true)∪ 有待处理交互(uiSession.pendingSnapshot 命中)∪ 刚完成
 *   未查看(completed=true,即侧栏绿色「完成」提醒)。基础轴 = 可见会话
 *   (sessionVisible 过滤:子代理/归档/非当前 blank)× byRecency(updatedAt 新→旧,
 *   id 升序决胜);以当前会话在轴上的位置为锚,向目标方向扫描**最近**的活跃会话
 *   并 open(当前会话本身不在活跃集中时同样可用,落点即方向上的最近活跃者)。
 */
import type {
  PendingInteractionLike,
  SessionListSnapshotLike,
  SessionSummaryLike,
  Services,
} from './types.ts'

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

/**
 * 会话视图标签切换:在同一个会话的头部视图 tab(conversation.view)之间切换。
 *
 * 定位方式是「内容判别」而非「DOM 位置」:遍历整页 [role="tablist"],返回
 * 其 tab(role="tab")均不带 aria-controls 的那一个。全应用共有 4 个 tablist,
 * 除会话视图外其余 3 个(cordis 源码、trajectory 详情、settings-plugins)的
 * tab 均带 id + aria-controls,因此「无 aria-controls」可唯一锁定会话头部
 * 的视图 tablist(conversation.session.header,见 dsh-client-ui-conversation)。
 * 不依赖 data-phase/header 的 DOM 层级,兼容 slot 引擎对头部内容的任意渲染
 * (直接子节点 / 包裹层 / 挂载到他处)。
 *
 * 每个视图为一个 role=tab 的 <button>,aria-selected 标记当前,点击触发
 * selectView(view.id)。切换为循环:最右标签按下一个回到第一个,最左标签按
 * 上一个跳到最后一个(模运算回绕);未选中时按方向落到第一个/最后一个。
 *
 * @param delta - 方向:1 = 下一个标签, -1 = 上一个标签。
 */
export function switchView(delta: number): boolean {
  const tablist = findSessionViewTablist()
  if (tablist === null) return false
  const tabs = [...tablist.querySelectorAll<HTMLElement>('[role="tab"]')]
  if (tabs.length === 0) return false
  // 循环切换:最右按右回到第一个,最左按左跳到最后一个(模运算回绕)。
  // tabs.length===1 时无意义(源里仅当 tabs.length>1 才渲染 tablist)。
  const current = tabs.findIndex((el) => el.getAttribute('aria-selected') === 'true')
  const base = current < 0 ? (delta > 0 ? -1 : tabs.length) : current
  const nextIndex = (base + delta + tabs.length) % tabs.length
  const nextTab = tabs[nextIndex]
  if (nextTab === undefined) return false
  nextTab.click()
  return true
}

/**
 * 定位会话视图 tablist:整页唯一的「tab 不带 aria-controls」的 [role="tablist"]。
 * 返回 null 表示当前页面没有可切换的会话视图标签(如空白会话只渲染 hero,
 * 头部不渲染 tablist)。
 */
function findSessionViewTablist(): HTMLElement | null {
  const tablists = document.querySelectorAll<HTMLElement>('[role="tablist"]')
  for (const tablist of tablists) {
    const tabs = tablist.querySelectorAll<HTMLElement>('[role="tab"]')
    if (tabs.length === 0) continue
    let hasControls = false
    for (const tab of tabs) {
      const controls = tab.getAttribute('aria-controls')
      if (controls !== null && controls !== '') {
        hasControls = true
        break
      }
    }
    if (!hasControls) return tablist
  }
  return null
}

/**
 * 会话切换:在「活跃会话」之间跳转,取方向上最近的活跃会话并打开。
 *
 * 活跃定义(用户确认):正在运行(running=true)∪ 有待处理交互
 * (uiSession.pendingSnapshot 命中)∪ 刚完成未查看(completed=true)。
 *
 * 算法:
 * 1. 基础轴 = 可见会话(复刻 dsh-client-ui-workspace 的 sessionVisible:
 *    剔除子代理/归档/非当前空白行),按 byRecency(updatedAt 新→旧,id 升序决胜)
 *    排序——即「最近活动时间」轴,与活跃语义同源。
 * 2. 以当前会话在轴上的位置为锚,向 delta 方向逐格扫描,落在**第一个**活跃
 *    会话上并 open();当前会话本身不活跃时同样可跳(锚点仍在轴上),落点即
 *    方向上最近的活跃会话;方向尽头无活跃会话则 no-op。
 * 3. 锚点不在可见轴(掩码间隙/选中了被过滤行)时 no-op,避免突跳。
 */
export function openNeighborSession(services: Services, delta: number): boolean {
  const sessions = services.sessions
  const snapshot = sessions?.list?.getSnapshot?.()
  if (sessions === null || sessions === undefined || snapshot === null || snapshot === undefined) return false
  if (
    snapshot.ids === undefined ||
    snapshot.ids.length === 0 ||
    snapshot.byId === undefined ||
    typeof sessions.open !== 'function'
  ) {
    return false
  }
  const axis = visibleSessionsByRecency(snapshot, services)
  if (axis.length === 0) return false
  const current = snapshot.current
  const anchor = current === undefined ? -1 : axis.findIndex((row) => row.id === current)
  if (anchor < 0) return false
  const active = activeSessionIds(snapshot, services)
  for (let i = anchor + delta; i >= 0 && i < axis.length; i += delta) {
    const row = axis[i]
    if (row === undefined) continue
    if (active.has(row.id)) {
      sessions.open(row.id)
      return true
    }
  }
  return false
}

/** 活跃会话 id 集合:running ∪ pendingSnapshot 命中 ∪ completed。 */
function activeSessionIds(snapshot: SessionListSnapshotLike, services: Services): ReadonlySet<string> {
  const pending = services.uiSession?.pendingSnapshot
  const active = new Set<string>()
  for (const id of snapshot.ids ?? []) {
    const summary = snapshot.byId?.[id]
    if (summary === undefined) continue
    if (summary.running === true || summary.completed === true || (pending !== undefined && pending.has(id))) {
      active.add(id)
    }
  }
  return active
}

/**
 * 可见会话按活跃度排序的导航轴(复刻 workspace 浏览器 sessionVisible +
 * byRecency;workspaces 缺失时无法过滤归档,其余判定不变)。
 */
function visibleSessionsByRecency(snapshot: SessionListSnapshotLike, services: Services): SessionSummaryLike[] {
  const archived = new Set<string>(services.workspaces?.list?.getSnapshot?.()?.archivedSessionIds ?? [])
  const rows: SessionSummaryLike[] = []
  for (const id of snapshot.ids ?? []) {
    const summary = snapshot.byId?.[id]
    if (summary === undefined || !sessionVisible(summary, snapshot.current, archived)) continue
    rows.push(summary)
  }
  rows.sort(byRecency)
  return rows
}

/**
 * 构建快捷键导航轴:可见会话按活跃度排序(复刻 workspace 浏览器
 * byRecency:updatedAt 新→旧;相同时按会话 id 升序决胜,确定性,保证连续按键轴稳定)。
 */
function byRecency(a: SessionSummaryLike, b: SessionSummaryLike): number {
  const aUpdated = a.updatedAt ?? Number.NEGATIVE_INFINITY
  const bUpdated = b.updatedAt ?? Number.NEGATIVE_INFINITY
  if (bUpdated !== aUpdated) return bUpdated - aUpdated
  return a.id < b.id ? -1 : 1
}

/**
 * 可见性判定,逐字复刻 workspace 浏览器 sessionVisible:
 * 子代理行(origin==='subagent')、归档行、非当前 blank 行均不可见。
 */
function sessionVisible(summary: SessionSummaryLike, current: string | undefined, archived: ReadonlySet<string>): boolean {
  return summary.origin !== 'subagent' && !archived.has(summary.id) && (!summary.blank || summary.id === current)
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
