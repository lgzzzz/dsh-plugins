/**
 * dsh-no-right-sidebar — 浏览器半部入口(TypeScript 真源;由
 * scripts/build-client.mjs 用 esbuild 打包为 lib/client.js)。
 *
 * 功能:提供一个 no-op 的 `sidebarRight` 桩服务。
 *
 * 背景:cordis.patch.yml 停用了右侧边栏三行(ui-sidebar-right /
 * ui-sidebar-textpreview / ui-sidebar-files),右侧边栏因此完全不加载、不渲染
 * (面板席位、会话头部的展开按钮、guide/文件树/文本预览页全部消失)。但
 * ui-chat 的浏览器半部 inject 声明了 "sidebarRight" 服务(点击对话中的文件
 * 链接时调用 ctx.sidebarRight.openResource(...)),而 cordis 对 inject 未满足
 * 的插件保持 INACTIVE、永不 apply——若不提供桩,主聊天界面会整体瘫痪。
 *
 * 桩只实现 ui-chat 实际调用的最小接口(openResource / openTab),行为为静默
 * no-op(带一条 console.debug 便于诊断)。provide 注册在本插件 fiber 上,
 * 卸载时由 cordis 自动回收并通知依赖方。
 *
 * 不声明 inject:本半部不消费任何服务,provide 是 cordis Context 的基础能力。
 */

export const name = 'dsh-no-right-sidebar'

/** apply(ctx) 的运行时上下文最小面:仅用 reflect.provide 注册服务。 */
interface ClientContext {
  reflect: {
    /** 以本 fiber 为属主注册服务,返回 disposer(fiber 卸载时自动执行)。 */
    provide(name: string, value: unknown): () => void
  }
}

/** ui-chat 实际消费的 sidebarRight 服务最小面。 */
interface SidebarRightStub {
  openResource(address: string, options?: unknown): void
  openTab(kind: string, options?: unknown): void
}

export function apply(ctx: ClientContext): void {
  const stub: SidebarRightStub = {
    openResource(address: string): void {
      console.debug(
        '[dsh-no-right-sidebar] sidebarRight.openResource 已忽略(右侧边栏已停用):',
        address,
      )
    },
    openTab(kind: string): void {
      console.debug(
        '[dsh-no-right-sidebar] sidebarRight.openTab 已忽略(右侧边栏已停用):',
        kind,
      )
    },
  }
  ctx.reflect.provide('sidebarRight', stub)
}
