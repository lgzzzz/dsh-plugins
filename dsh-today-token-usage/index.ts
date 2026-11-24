/**
 * 宿主半部：注册 `todayTokenUsage` 会话投影，并给旧会话补一行缓存。
 *
 * 投影（`src/fold.ts` + `src/schema.ts`）：每个会话一个单元，把**自己的** assistant 用量按事件发生
 * 的本地日期折成四个桶，只保留最近一个有用量的日期（`wire.view` 直接返回那个对象，引用稳定，
 * 视图没变时不会重复发布）。列表行因此自带「这个会话今天用了多少」，浏览器半部只需要把各会话
 * 今天的那一份加起来，不必读日志、也不必自己折事件。
 *
 * 回填（`src/backfill.ts`）：冷会话的列表值只来自持久化缓存里的行，而这一行只在该会话活着跨过
 * 存档点时才会写。插件装上之前就冷掉的会话，今天早些时候的用量不在任何一行里；启动时补一次，
 * 判据与开销见那个模块的注释。回填在后台跑，不阻塞插件激活。
 *
 * 这里没有 `Config`：回填只读「今天活跃且缺行」的少数会话，行补齐后不再读日志，没有需要用户调的量。
 */

import type { Context } from '@deepseek-ai/cordis'
// 空类型导入：加载各包对 Context 的服务增强（sessionProjections / sessionPersistence /
// sessionProjectionCache / sessions）与 SessionProjectionMap 的 `sessionListMetadata` 键，全是类型层。
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-session-projection-cache'
import type {} from '@deepseek-ai/dsh-session-query/types'
import type { SessionHeader } from '@deepseek-ai/dsh-session/types'
import type { BackfillServices, BackfillSession, CachedRows } from './src/backfill.ts'
import { backfillToday } from './src/backfill.ts'
import { todayTokenUsageProjection } from './src/schema.ts'
import { PROJECTION_KEY } from './src/wire.ts'

/** 插件标识（日志名，与包名一致）。 */
export const name = 'dsh-today-token-usage'

/** 需要的宿主服务：投影登记表与活会话表（回填据此跳过活着的会话）。 */
export const inject = ['sessionProjections', 'sessions']

/**
 * 注册投影并启动回填。
 * @param ctx - 宿主半部的 Context。
 * @returns 投影登记完成即返回；回填在后台继续。
 */
export async function apply(ctx: Context): Promise<void> {
  await ctx.sessionProjections.register(todayTokenUsageProjection)

  const controller = new AbortController()
  ctx.effect(() => () => { controller.abort() }, `${name}: 回填中止`)
  const services = backfillServices(ctx)
  // 没有持久化或投影缓存时没有可补的行：投影本身照常工作（活会话由登记表自己折）。
  if (services === undefined) return
  void backfillToday(services, controller.signal).then((report) => {
    if (report.refreshed > 0) {
      ctx.logger.info(`${name}: 已为 ${report.refreshed} 个今日活跃的旧会话补折用量（扫描 ${report.scanned} 个）`)
    }
  }, (error: unknown) => {
    ctx.logger.warn(`${name}: 今日用量回填中断: ${error instanceof Error ? error.message : String(error)}`)
  })
}

/**
 * 把真实服务适配成回填写入面。
 * @param ctx - 宿主半部的 Context。
 * @returns 适配器；持久化或投影缓存缺席时为 undefined。
 */
function backfillServices(ctx: Context): BackfillServices<SessionHeader> | undefined {
  const persistence = ctx.get('sessionPersistence')
  const cache = ctx.get('sessionProjectionCache')
  if (persistence === undefined || cache === undefined) return undefined
  return {
    async list() {
      const snapshots = await persistence.list()
      return snapshots.map((snapshot): BackfillSession<SessionHeader> => ({
        id: snapshot.header.id,
        createdAt: snapshot.header.createdAt,
        ...snapshot.formatStatus === undefined ? {} : { formatStatus: snapshot.formatStatus },
        header: snapshot.header,
      }))
    },
    cached(header): CachedRows | undefined {
      // 与列表同一份读取面：本插件的行在不在，以及最近一次人类提示时间。
      const block = cache.cachedSnapshot(header, [PROJECTION_KEY, 'sessionListMetadata'])
      if (block === undefined) return undefined
      return {
        hasRow: block.values[PROJECTION_KEY] !== undefined,
        lastPromptAt: block.values.sessionListMetadata?.lastPromptAt ?? null,
      }
    },
    isLive(id) {
      return ctx.sessions.get(id) !== undefined
    },
    async read(id, signal) {
      const handle = await persistence.open(id, 'read', { signal })
      try {
        const { events } = await handle.read(undefined, undefined, { signal })
        return { header: handle.header, inherited: handle.inheritedEventCount, events }
      } finally {
        await handle.close()
      }
    },
    refresh(header, inherited, events) {
      // 冷读一整个日志：按已登记的单元（含本插件的）折叠并异步写回缓存。
      cache.coldSnapshot(header, inherited, events)
    },
    warn(message) {
      ctx.logger.warn(`${name}: ${message}`)
    },
    now() {
      return Date.now()
    },
  }
}
