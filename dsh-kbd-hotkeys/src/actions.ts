/** 动作实现层:全走服务触发、不触碰 DOM(DOM 只有 keydown 入口、editing 判定、插件浮层)。
 * 无降级(任一环不可用即 no-op、不吞键);上游方法须以「方法」形式调用(fn.call(owner, …))。 */
import type {
  ComposerEditableLike,
  PendingInteractionLike,
  QuestionDraftLike,
  QuestionDraftStoreLike,
  Services,
  SessionFaceLike,
  SessionInputShellLike,
  SessionListSnapshotLike,
  SessionsLike,
} from './types.ts'
import { clearProgress, questionDraftStore, readProgress, writeProgress } from './question-drafts.ts'
import { sidebarOrderedSessionIds } from './sidebar-order.ts'
import { completionUnread, currentSessionId } from './session-view.ts'

/* 服务级：待处理交互读取（card 态判定与审批 / 问答载体） */

/** 待处理交互表：优先 pendingInteractions.getSnapshot()，回退私有 pendingSnapshot。 */
function pendingMap(services: Services): ReadonlyMap<string, PendingInteractionLike> | undefined {
  const uiSession = services.uiSession
  if (uiSession === null || uiSession === undefined) return undefined
  const snapshot = uiSession.pendingInteractions?.getSnapshot?.()
  if (snapshot !== undefined) return snapshot
  return uiSession.pendingSnapshot
}

/** card 态判定：当前会话有无待处理交互（服务级，不受渲染时序影响）。 */
export function hasPendingCard(services: Services): boolean {
  const map = pendingMap(services)
  if (map === undefined || map.size === 0) return false
  const current = currentSessionId(services)
  if (current === undefined) return false
  return map.has(current)
}

/** 待处理交互：优先当前会话，否则取表内第一项（审批可应答其它会话）。 */
function pendingInteraction(services: Services): PendingInteractionLike | undefined {
  const map = pendingMap(services)
  if (map === undefined || map.size === 0) return undefined
  const current = currentSessionId(services)
  if (current !== undefined) {
    const scoped = map.get(current)
    if (scoped !== undefined) return scoped
  }
  const first = map.values().next()
  return first.done === true ? undefined : first.value
}

/** 待处理问答 / 计划评审载体（kind 为 question / plan-review）。 */
function pendingQuestion(services: Services): PendingInteractionLike | undefined {
  const pending = pendingInteraction(services)
  if (pending === undefined) return undefined
  return pending.kind === 'question' || pending.kind === 'plan-review' ? pending : undefined
}

/** 触发一次载体动词并吞掉同步异常与异步拒绝；返回是否已发出调用。 */
function fireAndForget(run: () => Promise<void> | void): boolean {
  try {
    void Promise.resolve(run()).catch(() => {})
    return true
  } catch {
    return false
  }
}

/* 审批（任意态，回合级高频） */

/** 审批应答（PendingApproval.answer）；无载体即 no-op，不回退 DOM 点击。 */
export function answerApproval(services: Services, outcome: 'allowed-once' | 'rejected'): boolean {
  const pending = pendingInteraction(services)
  if (pending === undefined || pending.kind !== 'approval') return false
  if (typeof pending.answer !== 'function') return false
  return fireAndForget(() => pending.answer?.(outcome))
}

/* 问答 / 计划评审（card 态，回合级高频） */

/** 单题是否已作答（选中过选项或填过自定义文本）——同上游 QuestionFlow.answered。 */
function answered(draft: QuestionDraftLike): boolean {
  return draft.selected.length > 0 || draft.custom.trim() !== ''
}

/** 单题是否已完成（已作答或显式跳过）——同上游 QuestionFlow.completed。 */
function completed(draft: QuestionDraftLike): boolean {
  return answered(draft) || draft.skipped
}

