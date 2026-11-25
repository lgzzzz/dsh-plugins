/**
 * 宿主半部（空宿主语义，真正的接线在 `src/install.ts`）：把上游 OpenCode status 快照收窄成
 * 「`go` 服务里的 `deepseek-v4.1-flash`」一条，挂在同源、owner-only 的
 * `GET /opencode-status/status` 上；浏览器半部轮询它，在会话面板里按行显示。
 *
 * 上游接口不带 CORS 头，页面不能直连，所以取数只能留在宿主侧。本层没有可调参数：上游地址、
 * 服务键与模型 id 都是常量；抓取超时 10 秒、缓存 20 秒、失败后 10 分钟内用缓存兜底。
 */

import type { Context } from '@deepseek-ai/cordis'
import { installStatusRoute } from './src/install.ts'

/** 插件标识（与包名一致）。 */
export const name = 'dsh-opencode-status'

/**
 * 挂载宿主路由。
 * @param ctx - 宿主半部的 Context。
 */
export function apply(ctx: Context): void {
  installStatusRoute(ctx)
}
