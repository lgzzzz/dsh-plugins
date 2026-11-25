/**
 * 宿主半部：拦截 DSH 发出的每一次模型调用，把 Token 用量按天记进 journal。
 *
 * 采集点是 `llm/stream` waterfall：主对话、子智能体、会话标题生成、压缩摘要、时间线报告、
 * auto-review，以及任何插件直接 `ctx.llm.stream()` 发出的调用，都会经过这里；用量取流里
 * 最后一个 `usage` 块（provider 真正回报的值），没有回报的请求不产生记录。
 *
 * 记录落盘在 `$DSH_HOME/state/today-token-usage/requests-YYYY-MM-DD.jsonl`，保留今天 + 前
 * 29 天共 30 天；重启后当天合计从文件恢复。浏览器半部通过同源、owner-only 的
 * `GET /today-token-usage/today` 读当天合计，面板因此与 journal 是同一个数。
 *
 * 本层没有任何可调参数：保留天数与路由路径都固定。装/卸都只影响记录与那一栏读数。
 */

import type { Context } from '@deepseek-ai/cordis'
// 空类型导入：加载 dsh-llm 对 `Context.llm` 与 `llm/stream` 事件的声明（纯类型层）。
import type {} from '@deepseek-ai/dsh-llm'
import { installRecorder } from './src/install.ts'
import { journalDirectory } from './src/paths.ts'

/** 插件标识（与包名一致）。 */
export const name = 'dsh-today-token-usage'

/** 需要的宿主服务：模型调用服务（`llm/stream` 事件的源）。 */
export const inject = ['llm']

/**
 * 安装记录器与统计路由。
 * @param ctx - 宿主半部的 Context。
 */
export async function apply(ctx: Context): Promise<void> {
  await installRecorder(ctx, {
    directory: journalDirectory(),
    onError: (message, error) => {
      const detail = error === undefined ? '' : `: ${String(error)}`
      ctx.logger.warn(`[${name}] ${message}${detail}`)
    },
  })
}