/** 请求键（须与卡片 store 的 requestKey 一致，否则卡片不读这份进度）。 */
function requestKeyOf(pending: PendingInteractionLike): string | undefined {
  const key = pending.key
  return typeof key === 'string' && key !== '' ? key : undefined
}

/** 取承载当前问答的卡片草稿 store（唯一真源）；会话 / 请求键 / store 任一不可解析即 undefined。 */
function draftStoreOf(services: Services, pending: PendingInteractionLike): QuestionDraftStoreLike | undefined {
  const sessionId = pending.sessionId
  if (typeof sessionId !== 'string' || sessionId === '') return undefined
  return questionDraftStore(services, pending, sessionId)
}

/** 计划评审决策标签：intent.approve 为「确认执行」，其余选项为「拒绝」。 */
function planReviewLabels(
  pending: PendingInteractionLike,
): { id: string; approve?: string; decline?: string } | undefined {
  const question = pending.questions?.[0]
  if (question === undefined) return undefined
  const approveLabel = question.intent?.approve
  const options = question.options ?? []
  const approve = approveLabel === undefined ? undefined : options.find((option) => option.label === approveLabel)
  const decline = approveLabel === undefined ? undefined : options.find((option) => option.label !== approveLabel)
  return {
    id: question.id,
    ...(approve === undefined ? {} : { approve: approve.label }),
    ...(decline === undefined ? {} : { decline: decline.label }),
  }
}

/** 计划评审决策：approve / decline → answer，discuss → cancel；一次决策，不写草稿 store。 */
function answerPlanReview(pending: PendingInteractionLike, decision: 'approve' | 'decline' | 'discuss'): boolean {
  if (decision === 'discuss') {
    if (typeof pending.cancel !== 'function') return false
    return fireAndForget(() => pending.cancel?.())
  }
  const labels = planReviewLabels(pending)
  if (labels === undefined || typeof pending.answer !== 'function') return false
  const label = decision === 'approve' ? labels.approve : labels.decline
  if (label === undefined) return false
  return fireAndForget(() => pending.answer?.({ answers: [{ id: labels.id, selected: [label] }] }))
}

/** 数字键：选当前题第 n 个选项；计划评审 1=确认 2=拒绝 3=去聊天里说，问答只改选中态不翻题。 */
export function pickQuestionOption(services: Services, n: number): boolean {
  const pending = pendingQuestion(services)
  if (pending === undefined) return false

  if (pending.kind === 'plan-review') {
    if (n === 1) return answerPlanReview(pending, 'approve')
    if (n === 2) return answerPlanReview(pending, 'decline')
    if (n === 3) return answerPlanReview(pending, 'discuss')
    return false
  }

  const questions = pending.questions ?? []
  if (questions.length === 0) return false
  const requestKey = requestKeyOf(pending)
  if (requestKey === undefined) return false
  const store = draftStoreOf(services, pending)
  if (store === undefined) return false

  const progress = readProgress(store, requestKey, questions)
  const question = questions[progress.index]
  const draft = progress.drafts[progress.index]
  if (question === undefined || draft === undefined) return false
  const option = (question.options ?? [])[n - 1]
  if (option === undefined) return false

  if (question.multiSelect === true) {
    draft.selected = draft.selected.includes(option.label)
      ? draft.selected.filter((label) => label !== option.label)
      : [...draft.selected, option.label]
  } else {
    draft.selected = [option.label]
    draft.custom = ''
  }
  draft.skipped = false
  return writeProgress(store, requestKey, progress)
}

/** ← / →：切上一题 / 下一题（只改题号、草稿原样保留；首末题越界 no-op 不吞键）。 */
export function moveQuestion(services: Services, delta: number): boolean {
  const pending = pendingQuestion(services)
  if (pending === undefined || pending.kind === 'plan-review') return false

  const questions = pending.questions ?? []
  if (questions.length === 0) return false
  const requestKey = requestKeyOf(pending)
  if (requestKey === undefined) return false
  const store = draftStoreOf(services, pending)
  if (store === undefined) return false

  const progress = readProgress(store, requestKey, questions)
  const next = progress.index + delta
  if (next < 0 || next >= questions.length) return false
  progress.index = next
  return writeProgress(store, requestKey, progress)
}

