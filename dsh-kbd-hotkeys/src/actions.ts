/**
 * dsh-kbd-hotkeys — 动作实现层。
 *
 * 触发路径分两类:
 *
 * 服务级(不触碰 DOM):
 * - 审批:uiSession 待处理交互 → PendingApproval.answer('allowed-once' | 'rejected');
 * - 问答/计划评审:uiSession 待处理交互 → PendingQuestion.answer({answers}) / cancel();
 *   计划评审 1=确认执行(intent.approve 标签)、2=拒绝(另一标签)、3=去聊天里说(cancel)、
 *   Enter=确认执行;通用问答直接读写**卡片自己的 Session 级 slot store**
 *   (`conversation.composer` 注册项上的 createQuestionDraftStore,见 question-drafts.ts),
 *   数字键 = 上游 choose() 的选中语义(单选覆盖、多选切换),**但不自动翻题**;
 *   ←/→ = 上游 pager 的 nav.prev / nav.next 语义(仅改题号、草稿原样保留、首末题
 *   不循环);Enter = 保留上游 continueFlow 的推进语义(当前题已作答且非末题 →
 *   翻到下一题),末题仅在全部题目完成后按 store 的草稿成批结算(不跳回未完成题);
 * - 侧栏:layout.toggleSidebar()(左栏) / sidebarRight.toggleExpanded()(右栏);
 * - 会话跳转:sessions 快照 + slots 里的侧栏视图 store(顺序)+ sessions.open(id);
 * - Esc 停止:sessions.binding(id).session.cancel();
 * - `card` 态判定:当前会话在 uiSession 待处理交互表中命中(不依赖卡片是否已渲染)。
 *
 * DOM 级:仅 `editing` 态判定消耗 DOM(isEditableTarget,事件目标判定),
 * 不再有任何点击型动作——原「会话视图标签切换」(selectView 为 slot 注入的
 * React 回调、无服务面)及其 ⌘/Ctrl+Alt+←/→ 键位已移除。
 *
 * 源码事实依据(以 <dsh>/node_modules/@deepseek-ai 各包 lib/client.js 为准):
 * - uiSession.pendingInteractions.getSnapshot():sessionId → 待处理交互(公开面;
 *   pendingSnapshot 为同一份数据的私有字段,仅作兼容回退);
 * - PendingApproval:kind==='approval',answer('allowed-once' | 'rejected');
 * - PendingQuestion:kind==='question' | 'plan-review',questions 携带
 *   options/multiSelect/intent,answer({answers:[{id,selected,custom?}]})、cancel();
 * - 通用问答的选中态在 Session 级 slot store 内:注册项 store handle
 *   + uiSession.resolve(sessionId) 作用域绑定 + slots.resolveStore(handle, binding)
 *   取活实例,动作面 actions.replace/clear(dsh-client-ui-renderer 的 resolveStore、
 *   dsh-web-frontend 的 defineStore);
 * - 计划评审卡片的 DOM 底部按钮顺序实为 去聊天里说 / 拒绝 / 确认执行,故键位语义
 *   改为按 intent.approve 标签判定,不再依赖按钮顺序。
 */
import type {
  PendingInteractionLike,
  QuestionDraftLike,
  QuestionDraftStoreLike,
  Services,
  SessionFaceLike,
  SessionListSnapshotLike,
  SessionsLike,
} from './types.ts'
import { clearProgress, questionDraftStore, readProgress, writeProgress } from './question-drafts.ts'
import { sidebarOrderedSessionIds } from './sidebar-order.ts'

/* ------------------------------------------------------------------ *
 * 服务级:待处理交互读取(`card` 态判定 + 审批/问答载体)
 * ------------------------------------------------------------------ */

/**
 * 待处理交互表:优先公开观察面 pendingInteractions.getSnapshot(),
 * 回退私有字段 pendingSnapshot(两者运行时同源)。
 */
