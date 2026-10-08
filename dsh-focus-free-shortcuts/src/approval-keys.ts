/**
 * 审批面板的 Enter / Escape 决策：焦点不在面板内时也能作答。
 *
 * 面板只在焦点位于 `[data-approval-key]` 内时处理自己的 keydown；面板展示期间输入区
 * 被隐藏、焦点退回 `<body>`，两种键都成了无主按键。本模块用两条路径处理同一个按键：
 * 固定输入通道（每个 keydown 都早于可配置派发运行，可消费该按键）的冒泡观察者，以及
 * window 上的捕获阶段监听器（早于目标与冒泡处理器，用于焦点停在会自行处理该键的卡片上
 * 的情况）。两条路径共用同一归属判定，按键只生效一次，并经 `PendingApproval.answer()`
 * 作答；面板自身拥有按键（目标在 `[data-approval-key]` 内）时让位。作答会把键盘交回
 * 输入区，因此还要撤掉被取走按键的控件上的 `data-dsh-automatic-focus` 焦点环。
 * 这些动作在所有运行时都是固定行，Web 与 Desktop 都安装。
 *
 * 面板顶替 composer、焦点退回 `<body>` 的机制见
 * docs/dsh-focus-free-shortcuts/05-approval-key-bridge.md。
 */
import { captureContext, captureGesture, pressElement } from './capture.ts'
import { suppressFocusRing } from './focus-ring.ts'
import { fixedRowOwns } from './binding.ts'
import { isKeydown, mainViewSessionId, name, warn, type KeydownInput, type SessionId } from './runtime.ts'
import type {
  ShortcutContext,
  ShortcutFixedCatalogEntry,
  ShortcutGesture,
  Shortcuts,
} from '@deepseek-ai/dsh-client-shortcuts/client'
import type {ISessions} from '@deepseek-ai/dsh-api-session-controller/client'
import type {ApprovalDecision, PendingApproval} from '@deepseek-ai/dsh-client-ui-approval/client'
import type {
  SessionPendingInteraction,
  SessionStatusSnapshot,
  UiSession,
} from '@deepseek-ai/dsh-client-ui-session/client'
import type {Context} from '@deepseek-ai/cordis'

/** 本插件桥接的两个固定审批动作的注册 id。 */
export interface ApprovalCommandIds {
  readonly allow: string
  readonly reject: string
}

/** 该按键对应的审批决策（由已挂载的固定目录行判定）；其他按键返回 undefined。 */
export function approvalOutcomeFor(
  rows: readonly ShortcutFixedCatalogEntry[],
  gesture: ShortcutGesture,
  ids: ApprovalCommandIds,
): ApprovalDecision | undefined {
  const candidates: readonly (readonly [ApprovalDecision, string])[] = [
    ['allowed-once', ids.allow],
    ['rejected', ids.reject],
  ]
  for (const [outcome, id] of candidates) {
    if (fixedRowOwns(rows, id, gesture)) return outcome
  }
  return undefined
}

/** 该按键能否在无 DOM 焦点时作答审批：首次、未消费、无上层模态（`modal === null`），且 `region === 'page'`（不在文本控件或终端内）。 */
export function approvalEligible(gesture: ShortcutGesture, context: ShortcutContext): boolean {
  return !gesture.repeat
    && !gesture.composing
    && !gesture.defaultPrevented
    && context.modal === null
    && context.region === 'page'
}

/** 目标是否落在审批面板内（`[data-approval-key]` 根节点）：是则由面板自己作答，本桥接让位。 */
export function approvalPanelOwnsTarget(target: Element | null): boolean {
  if (target === null || typeof target.closest !== 'function') return false
  return target.closest('[data-approval-key]') !== null
}

/**
 * 捕获阶段的归属判定：问题与固定通道路径相同，区别是捕获到的 gesture 不含
 * `defaultPrevented`，因此不会被该门槛拦下；面板自身的目标仍然优先。
 */
export function approvalCaptureOutcome(
  rows: readonly ShortcutFixedCatalogEntry[],
  gesture: ShortcutGesture,
  element: Element | null,
): ApprovalDecision | undefined {
  // 先用已挂载的固定目录行筛选：非 Enter / Escape 的按键不必再构建需要读文档模态层的
  // context。
  const outcome: ApprovalDecision | undefined = approvalOutcomeFor(rows, gesture, APPROVAL_COMMAND_IDS)
  if (outcome === undefined) return undefined
  const context: ShortcutContext = captureContext(element)
  if (!approvalEligible(gesture, context)) return undefined
  return approvalPanelOwnsTarget(context.target) ? undefined : outcome
}

/**
 * 把已发布的 pending interaction 收窄为可作答的审批：`kind === 'approval'`、
 * `key` 为字符串、`answerable === true` 且 `answer` 为函数。
 */
