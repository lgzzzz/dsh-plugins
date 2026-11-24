/**
 * 本插件的样式：一张自己挂的 `<style>`，规则只有一条——隐藏 forge 的「状态已停止更新」连接行。
 *
 * 范围靠 `src/mark.ts` 打在分区上的标记属性限定，所以普通会话的面板里那行照旧显示；子会话里
 * 那一行被 CSS 隐掉，上游此后怎么重渲染都不必再管。这条规则必须比面板给行的
 * `[data-session-panel-row]`（一个类 + `:where()`，特异度 0,1,0）更强，本选择器是三个属性
 * （0,3,0），因此不需要 `!important`。
 *
 * 守卫自己不渲染可见内容，所以这里没有一条行的排版规则：唯一的效果就是「那一行不见了」。
 */
import { MARKER_ATTRIBUTE } from './mark.ts'

/** 样式表节点上的标记，重复 ensure 不会挂第二张。 */
export const STYLE_TAG_ID = 'dsh-subagent-forge-panel/panel.css'

const CSS = `
/* 子智能体会话里隐藏 forge 的连接行：那一步的 follow 流在 Host 侧必然被拒
   （子智能体会话只走子智能体路由），「重试」只会再失败一次。 */
[data-session-panel-section][${MARKER_ATTRIBUTE}] [data-forge-connection] {
  display: none;
}
`

/**
 * 确保样式表已挂到文档；重复调用是幂等的。
 *
 * @param doc - 目标文档。
 */
export function ensureStyles(doc: Document): void {
  if (doc.querySelector(`style[data-plugin-css="${STYLE_TAG_ID}"]`) !== null) return
  const tag = doc.createElement('style')
  tag.dataset.plugin = 'dsh-subagent-forge-panel'
  tag.dataset.pluginCss = STYLE_TAG_ID
  tag.textContent = CSS
  doc.head.appendChild(tag)
}
