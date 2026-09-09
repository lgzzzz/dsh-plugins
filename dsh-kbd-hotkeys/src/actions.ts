/**
 * dsh-kbd-hotkeys — 动作实现层。
 *
 * 触发路径分两类:
 *
 * 服务级(不触碰 DOM):
 * - 审批:uiSession 待处理交互 → PendingApproval.answer('allowed-once' | 'rejected');
 * - 问答/计划评审:uiSession 待处理交互 → PendingQuestion.answer({answers}) / cancel();
 *   计划评审 1=确认执行(intent.approve 标签)、2=拒绝(另一标签)、3=去聊天里说(cancel)、
 *   Enter=确认执行;通用问答由本插件镜像草稿后成批提交(上游卡片状态在 slot store 内,不可读);
 * - 侧栏:layout.toggleSidebar();
 * - 会话跳转:sessions 快照 + sessions.open(id);
 * - Esc 停止:sessions.binding(id).session.cancel();
 * - `card` 态判定:当前会话在 uiSession 待处理交互表中命中(不依赖卡片是否已渲染)。
 *
 * DOM 级(上游无可用服务面,维持点击/聚焦):
 * - 会话视图标签切换(switchView):selectView 是 slot 注入的 React 回调,无服务面;
 * - 打开设置(openSettings):打开状态是 ui-settings-general 组件内 useState,无服务面;
 * - 打开模型选择器(openModelSelector):下拉是 ui-model-selection 组件内 useState;
 * - 聚焦输入框(focusComposer):[data-composer-input]。
 *
 * 源码事实依据(以 <dsh>/node_modules/@deepseek-ai 各包 lib/client.js 为准):
 * - uiSession.pendingInteractions.getSnapshot():sessionId → 待处理交互(公开面;
 *   pendingSnapshot 为同一份数据的私有字段,仅作兼容回退);
 * - PendingApproval:kind==='approval',answer('allowed-once' | 'rejected');
 * - PendingQuestion:kind==='question' | 'plan-review',questions 携带
 *   options/multiSelect/intent,answer({answers:[{id,selected,custom?}]})、cancel();
 * - 计划评审卡片的 DOM 底部按钮顺序实为 去聊天里说 / 拒绝 / 确认执行,故键位语义
 *   改为按 intent.approve 标签判定,不再依赖按钮顺序;
 * - 会话视图 tablist:tabs.length>1 时渲染 role=tab 的 button(全应用仅此一个
 *   tablist 的 tab 不带 aria-controls);
 * - 设置触发:侧栏 button[aria-haspopup="dialog"];
 * - 模型选择器:composer 卡片内 button[aria-haspopup="menu"];
 * - 输入框:[data-composer-input]。
 */
import type {
  PendingInteractionLike,
  PendingQuestionItemLike,
  Services,
  SessionFaceLike,
  SessionListSnapshotLike,
  SessionsLike,
  SessionSummaryLike,
} from './types.ts'

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
 * 审批(P0,任意态)
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
 * 问答 / 计划评审(P0,`card` 态)
 * ------------------------------------------------------------------ */

/** 通用问答的服务侧草稿镜像(上游卡片状态在 slot store 内,不可读)。 */
interface QuestionDraftMirror {
  selected: string[]
  custom: string
  skipped: boolean
}

/** 一次问答请求的镜像进度(题号 + 每题草稿),按载体 key 缓存。 */
interface QuestionMirrorState {
  index: number
  drafts: QuestionDraftMirror[]
}

/**
 * 镜像缓存:载体 key → 进度。
 * 上游卡片把选中态放在 Session 级 Slot store 里(外部不可达),故热键侧自持一份;
 * 键随请求唯一(`question:<n>`),请求结算后由 pruneMirrors 回收。
 */
const questionMirrors = new Map<string, QuestionMirrorState>()

/** 取(或按题目数量重建)某次请求的镜像进度。 */
function mirrorFor(key: string, questions: readonly PendingQuestionItemLike[]): QuestionMirrorState {
  const existing = questionMirrors.get(key)
  if (existing !== undefined && existing.drafts.length === questions.length) return existing
  const fresh: QuestionMirrorState = {
    index: 0,
    drafts: questions.map(() => ({ selected: [], custom: '', skipped: false })),
  }
  questionMirrors.set(key, fresh)
  return fresh
}

/**
 * 回收已不在待处理表中的镜像(请求已应答/取消/作用域销毁)。
 * 注意:待处理表按 sessionId 索引,而镜像按载体 key 索引,故先投影出在册载体 key。
 */
function pruneMirrors(map: ReadonlyMap<string, PendingInteractionLike> | undefined): void {
  if (map === undefined) {
    questionMirrors.clear()
    return
  }
  const live = new Set<string>()
  for (const pending of map.values()) live.add(mirrorKeyOf(pending))
  for (const key of [...questionMirrors.keys()]) {
    if (!live.has(key)) questionMirrors.delete(key)
  }
}

