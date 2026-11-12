/**
 * 本插件注入的样式表文本：浮层与设置页各一段。
 *
 * 只用自己的类名（`.dsh-model-quick-switch-*`），不依赖上游的类名或 DOM 结构；颜色 / 圆角 /
 * 阴影走主题令牌 `--dsw-*` / `--dsh-*`（多数带回退值，`--dsw-font-family` 没有回退），亮色与
 * 深色主题自动跟随。浮层那一份的结构与 `dsh-workspace-quick-switch` 一致，排查时两边可以对照。
 */

/** 浮层的样式（面板、候选行、空态、错误行、底栏）。 */
export const PALETTE_CSS = `
.dsh-model-quick-switch-overlay {
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
.dsh-model-quick-switch-backdrop {
  pointer-events: auto;
  position: absolute;
  inset: 0;
  background: var(--dsw-alias-bg-mask-1, rgba(0, 0, 0, 0.24));
  backdrop-filter: var(--dsw-mask-blur, none);
}
.dsh-model-quick-switch-panel {
  pointer-events: auto;
  box-sizing: border-box;
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  width: min(560px, 100%);
  max-height: 100%;
  overflow: hidden;
  border-radius: var(--dsw-radius-lg, 16px);
  background: var(--dsw-alias-bg-layer-2, #ffffff);
  box-shadow: var(--dsw-elevation-prominent, 0 10px 30px rgba(0, 0, 0, 0.18));
}
.dsh-model-quick-switch-panel:focus {
  outline: none;
}
.dsh-model-quick-switch-head {
  flex: none;
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 18px 10px;
}
.dsh-model-quick-switch-title {
  font-size: 14px;
  font-weight: 500;
  color: var(--dsw-alias-label-primary, #1b1b1c);
}
.dsh-model-quick-switch-subhead {
  flex: none;
  padding: 0 18px 8px;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary, #81858c);
}
.dsh-model-quick-switch-count {
  font-size: 12px;
  color: var(--dsw-alias-label-tertiary, #81858c);
}
.dsh-model-quick-switch-list {
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
.dsh-model-quick-switch-option {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  box-sizing: border-box;
  padding: 8px 10px;
  border: none;
  border-radius: var(--dsw-radius-sm, 8px);
  background: transparent;
  color: var(--dsw-alias-label-primary, #1b1b1c);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.dsh-model-quick-switch-option[data-active='true'] {
  background: var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, 0.06));
}
.dsh-model-quick-switch-option[data-action] .dsh-model-quick-switch-name {
  font-weight: 500;
}
.dsh-model-quick-switch-option[data-action] .dsh-model-quick-switch-badge[data-badge='操作'] {
  color: var(--dsw-alias-state-business-primary, #3d6ce7);
}
.dsh-model-quick-switch-option:hover:not([data-active='true']) {
  background: var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, 0.06));
}
.dsh-model-quick-switch-option:focus {
  outline: none;
}
.dsh-model-quick-switch-index {
  flex: none;
  width: 20px;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--dsw-alias-label-tertiary, #81858c);
}
.dsh-model-quick-switch-texts {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}
.dsh-model-quick-switch-label {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  font-size: 14px;
}
.dsh-model-quick-switch-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-model-quick-switch-current {
  flex: none;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, 0.06));
  color: var(--dsw-alias-label-tertiary, #81858c);
  font-size: 11px;
  line-height: 18px;
}
.dsh-model-quick-switch-badge {
  flex: none;
  padding: 0 6px;
  border-radius: 999px;
  border: 0.5px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.08));
  color: var(--dsw-alias-state-warn-primary, #a9761b);
  font-size: 11px;
  line-height: 17px;
}
.dsh-model-quick-switch-path {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: var(--dsw-alias-label-tertiary, #81858c);
}
.dsh-model-quick-switch-enter {
  flex: none;
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary, #81858c);
}
.dsh-model-quick-switch-empty {
  padding: 8px 18px 18px;
  font-size: 13px;
  line-height: 20px;
  color: var(--dsw-alias-label-tertiary, #81858c);
}
.dsh-model-quick-switch-status {
  flex: none;
  box-sizing: border-box;
  min-height: 23px;
  padding: 5px 18px 0;
  font-size: 12px;
  line-height: 18px;
}
.dsh-model-quick-switch-error {
  color: var(--dsw-alias-state-error-primary, #c8342f);
}
.dsh-model-quick-switch-pending {
  color: var(--dsw-alias-label-tertiary, #81858c);
}
.dsh-model-quick-switch-foot {
  flex: none;
  display: flex;
  gap: 14px;
  padding: 10px 18px 14px;
  border-top: 0.5px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.08));
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary, #81858c);
}
/*
 * 视口高度不足 860px 时收紧内部留白与行高,保证一屏 10 行在常见笔记本窗口(视口 ≥ 800px)
 * 里一次看全;更矮的窗口仍由列表内部滚动兜底。行高写死,避免中文字体比拉丁字体高 2~3px/行、
 * 10 行累计把最后一行挤出视口。
 */
@media (max-height: 860px) {
  .dsh-model-quick-switch-head {
    padding: 12px 18px 8px;
  }
  .dsh-model-quick-switch-option {
    padding: 5px 10px;
  }
  .dsh-model-quick-switch-name {
    line-height: 18px;
  }
  .dsh-model-quick-switch-path {
    line-height: 15px;
  }
  .dsh-model-quick-switch-foot {
    padding: 8px 18px 10px;
  }
}
`

