/**
 * 宿主半部：把 `recentStepStats` 投影单元注册到会话投影注册表。
 *
 * 单元只做纯折叠（见 `src/recent.ts`）：最近 5 个已结束 step 的 TTFT 与解码累计。
 * 浏览器半部通过 `useProjection("recentStepStats")` 读取；注册表缺席时本插件仍生效，
 * 客户端退回已加载窗口的最后 5 个 assistant 节点折叠。
 *
 * 用 `ctx.inject` 而不是静态 `inject`：投影注册表缺席不影响客户端半部的装载。
 * 注册失败（例如键冲突）只告警，读数退回窗口兜底。
 */
import type { Context } from '@deepseek-ai/cordis'
// 空类型导入：加载 `ctx.sessionProjections` 的服务声明。
import type {} from '@deepseek-ai/dsh-session-projection'
import { recentStepStatsProjectionDefinition } from './src/recent.ts'

export const name = 'dsh-stats-ttft'

/**
 * 在投影注册表可用时注册最近步次统计单元。
 * @param ctx - 宿主 Context。
 */
export function apply(ctx: Context): void {
  ctx.inject(['sessionProjections'], (child) => {
    try {
      void child.sessionProjections.register(recentStepStatsProjectionDefinition).catch((error: unknown) => {
        console.error('[dsh-stats-ttft] 注册 recentStepStats 投影失败；按钮退回窗口折叠:', error)
      })
    } catch (error: unknown) {
      console.error('[dsh-stats-ttft] 注册 recentStepStats 投影失败；按钮退回窗口折叠:', error)
    }
  })
}
