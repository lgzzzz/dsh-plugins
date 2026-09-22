/** 订阅装配层:把三份活 store 的通知接到判定核心(diff-split.ts)。
 *
 * 订阅面(只为捕获三种事件而存在):
 * | A | 布局 store(root 作用域)      | 全屏翻转 = 事件 ③,并用来读 layoutInfo |
 * | B | 右栏 store(会话作用域)      | 标签记录提交 / focus / 切换 = 事件 ①② |
 * | C | uiSession.current            | 换会话 → 重建会话级订阅(不单独触发写入) |
 * | D | slots.subscribe(三个 slot)   | 座位晚到 / 重注册 → 重建 + 解除待完成 |
 * | E | 变更审阅视图 store(会话作用域)| 视图桶诞生(页 body 挂载)→ 解除待完成 |
 *
 * 实例**每次现解析、不缓存**(风险 7):解析成功才建立订阅,失败即跳过;重建先全量退订。
 * 上游 `subscribe` 是 uSES 的 invalidation 侧,返回退订函数;一律以方法形式调用(类实例丢 this 会抛)。 */
import { currentSessionId, PANE_TAB_SLOT, resolveLayoutStore, resolveReviewStore, resolveRightbarStore, RIGHTBAR_SLOT, ROOT_SLOT } from './resolve.ts'
import type { Services, StoreInstanceLike } from './types.ts'

export interface SubscriptionHubDeps {
  readonly services: Services
  readonly onLayout: () => void
  readonly onRightbar: () => void
  readonly onReview: () => void
  readonly onEntries: () => void
  readonly onSession: () => void
}

export interface SubscriptionHub {
  /** 现解析三份活 store 并(重)建全部订阅;先退掉上一轮的。 */
  rebuild(): void
  /** fiber 卸载 / HMR 替换:退掉全部订阅。 */
  dispose(): void
}

/**
 * 创建订阅中枢。
 * @param deps - 服务集合与各通知的回调。
 * @returns 可重建 / 可退订的订阅中枢。
 */
export function createSubscriptionHub(deps: SubscriptionHubDeps): SubscriptionHub {
  let disposers: (() => void)[] = []

  /** 退掉全部订阅(单个退订抛错不影响其余)。 */
  function disposeAll(): void {
    const pending = disposers
    disposers = []
    for (const dispose of pending) {
      try {
        dispose()
      } catch {
        // 上游退订抛错:插件不因此中断
      }
    }
  }

  /** 给活实例挂一个通知(实例 / subscribe 缺席即跳过;返回的退订函数必须存在才记账)。 */
  function attach(instance: StoreInstanceLike | undefined, listener: () => void): void {
    const subscribe = instance?.subscribe
    if (typeof subscribe !== 'function') return
    let dispose: unknown
    try {
      dispose = subscribe.call(instance, listener)
    } catch {
      return
    }
    if (typeof dispose === 'function') disposers.push(dispose as () => void)
  }

  return {
    rebuild(): void {
      disposeAll()
      const services = deps.services

      // A 布局 store:全屏真身(root 作用域,不传 binding)
      attach(resolveLayoutStore(services)?.instance, deps.onLayout)

      const sessionId = currentSessionId(services)
      if (sessionId !== undefined) {
        // B 右栏 store:当前面板的当前标签(会话作用域)
        attach(resolveRightbarStore(services, sessionId)?.instance, deps.onRightbar)
        // E 变更审阅视图 store:视图桶诞生时解除待完成(会话作用域)
        attach(resolveReviewStore(services, sessionId)?.instance, deps.onReview)
      }

      // C 当前会话绑定源:换会话即重建(会话级 store 实例按会话 id 铸,订阅必须跟着换)
      attach(services.uiSession?.current, deps.onSession)

      // D 注册变化:三个 slot 的座位晚到 / 重注册都值得重建一次
      const slots = services.slots
      const subscribeSlots = slots?.subscribe
      if (slots !== undefined && slots !== null && typeof subscribeSlots === 'function') {
        for (const key of [ROOT_SLOT, RIGHTBAR_SLOT, PANE_TAB_SLOT]) {
          try {
            const dispose = subscribeSlots.call(slots, key, deps.onEntries)
            if (typeof dispose === 'function') disposers.push(dispose)
          } catch {
            // 单键订阅失败不拖垮其余
          }
        }
      }
    },
    dispose(): void {
      disposeAll()
    },
  }
}