function pendingMap(services: Services): ReadonlyMap<string, PendingInteractionLike> | undefined {
  const uiSession = services.uiSession
  if (uiSession === null || uiSession === undefined) return undefined
  const snapshot = uiSession.pendingInteractions?.getSnapshot?.()
  if (snapshot !== undefined) return snapshot
  return uiSession.pendingSnapshot
}

/** 当前会话 id(无当前会话时 undefined)。 */
function currentSessionId(services: Services): string | undefined {
  const current = services.sessions?.list?.getSnapshot?.()?.current
  return current === undefined || current === '' ? undefined : current
}

/**
 * `card` 态判定:当前会话是否有待处理交互(审批/问答/计划评审卡片)。
 * 服务级判定,不受 React 渲染卡片时序影响。
 */
export function hasPendingCard(services: Services): boolean {
  const map = pendingMap(services)
  if (map === undefined || map.size === 0) return false
  const current = currentSessionId(services)
  if (current === undefined) return false
  return map.has(current)
}

/**
 * 取待处理交互:优先当前会话,当前会话无待处理时回退到表内第一项
 * (审批动作放行任意态,便于直接应答其它会话的审批请求)。
 */
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

/** 取待处理问答/计划评审载体(kind 为 question / plan-review)。 */
function pendingQuestion(services: Services): PendingInteractionLike | undefined {
  const pending = pendingInteraction(services)
  if (pending === undefined) return undefined
  return pending.kind === 'question' || pending.kind === 'plan-review' ? pending : undefined
}

/** 触发一次载体动词,吞掉同步异常与异步拒绝;返回是否已发出调用。 */
function fireAndForget(run: () => Promise<void> | void): boolean {
  try {
    void Promise.resolve(run()).catch(() => {})
    return true
  } catch {
    return false
  }
}

/* ------------------------------------------------------------------ *
 * 审批(任意态,回合级高频)
 * ------------------------------------------------------------------ */

/**
 * 审批:服务级应答(uiSession 待处理交互 → PendingApproval.answer)。
 * 无待处理审批载体时 no-op(不回退 DOM 点击)。
 */
export function answerApproval(services: Services, outcome: 'allowed-once' | 'rejected'): boolean {
  const pending = pendingInteraction(services)
  if (pending === undefined || pending.kind !== 'approval') return false
  if (typeof pending.answer !== 'function') return false
  return fireAndForget(() => pending.answer?.(outcome))
}

/* ------------------------------------------------------------------ *
 * 问答 / 计划评审(`card` 态,回合级高频)
 * ------------------------------------------------------------------ */

/** 单题是否已作答(选中过选项或填过自定义文本)——上游 QuestionFlow.answered 同语义。 */
function answered(draft: QuestionDraftLike): boolean {
  return draft.selected.length > 0 || draft.custom.trim() !== ''
}

/** 单题是否已完成(已作答或显式跳过)——上游 QuestionFlow.completed 同语义。 */
function completed(draft: QuestionDraftLike): boolean {
  return answered(draft) || draft.skipped
}

/** 请求键(卡片 store 的 requestKey 必须与之一致,否则卡片不会读这份进度)。 */
function requestKeyOf(pending: PendingInteractionLike): string | undefined {
  const key = pending.key
  return typeof key === 'string' && key !== '' ? key : undefined
}

/**
 * 取承载当前问答的卡片草稿 store(唯一真源)。
 * 无降级:会话 id / 请求键 / store 任一不可解析即返回 undefined,调用方 no-op。
 */
function draftStoreOf(services: Services, pending: PendingInteractionLike): QuestionDraftStoreLike | undefined {
  const sessionId = pending.sessionId
  if (typeof sessionId !== 'string' || sessionId === '') return undefined
  return questionDraftStore(services, pending, sessionId)
}

/**
 * 计划评审的决策标签:intent.approve 为「确认执行」标签,其余选项为「拒绝」标签。
 * 判定依据是请求数据而非 DOM 按钮顺序。
 */
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

/**
 * 计划评审决策:
 * - approve / decline → answer({answers:[{id, selected:[标签]}]});
 * - discuss → cancel()(「去聊天里说」)。
 * 计划评审卡片不使用草稿 store(一次决策),故无需清理。
 */
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

