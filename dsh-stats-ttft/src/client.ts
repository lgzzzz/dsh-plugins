/**
 * 浏览器半部：把「最近 5 步」的平均首 token 时长（TTFT）与输出速度（TPS）并进输入框
 * 下方的「性能」统计按钮；点开的气泡正文保持全会话口径。
 *
 * 上游 `@deepseek-ai/dsh-client-ui-chat` 的 `ActivityPill` 把按钮读数拼成
 * `t("stats.counts") · t("message.tokensPerSecond")`，并且同一份 `counts` / `speed`
 * 字符串也用在点开的气泡里（标题值与速度行）。两者在组件内部无法分开，所以本插件分两步：
 *
 *   1. 在 `conversation.composer.dock` 槽里按 id 遮蔽 `activity` 条目，包装源组件并只替换
 *      它的 `t`：第一段后追加最近 5 步的平均 TTFT，速度段换成最近 5 步的 TPS，得到
 *      「12 轮 34 步 · 2.3秒 · 45 tok/s」；
 *   2. 气泡挂到 `document.body` 后，由 `src/dialog.ts` 把气泡里的标题值与速度行改回
 *      全会话读数（气泡正文的 TTFT 行本来由上游按全会话计算）。
 *
 * 数据优先读宿主投影 `recentStepStats`；投影缺席时用已加载窗口的最后 5 个 assistant 节点
 * 兜底。气泡还原用的全会话读数优先读上游 `sessionStats` 投影，缺席时折叠窗口。
 * 上游锚点、已知边界与验证方式见 docs/dsh-stats-ttft.md。
 */
import * as React from 'react'
import type { Context } from '@deepseek-ai/cordis'
import { STATS_ID, STATS_SLOT, createShadowState, reconcileShadow, withdrawShadow } from './shadow.ts'
import { tokensPerSecond } from './recent-shared.ts'
import {
  dialogReadings,
  formatDuration,
  formatTokensPerSecond,
  readRecentStats,
  readSessionTotals,
  withRecentReadings,
  type DialogTexts,
} from './ttft.ts'
import { installDialogPatch, type DialogPatchController, type PatchDocument } from './dialog.ts'
import type {
  ChatNodes,
  RecentStepStats,
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
 * 自检窗口里两次探测之间的间隔（毫秒）；窗口总长约 1 秒，覆盖 roster 启动期。
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

/** 既不追加时长也不换速度时的气泡还原空表。 */
const NO_DIALOG_TEXTS: DialogTexts = { countsFrom: null, countsTo: null, speedFrom: null, speedTo: null }

/**
 * 布局副作用：浏览器里用 `useLayoutEffect`，气泡插入后、浏览器绘制前就完成还原；
 * 没有 `document` 的环境（SSR 测试）退化为 `useEffect`，避免 SSR 警告。
 */
const useIsomorphicLayoutEffect = typeof document === 'undefined' ? React.useEffect : React.useLayoutEffect

/**
 * 装上气泡正文还原：包装层每次拿到新的文本对就同步一次；React 重写气泡里的文本节点后，
 * 下一次同步会把它们改回全会话读数。
 *
 * @param texts - 当前按钮上生效的最近 5 步读数与对应的全会话文本。
 */
function useDialogPatch(texts: DialogTexts): void {
  const controller = React.useRef<DialogPatchController | null>(null)
  const latest = React.useRef<DialogTexts>(texts)

  useIsomorphicLayoutEffect(() => {
    latest.current = texts
    controller.current?.sync()
  }, [texts])

  useIsomorphicLayoutEffect(() => {
    if (typeof document === 'undefined') return undefined
    const installed = installDialogPatch(document as unknown as PatchDocument, () => latest.current)
    controller.current = installed
    return () => {
      installed.dispose()
      controller.current = null
    }
  }, [])
}

/**
 * 把源组件包进「按钮读数带最近 5 步 TTFT / TPS、气泡正文仍按全会话」的包装层。
 *
 * 包装层不读业务面之外的东西，把 props 原样透传给源组件；只覆盖 `t`，并在气泡挂载后
 * 还原标题值与速度行。按钮读数优先读 `recentStepStats` projection，投影缺席时用
 * `useChat` 的窗口节点取最后 5 个 assistant 节点兜底；没有样本时对应项不改写，
 * 按钮读数与上游一致。
 *
 * @param Inner - 上游那个统计按钮组件（`ActivityPill`）。
 * @returns 包装组件；把它交给 `slots.register()` 即可。
 */
export function withRecentStats(Inner: unknown): unknown {
  function ActivityWithRecentStats(props: Record<string, unknown>): React.ReactElement {
    const t = props.t as Translate | undefined
    const useProjection = (
      typeof props.useProjection === 'function' ? props.useProjection : useNoProjection
    ) as UseProjection
    const useChat = (typeof props.useChat === 'function' ? props.useChat : useNoChat) as UseChat

    // 包装层只按字符串键读会话投影：`recentStepStats` 是本插件注册的键，`sessionStats`
    // 是上游 ui-chat 依赖的全会话键（类型声明随 ui-chat 的 d.ts 加载，这里按值读取）。
    const readProjection = useProjection as unknown as (key: string) => unknown
    const projection = readProjection('recentStepStats') as RecentStepStats[] | undefined
    const sessionProjection = readProjection('sessionStats')
    const nodes: ChatNodes | undefined = useChat((snapshot) => snapshot?.legacy?.nodes)

    const reading = readRecentStats(projection, nodes)
    const sessionTotals = readSessionTotals(sessionProjection, nodes)
    const sessionTps = tokensPerSecond(sessionTotals)

    const segment = reading.averageTTFT === null || typeof t !== 'function'
      ? null
      : formatDuration(reading.averageTTFT, t) || null
    const tps = reading.tokensPerSecond === null || typeof t !== 'function'
      ? null
      : formatTokensPerSecond(reading.tokensPerSecond)
    const merged = React.useMemo(
      () => (typeof t === 'function' ? withRecentReadings(t, { segment, tps }) : t),
      [t, segment, tps],
    )
    const texts = React.useMemo(
      () => (typeof t === 'function'
        ? dialogReadings(
          t,
          { turns: sessionTotals.turns, steps: sessionTotals.steps },
          { segment, recentTps: reading.tokensPerSecond, sessionTps },
        )
        : NO_DIALOG_TEXTS),
      [t, sessionTotals.turns, sessionTotals.steps, segment, reading.tokensPerSecond, sessionTps],
    )
    useDialogPatch(texts)

    return React.createElement(
      Inner as React.ComponentType<Record<string, unknown>>,
      { ...props, t: merged },
    )
  }
  return ActivityWithRecentStats
}

/** 读取 `slots` 服务；服务缺席或形状不符时返回 undefined。 */
function getSlots(ctx: Context): ShadowSlots | undefined {
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
export function apply(ctx: Context): void {
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
      outcome = reconcileShadow(slots, state, withRecentStats)
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
