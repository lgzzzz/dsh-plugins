/**
 * dsh-kbd-hotkeys — 通用问答卡片的草稿 store 访问层。
 *
 * 通用问答(ask_user_question)的选中态**唯一真源**是上游卡片自己的 Session 级
 * slot store(dsh-client-ui-user-questions 的 `createQuestionDraftStore`,注册在
 * `conversation.composer` 链式 slot 的注册项上)。热键必须写这份 store,卡片才会
 * 实时高亮 / 翻题 / 与鼠标点选共用同一状态;插件自己再镜像一份会导致
 * 「按键被吞掉,但卡片外观毫无变化」——这正是此前 1/2/3「无法触发」的成因。
 *
 * 取数路径(全部是上游公开面,不触碰 DOM):
 *
 * 1. `slots.entries('conversation.composer')` → 注册项;用注册项自带的 `select`
 *    确认它就是承载当前待处理交互的那一个(chain slot 的路由契约,与渲染端
 *    选举用的是同一个函数);
 * 2. `uiSession.resolve(sessionId)` → 该会话**已物化的作用域绑定**
 *    (`{ key, ctx, hooks, … }`,与 UiSession 内部 `bindStoreScope` 同一对象);
 * 3. `slots.resolveStore(handle, binding)` → 活实例(与卡片渲染同一份内存态),
 *    动作面为 `defineStore` 产出的 `actions.replace` / `actions.clear`。
 *
 * **无降级**:上述任一环节不可用即返回 `undefined`,调用方 no-op——不猜、不写 DOM、
 * 也不在插件内另存一份镜像状态。快照不属于当前请求(`requestKey` 不匹配或题数不符)时按上游
 * `QuestionFlow` 的 `initialProgress` 语义重建空进度,与卡片自身 `?? initialProgress`
 * 完全一致,不属于降级。
 */
import type {
  PendingInteractionLike,
  PendingQuestionItemLike,
  QuestionDraftLike,
  QuestionDraftSnapshotLike,
  QuestionDraftStoreLike,
  QuestionProgressLike,
  Services,
  SlotEntryLike,
  SlotsLike,
  UiSessionLike,
} from './types.ts'

/** 问答卡片注册的链式 slot 名(dsh-client-ui-conversation 声明,scope=session)。 */
const COMPOSER_SLOT = 'conversation.composer'

/**
 * 解析承载当前待处理问答的草稿 store 活实例。
 *
 * @param services - 已解析服务集合。
 * @param pending - 当前待处理的问答载体(其 `select` 匹配目标)。
 * @param sessionId - 载体所属会话 id(store 的 session 作用域 key)。
 * @returns 活实例;权威来源不可用时 `undefined`(调用方 no-op)。
 */
export function questionDraftStore(
  services: Services,
  pending: PendingInteractionLike,
  sessionId: string,
): QuestionDraftStoreLike | undefined {
  const slots = services.slots
  const uiSession = services.uiSession
  if (slots === null || slots === undefined || uiSession === null || uiSession === undefined) return undefined
  if (typeof slots.entries !== 'function' || typeof slots.resolveStore !== 'function') return undefined

  const binding = resolveBinding(uiSession, sessionId)
  if (binding === undefined) return undefined

  for (const entry of entriesOf(slots)) {
    const handle = entry?.store
    if (handle === undefined || handle === null) continue
    if (!entryOwnsPending(entry, pending, sessionId)) continue
    let instance: unknown
    try {
      instance = slots.resolveStore(handle, binding)
    } catch {
      return undefined
    }
    return asDraftStore(instance)
  }
  return undefined
}

/** 该注册项是否就是承载当前待处理交互的那一个(注册项的 select 返回非空)。 */
function entryOwnsPending(entry: SlotEntryLike, pending: PendingInteractionLike, sessionId: string): boolean {
  const select = entry.select
  if (typeof select !== 'function') return false
  try {
    const matched = select({ sessionId, pendingInteraction: pending })
    return matched !== null && matched !== undefined
  } catch {
    // 与渲染端一致:选择器抛错视为不匹配(chain 选举里同样是「treating as declined」)。
    return false
  }
}

