/** 通用问答草稿 store 访问层(卡片选中态唯一真源,插件不镜像)。
 * 三步取数:slots.entries('conversation.composer') → 会话作用域绑定 → slots.resolveStore;无降级。 */
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
} from './types.ts'
import { sessionScopeBinding } from './scope-binding.ts'

/** 问答卡片注册的链式 slot 名（scope=session）。 */
const COMPOSER_SLOT = 'conversation.composer'

/** 解析承载当前问答的草稿 store 活实例；权威来源不可用即 undefined（调用方 no-op）。 */
export function questionDraftStore(
  services: Services,
  pending: PendingInteractionLike,
  sessionId: string,
): QuestionDraftStoreLike | undefined {
  const slots = services.slots
  if (slots === null || slots === undefined) return undefined
  if (typeof slots.entries !== 'function' || typeof slots.resolveStore !== 'function') return undefined

  const binding = sessionScopeBinding(services, sessionId)
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

/** 该注册项是否承载当前待处理交互（注册项的 select 返回非空）。 */
function entryOwnsPending(entry: SlotEntryLike, pending: PendingInteractionLike, sessionId: string): boolean {
  const select = entry.select
  if (typeof select !== 'function') return false
  try {
    const matched = select({ sessionId, pendingInteraction: pending })
    return matched !== null && matched !== undefined
  } catch {
    // 与渲染端一致：选择器抛错视为不匹配。
    return false
  }
}

/** slots 注册项列表（服务异常 / 形状不符即空）。 */
function entriesOf(slots: SlotsLike): readonly SlotEntryLike[] {
  try {
    const entries = slots.entries?.(COMPOSER_SLOT)
    return Array.isArray(entries) ? entries : []
  } catch {
    return []
  }
}

/** 形状校验：活实例须同时提供 getSnapshot() 与 actions.replace()。 */
function asDraftStore(value: unknown): QuestionDraftStoreLike | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as QuestionDraftStoreLike
  if (typeof candidate.getSnapshot !== 'function') return undefined
  const actions = candidate.actions
  if (typeof actions !== 'object' || actions === null) return undefined
  if (typeof actions.replace !== 'function') return undefined
  return candidate
}

/** 空进度（同上游 QuestionFlow.initialProgress）。 */
export function freshProgress(questions: readonly PendingQuestionItemLike[]): QuestionProgressLike {
  return { index: 0, drafts: questions.map(() => ({ selected: [], custom: '', skipped: false })) }
}

/** 读当前进度：requestKey 与题数一致时克隆一份可改写副本（快照冻结），否则重建空进度。 */
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

function asSnapshot(value: unknown): QuestionDraftSnapshotLike | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  return value as QuestionDraftSnapshotLike
}

/** 克隆单题草稿（只保留消费字段）。 */
function cloneDraft(draft: QuestionDraftLike): QuestionDraftLike {
  return {
    selected: Array.isArray(draft?.selected) ? [...draft.selected] : [],
    custom: typeof draft?.custom === 'string' ? draft.custom : '',
    skipped: draft?.skipped === true,
  }
}

/** 写回进度（卡片据此重渲染）；返回是否已发出调用。 */
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

/** 结算后清理本次请求的草稿。 */
export function clearProgress(store: QuestionDraftStoreLike, requestKey: string): void {
  const clear = store.actions?.clear
  if (typeof clear !== 'function') return
  try {
    clear.call(store.actions, requestKey)
  } catch {
  }
}
