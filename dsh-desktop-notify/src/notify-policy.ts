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
import type { SessionPendingInteraction } from '@deepseek-ai/dsh-client-ui-session/client'
// 会话状态类型由 `@deepseek-ai/dsh-client-ui-session-status` 提供。
import type { SessionStatus, SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session-status/client'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { ZH_TEXTS } from './locales.ts'

export type NotifyReason = 'turn-complete' | 'approval' | 'question' | 'plan-review'

/** 一次观察到的会话状态:UI 状态快照与会话目录行,都是上游的命名导出。 */
export interface PolicySnapshot {
  /** `uiSession.sessionStatus` 的快照。 */
  statuses: SessionStatusSnapshot
  /** `sessions.list` 快照里的会话目录行。 */
  rows: SessionListState['byId']
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

/** 判定器产出的可见文案；默认简体中文，浏览器半部按当前 locale 换成译文。 */
export interface NotifyTexts {
  /** 某一类通知的标题。 */
  title(reason: NotifyReason): string
  /** 审批提示没有工具名/原因时的兜底正文。 */
  approvalDetail(): string
  /** 提问没有正文时的兜底。 */
  questionDetail(): string
  /** 计划确认没有正文时的兜底。 */
  planReviewDetail(): string
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

function detailOf(interaction: SessionPendingInteraction, texts: NotifyTexts): string {
  if (interaction.kind === 'approval') {
    const tool = interaction.toolName
    const reason = interaction.reason
    if (tool !== undefined && tool !== '' && reason !== undefined && reason !== '') return `${tool} · ${reason}`
    if (tool !== undefined && tool !== '') return tool
    return texts.approvalDetail()
  }
  const first = interaction.questions?.[0]
  const question = first?.question ?? first?.header ?? first?.detail
  if (question !== undefined && question !== '') return question
  return interaction.kind === 'plan-review' ? texts.planReviewDetail() : texts.questionDetail()
}

/**
 * 建一个判定器。
 *
 * @param texts - 可见文案；省略时用简体中文（纯逻辑测试与 locale 缺席时）。
 * @returns 逐帧比较的判定器。
 */
export function createNotifyPolicy(texts: NotifyTexts = ZH_TEXTS): NotifyPolicy {
  let baseline: SessionStatusSnapshot | undefined
  return {
    observe(snapshot) {
      const next = new Map<SessionId, SessionStatus>()
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
              title: texts.title('turn-complete'),
              body: clip(label),
              tag: `dsh-notify:${sessionId}:turn-complete`,
            })
          }

          const interaction = status.pendingInteraction
          if (interaction !== undefined && interaction.key !== previous?.pendingInteraction?.key) {
            const reason = reasonOf(interaction)
            const detail = detailOf(interaction, texts)
            plans.push({
              sessionId,
              reason,
              title: texts.title(reason),
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
