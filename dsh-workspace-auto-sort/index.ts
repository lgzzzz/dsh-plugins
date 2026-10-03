/**
 * 宿主半部：让左侧栏的 Workspace 列表始终按同一种顺序排列。
 *
 * 侧边栏的 Workspace 分组顺序就是 Workspace 注册表的持久显示顺序
 * （`ctx.workspaceRegistry` 的 `workspaceIds`）；浏览器通过控制器
 * `follow()` 的 `order` 增量跟随它。所以本插件完全不碰 UI：注册表每次
 * 持久写入后重算一次期望顺序，用注册表自己的 `insertBefore` 把偏差补上，
 * 顺序随即成为权威事实，重连的客户端也拿到同一份顺序。
 *
 * 自己发起的 `insertBefore` 会同步发出 `domain/changed`，监听器会再请求
 * 一轮；因为顺序已经收敛，新一轮不做任何写入。`busy`/`dirty` 把这类重入
 * 压成「当前这轮跑完再跑一轮」，`rounds` 上限则保证任何意外都不会变成写盘风暴。
 *
 * 按 `updatedAt` 排序因此也是稳定的：注册表重排只写全局顺序单例
 * （`insertBefore` → `setState` → `global.set`），绝不触碰工作区记录，所以
 * `updatedAt` 只由实体变更（创建、改名、会话归属变化）推进，插件自己的写入
 * 不会反过来改变自己的排序依据。
 */
import z from '@deepseek-ai/schemastery'
import type { Context } from '@deepseek-ai/cordis'
import type { WorkspaceRegistry } from '@deepseek-ai/dsh-workspace'
// 空导入（不引入任何名字）：只为让 TS 加载 dsh-storage-domain 对 Events 的
// 增强，下面 ctx.on('domain/changed', …) 的回调参数才有类型。
import type {} from '@deepseek-ai/dsh-storage-domain'
import { SORT_ORDERS, planReorderSteps, planWorkspaceOrder, sameOrder, toSortable } from './src/order.ts'
import type { SortOrder, SortPolicy } from './src/order.ts'

/** 插件标识（日志名，与包名一致）。 */
export const name = 'dsh-workspace-auto-sort'

/**
 * 依赖的宿主服务。注册表就绪（含首次历史引导）之前不挂载，因此第一次排序
 * 一定跑在权威顺序存在之后。
 */
export const inject = ['workspaceRegistry']

/** 插件配置（schemastery 校验后的形态）。 */
export interface Config {
  /** 排序依据；默认 `updated-desc`（最近改动的排最前）。 */
  order: SortOrder
  /** 置顶项：按显示标题或绝对路径匹配，按数组顺序排在最前。 */
  pinned: string[]
  /** 比较标题与路径时是否区分大小写。 */
  caseSensitive: boolean
  /** 比较用的 BCP-47 语言标签；省略时用运行环境默认语言。 */
  locale?: string
}

/** 配置 schema：非法取值在加载期报错，默认值在 apply 之前展开。 */
export const Config: z<Config> = z.object({
  order: z.union([...SORT_ORDERS]).default('updated-desc'),
  pinned: z.array(z.string()).default([]),
  caseSensitive: z.boolean().default(false),
  locale: z.string(),
})

/** 一轮里最多连续收敛几次；正常最多两轮（自己写入触发的一轮必然是空轮）。 */
const MAX_ROUNDS = 8

/**
 * 挂载自动排序：注册表每次持久写入后重算顺序，用最少次数的移动收敛。
 * @param ctx - 宿主上下文（提供 workspaceRegistry）。
 * @param config - 校验后的配置。
 */
export function apply(ctx: Context, config: Config): void {
  const policy: SortPolicy = {
    order: config.order,
    pinned: [...config.pinned],
    caseSensitive: config.caseSensitive,
    locale: config.locale,
  }
  // inject 数组已经让整插件等到注册表就绪；这里再用 ctx.inject 拿一次，
  // 服务中途消失或尚未出现时都不会把 apply 变成一次空指针解引用。
  ctx.inject(['workspaceRegistry'], (registryCtx) => {
    mount(registryCtx.workspaceRegistry, registryCtx, policy)
  })
}

/**
 * 订阅注册表变更并驱动收敛。
 * @param registry - 权威 Workspace 注册表。
 * @param ctx - 宿主上下文（事件、effect、日志）。
 * @param policy - 排序策略。
 */
function mount(registry: WorkspaceRegistry, ctx: Context, policy: SortPolicy): void {
  let active = true
  let busy = false
  let dirty = false
  let announced = false

  ctx.effect(
    () => () => {
      active = false
    },
    'dsh-workspace-auto-sort',
  )

  /** 跑一轮：算出期望顺序，按最小移动序列落盘。返回实际移动次数。 */
  const runOnce = async (): Promise<number> => {
    const workspaces = registry.list()
    const byId = new Map(workspaces.map((workspace) => [String(workspace.id), workspace.id]))
    const current = workspaces.map((workspace) => String(workspace.id))
    const desired = planWorkspaceOrder(workspaces.map(toSortable), policy)
    if (sameOrder(current, desired)) return 0
    let moved = 0
    for (const step of planReorderSteps(current, desired)) {
      if (!active) break
      const id = byId.get(step.id)
      if (id === undefined) continue
      await registry.insertBefore(id, step.beforeId === undefined ? undefined : byId.get(step.beforeId))
      moved += 1
    }
    return moved
  }

  /** 请求收敛：正忙就记一次「还要再跑」，空闲则直接把这一轮跑起来。 */
  const pump = async (): Promise<void> => {
    if (busy) {
      dirty = true
      return
    }
    busy = true
    try {
      let rounds = 0
      do {
        dirty = false
        rounds += 1
        const moved = await runOnce()
        if (moved > 0) {
          report(ctx, policy, moved, announced)
          announced = true
        }
      } while (dirty && active && rounds < MAX_ROUNDS)
      if (dirty && rounds >= MAX_ROUNDS) {
        ctx.logger.warn('dsh-workspace-auto-sort: 连续重排未收敛，已暂停本轮')
      }
    } finally {
      busy = false
    }
  }

  const request = (): void => {
    void pump().catch((error: unknown) => {
      ctx.logger.warn(`dsh-workspace-auto-sort: 排序失败: ${String(error)}`)
    })
  }

  ctx.on('domain/changed', (change) => {
    if (change.domain === 'workspace') request()
  })

  request()
}

/**
 * 报告一次真实发生的重排：首次是 info（说明插件确实在起作用），之后降为 debug。
 * @param ctx - 宿主上下文。
 * @param policy - 排序策略。
 * @param moved - 本次移动的工作区数量。
 * @param announced - 之前是否已经报过。
 */
function report(ctx: Context, policy: SortPolicy, moved: number, announced: boolean): void {
  const line = `dsh-workspace-auto-sort: 按 ${policy.order} 重排侧边栏工作区（${moved} 次移动）`
  if (announced) ctx.logger.debug(line)
  else ctx.logger.info(line)
}

export default { name, inject, Config, apply }
