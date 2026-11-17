/**
 * 宿主投影单元 `recentStepStats`：把持久日志折成最近 {@link RECENT_STEPS} 个**已结束**
 * step 的 TTFT / 解码累计，供浏览器半部算「最近 5 步平均 TTFT 与 TPS」。
 *
 * 窗口在 `step/end` 才落一条记录：进行中的步不计入，结束后才进窗口；失败/取消的步
 * 落零值记录占位、不贡献样本。
 *
 * 口径与上游 `sessionStats` 对齐：
 *   - `step/start` 记步起点；`assistant/attempt` 记录首次尝试的首 token；
 *   - `assistant/message` 收尾：TTFT 记一次样本，解码时间与 outputTokens 只在
 *     provider 上报 usage 时累计；
 *   - `llm/retry-started` 不清首 token，重试退避因此落在解码时间里（与上游一致）；
 *   - `step/end` 把该步的累计写入环形窗口；没有 assistant 消息的步写零值。
 *
 * 视图直接返回 `state.steps` 数组：步内事件（尝试、消息）不替换数组，不触发 change
 * feed；只有 `step/end` 落步时才发布新值。
 *
 * @module dsh-stats-ttft/recent
 */
import { z } from 'zod'
import { assistantStreamFirstTokenTime } from '@deepseek-ai/dsh-llm/assistant-stream'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { RECENT_STEPS, type RecentStepStats } from './recent-shared.ts'

/** 一个已结束 step 的零值记录。 */
function emptyStep(turn: number, step: number): RecentStepStats {
  return { turn, step, ttftMs: 0, ttftSteps: 0, decodeMs: 0, decodeTokens: 0 }
}

/** `assistant/message` 上报的 completion tokens；缺失或非法时返回 null。 */
function usageOutputTokens(usage: unknown): number | null {
  if (typeof usage !== 'object' || usage === null) return null
  const value = (usage as { outputTokens?: unknown }).outputTokens
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

/** 当前打开的步：边界事实 + 已累计的样本；`settled` 后同一步的重复消息被忽略。 */
interface OpenStep {
  turn: number
  step: number
  startTime: number
  firstTokenTime: number | null
  ttftMs: number
  ttftSteps: number
  decodeMs: number
  decodeTokens: number
  settled: boolean
}

/** 投影状态：已结束步的环形窗口 + 当前步；纯 JSON。 */
interface RecentStepStatsState {
  steps: RecentStepStats[]
  open: OpenStep | null
}

/** 把一步写进环形窗口；同一步重复落步时替换，窗口裁到最近 {@link RECENT_STEPS} 步。 */
function commitStep(state: RecentStepStatsState, record: RecentStepStats): RecentStepStatsState {
  const index = state.steps.findIndex(item => item.turn === record.turn && item.step === record.step)
  const steps = index === -1
    ? [...state.steps, record]
    : state.steps.map((item, at) => (at === index ? record : item))
  return { ...state, steps: steps.slice(-RECENT_STEPS) }
}

const recentStepSchema = z.object({
  turn: z.number().int().nonnegative(),
  step: z.number().int().nonnegative(),
  ttftMs: z.number().nonnegative(),
  ttftSteps: z.number().int().nonnegative(),
  decodeMs: z.number().nonnegative(),
  decodeTokens: z.number().nonnegative(),
}).strict()

const recentStepsSchema = z.array(recentStepSchema)

const recentStepStatsStateSchema = z.object({
  steps: recentStepsSchema,
  open: z.object({
    turn: z.number().int().nonnegative(),
    step: z.number().int().nonnegative(),
    startTime: z.number().nonnegative(),
    firstTokenTime: z.number().nonnegative().nullable(),
    ttftMs: z.number().nonnegative(),
    ttftSteps: z.number().int().nonnegative(),
    decodeMs: z.number().nonnegative(),
    decodeTokens: z.number().nonnegative(),
    settled: z.boolean(),
  }).strict().nullable(),
}).strict()

/** `recentStepStats` 投影单元（注册方见宿主 `index.ts`）。 */
export const recentStepStatsProjectionDefinition = {
  key: 'recentStepStats',
  stateVersion: 1,
  stateSchema: recentStepStatsStateSchema,
  init: () => ({ steps: [], open: null }),
  apply: (state, event) => {
    switch (event.type) {
      case 'step/start':
        return {
          ...state,
          open: {
            turn: event.data.turn,
            step: event.data.step,
            startTime: event.time,
            firstTokenTime: null,
            ttftMs: 0,
            ttftSteps: 0,
            decodeMs: 0,
            decodeTokens: 0,
            settled: false,
          },
        }
      case 'assistant/attempt': {
        const open = state.open
        if (open === null || open.turn !== event.data.turn || open.step !== event.data.step) return state
        if (open.firstTokenTime !== null) return state
        const firstTokenTime = assistantStreamFirstTokenTime(event.data.stream)
        if (firstTokenTime === undefined) return state
        return { ...state, open: { ...open, firstTokenTime } }
      }
      case 'assistant/message': {
        const open = state.open
        if (open === null || open.settled) return state
        if (open.turn !== event.data.turn || open.step !== event.data.step) return state
        const firstTokenTime = open.firstTokenTime ?? assistantStreamFirstTokenTime(event.data.stream) ?? null
        // 一个步只结算一条消息；settled 后重复消息不会再累计一次。
        const settled: OpenStep = { ...open, firstTokenTime, settled: true }
        if (firstTokenTime === null) return { ...state, open: settled }
        const outputTokens = usageOutputTokens(event.data.usage)
        return {
          ...state,
          open: {
            ...settled,
            ttftMs: open.ttftMs + Math.max(0, firstTokenTime - open.startTime),
            ttftSteps: open.ttftSteps + 1,
            decodeMs: open.decodeMs + (outputTokens === null ? 0 : Math.max(0, event.time - firstTokenTime)),
            decodeTokens: open.decodeTokens + (outputTokens ?? 0),
          },
        }
      }
      case 'step/end': {
        const open = state.open
        if (open !== null && open.turn === event.data.turn && open.step === event.data.step) {
          const record: RecentStepStats = {
            turn: open.turn,
            step: open.step,
            ttftMs: open.ttftMs,
            ttftSteps: open.ttftSteps,
            decodeMs: open.decodeMs,
            decodeTokens: open.decodeTokens,
          }
          return commitStep({ ...state, open: null }, record)
        }
        // 没有看到步起点（例如从半步恢复）：仍按「已结束的步」占位，但不带样本。
        // 已落过步的重复 step/end 不能把样本覆盖成零值。
        const known = state.steps.some(item => item.turn === event.data.turn && item.step === event.data.step)
        if (known) return { ...state, open: null }
        return commitStep({ ...state, open: null }, emptyStep(event.data.turn, event.data.step))
      }
      case 'turn/end':
        return state.open === null ? state : { ...state, open: null }
      default:
        return state
    }
  },
  wire: {
    viewSchema: recentStepsSchema,
    view: state => state.steps,
    summary: false,
  },
} satisfies ProjectionDefinition<'recentStepStats', RecentStepStatsState>