export function asAnswerableApproval(value: SessionPendingInteraction | undefined): PendingApproval | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as unknown as {
    kind?: unknown
    key?: unknown
    answerable?: unknown
    answer?: unknown
  }
  if (candidate.kind !== 'approval') return undefined
  if (typeof candidate.key !== 'string') return undefined
  if (candidate.answerable !== true) return undefined
  if (typeof candidate.answer !== 'function') return undefined
  return candidate as unknown as PendingApproval
}

/** 主视图为某个 Session 呈现的审批（由主视图 Session 与其已发布 pending interaction 决定）；没有则返回 undefined。 */
export function presentedApproval(
  sessionId: SessionId | undefined,
  statuses: SessionStatusSnapshot,
): PendingApproval | undefined {
  if (sessionId === undefined) return undefined
  return asAnswerableApproval(statuses.get(sessionId)?.pendingInteraction)
}

/** 本桥接跟踪的两个固定审批动作的注册 id。 */
const APPROVAL_COMMAND_IDS: ApprovalCommandIds = {
  allow: 'approval.allow',
  reject: 'approval.reject',
}

/**
 * 安装审批面板的 Enter / Escape 桥接：注册固定输入观察者与捕获阶段监听器；
 * 这些动作在所有运行时都是固定行，Web 与 Desktop 都安装。
 */
export function installApprovalBridge(ctx: Context): void {
  ctx.inject(['shortcuts', 'sessions', 'uiSession'], (scope) => {
    const shortcuts: Shortcuts = scope.shortcuts
    const sessions: ISessions = scope.sessions
    const uiSession: UiSession = scope.uiSession
    if (typeof shortcuts.observeFixedInput !== 'function') {
      warn('shortcuts service exposes no observeFixedInput; approval bridge not installed')
      return
    }
    scope.effect(() => shortcuts.observeFixedInput((input) => {
      if (!isKeydown(input)) return
      handleApprovalInput(shortcuts, sessions, uiSession, input)
    }), `${name}: approval keys`)
    // 捕获路径：处理已被本地控件提前消费、冒泡通道收不到的按键。
    scope.effect(() => installApprovalCapture(shortcuts, sessions, uiSession), `${name}: approval capture`)
  })
}

/**
 * 在 window 上以捕获阶段监听 keydown：早于任何本地控件（含 React 根处理器）取得该按键，
 * 命中时先 `preventDefault()` / `stopPropagation()` 再作答。
 */
function installApprovalCapture(
  shortcuts: Shortcuts,
  sessions: ISessions,
  uiSession: UiSession,
): () => void {
  if (typeof window === 'undefined') return () => {}
  const onKeydown = (event: KeyboardEvent): void => {
    if (event.type !== 'keydown') return
    const target: Element | null = pressElement(event)
    const outcome: ApprovalDecision | undefined = approvalCaptureOutcome(
      shortcuts.fixedCatalog.getSnapshot(),
      captureGesture(event),
      target,
    )
    if (outcome === undefined) return
    const approval: PendingApproval | undefined = presentedApproval(
      mainViewSessionId(sessions.list.getSnapshot()),
      uiSession.sessionStatus.getSnapshot(),
    )
    if (approval === undefined) return
    // 作答前先消费按键：持有焦点的卡片不得同时生效，冒泡通道也不应再看到该按键。
    event.preventDefault()
    event.stopPropagation()
    // 作答会把键盘交回输入区，需撤掉被取走按键的控件上随之显现的焦点环。
    suppressFocusRing(target)
    approval.answer(outcome).catch((error: unknown) => {
      warn(`approval ${approval.key} was not sent:`, error)
    })
  }
  window.addEventListener('keydown', onKeydown, true)
  return () => window.removeEventListener('keydown', onKeydown, true)
}

/** 处理固定通道投递的一次 keydown；只有解析出可作答的审批时才消费按键。 */
function handleApprovalInput(
  shortcuts: Shortcuts,
  sessions: ISessions,
  uiSession: UiSession,
  input: KeydownInput,
): void {
  const gesture: ShortcutGesture = input.gesture
  const context = input.context
  if (!approvalEligible(gesture, context)) return
  const rows = shortcuts.fixedCatalog.getSnapshot()
  const outcome: ApprovalDecision | undefined = approvalOutcomeFor(rows, gesture, APPROVAL_COMMAND_IDS)
  if (outcome === undefined) return
  // 落在面板内的按键归面板：它要么已自行作答，要么把 Enter 留给面板内聚焦的按钮。
  if (approvalPanelOwnsTarget(context.target)) return
  const approval: PendingApproval | undefined = presentedApproval(
    mainViewSessionId(sessions.list.getSnapshot()),
    uiSession.sessionStatus.getSnapshot(),
  )
  if (approval === undefined) return
  // 先消费再作答:该按键不再传给浏览器。
  input.consume()
  // 与捕获路径一致：保留焦点，但不显示作答带来的焦点环。
  suppressFocusRing(context.target)
  approval.answer(outcome).catch((error: unknown) => {
    warn(`approval ${approval.key} was not sent:`, error)
  })
}
