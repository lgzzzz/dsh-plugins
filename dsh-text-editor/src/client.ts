/**
 * dsh-text-editor — 浏览器半部入口（TypeScript 真源；由 scripts/build-client.mjs
 * 编译为 CommonJS 并打包成单文件 lib/client.js）。
 *
 * 本文件只做装配：声明 inject、注入样式、注册右栏编辑器类型、把 slots 交给
 * controller.bind()（差异 tab）、用 ctx.provide 注册对外能力面。功能实现按职责
 * 拆在 src/ 下的模块：
 *
 *   - api.ts        对外能力契约（服务名 + 类型），供其他插件消费
 *   - sidebar.ts    文件面：右栏资源 tab 类型 + 可编辑 Monaco pane 正文 / chip 标题
 *   - file-io.ts    文件读写（宿主 read/write 路由）+ 当前挂载编辑器的登记
 *   - address.ts    dsh-resource://file 地址解析/构造 + 文本类判定
 *   - controller.ts 编排层：差异 tab 生命周期（showDiff / 推进 / 关闭）
 *   - ui.ts         视图层：差异标签、差异视图、Monaco 双栏 diff 容器
 *   - monaco.ts     Monaco AMD 加载封装 + monaco 全局缓存 + 当前 diff 实例
 *   - state.ts      文件状态 store（按会话 + 路径）+ 差异状态 store
 *   - commands.ts   UI → 编排层的差异命令总线
 *   - routes.ts     与宿主约定的 URL 常量与响应类型
 *   - path.ts       basename / 扩展名 → language id
 *   - faces.ts      上游客户端服务的最小结构切片
 *   - css.ts        编辑器与差异视图样式
 */
import { TEXT_EDITOR_SERVICE } from './api.ts'
import type { OpenFileRequest, TextEditorService } from './api.ts'
import { fileAddressFor } from './address.ts'
import { CSS } from './css.ts'
import { bind, showDiffInTab } from './controller.ts'
import type { SessionsFace, SidebarRightFace, SidebarRightTabsFace, SlotsFace } from './faces.ts'
import { registerSidebarEditor } from './sidebar.ts'
import { getActiveSessionId } from './state.ts'

/**
 * 依赖声明：插件在这些服务可用后才 apply（否则 apply 时 `ctx.get(...)` 返回
 * undefined，后续 `.inject(...)` 会抛错，导致 web 端启动失败）。
 *
 *   - slots            keyed slot 注册（右栏 pane 正文 / chip 标题、差异 tab）
 *   - sessions         观察「当前活动会话」（差异 tab 的会话作用域 + openFile 缺省会话）
 *   - sidebarRightTabs 右栏 tab 类型注册表（本插件的文件面入口）
 *   - sidebarRight     右栏导航控制器（openFile 能力把它落到右栏）
 */
export const inject = ['slots', 'sessions', 'sidebarRightTabs', 'sidebarRight']

export const name = 'dsh-text-editor'

interface ClientContext {
  get(name: string): unknown
  effect(callback: () => void | (() => void)): void
  provide(name: string, value: unknown): () => void
}

function apply(ctx: ClientContext): void {
  const slots = ctx.get('slots') as SlotsFace | null | undefined
  const sidebarRightTabs = ctx.get('sidebarRightTabs') as SidebarRightTabsFace | null | undefined
  if (slots === null || slots === undefined) return
  if (sidebarRightTabs === null || sidebarRightTabs === undefined) return

  ctx.effect(() => {
    const tag = document.createElement('style')
    tag.dataset.plugin = 'dsh-text-editor'
    tag.textContent = CSS
    document.head.appendChild(tag)
    // sessions：观察「当前活动会话」，用于差异 tab 的会话作用域与 openFile 的缺省会话。
    const sessions = ctx.get('sessions') as SessionsFace | undefined
    const sidebarRight = ctx.get('sidebarRight') as SidebarRightFace | null | undefined
    // 差异 tab：仍注册在会话主区 conversation.view。
    const unbind = bind(slots, sessions)
    // 文件面：注册为右栏资源 tab 类型（extension 档），右栏文件树与对话文件链接都落到它。
    const stopSidebar = registerSidebarEditor(slots, sidebarRightTabs)
    // 对外能力面：其他客户端插件 `inject: ['dsh-text-editor']` 后
    // `ctx.get('dsh-text-editor')` 取用；卸载时 dispose 自动清理。
    const stopProvide = ctx.provide(TEXT_EDITOR_SERVICE, {
      openFile: (request) => openFileInSidebar(sidebarRight, request),
      showDiff: (request) => showDiffInTab(request),
    } satisfies TextEditorService)
    return () => {
      stopProvide()
      stopSidebar()
      unbind()
      tag.remove()
    }
  })
}

/**
 * 能力 1 的落点：把文件作为 `dsh-resource://file/session/…` 地址开进右栏。
 *
 * 右栏 tab 类型注册表按地址认领：文本文件由本插件的编辑器接管，图片 / PDF 落到
 * 内置文档预览。同一 (kind, 地址) 已打开时只是聚焦既有 tab 并送达新导航。
 *
 * 无挂载的右栏会话面（空白会话 / 右栏插件缺席）时 `openResource` 抛错，这里吞掉：
 * 打开失败不应把异常抛回调用方插件。
 */
function openFileInSidebar(sidebarRight: SidebarRightFace | null | undefined, request: OpenFileRequest): void {
  if (sidebarRight === null || sidebarRight === undefined) return
  const sessionId = request.sessionId ?? getActiveSessionId()
  if (sessionId === undefined) return
  const address = fileAddressFor(sessionId, request.cwd, request.path)
  try {
    if (request.sessionId !== undefined && typeof sidebarRight.openResourceIn === 'function') {
      sidebarRight.openResourceIn(sessionId, address)
      return
    }
    sidebarRight.openResource(address)
  } catch {
    // 该会话的右栏 seat 未挂载：无处可开，静默忽略。
  }
}

export { apply }
