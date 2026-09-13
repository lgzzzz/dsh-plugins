/**
 * 客户端服务的最小结构切片。
 *
 * 权威类型在上游包里（`dsh-client-ui-slots` / `dsh-client-ui-session` /
 * `dsh-client-ui-sidebar-right`），但部分包不在内置 bundle 中，故按仓库约定
 * 只声明本插件真正消费的字段（以上游 lib 源码为准，见 AGENTS.md「类型解析约定」）。
 */

/** slots 服务：keyed slot 的注册与「等 slot 就绪」注入。 */
export interface SlotsFace {
  inject(key: string, callback: () => unknown): () => void
  register(options: Record<string, unknown>, component: unknown): () => void
}

/** sessions 服务：只用到 list 快照 store（当前活动会话）。 */
export interface SessionsFace {
  list?: {
    getSnapshot(): unknown
    subscribe(fn: () => void): () => void
  }
}

/**
 * 右栏 tab 类型注册表（`ctx.sidebarRightTabs`）。
 *
 * register 的定义面：`{ id, kind, patterns?, priority?, canOpen?, title, guide? }`。
 * `priority` 缺省即 `extension` 档（最高档），因此声明 `dsh-resource://file/**`
 * 后本编辑器优先于内置 `builtin`（图片 / PDF / HTML 预览）与 `fallback`
 * （文档预览的文本兜底）接过文件地址。`canOpen` 是否决钩子，`title(address)`
 * 是打开时捕获的标签文案。
 */
export interface SidebarRightTabsFace {
  register(definition: Record<string, unknown>): () => void
}

/** 右栏导航控制器（`ctx.sidebarRight`）。 */
export interface SidebarRightFace {
  /** 在**当前活动会话**的右栏打开一个 `dsh-resource://…` 地址（无挂载会话面时抛错）。 */
  openResource(address: string, options?: { params?: unknown }): void
  /** 在**指定会话**的右栏打开（该会话的右栏 store 未被挂载时静默 no-op）。 */
  openResourceIn?(sessionId: string, address: string, options?: { params?: unknown }): void
}
