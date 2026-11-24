/**
 * 宿主半部：注册 `todayTokenUsage` 会话投影。
 *
 * 投影（`src/fold.ts` + `src/schema.ts`）：每个会话一个单元，把**自己的** assistant 用量按事件发生
 * 的本地日期折成四个桶，只保留最近一个有用量的日期（`wire.view` 直接返回那个对象，引用稳定，
 * 视图没变时不会重复发布）。列表行因此自带「这个会话今天用了多少」，浏览器半部只需要把各会话
 * 今天的那一份加起来，不必读日志、也不必自己折事件。
 *
 * 冷会话的列表值只来自持久化缓存里已存档的行，由投影登记表在该会话活着跨过存档点时写入；
 * 本插件不扫日志、不回填。所以插件装上之前就已经冷掉、之后没有再打开的会话没有这一行，它今天
 * 早些时候的用量不会出现在读数里，直到该会话重新打开。这是有意的取舍：换启动时零日志 I/O。
 *
 * 这里没有 `Config`：没有任何需要用户调的量。
 */

import type { Context } from '@deepseek-ai/cordis'
// 空类型导入：加载包对 Context 的 `sessionProjections` 服务增强，纯类型层。
import type {} from '@deepseek-ai/dsh-session-projection'
import { todayTokenUsageProjection } from './src/schema.ts'

/** 插件标识（与包名一致）。 */
export const name = 'dsh-today-token-usage'

/** 需要的宿主服务：投影登记表。 */
export const inject = ['sessionProjections']

/**
 * 注册投影。
 * @param ctx - 宿主半部的 Context。
 * @returns 投影登记完成即返回。
 */
export async function apply(ctx: Context): Promise<void> {
  await ctx.sessionProjections.register(todayTokenUsageProjection)
}