/** 单题是否已作答(选中过选项或填过自定义文本)。 */
function answered(draft: QuestionDraftMirror): boolean {
  return draft.selected.length > 0 || draft.custom.trim() !== ''
}

/** 镜像键(载体 key 缺失时以 sessionId 兜底,保证同一请求内稳定)。 */
function mirrorKeyOf(pending: PendingInteractionLike): string {
  return pending.key ?? `${pending.sessionId ?? ''}#question`
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
 */
function answerPlanReview(pending: PendingInteractionLike, decision: 'approve' | 'decline' | 'discuss'): boolean {
  if (decision === 'discuss') {
    if (typeof pending.cancel !== 'function') return false
    const settled = fireAndForget(() => pending.cancel?.())
    if (settled) questionMirrors.delete(mirrorKeyOf(pending))
    return settled
  }
  const labels = planReviewLabels(pending)
  if (labels === undefined || typeof pending.answer !== 'function') return false
  const label = decision === 'approve' ? labels.approve : labels.decline
  if (label === undefined) return false
  const settled = fireAndForget(() => pending.answer?.({ answers: [{ id: labels.id, selected: [label] }] }))
  if (settled) questionMirrors.delete(mirrorKeyOf(pending))
  return settled
}

/**
 * 数字键:选择当前题第 n 个选项(1 起)。
 * - 计划评审:1=确认执行、2=拒绝、3=去聊天里说(直接结算,无中间态);
 * - 通用问答:单选覆盖选中并自动翻到下一题(镜像态),多选切换该项,
 *   最终由 Enter(submitQuestion)成批提交。
 */
export function pickQuestionOption(services: Services, n: number): boolean {
  const pending = pendingQuestion(services)
  if (pending === undefined) return false
  pruneMirrors(pendingMap(services))

  if (pending.kind === 'plan-review') {
    if (n === 1) return answerPlanReview(pending, 'approve')
    if (n === 2) return answerPlanReview(pending, 'decline')
    if (n === 3) return answerPlanReview(pending, 'discuss')
    return false
  }

  const questions = pending.questions ?? []
  if (questions.length === 0) return false
  const mirror = mirrorFor(mirrorKeyOf(pending), questions)
  const question = questions[mirror.index]
  const draft = mirror.drafts[mirror.index]
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
    if (mirror.index < questions.length - 1) mirror.index += 1
  }
  draft.skipped = false
  return true
}

/**
 * Enter:通用问答推进/提交(镜像态),计划评审 = 确认执行。
 *
 * 语义对齐上游 QuestionFlow.continueFlow / submitDrafts:
 * - 当前题未作答 → 不吞键(焦点在自定义文本框等场景交回卡片自身处理);
 * - 非最后一题 → 翻到下一题;
 * - 最后一题 → 按 answers 批量结算(单选且带 custom 时丢弃 selected,多选保留)。
 */
export function submitQuestion(services: Services): boolean {
  const pending = pendingQuestion(services)
  if (pending === undefined) return false
  pruneMirrors(pendingMap(services))

  if (pending.kind === 'plan-review') return answerPlanReview(pending, 'approve')

  const questions = pending.questions ?? []
  if (questions.length === 0) return false
  const key = mirrorKeyOf(pending)
  const mirror = mirrorFor(key, questions)
  const draft = mirror.drafts[mirror.index]
  if (draft === undefined || !answered(draft)) return false

  if (mirror.index < questions.length - 1) {
    mirror.index += 1
    return true
  }

  // 理论上不可达(仅在作答后才前进),保留为防御:跳回未完成题且不吞键。
  const incomplete = mirror.drafts.findIndex((item) => !item.skipped && !answered(item))
  if (incomplete >= 0) {
    mirror.index = incomplete
    return false
  }

  if (typeof pending.answer !== 'function') return false
  const answers = questions.map((item, index) => {
    const value = mirror.drafts[index] ?? { selected: [], custom: '', skipped: false }
    if (value.skipped) return { id: item.id, selected: [] }
    const custom = value.custom.trim()
    return {
      id: item.id,
      selected: custom === '' || item.multiSelect === true ? [...value.selected] : [],
      ...(custom === '' ? {} : { custom }),
    }
  })
  const settled = fireAndForget(() => pending.answer?.({ answers }))
  if (settled) questionMirrors.delete(key)
  return settled
}

/* ------------------------------------------------------------------ *
 * DOM 级(上游无可用服务面)
 * ------------------------------------------------------------------ */

/** 焦点是否在文本编辑目标上(分发 `editing` 态判定)。 */
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
 * 注:selectView / openView 是 slot 注入的 React 回调,上游没有可调用的服务面,
 * 故本动作维持 DOM 点击。
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
