/**
 * 最近步次统计的取值、窗口折叠与显示改写：纯函数，不碰 React 与 DOM。
 *
 * 取值规则：
 *   - `recentStepStats` 投影存在时**只**读投影（最近 7 个已结束 step 的逐步累计）；
 *     投影为空或无样本就返回 null，不回退到窗口，避免两套窗口口径混用；
 *   - 投影缺席时，用已加载窗口的最后 7 个 assistant 节点（有消息的步）兜底；
 *   - 没有样本不显示 `0秒`，也不改写 TPS。
 *
 * 全会话读数（{@link readSessionTotals}）只给气泡正文还原用：优先读上游
 * `sessionStats` 投影，缺席时按上游 `deriveStats` 的口径折叠已加载窗口。
 *
 * 显示只输出时长/TPS 本身，不带标签；时长格式与上游 `formatDuration` 逐字一致，
 * TPS 格式与上游 `formatTokensPerSecond` 逐字一致。
 */
import type { ConversationNode } from '@deepseek-ai/dsh-client-ui-conversation/client'
import {
  RECENT_STEPS,
  averageTTFT,
  formatTokensPerSecond,
  sumRecentSteps,
  tokensPerSecond,
  type DecodeTotals,
  type RecentStatsTotals,
  type RecentStepStats,
} from './recent-shared.ts'
import type { Translate } from './types.ts'