/** Enter：计划评审=确认执行；问答非末题翻页，末题全部完成后才结算（未完成 no-op 不跳回）。 */
export function submitQuestion(services: Services): boolean {
  const pending = pendingQuestion(services)
  if (pending === undefined) return false

  if (pending.kind === 'plan-review') return answerPlanReview(pending, 'approve')

  const questions = pending.questions ?? []
  if (questions.length === 0) return false
  const requestKey = requestKeyOf(pending)
  if (requestKey === undefined) return false
  const store = draftStoreOf(services, pending)
  if (store === undefined) return false

  const progress = readProgress(store, requestKey, questions)
  const draft = progress.drafts[progress.index]
  if (draft === undefined || !answered(draft)) return false

  if (progress.index < questions.length - 1) {
    progress.index += 1
    return writeProgress(store, requestKey, progress)
  }

  if (progress.drafts.some((item) => !completed(item))) return false

  if (typeof pending.answer !== 'function') return false
  const answers = questions.map((item, index) => {
    const value = progress.drafts[index] ?? { selected: [], custom: '', skipped: false }
    if (value.skipped) return { id: item.id, selected: [] }
    const custom = value.custom.trim()
    return {
      id: item.id,
      selected: custom === '' || item.multiSelect === true ? [...value.selected] : [],
      ...(custom === '' ? {} : { custom }),
    }
  })
  const settled = fireAndForget(() => pending.answer?.({ answers }))
  if (settled) clearProgress(store, requestKey)
  return settled
}

/* 态判定（DOM 事件目标）与其余服务级动作（左右栏 / 新建 / 停止 / 会话跳转） */

/** 焦点是否在文本编辑目标上（editing 态判定）。 */
export function isEditableTarget(target: EventTarget | null | undefined): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

/** 开关左栏（layout.toggleSidebar()，⌘/Ctrl+B，browse / editing）；服务缺席即 no-op 不吞键。 */
export function toggleSidebar(services: Services): boolean {
  const layout = services.layout
  if (layout === null || layout === undefined || typeof layout.toggleSidebar !== 'function') return false
  layout.toggleSidebar()
  return true
}

/** 开关右栏（sidebarRight.toggleExpanded()，⌘/Ctrl+O，browse / editing）；抛错即 no-op 不吞键。 */
export function toggleRightSidebar(services: Services): boolean {
  const sidebarRight = services.sidebarRight
  if (sidebarRight === null || sidebarRight === undefined) return false
  if (typeof sidebarRight.toggleExpanded !== 'function') return false
  try {
    sidebarRight.toggleExpanded()
    return true
  } catch {
    return false
  }
}

/** 新建会话（⌘/Ctrl+N，等同侧栏「新建会话」按钮）：uiWorkspace.startSession()；不可用即 no-op，不回退 DOM；⌘/Ctrl+N 是浏览器保留键。 */
export function startNewSession(services: Services): boolean {
  const uiWorkspace = services.uiWorkspace
  if (uiWorkspace === null || uiWorkspace === undefined) return false
  if (typeof uiWorkspace.startSession !== 'function') return false
  try {
    uiWorkspace.startSession()
    return true
  } catch {
    return false
  }
}

/** 聚焦输入框（⌘/Ctrl+J）：取服务链路的 composer 宿主元素后 focus({preventScroll:true})；无降级不回退 DOM。 */
export function focusComposer(services: Services): boolean {
  const root = composerRoot(services)
  if (root === undefined || typeof root.focus !== 'function') return false
  try {
    root.focus({ preventScroll: true })
    return true
  } catch {
    return false
  }
}