/** 设置页的样式。 */
export const SETTINGS_CSS = `
.dsh-model-quick-switch-settings {
  display: flex;
  flex-direction: column;
  gap: 18px;
  color: var(--dsw-alias-label-primary, #1b1b1c);
  font-size: 14px;
  line-height: 22px;
}
.dsh-model-quick-switch-settings-title {
  margin: 0;
  font-size: 16px;
  font-weight: 500;
  line-height: 24px;
}
.dsh-model-quick-switch-settings-intro {
  margin: 6px 0 0;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary, #5f6368);
}
.dsh-model-quick-switch-settings-heading {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}
.dsh-model-quick-switch-settings-subtitle {
  margin: 0;
  font-size: 14px;
  font-weight: 500;
  line-height: 22px;
}
.dsh-model-quick-switch-settings-hint {
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary, #81858c);
}
.dsh-model-quick-switch-settings-list {
  margin: 0;
  padding: 0;
  list-style: none;
  border-top: 0.5px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.08));
}
.dsh-model-quick-switch-settings-row {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 0;
  border-bottom: 0.5px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.08));
}
.dsh-model-quick-switch-settings-texts {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}
.dsh-model-quick-switch-settings-name {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  font-size: 14px;
  line-height: 22px;
}
.dsh-model-quick-switch-settings-name-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-primary, #1b1b1c);
}
.dsh-model-quick-switch-settings-id {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary, #81858c);
}
.dsh-model-quick-switch-settings-badge {
  flex: none;
  padding: 0 6px;
  border-radius: 999px;
  border: 0.5px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.08));
  color: var(--dsw-alias-state-warn-primary, #a9761b);
  font-size: 11px;
  line-height: 17px;
}
.dsh-model-quick-switch-settings-current {
  flex: none;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, 0.06));
  color: var(--dsw-alias-label-tertiary, #81858c);
  font-size: 11px;
  line-height: 18px;
}
.dsh-model-quick-switch-settings-button {
  flex: none;
  box-sizing: border-box;
  min-height: 28px;
  padding: 0 10px;
  border: 0.5px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.08));
  border-radius: var(--dsw-radius-sm, 8px);
  background: transparent;
  color: var(--dsw-alias-label-primary, #1b1b1c);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.dsh-model-quick-switch-settings-button:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, 0.06));
}
.dsh-model-quick-switch-settings-button:disabled {
  cursor: default;
  opacity: 0.5;
}
.dsh-model-quick-switch-settings-button:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary, #4b6bfb);
  outline-offset: 1px;
}
.dsh-model-quick-switch-settings-button-danger {
  color: var(--dsw-alias-state-error-primary, #c8342f);
}
.dsh-model-quick-switch-settings-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.dsh-model-quick-switch-settings-note,
.dsh-model-quick-switch-settings-empty {
  margin: 0;
  padding: 12px 0;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary, #81858c);
}
.dsh-model-quick-switch-settings-error {
  margin: 0;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-state-error-primary, #c8342f);
}
.dsh-model-quick-switch-settings-catalog {
  display: flex;
  flex-direction: column;
  gap: 14px;
  border-top: 0.5px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.08));
  padding-top: 14px;
}
.dsh-model-quick-switch-settings-group {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.dsh-model-quick-switch-settings-group-title {
  margin: 0 0 4px;
  font-size: 12px;
  font-weight: 500;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary, #5f6368);
}
.dsh-model-quick-switch-settings-model {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 0;
}
.dsh-model-quick-switch-settings-model-texts {
  display: flex;
  flex-direction: column;
  gap: 1px;
  flex: 1;
  min-width: 0;
}
.dsh-model-quick-switch-settings-model-name {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  font-size: 13px;
  line-height: 20px;
}
.dsh-model-quick-switch-settings-model-name-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-primary, #1b1b1c);
}
.dsh-model-quick-switch-settings-model-id {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  line-height: 16px;
  color: var(--dsw-alias-label-tertiary, #81858c);
}
`
