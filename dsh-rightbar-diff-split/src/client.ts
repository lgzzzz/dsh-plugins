/** 浏览器半部入口:右栏「变更审阅」diff 的左右对比**持续回正**到右栏全屏状态。
 *
 * 分栏状态 = 右栏全屏状态,任何时刻恒等:任一次 store 提交、slots 注册变化、换会话,以及
 * 插件加载,都就地跑一次回正(先读后 toggle,幂等)。因此页头「左右对比」按钮降级为**只读
 * 状态指示器** —— 点击同样会提交那个 store、也就同样触发我们**在同一次同步通知内**回正,
 * 视觉上「点了没反应」;按钮保留、DOM 不动、样式不加、键位不接管。
 * 全走服务面与活 store,不轮询、不回退点击、不引入任何延迟调度器。 */
import { createDiffSplitSync } from './diff-split.ts'
import { createSubscriptionHub, type SubscriptionHub } from './subscriptions.ts'
import type { ClientContext, Services, SessionsLike, SlotsLike, UiSessionLike } from './types.ts'

export const name = 'dsh-rightbar-diff-split'

/** 浏览器半部注入的服务(模块加载器读取):slots 取三份活实例,sessions + uiSession 构造会话作用域绑定。 */
export const inject = ['slots', 'sessions', 'uiSession']

/** 双重判空后取服务(缺失 / 抛错时返回 undefined;绝不把异常穿出 apply)。 */
function getService(ctx: ClientContext, serviceName: string): unknown {
  if (ctx.get === undefined || ctx.get === null) return undefined
  let value: unknown
  try {
    value = ctx.get(serviceName)
  } catch {
    return undefined
  }
  return value === null || value === undefined ? undefined : value
}

/**
 * 装配:创建回正核心 + 订阅中枢,先建订阅、再对齐一次(加载即对齐),并把退订挂到 fiber 生命周期。
 * 订阅走 `ctx.effect(() => cleanup)`:client-hmr 的 fiber 替换即退订,模块级快照随新 fiber 重置。
 */
export function apply(ctx: ClientContext): void {
  const services: Services = {
    slots: getService(ctx, 'slots') as SlotsLike | undefined,
    sessions: getService(ctx, 'sessions') as SessionsLike | undefined,
    uiSession: getService(ctx, 'uiSession') as UiSessionLike | undefined,
  }

  const core = createDiffSplitSync(services)

  let hub: SubscriptionHub | undefined
  hub = createSubscriptionHub({
    services,
    // A/B/E:三份 store 的任意一次提交 → 就地回正(同一次同步通知内完成)
    onNotify: () => {
      core.drive()
    },
    // C/D:订阅拓扑变了 → 先重建订阅(拿新实例、先全量退订),再回正
    onRebuild: () => {
      hub?.rebuild()
      core.drive()
    },
  })
  hub.rebuild()
  // 加载即对齐一次:不再有「生效时不补写既有状态」的口径
  core.drive()

  if (typeof ctx.effect === 'function') {
    ctx.effect(() => () => {
      hub?.dispose()
    })
  }
}
