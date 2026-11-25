/**
 * 浮层自己的样式表与类名。
 *
 * 高度预算、指针与滚轮的处理见 `overlay.tsx`；颜色只取 `--dsw-alias-*` 主题令牌，
 * 亮/暗主题随宿主切换。类名全部带本插件前缀，节点随插件 fiber 卸载一起移除。
 */

import { name } from './runtime.ts'

/** 本插件使用的类名（全部带插件前缀）。 */
export const CLASS = {
  overlay: 'dsh-workspace-quick-switch-overlay',
  backdrop: 'dsh-workspace-quick-switch-backdrop',
  panel: 'dsh-workspace-quick-switch-panel',
  head: 'dsh-workspace-quick-switch-head',
  title: 'dsh-workspace-quick-switch-title',
  count: 'dsh-workspace-quick-switch-count',
  list: 'dsh-workspace-quick-switch-list',
  option: 'dsh-workspace-quick-switch-option',
  index: 'dsh-workspace-quick-switch-index',
  texts: 'dsh-workspace-quick-switch-texts',
  label: 'dsh-workspace-quick-switch-label',
  name: 'dsh-workspace-quick-switch-name',
  current: 'dsh-workspace-quick-switch-current',
  badge: 'dsh-workspace-quick-switch-badge',
  path: 'dsh-workspace-quick-switch-path',
  enter: 'dsh-workspace-quick-switch-enter',
  empty: 'dsh-workspace-quick-switch-empty',
  foot: 'dsh-workspace-quick-switch-foot',
} as const

export const PALETTE_CSS = `
.dsh-workspace-quick-switch-overlay {
  pointer-events: none;
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: max(24px, var(--dsh-frame-overlay-top, 24px)) 24px 24px;
  font-family: var(--dsw-font-family);
}
.dsh-workspace-quick-switch-backdrop {
  pointer-events: auto;
  position: absolute;
  inset: 0;
  background: var(--dsw-alias-bg-mask-1);
  backdrop-filter: var(--dsw-mask-blur, none);
}
.dsh-workspace-quick-switch-panel {
  pointer-events: auto;
  box-sizing: border-box;
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  width: min(520px, 100%);
  max-height: 100%;
  overflow: hidden;
  border-radius: var(--dsw-radius-lg, 16px);
  background: var(--dsw-alias-bg-layer-2);
  box-shadow: var(--dsw-elevation-prominent);
}
.dsh-workspace-quick-switch-panel:focus {
  outline: none;
}
.dsh-workspace-quick-switch-head {
  flex: none;
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 18px 10px;
}
.dsh-workspace-quick-switch-title {
  font-size: 14px;
  font-weight: 500;
  color: var(--dsw-alias-label-primary);
}
.dsh-workspace-quick-switch-count {
  font-size: 12px;
  color: var(--dsw-alias-label-tertiary);
}
.dsh-workspace-quick-switch-list {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0;
  padding: 0 8px 8px;
  list-style: none;
  overflow-y: auto;
}
.dsh-workspace-quick-switch-option {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  box-sizing: border-box;
  padding: 8px 10px;
  border: none;
  border-radius: var(--dsw-radius-sm, 8px);
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.dsh-workspace-quick-switch-option[data-active='true'] {
  background: var(--dsw-alias-interactive-bg-hover);
}
.dsh-workspace-quick-switch-option:hover:not([data-active='true']) {
  background: var(--dsw-alias-interactive-bg-hover);
}
.dsh-workspace-quick-switch-option:focus {
  outline: none;
}
.dsh-workspace-quick-switch-index {
  flex: none;
  width: 20px;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--dsw-alias-label-tertiary);
}
.dsh-workspace-quick-switch-texts {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}
.dsh-workspace-quick-switch-label {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  font-size: 14px;
}
.dsh-workspace-quick-switch-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-workspace-quick-switch-current {
  flex: none;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  line-height: 18px;
}
.dsh-workspace-quick-switch-badge {
  flex: none;
  padding: 0 6px;
  border-radius: 999px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  line-height: 17px;
}
.dsh-workspace-quick-switch-path {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: var(--dsw-alias-label-tertiary);
}
.dsh-workspace-quick-switch-enter {
  flex: none;
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary);
}
.dsh-workspace-quick-switch-empty {
  padding: 8px 18px 18px;
  font-size: 13px;
  color: var(--dsw-alias-label-tertiary);
}
.dsh-workspace-quick-switch-foot {
  flex: none;
  display: flex;
  gap: 14px;
  padding: 10px 18px 14px;
  border-top: 0.5px solid var(--dsw-alias-border-l2);
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary);
}
/*
 * 视口高度不足 860px 时收紧内部留白与行高,保证一屏 10 行在常见笔记本窗口(视口 ≥ 800px)
 * 里一次看全;更矮的窗口仍由列表内部滚动兜底。
 *
 * 行高要显式写死:候选行是「名称 + 路径」两行文字,默认值 line-height: normal 会按字体
 * 给不同高度(中文 / 日文字体比拉丁字体高 2~3px/行,10 行累计差 20~30px,足以让第 10 行
 * 掉出视口)。写死之后一屏高度与标题语言无关。
 *
 * 只改内部间距,不动浮层根节点的顶部内边距 —— 那个值要让开 macOS 红绿灯 / Windows 标题栏。
 */
@media (max-height: 860px) {
  .dsh-workspace-quick-switch-head {
    padding: 12px 18px 8px;
  }
  .dsh-workspace-quick-switch-option {
    padding: 5px 10px;
  }
  .dsh-workspace-quick-switch-name {
    line-height: 18px;
  }
  .dsh-workspace-quick-switch-path {
    line-height: 15px;
  }
  .dsh-workspace-quick-switch-foot {
    padding: 8px 18px 10px;
  }
}
`

/** 往 `<head>` 挂一张样式表，并返回移除它的函数。 */
export function installStyleTag(): () => void {
  const tag = document.createElement('style')
  tag.dataset.plugin = name
  tag.textContent = PALETTE_CSS
  document.head.appendChild(tag)
  return () => tag.remove()
}