/**
 * 数字键:选择当前题第 n 个选项(1 起)。
 * - 计划评审:1=确认执行、2=拒绝、3=去聊天里说(直接结算,无中间态);
 * - 通用问答:单选覆盖选中并清空自定义文本、多选切换该项;**只改选中态,不改题号**
 *   (与上游 QuestionFlow.choose() 的唯一差异:上游单选会顺手翻到下一题,这里不翻,
 *   切题完全交给 ← / →)。写回**卡片自己的 store**,卡片实时高亮,与鼠标点选共用
 *   同一份状态;最终由 Enter(submitQuestion)成批提交。
 */
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

/**
 * 左右方向键:在题目之间切换(上一题 / 下一题)。
 *
 * 语义对齐上游 QuestionFlow 底部 pager 的两个按钮(aria-label 为 nav.prev /
 * nav.next):两者都只做 `replaceProgress(index ± 1, drafts)`——**草稿原样保留**,
 * 仅改当前题号;边界处上游把按钮置为 `disabled`(index===0 / index===末题),
 * 故这里同样**不循环**:已在首题按 ←、已在末题按 → 均返回 false(不吞键,
 * 页面默认行为照常)。
 *
 * 仅通用问答有题目列表;计划评审是「单题一次决策」,两端都越界,天然 no-op。
 * 取数路径与数字键完全相同(卡片自己的草稿 store,无降级):会话 id / 请求键 /
 * store 任一不可解析即返回 false。
 *
 * @param delta - 方向:-1 = 上一题,1 = 下一题。
 */
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

/**
 * Enter:通用问答推进 / 结算,计划评审 = 确认执行。
 *
 * 保留上游 `continueFlow()` 的**推进**语义,但去掉它的「跳回未完成题」跳转
 * (跳转只由 ← / → 负责):
 * - 当前题未作答 → 不吞键(上游在此提示「请选择一个选项或填写自定义答案」);
 * - 当前题已作答且非末题 → 翻到下一题;
 * - 末题 → 仍有未完成题时 no-op(不结算、**不跳回**该题);全部完成后按 answers
 *   批量结算(结算形态对齐上游 submitDrafts:单选且带 custom 时丢弃 selected,
 *   多选保留),并清理本次草稿。
 */
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

/* ------------------------------------------------------------------ *
 * 态判定(DOM 事件目标)+ 其余服务级动作(左右栏开关 / 停止会话树)
 * ------------------------------------------------------------------ */

/** 焦点是否在文本编辑目标上(分发 `editing` 态判定)。 */
export function isEditableTarget(target: EventTarget | null | undefined): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

/**
 * 开关左侧栏(`layout.toggleSidebar()`,⌘/Ctrl+B)。
 *
 * 宽屏下在契约默认宽(280px)与 0 之间切换,窄屏(<1024)下只翻转 `narrowExpanded`
 * 覆盖——即 AppFrame 左列轨道本身。服务缺席(无 layout 行)时 no-op(不吞键)。
 */
export function toggleSidebar(services: Services): boolean {
  const layout = services.layout
  if (layout === null || layout === undefined || typeof layout.toggleSidebar !== 'function') return false
  layout.toggleSidebar()
  return true
}

/**
 * 开关右侧栏(`sidebarRight.toggleExpanded()`,⌘/Ctrl+Alt+B,
 * 与右栏头部的折叠按钮同一入口)。
 *
 * 一次调用即完成「面板 + AppFrame 右栏轨道」的开合:展开态是会话级 slot store
 * 状态,seat 重渲染后由自己的 useLayoutEffect 调 `layout.openRightbar /
 * closeRightbar` 把轨道同步给 AppFrame(见 dsh-client-ui-sidebar-right/lib/client.js
 * 的 RightbarSeat → syncPresentation);控制器 `require()` 在无挂载会话面时抛错
 * (空白/hero 会话、右栏插件缺席),这里兜住 → no-op(返回 false,不吞键)。
 */
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

