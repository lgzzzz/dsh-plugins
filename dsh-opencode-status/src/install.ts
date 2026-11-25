/**
 * 宿主半部的接线：把取数器的快照挂到 `webServer` 的同源路由上。
 *
 * `webServer` 只在 web composition 里存在；缺席时（CLI / 非 web 会话）整段落空，插件的其它
 * 声明照常挂载。路由与取数器都挂在插件自己的 fiber 上，卸载时一起收回。
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from './web-types.ts'
import { createStatusHandler } from './route.ts'
import { createStatusSource, DEFAULT_BACKGROUND_REFRESH_MS } from './upstream.ts'
import { STATUS_PATH } from './wire.ts'

/**
 * 注册 `GET /opencode-status/status`（`auth: 'required'` + owner 校验）。
 *
 * 取数器一装配就开始后台保活刷新，之后页面请求只读内存里的最新快照；因此打开会话时
 * 面板第一帧就有读数，不用等一次上游往返。
 * @param ctx - 宿主半部的 Context。
 */
export function installStatusRoute(ctx: Context): void {
  ctx.inject(['webServer'], (webCtx) => {
    const source = createStatusSource({
      backgroundRefreshMs: DEFAULT_BACKGROUND_REFRESH_MS,
      onError: message => webCtx.logger?.warn?.(`[dsh-opencode-status] ${message}`),
    })
    webCtx.effect(() => {
      const dispose = webCtx.webServer.register({
        kind: 'exact',
        path: STATUS_PATH,
        auth: 'required',
        handler: createStatusHandler({ read: source.read }),
      })
      return () => {
        dispose()
        source.dispose()
      }
    }, 'dsh-opencode-status: status route')
  })
}
