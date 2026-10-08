/**
 * 通知策略:比较两次会话状态快照,产出「这一拍该弹哪些通知」。
 *
 * 第一次 `observe` 只建立基线、不产出任何通知 —— 它看到的都是「本来就如此」的状态,没有可比较
 * 的前值。之后每条判定都要求状态发生了具体变化:运行中转运行结束(`turn-complete`),或待处理
 * 交互的 `key` 变了(审批 / 提问 / 计划确认,同一条交互只报一次)。`origin === 'subagent'` 的
 * 会话不报:子智能体不面向用户。
 *
 * `tag` 按会话与原因区分,投递方配 `renotify: true` 使用:同一 tag 的后一条通知替换前一条;
 * 正文统一裁到 `BODY_LIMIT`。
 */
import type { SessionPendingInteraction, SessionStatus } from '@deepseek-ai/dsh-client-ui-session/client'
import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'

export type NotifyReason = 'turn-complete' | 'approval' | 'question' | 'plan-review'

export interface PolicySnapshot {
  statuses: ReadonlyMap<string, SessionStatus>
  rows: Readonly<Record<string, SessionSummary>>
}

export interface PlannedNotification {
  sessionId: string
  reason: NotifyReason
  title: string
  body: string
  tag: string
}

export interface NotifyPolicy {
  observe(snapshot: PolicySnapshot): PlannedNotification[]
}

const BODY_LIMIT = 96

const TITLES: Readonly<Record<NotifyReason, string>> = {
  'turn-complete': 'DSH · 回合完成',
  approval: 'DSH · 需要你审批',
  question: 'DSH · 需要你回答',
  'plan-review': 'DSH · 计划待确认',
}

function clip(text: string, limit: number = BODY_LIMIT): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= limit ? flat : `${flat.slice(0, limit - 1)}…`
}

function labelOf(row: SessionSummary | undefined, sessionId: string): string {
  const display = row?.displayTitle
  if (display !== undefined && display !== '') return display
  const title = row?.title
  if (title !== undefined && title !== '') return title
  return sessionId
}

function reasonOf(interaction: SessionPendingInteraction): NotifyReason {
  if (interaction.kind === 'approval') return 'approval'
  if (interaction.kind === 'plan-review') return 'plan-review'
  return 'question'
}

function detailOf(interaction: SessionPendingInteraction): string {
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

export function createNotifyPolicy(): NotifyPolicy {
  let baseline: Map<string, SessionStatus> | undefined
  return {
    observe(snapshot) {
      const next = new Map<string, SessionStatus>()
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
