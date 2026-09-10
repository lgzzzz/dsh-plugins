/**
 * dsh-left-dock — 注入到 document.head 的样式（`<style data-plugin="dsh-left-dock">`）。
 *
 * 配色全部走 ui-theme 暴露的 CSS 变量（与内置左栏同一套），因此在浅色/深色主题与
 * 用户字号设置下与周围界面一致：
 *   --dsw-specific-sidebar-fill        侧栏底色
 *   --dsw-alias-label-primary/secondary 文字
 *   --dsw-alias-interactive-bg-hover/active 交互底色
 *   --dsw-alias-border-l3              分隔线
 *   --dsw-alias-scrollbar-bg-l2/hover-l2 滚动条（经 --dsh-scrollbar-* 间接层）
 * 类名统一带 `dsh-ld-` 前缀，不依赖上游任何哈希类名。
 */
export const CSS = String.raw`
.dsh-ld-root {
  --dsh-ld-strip: 40px;
  display: flex;
  flex-direction: row;
  height: 100%;
  min-width: 0;
  box-sizing: border-box;
  overflow: hidden;
  background: var(--dsw-specific-sidebar-fill);
  color: var(--dsw-alias-label-primary);
  font-size: 14px;
  --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2);
  --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2);
}
.dsh-ld-root[data-state="collapsed"] { --dsh-ld-strip: 56px; }

/* 活动栏：始终可见的两枚按钮（会话 / 文件）。 */
.dsh-ld-strip {
  flex: none;
  width: var(--dsh-ld-strip);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 8px 0 8px;
  box-sizing: border-box;
  border-right: 1px solid var(--dsw-alias-border-l3);
}
.dsh-ld-root[data-state="collapsed"] .dsh-ld-strip {
  border-right: none;
  padding-top: 10px;
}

.dsh-ld-btn {
  position: relative;
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}
.dsh-ld-btn:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.dsh-ld-btn:focus-visible { outline: 2px solid var(--dsw-alias-label-primary); outline-offset: -2px; }
.dsh-ld-btn[data-active="true"] {
  background: var(--dsw-alias-interactive-bg-active);
  color: var(--dsw-alias-label-primary);
}
.dsh-ld-btn[data-active="true"]::before {
  content: '';
  position: absolute;
  left: -5px;
  top: 50%;
  width: 2px;
  height: 18px;
  border-radius: 1px;
  transform: translateY(-50%);
  background: var(--dsw-alias-label-primary);
}
.dsh-ld-root[data-state="collapsed"] .dsh-ld-btn {
  width: 36px;
  height: 36px;
  color: var(--dsw-alias-label-primary);
}

/* 面板容器：活动栏右侧，两个面板都挂载、只显示当前那一个。
   两个都保持挂载（而不是切换时卸载）是为了让会话浏览器保留自己的状态
   ——搜索词、分组展开、滚动位置——与上游「收起时也一直挂着」的做法一致。 */
.dsh-ld-panel {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.dsh-ld-slotPane {
  flex: 1;
  min-height: 0;
  display: none;
  flex-direction: column;
  overflow: hidden;
}
.dsh-ld-slotPane[data-active="true"] { display: flex; }

/* ── 会话面板（新会话 + panellist 行 + 会话浏览器 + 页脚） ───────────────── */
.dsh-ld-session {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 6px 12px;
  box-sizing: border-box;
}
.dsh-ld-brand {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 36px;
  padding: 0 4px;
  margin-bottom: 8px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  overflow: hidden;
}
.dsh-ld-brand:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-ld-brandMark {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.dsh-ld-brandName {
  display: inline-flex;
  align-items: center;
  min-width: 0;
  height: 24px;
  font-size: 16px;
  font-weight: 600;
  line-height: 24px;
  letter-spacing: 0.04em;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.dsh-ld-new {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 38px;
  padding: 8px 16px;
  margin: 0 2px 8px;
  box-sizing: border-box;
  border: 0.5px solid var(--dsw-alias-border-l3);
  border-radius: 12px;
  background: var(--dsw-alias-button-elevated-fill);
  color: var(--dsw-alias-label-primary);
  font-size: 14px;
  font-weight: 500;
  line-height: 22px;
  cursor: pointer;
  overflow: hidden;
}
.dsh-ld-new:hover { background: var(--dsw-alias-button-floating-hover); }
.dsh-ld-new:focus-visible { outline: 2px solid var(--dsw-alias-label-primary); outline-offset: -2px; }
.dsh-ld-panels {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 8px;
}
.dsh-ld-panelRow {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 36px;
  padding: 7px 8px;
  box-sizing: border-box;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  line-height: 22px;
  text-align: left;
  cursor: pointer;
}
.dsh-ld-panelRow:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-ld-panelRow[data-active="true"] {
  background: var(--dsw-alias-interactive-bg-active);
  color: var(--dsw-alias-label-primary);
  font-weight: 500;
}
.dsh-ld-panelGlyph {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.dsh-ld-panelTitle {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 会话浏览器区域：与上游同一套负边距，让内嵌滚动条贴到栏边。 */
.dsh-ld-region {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  margin-left: -4px;
  margin-right: -12px;
  padding-left: 4px;
  overflow: hidden;
}
.dsh-ld-foot {
  flex: none;
  display: flex;
  flex-direction: column;
}
.dsh-ld-footActions,
.dsh-ld-settings {
  flex: none;
  min-width: 0;
  width: 100%;
}
.dsh-ld-footActions { display: flex; }

/* ── 文件面板 ──────────────────────────────────────────────────────────── */
.dsh-ld-files {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.dsh-ld-filesHead {
  flex: none;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 12px 12px 6px;
}
.dsh-ld-path {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary);
}
.dsh-ld-pathInner {
  display: block;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.dsh-ld-pathName { color: var(--dsw-alias-label-primary); font-weight: 600; }
.dsh-ld-tool {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}
.dsh-ld-tool:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.dsh-ld-tree {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 2px 6px 12px;
  box-sizing: border-box;
}
.dsh-ld-level {
  margin: 0;
  padding: 0;
  list-style: none;
}
.dsh-ld-item { margin: 0; }
.dsh-ld-row {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-height: 26px;
  padding: 2px 6px;
  box-sizing: border-box;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
  line-height: 20px;
  text-align: left;
  cursor: pointer;
  overflow: hidden;
}
.dsh-ld-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-ld-row:focus-visible { outline: 2px solid var(--dsw-alias-label-primary); outline-offset: -2px; }
.dsh-ld-row[data-kind="other"] {
  color: var(--dsw-alias-label-secondary);
  cursor: default;
}
.dsh-ld-row[data-kind="other"]:hover { background: transparent; }
.dsh-ld-glyph {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  color: var(--dsw-alias-label-secondary);
}
.dsh-ld-name {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.dsh-ld-note {
  padding: 4px 12px;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary);
}
.dsh-ld-status {
  flex: 1;
  display: flex;
  align-items: flex-start;
  padding: 4px 16px;
}
.dsh-ld-statusLine {
  margin: 0;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary);
}
`