/** slots 注册项列表(服务异常 / 形状不符时视为不可用)。 */
function entriesOf(slots: SlotsLike): readonly SlotEntryLike[] {
  try {
    const entries = slots.entries?.(COMPOSER_SLOT)
    return Array.isArray(entries) ? entries : []
  } catch {
    return []
  }
}

/** 取会话的作用域绑定(必须带字符串 key,否则 store 无法按会话解析)。 */
function resolveBinding(uiSession: UiSessionLike, sessionId: string): unknown {
  const resolve = uiSession.resolve
  if (typeof resolve !== 'function') return undefined
  let binding: unknown
  try {
    binding = resolve.call(uiSession, sessionId)
  } catch {
    return undefined
  }
  if (typeof binding !== 'object' || binding === null) return undefined
  const key = (binding as { key?: unknown }).key
  return typeof key === 'string' && key !== '' ? binding : undefined
}

/** 形状校验:活实例必须同时提供 `getSnapshot()` 与 `actions.replace()`。 */
function asDraftStore(value: unknown): QuestionDraftStoreLike | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as QuestionDraftStoreLike
  if (typeof candidate.getSnapshot !== 'function') return undefined
  const actions = candidate.actions
  if (typeof actions !== 'object' || actions === null) return undefined
  if (typeof actions.replace !== 'function') return undefined
  return candidate
}

/** 空进度(上游 QuestionFlow.initialProgress 同形)。 */
export function freshProgress(questions: readonly PendingQuestionItemLike[]): QuestionProgressLike {
  return { index: 0, drafts: questions.map(() => ({ selected: [], custom: '', skipped: false })) }
}

/**
 * 读当前进度。
 *
 * 快照属于本次请求(`requestKey` 一致且题数一致)时**克隆**一份可安全改写的副本
 * (store 快照是 immer 冻结对象);否则按上游 `initialProgress` 重建。
 */
export function readProgress(
  store: QuestionDraftStoreLike,
  requestKey: string,
  questions: readonly PendingQuestionItemLike[],
): QuestionProgressLike {
  const snapshot = asSnapshot(store.getSnapshot?.())
  if (snapshot === undefined || snapshot.requestKey !== requestKey) return freshProgress(questions)
  const progress = snapshot.progress
  if (progress === undefined) return freshProgress(questions)
  const drafts = progress.drafts
  if (!Array.isArray(drafts) || drafts.length !== questions.length) return freshProgress(questions)
  const index = progress.index
  return {
    index:
      typeof index === 'number' && Number.isInteger(index) && index >= 0 && index < questions.length ? index : 0,
    drafts: drafts.map(cloneDraft),
  }
}

/** 快照形状校验。 */
function asSnapshot(value: unknown): QuestionDraftSnapshotLike | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  return value as QuestionDraftSnapshotLike
}

/** 克隆单题草稿(只保留消费字段)。 */
function cloneDraft(draft: QuestionDraftLike): QuestionDraftLike {
  return {
    selected: Array.isArray(draft?.selected) ? [...draft.selected] : [],
    custom: typeof draft?.custom === 'string' ? draft.custom : '',
    skipped: draft?.skipped === true,
  }
}

/** 写回进度(卡片据此重渲染);返回是否已发出调用。 */
export function writeProgress(
  store: QuestionDraftStoreLike,
  requestKey: string,
  progress: QuestionProgressLike,
): boolean {
  const replace = store.actions?.replace
  if (typeof replace !== 'function') return false
  try {
    replace.call(store.actions, requestKey, progress)
    return true
  } catch {
    return false
  }
}

/** 结算后清理本次请求的草稿(上游 QuestionFlow 应答成功后同样 clear)。 */
export function clearProgress(store: QuestionDraftStoreLike, requestKey: string): void {
  const clear = store.actions?.clear
  if (typeof clear !== 'function') return
  try {
    clear.call(store.actions, requestKey)
  } catch {
    // 结算后卡片随即卸载,清理失败无副作用。
  }
}
