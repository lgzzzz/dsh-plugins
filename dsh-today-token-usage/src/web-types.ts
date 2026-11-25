/**
 * 本插件用到的宿主 Web 服务最小面（结构化声明，不引入 `@deepseek-ai/dsh-host-webserver` 依赖）。
 *
 * 宿主在 web composition 里提供 `ctx.webServer`；本插件只做一件事：注册一个精确路径的 JSON
 * 路由（`auth: 'required'`，处理函数里再校验 owner）。这条路是第三方插件把宿主派生值送到
 * 浏览器半部的唯一公开通道（自定义 `ctx.remote` 命名空间是构建期按包选定的）。
 *
 * 只在类型层使用：运行时不 import 任何宿主包，`ctx.inject(['webServer'], …)` 在服务缺席时
 * 安静跳过（非 web 环境只记录、不开放路由）。
 */

import type { IncomingMessage, ServerResponse } from 'node:http'

/** 路由鉴权策略；本插件只用 `required`（要求活着的 Peer）。 */
export type WebRouteAuth = 'anonymous' | 'required' | 'deny'

/** 被准入的请求方；本插件只关心 `principal.kind === 'owner'`。 */
export interface WebPeer {
  readonly principal: { readonly kind: string }
}

/** 注册给 `ctx.webServer.register()` 的路由。 */
export interface WebRouteLike {
  readonly kind: 'exact' | 'prefix'
  readonly path: string
  readonly auth?: WebRouteAuth
  readonly handler: (req: IncomingMessage, res: ServerResponse, peer?: WebPeer) => void | Promise<void>
}

/** `ctx.webServer` 里本插件用到的那一个方法。 */
export interface WebServerSurface {
  register(route: WebRouteLike): () => void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** 浏览器 HTTP 载体；只在 web composition 里存在。 */
    readonly webServer: WebServerSurface
  }
}
