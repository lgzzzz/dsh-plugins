/**
 * 宿主半部的接线：把「每一次模型调用」接到 journal 上，并把当天 / 当月合计开到只读路由。
 *
 * 三块注册都挂在插件自己的 fiber 上，卸载时一起收回：
 *
 *   - `llm/stream` global 监听：覆盖进程内所有模型调用（主对话、子智能体、标题生成、压缩摘要、
 *     时间线报告、第三方插件直接发起的调用）。监听只包一层 {@link tapStream}，绝不改写请求；
 *   - journal store：启动时读回当天文件与月度汇总，之后每次调用同步更新当天 / 当月内存、
 *     串行追加一行，并按节流写一份月度汇总；
 *   - `webServer` 路由（可选服务）：当天快照与 SSE 推送（载荷里同时带当月累计）。
 *
 * 单独导出（而不是全写在 `index.ts` 里）是为了让测试用临时目录跑真装配。
 */

import type { Context } from '@deepseek-ai/cordis'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import { createTodayStore } from './store.ts'
import type { TodayStore, TodayStoreOptions } from './store.ts'
import { tapStream } from './tap.ts'
import { createTodayUsageHandler, createTodayUsageStream } from './route.ts'
import { TODAY_USAGE_PATH, TODAY_USAGE_STREAM_PATH } from './wire.ts'
import type {} from './web-types.ts'

/** 装配选项（与 {@link TodayStoreOptions} 相同；测试用临时目录与假时钟）。 */
export interface RecorderOptions extends TodayStoreOptions {}

/** 一次请求的身份：在 waterfall 入口同步抄下原始值，之后不再读 `options`。 */
interface RequestIdentity {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string
  readonly sessionId?: string
  readonly purpose?: string
}

/** 从请求里取出记录用身份；只复制原始标量，不持有请求对象。 */
function identityOf(options: GenerateOptions): RequestIdentity {
  return {
    provider: options.provider,
    model: options.model,
    ...options.reasoningEffort === undefined ? {} : { reasoningEffort: options.reasoningEffort },
    ...options.sessionId === undefined ? {} : { sessionId: options.sessionId },
    ...options.purpose === undefined ? {} : { purpose: options.purpose },
  }
}

/**
 * 安装用量记录器。
 * @param ctx - 宿主半部的插件 Context。
 * @param options - journal 目录、保留天数、时钟与告警出口。
 * @returns 已加载的 store（测试可直接读 `snapshot()`）。
 */
export async function installRecorder(
  ctx: Context,
  options: RecorderOptions,
): Promise<{ readonly store: TodayStore }> {
  const store = createTodayStore(options)
  await store.load()
  const stream = createTodayUsageStream(store)

  ctx.effect(() => () => store.dispose(), 'dsh-today-token-usage: usage store')
  ctx.effect(() => () => stream.dispose(), 'dsh-today-token-usage: usage stream')

  // global：LLM 调度器是进程级的，插件作用域内的监听收不到别的上下文发起的调用。
  ctx.on('llm/stream', (request, next) => {
    const identity = identityOf(request)
    return tapStream(next(), (settled) => {
      if (settled.usage === undefined) return
      store.record({
        ...identity,
        usage: settled.usage,
        ...settled.finish === undefined ? {} : { finish: settled.finish.kind },
      })
    })
  }, { global: true })

  // webServer 只在 web composition 里存在；缺席时安静地只记录、不开放路由。
  // 页面用 SSE 推送；JSON 快照留给 curl / 排障。
  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(() => {
      const disposeSnapshot = webCtx.webServer.register({
        kind: 'exact',
        path: TODAY_USAGE_PATH,
        auth: 'required',
        handler: createTodayUsageHandler(store),
      })
      const disposeStream = webCtx.webServer.register({
        kind: 'exact',
        path: TODAY_USAGE_STREAM_PATH,
        auth: 'required',
        handler: stream.handler,
      })
      return () => {
        disposeStream()
        disposeSnapshot()
      }
    }, 'dsh-today-token-usage: usage routes')
  })

  return { store }
}
