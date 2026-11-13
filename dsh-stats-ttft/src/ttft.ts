/**
 * 首 token 时长（TTFT）的读取、折叠与显示格式化：纯函数，不碰 React 与 DOM。
 *
 * 取值规则与上游一致：
 *   - 有 `sessionStats` projection 时**只**读投影（与上游 `useSessionStats` 相同，
 *     不把窗口折叠混进来）；`ttftSteps === 0` 表示没有样本，返回 null；
 *   - 投影缺席时，按窗口内 assistant 节点的 `stepStartTime` / `firstTokenTime`
 *     折叠兜底（上游 `deriveStats` 的同款规则）。
 *
 * 显示只输出时长本身（`2.3秒` / `2分5秒`），不带「首 token 平均（TTFT）」字样；
 * 时长格式与上游 `formatDuration` 逐字一致。
 */
import type { ConversationNode } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionStatsProjection, Translate } from './types.ts'

/** 窗口折叠的 TTFT 合计与样本数。 */
export interface FoldedTTFT {
  /** 已记录首 token 的步骤的延迟总和，毫秒。 */
  ms: number
  /** 参与求和的步骤数。 */
  steps: number
}

/**
 * 按上游 `deriveStats` 的规则折叠窗口内的 TTFT。
 *
 * 只有 `kind === "assistant"` 且 `timing` 同时记录 `stepStartTime` 与
 * `firstTokenTime` 的节点计入；单步延迟取 `max(0, firstTokenTime - stepStartTime)`。
 *
 * @param nodes - 已落定的窗口节点。
 * @returns 求和与样本数；没有节点时两者都是 0。
 */
export function foldTTFT(nodes: readonly ConversationNode[] | undefined): FoldedTTFT {
  let ms = 0
  let steps = 0
  if (nodes === undefined) return { ms, steps }
  for (const node of nodes) {
    if (node.kind !== 'assistant') continue
    const timing = node.timing
    if (timing === undefined || timing.stepStartTime === null || timing.firstTokenTime === null) continue
    ms += Math.max(0, timing.firstTokenTime - timing.stepStartTime)
    steps += 1
  }
  return { ms, steps }
}

/**
 * 平均首 token 时长。
 *
 * @param projection - `useProjection("sessionStats")` 的值；存在时以它为准。
 * @param nodes - 投影缺席时用于折叠兜底的窗口节点。
 * @returns 平均毫秒数；没有样本或数值不合法时返回 null。
 */
export function averageTTFT(
  projection: SessionStatsProjection | undefined,
  nodes: readonly ConversationNode[] | undefined,
): number | null {
  if (projection !== undefined) {
    if (!Number.isFinite(projection.ttftMs) || !Number.isFinite(projection.ttftSteps)) return null
    if (projection.ttftSteps <= 0) return null
    return Math.max(0, projection.ttftMs) / projection.ttftSteps
  }
  const folded = foldTTFT(nodes)
  return folded.steps > 0 ? folded.ms / folded.steps : null
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

/**
 * 只改写统计按钮第一段的译文：在 `stats.counts` 的结果后追加「 · 时长」。
 *
 * 这个 `t` 只交给被遮蔽的 `ActivityPill`，其它组件不受影响；按钮第一段、tooltip
 * 完整读数、`aria-label` 与气泡标题值都复用同一段译文，因此都会带上时长。
 * `segment` 为 null（没有 TTFT）时原样返回 `t`，避免无意义的 memo 失效。
 *
 * @param t - 上游交给 ActivityPill 的聊天字典座位。
 * @param segment - 已经格式化好的纯时长（如 `2.3秒`），或 null。
 * @returns 只对 `stats.counts` 追加时长的 translate。
 */
export function withDuration(t: Translate, segment: string | null): Translate {
  if (segment === null) return t
  return (key, params) => {
    const text = t(key, params)
    return key === 'stats.counts' ? `${text} · ${segment}` : text
  }
}