/** 窗口折叠出的 `assistant/message` 上报输出 token；缺失或非法时为 null。 */
function usageOutputTokens(usage: unknown): number | null {
  if (typeof usage !== 'object' || usage === null) return null
  const value = (usage as { outputTokens?: unknown }).outputTokens
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

/**
 * 已加载窗口内最后 {@link RECENT_STEPS} 个 assistant 节点（有消息的步）的 TTFT/解码累计。
 *
 * 这是投影缺席时的近似：没有 assistant 消息的步（失败、取消、进行中）不会占位，
 * 而宿主投影按 `step/start` 占位。只统计同时记录 `stepStartTime` 与 `firstTokenTime`
 * 的步；解码时间与 token 只在 assistant 节点带合法 outputTokens 时累计。
 *
 * @param nodes - 已落定的窗口节点。
 * @returns 四字段累计；没有节点时全为 0。
 */
export function foldRecentSteps(nodes: readonly ConversationNode[] | undefined): RecentStatsTotals {
  const totals: RecentStatsTotals = { ttftMs: 0, ttftSteps: 0, decodeMs: 0, decodeTokens: 0 }
  if (nodes === undefined) return totals

  type AssistantNode = Extract<ConversationNode, { kind: 'assistant' }>
  const assistants: AssistantNode[] = []
  for (const node of nodes) {
    if (node.kind === 'assistant') assistants.push(node)
  }

  for (const node of assistants.slice(-RECENT_STEPS)) {
    const timing = node.timing
    if (timing === undefined || timing.stepStartTime === null || timing.firstTokenTime === null) continue
    totals.ttftMs += Math.max(0, timing.firstTokenTime - timing.stepStartTime)
    totals.ttftSteps += 1
    const outputTokens = usageOutputTokens(node.usage)
    if (outputTokens === null) continue
    totals.decodeMs += Math.max(0, timing.completedTime - timing.firstTokenTime)
    totals.decodeTokens += outputTokens
  }
  return totals
}

/** 窗口取值结果：平均 TTFT 与 TPS 各自独立，可能只有其中一个有样本。 */
export interface RecentReading {
  /** 平均首 token 时长（毫秒）；没有样本时为 null。 */
  averageTTFT: number | null
  /** 输出速度（token/秒）；没有解码时间时为 null。 */
  tokensPerSecond: number | null
}

/**
 * 解析最近 7 步的读数：投影优先，缺席时才折叠窗口。
 * @param projection - `useProjection("recentStepStats")` 的值。
 * @param nodes - 投影缺席时的窗口节点。
 * @returns 平均 TTFT 与 TPS。
 */
export function readRecentStats(
  projection: readonly RecentStepStats[] | undefined,
  nodes: readonly ConversationNode[] | undefined,
): RecentReading {
  const totals = projection !== undefined
    ? sumRecentSteps(projection.slice(-RECENT_STEPS))
    : foldRecentSteps(nodes)
  return { averageTTFT: averageTTFT(totals), tokensPerSecond: tokensPerSecond(totals) }
}

/** 全会话的计数与解码累计；字段与上游 `sessionStats` 投影（及窗口折叠）对齐。 */
export interface SessionTotals extends DecodeTotals {
  /** 出现过 assistant 消息的 turn 数。 */
  turns: number
  /** assistant 消息数：每一步一条。 */
  steps: number
}

/**
 * 已加载窗口的全会话计数与解码累计（投影缺席时的兜底，口径对齐上游 `deriveStats`）。
 *
 * 计数只认 assistant 节点；解码时间与 token 只累计同时有首 token 与合法
 * `outputTokens` 的节点，与上游把两者成对累加的规则一致。
 *
 * @param nodes - 已落定的窗口节点。
 * @returns 计数与解码累计；没有节点时全为 0。
 */
export function foldSessionTotals(nodes: readonly ConversationNode[] | undefined): SessionTotals {
  const totals: SessionTotals = { turns: 0, steps: 0, decodeMs: 0, decodeTokens: 0 }
  if (nodes === undefined) return totals

  const turns = new Set<number>()
  for (const node of nodes) {
    if (node.kind !== 'assistant') continue
    turns.add(node.turn)
    totals.steps += 1
    const timing = node.timing
    if (timing === undefined || timing.firstTokenTime === null) continue
    const outputTokens = usageOutputTokens(node.usage)
    if (outputTokens === null) continue
    totals.decodeMs += Math.max(0, timing.completedTime - timing.firstTokenTime)
    totals.decodeTokens += outputTokens
  }
  totals.turns = turns.size
  return totals
}

/** 非负有限数字；其它形状返回 null。 */
function nonNegative(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

/**
 * 解析全会话计数：`sessionStats` 投影优先，缺席（或字段不合法）时折叠窗口。
 *
 * @param projection - `useProjection("sessionStats")` 的值（上游投影，本插件只读四个字段）。
 * @param nodes - 投影缺席时的窗口节点。
 * @returns 计数与解码累计。
 */
export function readSessionTotals(
  projection: unknown,
  nodes: readonly ConversationNode[] | undefined,
): SessionTotals {
  if (typeof projection === 'object' && projection !== null) {
    const record = projection as Record<string, unknown>
    const turns = nonNegative(record.turns)
    const steps = nonNegative(record.steps)
    const decodeMs = nonNegative(record.decodeMs)
    const decodeTokens = nonNegative(record.decodeTokens)
    if (turns !== null && steps !== null && decodeMs !== null && decodeTokens !== null) {
      return { turns, steps, decodeMs, decodeTokens }
    }
  }
  return foldSessionTotals(nodes)
}

/** 气泡正文里要还原的两对文本。 */
export interface DialogTexts {
  /** 标题值当前文本（`计数 · 最近时长`）；标题没被追加时长时为 null。 */
  countsFrom: string | null
  /** 标题值应显示的全会话计数（`计数`）。 */
  countsTo: string | null
  /** 速度行当前文本（最近 7 步 TPS）；速度行没被改写时为 null。 */
  speedFrom: string | null
  /** 速度行应显示的全会话 TPS。 */
  speedTo: string | null
}

/**
 * 把按钮读数与全会话读数配成气泡里要还原的两对文本。
 *
 * 按钮第一段追加了最近时长、速度段换成了最近 TPS；气泡的标题值复用第一段、
 * 速度行复用速度段，所以要按按钮上的文本原样找回再换成全会话文本。
 *
 * @param t - 上游聊天字典座位。
 * @param counts - 全会话轮/步计数（标题值的基数）。
 * @param readings - 最近 7 步的时长文本、TPS 数值与全会话 TPS 数值。
 * @returns 两对 from/to；对应文本没被改写时该对为 null。
 */
export function dialogReadings(
  t: Translate,
  counts: { turns: number; steps: number },
  readings: { segment: string | null; recentTps: number | null; sessionTps: number | null },
): DialogTexts {
  const baseCounts = t('stats.counts', { turns: counts.turns, steps: counts.steps })
  const countsFrom = readings.segment === null ? null : `${baseCounts} · ${readings.segment}`
  const countsTo = countsFrom === null ? null : baseCounts

  const recentSpeed = readings.recentTps === null
    ? null
    : t('message.tokensPerSecond', { tps: formatTokensPerSecond(readings.recentTps) })
  const sessionSpeed = readings.sessionTps === null
    ? null
    : t('message.tokensPerSecond', { tps: formatTokensPerSecond(readings.sessionTps) })
  const changed = recentSpeed !== null && sessionSpeed !== null && recentSpeed !== sessionSpeed

  return {
    countsFrom,
    countsTo,
    speedFrom: changed ? recentSpeed : null,
    speedTo: changed ? sessionSpeed : null,
  }
}

/**
 * 与上游 `formatDuration` 逐字一致的时长文本。
 *
 * @param ms - 时长，毫秒。
 * @param t - 聊天字典座位（复用 `duration.compactSeconds` / `compactMinutes`）。
 * @returns `<60s` 时保留 1 位小数（`2.3秒`），否则 `2分5秒`。
 */
export function formatDuration(ms: number, t: Translate): string {
  const s = ms / 1e3
  if (s < 60) return t('duration.compactSeconds', { seconds: Math.round(s * 10) / 10 })
  const whole = Math.round(s)
  return t('duration.compactMinutes', { minutes: Math.floor(whole / 60), seconds: whole % 60 })
}

/** `withRecentReadings` 需要的预格式化读数。 */
export interface RecentDisplayReadings {
  /** 平均 TTFT 的裸时长（如 `2.3秒`），或 null。 */
  segment: string | null
  /** 最近 7 步的 TPS 文本（如 `45` / `4.5`），或 null。 */
  tps: string | null
}

/**
 * 改写统计按钮收到的 `t`：
 *   - `stats.counts` 的结果后追加 ` · 时长`；
 *   - `message.tokensPerSecond` 改用最近 7 步的 TPS 文本；
 *   - 其它 key 原样转发。
 *
 * 这个 `t` 只交给被遮蔽的 `ActivityPill`；按钮第一段、tooltip、`aria-label`、气泡标题值
 * 共享 `stats.counts`，气泡速度行共享 `message.tokensPerSecond`，因此按钮与气泡会一起变。
 * 气泡正文要回全会话口径，由 `src/dialog.ts` 在气泡挂载后把这两处文本节点改回去；
 * 气泡正文的 TTFT 行由上游内部直接算，本来就不经过这两个 key。
 *
 * @param t - 上游交给 ActivityPill 的聊天字典座位。
 * @param readings - 已格式化的读数；两项都为 null 时原样返回 `t`。
 * @returns 改写后的 translate。
 */
export function withRecentReadings(t: Translate, readings: RecentDisplayReadings): Translate {
  if (readings.segment === null && readings.tps === null) return t
  return (key, params) => {
    if (key === 'stats.counts' && readings.segment !== null) return `${t(key, params)} · ${readings.segment}`
    if (key === 'message.tokensPerSecond' && readings.tps !== null) return t(key, { ...params, tps: readings.tps })
    return t(key, params)
  }
}

/** 重新导出 TPS 格式化，供客户端与测试使用。 */
export { formatTokensPerSecond }
