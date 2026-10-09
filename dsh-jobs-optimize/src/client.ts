/**
 * 浏览器入口：把会话标题栏的后台任务计数控件接上悬停开合。
 *
 * 上游 `@deepseek-ai/dsh-client-ui-jobs` 的 `job-list` 条目在槽位声明之后才注册（它的客户端包
 * 依赖 `jobs` / `locale` / `conversation` / `primitives` 一串服务），因此本插件不在启动时注册，
 * 而是等槽位声明：`slots.inject` 一到就扫一次账本，之后每次账本变化再由 `slots.subscribe` 重扫。
 * 上游先注册或后注册都能遮蔽到，也不需要与它的加载顺序约定。
 *
 * 包装层是 `display: contents` 的 div：它只作为可寻址的宿主存在，不产生盒子，因此头部动作条
 * 的 `display: flex; gap: 8px` 仍只看到上游控件那一个 flex 子项（`display: contents` 的子元素
 * 直接参与父级 flex 布局）。调度细节见 `hover-open.ts`，账本遮蔽见 `shadow.ts`。
 */
import * as React from 'react'
import { createHoverOpen } from './hover-open.ts'
import { JOB_LIST_ID, JOB_LIST_SLOT, createShadowState, reconcileShadow, withdrawShadow } from './shadow.ts'
import type { HoverHost } from './hover-open.ts'
import type { ShadowSlots } from './types.ts'

export const name = 'dsh-jobs-optimize'

/** 需要的 cordis 服务：槽位注册表。 */
export const inject = ['slots']

/** `slots` 服务在本插件里的服务名。 */
const SLOTS_SERVICE = 'slots'

/**
 * 包装层样式：无盒锚点。
 *
 * 模块级常量——引用稳定，包装层每次渲染都不会 diff style。
 */
const ANCHOR_STYLE: React.CSSProperties = { display: 'contents' }

/** 自检窗口里两次探测之间的间隔（毫秒）。 */
export const MISSING_PROBE_MS = 50

/**
 * 自检窗口的探测次数：窗口 ≈ `MISSING_PROBE_MS × MISSING_PROBE_ATTEMPTS` ≈ 1 秒。
 *
 * 覆盖客户端 roster 的启动期（ui-jobs 的包与它的依赖链陆续激活）。窗口内一发现
 * `job-list` 条目就停止探测，所以只有 ui-jobs 真的没注册时才会走满窗口并告警一次。
 */
export const MISSING_PROBE_ATTEMPTS = 20

/** 本插件用到的客户端上下文能力。 */
interface ClientContext {
  /** 读取已激活的 cordis 服务。 */
  get?(name: string): unknown
}

/**
 * 把源组件包进悬停宿主。
 *
 * 返回的组件把 props 原样透传给源组件，自身不读业务面，因此源组件的 `inject` 面
 * （`hooks.jobs` / `watchRows` / `observe` / `killJob`）与 `t` 座位都照常到达。
 *
 * @param Inner - 上游那个后台任务控件组件。
 * @returns 包装组件；把它交给 `slots.register()` 即可。
 */
export function withHoverOpen(Inner: unknown): unknown {
  function JobListHoverOpen(props: Record<string, unknown>): React.ReactElement {
    const hostRef = React.useRef<HTMLDivElement | null>(null)
    React.useEffect(() => {
      const host = hostRef.current
      if (host === null) return
      const controller = createHoverOpen(host as unknown as HoverHost)
      return () => {
        controller.dispose()
      }
    }, [])
    return React.createElement(
      'div',
      { ref: hostRef, style: ANCHOR_STYLE },
      React.createElement(Inner as React.FunctionComponent<Record<string, unknown>>, props),
    )
  }
  return JobListHoverOpen
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

/** 在一个客户端上下文上安装悬停开合。 */
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
   * 扫一遍账本并把遮蔽项对到当前状态；账本上还没有 `job-list` 时在有界窗口内继续探测，
   * 窗口走完仍没有才算 ui-jobs 缺席，告警一次。
   *
   * 自检只针对「从来没找到过源项」：一旦遮蔽成功过，源项此后消失（ui-jobs 被卸载，或它的
   * 条目因崩溃退位）是账本变化的正常结果，撤回即可，再报「未找到」会把一次成功的接管说成
   * 失效。
   */
  const reapply = (): void => {
    if (disposed) return
    let outcome
    try {
      outcome = reconcileShadow(slots, state, withHoverOpen)
    } catch (error) {
      warn('遮蔽 job-list 失败:', error)
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
      warn(`未找到 ${JOB_LIST_SLOT}#${JOB_LIST_ID}；悬停展开未生效`)
    })
  }

  if (typeof slots.inject !== 'function') {
    reapply()
    return
  }

  slots.inject(JOB_LIST_SLOT, () => {
    reapply()
    const unsubscribe = typeof slots.subscribe === 'function' ? slots.subscribe(JOB_LIST_SLOT, reapply) : undefined
    return () => {
      // 卸载后不再对账，也不再推进自检窗口：待触发的那一拍会自行返回。
      disposed = true
      if (typeof unsubscribe === 'function') unsubscribe()
      withdrawShadow(state)
    }
  })
}
