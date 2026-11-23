/**
 * 「主智能体」一栏的样式：自己挂一张 `<style>`，不依赖上游 primitives 的组件或样式表。
 *
 * 几何照抄会话面板里上游「子智能体」一栏的行：28px 高、`padding: 4px 6px`、行内 8px 间距、
 * `--dsw-radius-sm` 圆角、悬停 `--dsw-alias-interactive-bg-hover`；状态点 6px，
 * 空闲用 `--dsw-alias-state-idle-primary`、运行中用 `--dsw-alias-state-business-primary`。
 * 颜色全部走 `--dsw-*` 设计令牌，随明暗主题切换。
 */

/** 样式表节点上的标记，重复 ensure 不会挂第二张。 */
export const STYLE_TAG_ID = 'dsh-subagent-parent-nav/section.css'

/** 本插件使用的类名（全部带插件前缀）。 */
export const CLASS = {
  list: 'dsh-subagent-parent-nav__list',
  item: 'dsh-subagent-parent-nav__item',
  row: 'dsh-subagent-parent-nav__row',
  dotSlot: 'dsh-subagent-parent-nav__dot-slot',
  dot: 'dsh-subagent-parent-nav__dot',
  title: 'dsh-subagent-parent-nav__title',
  role: 'dsh-subagent-parent-nav__role',
  arrow: 'dsh-subagent-parent-nav__arrow',
} as const

const CSS = `
.${CLASS.list} {
  display: flex;
  flex-direction: column;
  min-width: 0;
  margin: 0;
  padding: 0;
  list-style: none;
}
.${CLASS.item} {
  min-width: 0;
}
.${CLASS.row} {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 28px;
  padding: 4px 6px;
  border: 0;
  border-radius: var(--dsw-radius-sm);
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font-family: inherit;
  font-size: 13px;
  font-weight: 400;
  line-height: 20px;
  text-align: left;
  cursor: pointer;
}
@media (hover: hover) {
  .${CLASS.row}:hover {
    background: var(--dsw-alias-interactive-bg-hover);
  }
}
.${CLASS.row}:active {
  background: var(--dsw-alias-interactive-bg-active);
}
.${CLASS.row}:focus-visible {
  outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: -2px;
}
.${CLASS.dotSlot} {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 20px;
}
.${CLASS.dot} {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--dsw-alias-state-idle-primary);
}
.${CLASS.row}[data-running] .${CLASS.dot} {
  background: var(--dsw-alias-state-business-primary);
}
.${CLASS.title} {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.${CLASS.role} {
  flex: none;
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 20px;
  white-space: nowrap;
}
.${CLASS.arrow} {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  /* 16px 宽与面板行尾列对齐；20px 高与标题同一行盒，箭头字形本身仍是 14px。 */
  width: 16px;
  height: 20px;
  color: var(--dsw-alias-label-tertiary);
}
@media (hover: hover) {
  .${CLASS.row}:hover .${CLASS.arrow} {
    color: var(--dsw-alias-label-primary);
  }
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
  tag.dataset.plugin = 'dsh-subagent-parent-nav'
  tag.dataset.pluginCss = STYLE_TAG_ID
  tag.textContent = CSS
  doc.head.appendChild(tag)
}
