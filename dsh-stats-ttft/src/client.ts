/**
 * 浏览器半部：把会话平均首 token 时长（TTFT）直接并进输入框下方的「性能」统计按钮。
 *
 * 上游 `@deepseek-ai/dsh-client-ui-chat` 的 `ActivityPill` 把按钮读数拼成
 * `t("stats.counts") · t("message.tokensPerSecond")`；TTFT 只在点开「会话统计」气泡后
 * 才有一行。本插件在 `conversation.composer.dock` 槽里按 id 遮蔽 `activity` 条目，
 * 包装源组件并只替换它的 `t`：没有标签，只在第一段后面追加纯时长，
 * 得到「12 轮 34 步 · 2.3秒 · 45.0 tok/s」。不新增标签、不改气泡、不拦截点击。
 *
 * 上游锚点、已知边界与验证方式见 docs/dsh-stats-ttft.md。
 */
import * as React from 'react'
import { STATS_ID, STATS_SLOT, createShadowState, reconcileShadow, withdrawShadow } from './shadow.ts'
import { averageTTFT, formatDuration, withDuration } from './ttft.ts'
import type {
  AssistantNode,
  ClientContext,
  SessionStatsReading,
  ShadowSlots,
  Translate,
  UseChat,
  UseProjection,
} from './types.ts'

export const name = 'dsh-stats-ttft'

/** 需要的 cordis 服务：槽位注册表。 */
export const inject = ['slots']

/** `slots` 服务在本插件里的服务名。 */
const SLOTS_SERVICE = 'slots'

/**
 * 自检窗口里两次探测之间的间隔（毫秒）；与 dsh-jobs-optimize 同一口径。
 */
export const MISSING_PROBE_MS = 50

/**
 * 自检窗口的探测次数：窗口 ≈ `MISSING_PROBE_MS × MISSING_PROBE_ATTEMPTS` ≈ 1 秒。
 * 覆盖客户端 roster 的启动期；一旦遮蔽成功过就不再探测。
 */
export const MISSING_PROBE_ATTEMPTS = 20

/** 标准 props 缺席时的空 projection 座位（仍按 hook 调用，保持 hook 顺序稳定）。 */
function useNoProjection(): unknown {
  return undefined
}

/** 标准 props 缺席时的空 Chat 座位。 */
function useNoChat(): unknown {
  return undefined
}

/**
 * 把源组件包进「按钮读数带 TTFT 时长」的包装层。
 *
 * 包装层不读业务面之外的东西，把 props 原样透传给源组件；只覆盖 `t`。TTFT 优先读
 * `sessionStats` projection，投影缺席时用 `useChat` 的窗口节点折叠兜底；没有样本时
 * `t` 原样透传，按钮读数与上游完全一致。
 *
 * @param Inner - 上游那个统计按钮组件（`ActivityPill`）。
 * @returns 包装组件；把它交给 `slots.register()` 即可。
 */
export function withTTFTDuration(Inner: unknown): unknown {
  function ActivityWithTTFTDuration(props: Record<string, unknown>): React.ReactElement {
    const t = props.t as Translate | undefined
    const useProjection = (
      typeof props.useProjection === 'function' ? props.useProjection : useNoProjection
    ) as UseProjection
    const useChat = (typeof props.useChat === 'function' ? props.useChat : useNoChat) as UseChat

    const projection = useProjection('sessionStats') as SessionStatsReading | undefined
    const nodes = useChat((snapshot) => snapshot?.legacy?.nodes) as readonly AssistantNode[] | undefined
    const average = averageTTFT(projection, nodes)
    const segment = average === null || typeof t !== 'function'
      ? null
      : formatDuration(average, t) || null
    const merged = React.useMemo(
      () => (typeof t === 'function' ? withDuration(t, segment) : t),
      [t, segment],
    )

    return React.createElement(
      Inner as React.ComponentType<Record<string, unknown>>,
      { ...props, t: merged },
    )
  }
  return ActivityWithTTFTDuration
}

/** 读取 `slots` 服务；服务缺席或形状不符时返回 undefined。 */
function getSlots(ctx: ClientContext): ShadowSlots | undefined {
  if (typeof ctx.get !== 'function') return undefined
  const value = ctx.get(SLOTS_SERVICE)
  if (value === null || typeof value !== 'object') return undefined
  const candidate = value as Partial<ShadowSlots>
  if (typeof candidate.entries !== 'function' || typeof candidate.register !== 'function') return undefined
  return value as ShadowSlots
}

/** 输出一条带插件名前缀的告警。 */
function warn(message: string, detail?: unknown): void {
  if (detail === undefined) console.warn(`[${name}] ${message}`)
  else console.warn(`[${name}] ${message}`, detail)
}

/** 一次延迟自检；没有定时器的环境里直接同步跑。 */
function whenLater(ms: number, run: () => void): void {
  if (typeof setTimeout === 'function') setTimeout(run, ms)
  else run()
}

/** 在一个客户端上下文上安装遮蔽。 */
export function apply(ctx: ClientContext): void {
  const slots = getSlots(ctx)
  if (slots === undefined) return

  const state = createShadowState()
  let attemptsLeft = MISSING_PROBE_ATTEMPTS
  let probeScheduled = false
  let missingReported = false
  let installedOnce = false
  let disposed = false

  /**
   * 扫一遍账本并把遮蔽项对到当前状态；账本上还没有 `activity` 时在有界窗口内继续探测，
   * 窗口走完仍没有才算 ui-chat 缺席，告警一次。
   *
   * 自检只针对「从来没找到过源项」：一旦遮蔽成功过，源项此后消失（ui-chat 被卸载，
   * 或它的条目因崩溃退位）是账本变化的正常结果，撤回即可，再报「未找到」会把一次
   * 成功的接管说成失效。
   */
  const reapply = (): void => {
    if (disposed) return
    let outcome
    try {
      outcome = reconcileShadow(slots, state, withTTFTDuration)
    } catch (error) {
      warn('遮蔽 activity 失败:', error)
      return
    }
    if (outcome === 'install' || outcome === 'replace') installedOnce = true
    // 其余结果都表示源项已就位（或刚被撤回），没有任何要等的条目。
    if (outcome !== 'absent' || installedOnce || missingReported || probeScheduled) return
    probeScheduled = true
    whenLater(MISSING_PROBE_MS, () => {
      probeScheduled = false
      if (disposed || missingReported) return
      attemptsLeft -= 1
      if (attemptsLeft > 0) {
        reapply()
        return
      }
      missingReported = true
      warn(`未找到 ${STATS_SLOT}#${STATS_ID}；统计按钮保持上游原样`)
    })
  }

  if (typeof slots.inject !== 'function') {
    reapply()
    return
  }

  slots.inject(STATS_SLOT, () => {
    reapply()
    const unsubscribe = typeof slots.subscribe === 'function' ? slots.subscribe(STATS_SLOT, reapply) : undefined
    return () => {
      // 卸载后不再对账，也不再推进自检窗口：待触发的那一拍会自行返回。
      disposed = true
      if (typeof unsubscribe === 'function') unsubscribe()
      withdrawShadow(state)
    }
  })
}