/** 取 composer 的 contenteditable 宿主元素：binding.ctx → input.for(actx)，缺席回退 shell(id)。 */
function composerRoot(services: Services): ComposerEditableLike | undefined {
  const sessions = services.sessions
  const conversation = services.conversation
  if (sessions === null || sessions === undefined) return undefined
  if (conversation === null || conversation === undefined) return undefined
  const input = conversation.input
  if (input === null || input === undefined) return undefined
  const current = currentSessionId(services)
  if (current === undefined) return undefined

  let shell: SessionInputShellLike | undefined
  let actx: unknown
  try {
    actx = sessions.binding?.(current)?.ctx
  } catch {
    actx = undefined
  }
  if (actx !== undefined && typeof input.for === 'function') {
    try {
      shell = input.for(actx) ?? undefined
    } catch {
      shell = undefined
    }
  }
  if (shell === undefined && typeof input.shell === 'function') {
    try {
      shell = input.shell(current) ?? undefined
    } catch {
      shell = undefined
    }
  }
  if (shell === null || shell === undefined) return undefined
  const editor = shell.editor
  if (editor === null || editor === undefined) return undefined
  if (typeof editor.getRootElement !== 'function') return undefined
  const root = editor.getRootElement()
  return root === null || root === undefined ? undefined : root
}

/** 事件目标是否在 composer 编辑区内（editing 态门闸：⇧Tab 为真才接管，⌘/Ctrl+J 为假才聚焦）。 */
export function isComposerTarget(services: Services, target: EventTarget | null | undefined): boolean {
  if (target === null || target === undefined) return false
  const root = composerRoot(services)
  if (root === undefined) return false
  if (typeof root.contains !== 'function') return false
  try {
    return root.contains(target)
  } catch {
    return false
  }
}

/** 停止当前会话整棵运行中交互树（Esc）：递归直系**子代理**（不含 fork）、visited 去重、跳过 one-shot。 */
export function stopCurrentSessionTree(services: Services): boolean {
  const sessions = services.sessions
  const snapshot = sessions?.list?.getSnapshot?.()
  if (sessions === null || sessions === undefined || snapshot === null || snapshot === undefined) return false
  // 当前会话来自视图层(0.1.6-alpha.2 起 sessions.list 快照不再带 current)
  const current = currentSessionId(services)
  if (current === undefined || current === '') return false
  // 0.1.7-alpha.1 起子代理名册由投影提供(origin='subagent' 行 + subagentCatalog 两源并集),旧的 subagentsByParent 已删除
  const children = childIdsByParent(snapshot)
  const cancelled = new Set<string>()
  const visit = (id: string | undefined, seen: Set<string>): void => {
    if (id === undefined || id === '' || seen.has(id)) return
    seen.add(id)
    cancelIfRunning(id, sessions, cancelled)
    for (const child of children.get(id) ?? []) visit(child, seen)
  }
  visit(current, new Set())
  return cancelled.size > 0
}

/**
 * 父会话 → 直系子代理 id 索引:并集「byId 里 `origin === 'subagent'` 且 parentId 命中行」
 * （同步、恒可用）与「projectionsBySession[parent].values.subagentCatalog」（投影已加载时补充）。
 * 判据与上游一致(dsh-subagent `runningDescendants`:parentSession 有值且 origin === 'subagent'):
 * **fork 也带 parentId 但 origin 缺席**,是独立会话而非子代理,不得递归取消。
 * 任一来源不可读即视为空;不触碰 DOM、不触发投影加载（保持 Esc 的同步吞键语义）。
 */