/**
 * 停止当前会话的整棵运行中交互树(Esc)。
 *
 * 语义(自 dsh-new-session 迁移而来,行为保持一致):
 * - 起点 = sessions.list 快照的 current(无当前会话即 no-op);
 * - 对每个节点:sessions.binding(id).session → getSnapshot().running === true 时
 *   session.cancel();subagent.address.mode === 'one-shot' 的一次性子代理不可取消,
 *   跳过(其自身与后代都不动);
 * - 沿 subagentsByParent[id].entries 递归 kind==='child' 的直系子代理,visited 去重
 *   防环;
 * - 返回是否**实际取消过**至少一个会话(供测试/诊断用);分发器不据此吞键——与
 *   迁移前的 dsh-new-session 一致,Esc 的页面默认行为(关弹层 / 退出编辑态)照常。
 *
 * 服务缺失、binding 未解析(未列出且未 scoped)、快照缺字段一律静默跳过。
 */
export function stopCurrentSessionTree(services: Services): boolean {
  const sessions = services.sessions
  const snapshot = sessions?.list?.getSnapshot?.()
  if (sessions === null || sessions === undefined || snapshot === null || snapshot === undefined) return false
  const current = snapshot.current
  if (current === undefined || current === '') return false
  const cancelled = new Set<string>()
  const visit = (id: string | undefined, seen: Set<string>): void => {
    if (id === undefined || id === '' || seen.has(id)) return
    seen.add(id)
    cancelIfRunning(id, sessions, cancelled)
    const catalog = snapshot.subagentsByParent?.[id]
    const entries = catalog?.entries
    if (entries === undefined) return
    for (const entry of entries) {
      if (entry.kind !== 'child') continue
      visit(entry.id, seen)
    }
  }
  visit(current, new Set())
  return cancelled.size > 0
}

/**
 * 取消单个运行中的会话;返回是否发出取消。
 * one-shot 子代理不可取消(不打断一次性任务),运行中判定取自会话快照。
 */
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
 * 会话切换:在「活跃会话」之间跳转,取方向上最近的活跃会话并打开。
 *
 * 活跃定义(用户确认):正在运行(running=true)∪ 有待处理交互
 * (uiSession.pendingInteractions 命中)∪ 刚完成未查看(completed=true)。
 *
 * 算法:
 * 1. 导航轴 = **侧栏(workspace 浏览器)里看到的顺序**,由 sidebar-order.ts
 *    逐条复刻上游派生规则(工作区分组 + 视图 store 的本地会话顺序账号 +
 *    sessionVisible 可见性过滤);**每次调用都重新取快照与视图 store**,不缓存。
 * 2. 以当前会话在轴上的位置为锚,向 delta 方向逐格扫描,落在**第一个**活跃
 *    会话上并 open();当前会话本身不活跃时同样可跳(锚点仍在轴上),落点即
 *    方向上最近的活跃会话;方向尽头无活跃会话则 no-op。
 * 3. 锚点不在轴上(当前会话被可见性过滤/选中了子代理行)时 no-op,避免突跳。
 * 4. **无降级**:侧栏视图 store 或 workspaces 快照不可读 → 空轴 → no-op,
 *    绝不按猜测的顺序跳转。
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
  const axis = sidebarOrderedSessionIds(snapshot, services)
  if (axis.length === 0) return false
  const current = snapshot.current
  const anchor = current === undefined ? -1 : axis.indexOf(current)
  if (anchor < 0) return false
  const active = activeSessionIds(snapshot, services)
  for (let i = anchor + delta; i >= 0 && i < axis.length; i += delta) {
    const id = axis[i]
    if (id === undefined) continue
    if (active.has(id)) {
      sessions.open(id)
      return true
    }
  }
  return false
}

/** 活跃会话 id 集合:running ∪ pending 交互命中 ∪ completed。 */
function activeSessionIds(snapshot: SessionListSnapshotLike, services: Services): ReadonlySet<string> {
  const pending = pendingMap(services)
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
