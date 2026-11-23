/**
 * 「本地变更」「变更请求」左侧文件列表的宽度固定为上游默认值，不再可调。
 *
 * 上游 `FileTreePane` 把宽度放在组件内的 `useState(240)` 里，改宽的唯一入口是它渲染的那条
 * 8px 分隔条（`<div role="separator" tabIndex="0" aria-controls=…>`）：指针拖动、方向键与
 * Home / End 都挂在这条分隔条自己的事件里，`onWidth` 只把结果报给工具栏做列对齐。把分隔条
 * `display:none` 掉，两个入口一起消失，文件树就只剩上游自己算出的默认宽度（240px，面板窄时
 * 按可用空间收窄，见 `MIN_WIDTH` / `MAX_WIDTH` / `DIFF_MIN_WIDTH`）。
 *
 * 上游给这条分隔条的稳定标记是 `role="separator"` 与 `aria-controls` 的组合（`aria-controls`
 * 只出现在文件树分隔条上；两条都由 contract.json 的 tree-separator-* 契约盯住）。作用域限定在
 * `[data-forge-changes]` 里：右栏其它可拖动元素与改动审查页（`[data-changes-review]`）不碰。
 *
 * 规则带 `!important`：分隔条的样式声明在 CSS Module 的哈希类名上，模块样式与本插件注入的
 * `<style>` 谁先生效不由本插件掌握；特异性（0,3,0）加 `!important` 保证隐藏不被模块样式翻盘。
 *
 * 不读写 `localStorage`：旧版本记住的 `dsh-changes-behavior:tree-width` 不再被读取，留着也
 * 不会生效。
 */
export const CSS = `
[data-forge-changes] [role="separator"][aria-controls] {
  display: none !important;
}
`

/** 文档根元素上的生效标记：装上样式表时写入，卸载时移除。 */
export const MARKER_ATTRIBUTE = 'data-dsh-changes-behavior-tree-fixed'

/** 样式元素的最小形状（生产环境是 `HTMLStyleElement`，测试接缝）。 */
export interface StyleTagLike {
  readonly dataset?: Record<string, string>
  textContent: string
  remove?(): void
}

/** 打标记的最小根元素形状。 */
export interface MarkedRootLike {
  setAttribute(name: string, value: string): void
  removeAttribute(name: string): void
}

/** 安装隐藏样式需要的文档能力（生产环境是 `Document`，测试接缝）。 */
export interface TreeFixedDocumentLike {
  readonly head?: { appendChild(node: StyleTagLike): void; removeChild?(node: StyleTagLike): void } | null
  readonly documentElement?: MarkedRootLike | null
  createElement?(tag: string): StyleTagLike
}

/**
 * 装上隐藏文件树分隔条的样式表并写入生效标记。
 * @param doc - 目标文档；没有 `head` / `createElement` 时只写标记，不抛错。
 * @returns 卸载函数：移除样式与标记。
 */
export function installFixedTreeWidth(
  doc: TreeFixedDocumentLike | undefined = typeof document === 'undefined'
    ? undefined
    : document as unknown as TreeFixedDocumentLike,
): () => void {
  if (doc === undefined) return () => {}
  let tag: StyleTagLike | undefined
  try {
    if (doc.head !== undefined && doc.head !== null && typeof doc.createElement === 'function') {
      tag = doc.createElement('style')
      if (tag.dataset !== undefined) tag.dataset.plugin = 'dsh-changes-behavior'
      tag.textContent = CSS
      doc.head.appendChild(tag)
    }
  } catch {
    // 非浏览器 / 受限文档：只留标记，不阻止插件其余部分安装。
    tag = undefined
  }
  doc.documentElement?.setAttribute(MARKER_ATTRIBUTE, '')
  return () => {
    try {
      if (tag?.remove !== undefined) tag.remove()
      else if (tag !== undefined) doc.head?.removeChild?.(tag)
    } catch {
      // 样式已被页面卸载带走：忽略。
    }
    doc.documentElement?.removeAttribute(MARKER_ATTRIBUTE)
  }
}
