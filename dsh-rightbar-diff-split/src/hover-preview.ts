/** 变更卡片悬停 diff 浮窗的呈现补丁:让聊天区回合末尾「改动卡片」的文件行**不再弹出 diff 浮窗**。
 *
 * 上游事实(以全局 dsh 包内置 scope 的 lib 源码为准):
 *  - 浮窗是 `dsh-client-ui-deliverables` 里挂在每个文件行上的 `HoverCard`(`variant: "preview"`,
 *    `openDelayMs: 500`),内容 `ChangedFilePreview` = 路径头 + 整段 diff;
 *  - 该浮窗虽然 portal 到 `document.body`,但根元素带稳定标记 `data-changes-hover-preview`
 *    (`data-changes-preview-path` 打在它的路径头上),**整个 @deepseek-ai scope 内只有这一处**;
 *  - `HoverCard` 上游自带 `disabled` 抑制开关,但 `ChangedFiles` 没有传 ⇒ 触发路径无法从外部关闭;
 *  - 浮窗的命中与定位全走 `HoverCard` 的内部实现(`position: fixed` + 内联 left/top/width/
 *    maxHeight),类名是 CSS-module 哈希,不能作为锚点。
 *
 * 因此本补丁只做**呈现抑制**:用那一处稳定 data 属性把浮窗整棵子树从布局与命中测试里摘掉。
 * `display: none` 而不是 `opacity` / `visibility`:后两者仍占着 `position: fixed` 的命中区,
 * 会挡住底下的文件行与页头按钮。
 *
 * 口径与代价(README「浮窗抑制」章节):**不是阻止触发** —— 上游 500ms 后依旧进入 open、
 * 依旧 portal 挂载、依旧有 Escape 监听与 100ms 淡出;被摘掉的只是它的可见性与命中面。
 * 数据面基本无额外成本:同一个比较的读取走 `HostReadStore.loadUrl`,已有非重试状态即直接返回,
 * 所以悬停重读不会重新发请求(详见上游 `dsh-client-ui-deliverables` 的 changes-diff 存储)。
 * 上游若不再打该属性,本补丁静默失效(浮窗重新出现),不会误伤其它 UI。 */

/** 上游 `ChangedFilePreview` 的根标记(style 内首行注释供 DevTools 核对来源)。 */
const PREVIEW_ATTRIBUTE = '[data-changes-hover-preview]'

/** 注入的样式表:唯一规则 = 摘掉变更卡片悬停 diff 浮窗。 */
export const CSS = `/* dsh-rightbar-diff-split: suppress the changed-files card's hover diff popup */
${PREVIEW_ATTRIBUTE} {
  display: none;
}
`

/** 注入样式所需的最小 DOM 面(便于诊断脚本用桩校验;浏览器下即 document)。 */
export interface StyleHost {
  head: { appendChild(node: unknown): unknown }
  createElement(tag: string): StyleElementLike
}

/** 注入的 style 元素面:数据集 + 文本内容 + 摘除。 */
export interface StyleElementLike {
  dataset: Record<string, string>
  textContent: string
  remove(): void
}

/**
 * 装一次样式补丁。
 * @param host - 文档面(DOM document;缺席即 no-op,绝不抛)。
 * @param pluginId - 写进 `data-plugin` 的包名,供 client-hmr / 上游按归属清理。
 * @returns 摘除函数(重复调用安全);DOM 不可用时返回 undefined。
 */
export function installHoverPreviewStyles(host: unknown, pluginId: string): (() => void) | undefined {
  const documentLike = asStyleHost(host)
  if (documentLike === undefined) return undefined
  const tag = documentLike.createElement('style')
  tag.dataset.plugin = pluginId
  tag.textContent = CSS
  documentLike.head.appendChild(tag)
  return () => {
    tag.remove()
  }
}

/** 结构判空:拿不到 createElement / head.appendChild 就不猜也不写。 */
function asStyleHost(value: unknown): StyleHost | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as { head?: unknown; createElement?: unknown }
  if (typeof candidate.createElement !== 'function') return undefined
  if (typeof candidate.head !== 'object' || candidate.head === null) return undefined
  if (typeof (candidate.head as { appendChild?: unknown }).appendChild !== 'function') return undefined
  return candidate as StyleHost
}
