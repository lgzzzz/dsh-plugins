/**
 * 开关样式：自己挂一张 `<style>`，不依赖上游 primitives 的组件或样式表。
 *
 * 几何与「新建工作树」芯片对齐（28px 高、13px/500、次级文字色、`--dsw-radius-sm`），
 * 开关轨道沿用桌面通知开关的配色：关闭 `--dsw-alias-border-l3`、开启品牌色、
 * 圆点 `--dsw-alias-label-primary-foreground`。
 */

/** 样式表节点上的标记，重复 ensure 不会挂第二张。 */
export const STYLE_TAG_ID = 'dsh-agent-team-hero-toggle/hero-toggle.css'

/** 本插件使用的类名（全部带插件前缀）。 */
export const CLASS = {
  chip: 'dsh-agent-team-hero-toggle',
  track: 'dsh-agent-team-hero-toggle__track',
  thumb: 'dsh-agent-team-hero-toggle__thumb',
  error: 'dsh-agent-team-hero-toggle__error',
} as const

const CSS = `
.${CLASS.chip} {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 8px;
  border: none;
  border-radius: var(--dsw-radius-sm);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-family: inherit;
  font-size: 13px;
  font-weight: 500;
  line-height: 20px;
  white-space: nowrap;
  cursor: pointer;
}
@media (hover: hover) {
  .${CLASS.chip}:hover:not(:disabled) {
    background: var(--dsw-alias-interactive-bg-hover);
  }
}
.${CLASS.chip}:focus-visible {
  outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 2px;
}
.${CLASS.chip}:disabled {
  color: var(--dsw-alias-label-dimmed);
  cursor: default;
}
.${CLASS.track} {
  box-sizing: border-box;
  display: inline-block;
  flex: none;
  width: 28px;
  height: 16px;
  padding: 2px;
  border-radius: 8px;
  background: var(--dsw-alias-border-l3);
  transition: background 120ms ease;
}
.${CLASS.chip}[aria-checked='true'] .${CLASS.track} {
  background: var(--dsw-alias-brand-primary);
}
.${CLASS.thumb} {
  display: block;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--dsw-alias-label-primary-foreground);
  transition: transform 120ms ease;
}
.${CLASS.chip}[aria-checked='true'] .${CLASS.thumb} {
  transform: translateX(12px);
}
.${CLASS.error} {
  color: var(--dsw-alias-state-error-primary);
  font-weight: 700;
}
@media (prefers-reduced-motion: reduce) {
  .${CLASS.track},
  .${CLASS.thumb} {
    transition: none;
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
  tag.dataset.plugin = 'dsh-agent-team-hero-toggle'
  tag.dataset.pluginCss = STYLE_TAG_ID
  tag.textContent = CSS
  doc.head.appendChild(tag)
}
