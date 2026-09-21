/**
 * 通知判定(纯逻辑:无 DOM、无 cordis、无 Notification)。
 * 输入是 uiSession.sessionStatus 的相邻两帧,输出是「这次该发什么」。
 * 只认状态差,不认当前值:挂载时已经跑着的回合 / 已经等着的卡片不补发。
 */
import type { PendingInteractionLike, SessionStatusLike, SessionSummaryLike } from './types.ts'

/** 通知原因。 */
export type NotifyReason = 'turn-complete' | 'approval' | 'question' | 'plan-review'

/** 一帧输入:全量状态表 + 会话列表行(取标题与子代理标记)。 */
export interface PolicySnapshot {
  statuses: ReadonlyMap<string, SessionStatusLike>
  rows: Readonly<Record<string, SessionSummaryLike>>
}

/** 一条待发通知(纯数据;真正发送由 delivery 完成)。 */
export interface PlannedNotification {
  sessionId: string
  reason: NotifyReason
  /** 系统通知标题。 */
  title: string
  /** 系统通知正文。 */
  body: string
  /** 同一会话同一原因的通知互相替换,而不是堆满通知中心。 */
  tag: string
}

export interface NotifyPolicy {
  observe(snapshot: PolicySnapshot): PlannedNotification[]
}

/** 正文长度上限(系统通知面板宽度有限)。 */
const BODY_LIMIT = 96

const TITLES: Readonly<Record<NotifyReason, string>> = {
  'turn-complete': 'DSH · 回合完成',
  approval: 'DSH · 需要你审批',
  question: 'DSH · 需要你回答',
  'plan-review': 'DSH · 计划待确认',
}

/** 单行化 + 截断。 */
function clip(text: string, limit: number = BODY_LIMIT): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= limit ? flat : `${flat.slice(0, limit - 1)}…`
}

/** 会话显示名:displayTitle → title → id。 */
function labelOf(row: SessionSummaryLike | undefined, sessionId: string): string {
  const display = row?.displayTitle
  if (display !== undefined && display !== '') return display
  const title = row?.title
  if (title !== undefined && title !== '') return title
  return sessionId
}

/** 待处理交互 → 通知原因(未知 kind 归入「需要你回答」)。 */
function reasonOf(interaction: PendingInteractionLike): NotifyReason {
  if (interaction.kind === 'approval') return 'approval'
  if (interaction.kind === 'plan-review') return 'plan-review'
  return 'question'
}

/** 待处理交互的正文细节:审批取工具名(+理由),问答 / 计划评审取首题题面。 */
function detailOf(interaction: PendingInteractionLike): string {
  if (interaction.kind === 'approval') {
    const tool = interaction.toolName
    const reason = interaction.reason
    if (tool !== undefined && tool !== '' && reason !== undefined && reason !== '') return `${tool} · ${reason}`
    if (tool !== undefined && tool !== '') return tool
    return '有一条工具调用等你决定'
  }
  const first = interaction.questions?.[0]
  const question = first?.question ?? first?.header ?? first?.detail
  if (question !== undefined && question !== '') return question
  return interaction.kind === 'plan-review' ? '计划已就绪,等你确认' : '有一个提问等你回答'
}

/**
 * 建一个判定器。
 * 规则(都只认相邻两帧的差异,且只针对顶层会话):
 * - 回合完成:running true → false;
 * - 需要你处理:pendingInteraction 出现,或换成新的 key。
 * 子代理会话(origin === 'subagent')与列表里查不到的行(取不到标题)一律不打扰。
 */
export function createNotifyPolicy(): NotifyPolicy {
  let baseline: Map<string, SessionStatusLike> | undefined
  return {
    observe(snapshot) {
      const next = new Map<string, SessionStatusLike>()
      for (const [sessionId, status] of snapshot.statuses) next.set(sessionId, status)

      const plans: PlannedNotification[] = []
      if (baseline !== undefined) {
        for (const [sessionId, status] of next) {
          const row = snapshot.rows[sessionId]
          if (row === undefined || row.origin === 'subagent') continue
          const previous = baseline.get(sessionId)
          const label = labelOf(row, sessionId)

          if (previous?.running === true && status.running === false) {
            plans.push({
              sessionId,
              reason: 'turn-complete',
              title: TITLES['turn-complete'],
              body: clip(label),
              tag: `dsh-notify:${sessionId}:turn-complete`,
            })
          }

          const interaction = status.pendingInteraction
          if (interaction !== undefined && interaction.key !== previous?.pendingInteraction?.key) {
            const reason = reasonOf(interaction)
            const detail = detailOf(interaction)
            plans.push({
              sessionId,
              reason,
              title: TITLES[reason],
              body: clip(detail === '' ? label : `${label} · ${detail}`),
              tag: `dsh-notify:${sessionId}:${reason}`,
            })
          }
        }
      }

      baseline = next
      return plans
    },
  }
}