function childIdsByParent(snapshot: SessionListSnapshotLike): ReadonlyMap<string, readonly string[]> {
  const index = new Map<string, string[]>()
  const push = (parent: string | undefined, child: string | undefined): void => {
    if (parent === undefined || parent === '' || child === undefined || child === '') return
    const known = index.get(parent)
    if (known === undefined) {
      index.set(parent, [child])
      return
    }
    if (!known.includes(child)) known.push(child)
  }
  const byId = snapshot.byId
  if (byId !== null && byId !== undefined) {
    for (const summary of Object.values(byId)) {
      if (summary === null || summary === undefined) continue
      if (summary.origin !== 'subagent') continue
      push(summary.parentId, summary.id)
    }
  }
  const projections = snapshot.projectionsBySession
  if (projections !== null && projections !== undefined) {
    for (const [parent, projection] of Object.entries(projections)) {
      const catalog = projection?.values?.subagentCatalog
      if (catalog === undefined) continue
      for (const entry of catalog) {
        if (entry === null || entry === undefined) continue
        push(parent, entry.id)
      }
    }
  }
  return index
}

/** 取消单个运行中的会话；one-shot 子代理不可取消；返回是否发出取消。 */
function cancelIfRunning(id: string, sessions: SessionsLike, cancelled: Set<string>): boolean {
  const binding = sessions.binding?.(id)
  const session: SessionFaceLike | undefined = binding?.session
  if (session === undefined) return false
  const snapshot = session.getSnapshot?.()
  if (snapshot?.running !== true) return false
  const subagent = snapshot.subagent
  const address = subagent === null || subagent === undefined ? undefined : subagent.address
  if (address !== undefined && address.mode === 'one-shot') return false
  if (typeof session.cancel !== 'function') return false
  try {
    void Promise.resolve(session.cancel()).catch(() => {})
    cancelled.add(id)
    return true
  } catch {
    return false
  }
}

/**
 * 活跃会话循环跳转（⌘/Ctrl+Alt+↑↓）：按侧栏顺序轴从当前会话出发、找方向上最近的其他活跃会话，
 * 走到轴尽头**回绕**到另一端（循环）；锚点自身不作落点，故除当前会话外没有活跃会话即 no-op；
 * 轴 / 锚点不可读即 no-op（无降级）。
 */
export function openNeighborSession(services: Services, delta: number): boolean {
  const sessions = services.sessions
  const snapshot = sessions?.list?.getSnapshot?.()
  if (sessions === null || sessions === undefined || snapshot === null || snapshot === undefined) return false
  if (snapshot.ids === undefined || snapshot.ids.length === 0 || snapshot.byId === undefined) return false
  // 打开会话的选择权 0.1.6-alpha.2 起在 uiWorkspace（与侧栏点会话行同一入口）；sessions.open 已删除。
  const uiWorkspace = services.uiWorkspace
  const openSession = uiWorkspace?.openSession
  if (uiWorkspace === null || uiWorkspace === undefined || typeof openSession !== 'function') return false
  const axis = sidebarOrderedSessionIds(snapshot, services)
  const total = axis.length
  if (total === 0) return false
  const current = currentSessionId(services)
  const anchor = current === undefined ? -1 : axis.indexOf(current)
  if (anchor < 0) return false
  const active = activeSessionIds(snapshot, services)
  // 从 anchor ± 1 起沿方向扫；越过任一端即回绕（取模）。step 只到 total - 1，锚点自身不会被再次落点
  for (let step = 1; step < total; step += 1) {
    const id = axis[(((anchor + delta * step) % total) + total) % total]
    if (id === undefined) continue
    if (!active.has(id)) continue
    try {
      openSession.call(uiWorkspace, id)
      return true
    } catch {
      return false
    }
  }
  return false
}

/** 活跃会话 id 集合：running ∪ 待处理交互命中 ∪ 完成未读（completionUnread，替代已删除的 summary.completed）。 */
function activeSessionIds(snapshot: SessionListSnapshotLike, services: Services): ReadonlySet<string> {
  const pending = pendingMap(services)
  const active = new Set<string>()
  for (const id of snapshot.ids ?? []) {
    const summary = snapshot.byId?.[id]
    if (summary === undefined) continue
    if (summary.running === true || completionUnread(services, id) || (pending !== undefined && pending.has(id))) {
      active.add(id)
    }
  }
  return active
}
