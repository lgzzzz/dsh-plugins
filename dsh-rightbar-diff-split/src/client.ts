/** 浏览器半部入口,两件事各自独立:
 *
 * ① **回正**:右栏「变更审阅」diff 的左右对比**持续回正**到右栏全屏状态。分栏状态 = 右栏全屏
 * 状态,任何时刻恒等:任一次 store 提交、slots 注册变化、换会话,以及插件加载,都就地跑一次
 * 回正(先读后 toggle,幂等)。因此页头「左右对比」按钮降级为**只读状态指示器** —— 点击同样会
 * 提交那个 store、也就同样触发我们**在同一次同步通知内**回正,视觉上「点了没反应」;按钮保留、
 * DOM 不动、键位不接管。全走服务面与活 store,不轮询、不回退点击、不引入任何延迟调度器。
 *
 * ② **呈现补丁**:一条样式规则摘掉聊天区「改动卡片」文件行的悬停 diff 浮窗(见
 * `hover-preview.ts`);只在 `document.head` 追加一个 `style`,fiber 退场时摘除。
 *
 * 两件事互不依赖:样式装不上(无 DOM)不影响回正,服务全缺也不影响样式。 */
import { createDiffSplitSync } from './diff-split.ts'
import { installHoverPreviewStyles } from './hover-preview.ts'
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
 * 装配:装一次悬停浮窗呈现补丁,再创建回正核心 + 订阅中枢 —— 先建订阅、再对齐一次(加载即对齐),
 * 并把两处清理都挂到 fiber 生命周期。
 * 订阅与样式都走 `ctx.effect(() => cleanup)`:client-hmr 的 fiber 替换即退订 + 摘样式,模块级快照
 * 随新 fiber 重置。`ctx.effect` 缺席时样式仍装上(只是没有 fiber 生命周期钩子来摘除)。
 */
export function apply(ctx: ClientContext): void {
  const uninstallStyles =
    typeof document === 'undefined' ? undefined : installHoverPreviewStyles(document, name)

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
      uninstallStyles?.()
    })
  }
}
