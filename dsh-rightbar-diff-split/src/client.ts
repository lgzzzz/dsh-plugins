/** 浏览器半部入口:右栏「变更审阅」diff 的左右对比跟随右栏全屏状态(状态跟随,不是快捷键)。
 *
 * 只认三种事件(打开 diff 标签 / 切到 diff 标签 / 全屏翻转),触发时按当时全屏值把**当前面板的
 * 当前 diff 标签**的 split set 一次;其余右栏通知(拖标签、拖分隔条、浮窗移动、手动点页头
 * 「左右对比」)一律不介入。全走服务面与活 store,不接管键位、不改 DOM、不回退点击、不轮询。 */
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

/** 待完成的一次兜底重试:优先下一帧;无 rAF 时退化为一次 0ms 宏任务(仍然至多一次,不是轮询)。 */
function scheduleRetry(flush: () => void): void {
  const raf = (globalThis as { requestAnimationFrame?: (callback: () => void) => unknown }).requestAnimationFrame
  if (typeof raf === 'function') {
    raf(() => {
      flush()
    })
    return
  }
  setTimeout(() => {
    flush()
  }, 0)
}

/**
 * 装配:创建判定核心 + 订阅中枢,并把退订挂到 fiber 生命周期(ctx.effect)。
 * 订阅走 ctx.effect(() => cleanup):client-hmr 的 fiber 替换即退订,模块级快照随新 fiber 重置。
 */
export function apply(ctx: ClientContext): void {
  const services: Services = {
    slots: getService(ctx, 'slots') as SlotsLike | undefined,
    sessions: getService(ctx, 'sessions') as SessionsLike | undefined,
    uiSession: getService(ctx, 'uiSession') as UiSessionLike | undefined,
  }

  const core = createDiffSplitSync(services, { requestRetry: scheduleRetry })

  let hub: SubscriptionHub | undefined
  hub = createSubscriptionHub({
    services,
    onLayout: () => {
      core.notifyLayout()
    },
    onRightbar: () => {
      core.notifyRightbar()
    },
    onReview: () => {
      core.notifyReview()
    },
    // 座位晚到 / 重注册:先重建订阅(拿新实例),再尝试解除待完成
    onEntries: () => {
      hub?.rebuild()
      core.notifyEntries()
    },
    // 换会话:会话级快照先作废并重新判定,再重建会话级订阅
    onSession: () => {
      core.notifySession()
      hub?.rebuild()
    },
  })
  hub.rebuild()

  if (typeof ctx.effect === 'function') {
    ctx.effect(() => () => {
      hub?.dispose()
    })
  }
}
