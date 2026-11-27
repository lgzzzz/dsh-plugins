/**
 * 面板视图：今日 / 本月。
 *
 * 视图放模块级、不放组件状态：切到本月时要把分区标题从「今日 Token 用量」换成「本月 Token
 * 用量」，而标题由面板从注册项读（见 `src/registration.ts`），只能靠重新注册来改；重新注册会让
 * 面板重建这一节，组件里的状态会被重置回今日，切换就白点了。
 *
 * 纯状态模块：没有任何 React 或浏览器依赖，测试可以直接 import。
 */

/** 面板正在显示哪一段：今天，或本月累计。 */
export type UsageView = 'today' | 'month'

/** 当前视图；页面刚打开时是今天。 */
let view: UsageView = 'today'

/** 视图变化的订阅者（React 的 `useSyncExternalStore` 与注册项的重注册各一个）。 */
const listeners = new Set<() => void>()

/**
 * 当前视图。
 * @returns `today` 或 `month`。
 */
export function getUsageView(): UsageView {
  return view
}

/**
 * 切换视图并通知订阅者；与当前一致时什么都不做。
 * @param next - 目标视图。
 */
export function setUsageView(next: UsageView): void {
  if (view === next) return
  view = next
  for (const listener of [...listeners]) listener()
}

/**
 * 订阅视图变化。
 * @param listener - 视图变化时回调。
 * @returns 取消订阅。
 */
export function subscribeUsageView(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
