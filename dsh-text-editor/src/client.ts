/**
 * dsh-text-editor — 浏览器半部入口（TypeScript 真源；由 scripts/build-client.mjs
 * 编译为 CommonJS 并打包成单文件 lib/client.js）。
 *
 * 本文件只做装配：声明 inject、注入样式、把 slots 交给 controller.bind()、
 * 用 ctx.provide 注册对外能力面（openFile / showDiff）。功能实现按职责拆在
 * src/ 下的模块：
 *
 *   - api.ts        对外能力契约（服务名 + 类型），供其他插件消费
 *   - controller.ts 编排层：文件 tab 生命周期 + 差异 tab 生命周期
 *   - ui.ts         视图层：文件标签/差异标签、编辑器视图、差异视图、Monaco 容器
 *   - monaco.ts     Monaco AMD 加载封装 + 编辑器实例单例（含 diff 编辑器）
 *   - state.ts      文件状态 store + 差异状态 store
 *   - commands.ts   UI → 编排层的命令总线（打破组件与编排的环）
 *   - routes.ts     与宿主约定的 URL 常量与响应类型
 *   - path.ts       basename / 扩展名 → language id
 *   - css.ts        编辑器与差异视图样式
 */
import { TEXT_EDITOR_SERVICE } from './api.ts'
import type { TextEditorService } from './api.ts'
import { CSS } from './css.ts'
import { bind, openInEditor, showDiffInTab } from './controller.ts'
import type { SessionsFace, SlotsFace } from './controller.ts'

/**
 * 依赖声明：插件在 `slots` 服务可用后才 apply（否则 apply 时
 * `ctx.get('slots')` 返回 undefined，后续 `.inject(...)` 会抛错，导致
 * web 端启动失败）。与 ui-trajectory 等客户端插件保持一致。
 * `sessions` 一并注入：apply 时该服务必已就绪，bind() 才能订阅当前
 * 活动会话——标签的会话作用域依赖它，缺失时会静默失去会话跟踪。
 */
export const inject = ['slots', 'sessions']

export const name = 'dsh-text-editor'

interface ClientContext {
  get(name: string): unknown
  effect(callback: () => void | (() => void)): void
  provide(name: string, value: unknown): () => void
}

function apply(ctx: ClientContext): void {
  const slots = ctx.get('slots') as SlotsFace | null | undefined
  if (slots === null || slots === undefined) return

  ctx.effect(() => {
    const tag = document.createElement('style')
    tag.dataset.plugin = 'dsh-text-editor'
    tag.textContent = CSS
    document.head.appendChild(tag)
    // sessions：观察「当前活动会话」，用于编辑器 tab 的会话作用域（切走消失/切回重现）。
    const sessions = ctx.get('sessions') as SessionsFace | undefined
    const unbind = bind(slots, sessions)
    // 对外能力面：其他客户端插件 `inject: ['dsh-text-editor']` 后
    // `ctx.get('dsh-text-editor')` 取用；卸载时 dispose 自动清理。
    const stopProvide = ctx.provide(TEXT_EDITOR_SERVICE, {
      openFile: (request) => openInEditor(request.path, request.cwd ?? '', request.sessionId),
      showDiff: (request) => showDiffInTab(request),
    } satisfies TextEditorService)
    return () => {
      stopProvide()
      unbind()
      tag.remove()
    }
  })
}

export { apply }
