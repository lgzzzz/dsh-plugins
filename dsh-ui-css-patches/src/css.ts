// 由 dsh-code-card-fonts / dsh-rightbar-fonts / dsh-rightbar-tab-width /
// dsh-fullwidth-chat 合并而来。

// ── 右栏字号轴参数（来自 dsh-rightbar-fonts）──────────────────
const FIXED_FONT_SIZE_PX: number | null = null
const FONT_SIZE = FIXED_FONT_SIZE_PX === null
  ? 'var(--dsh-content-font-size, 14px)'
  : `${FIXED_FONT_SIZE_PX}px`
const LINE_HEIGHT = FIXED_FONT_SIZE_PX === null
  ? 'calc(22px + var(--dsh-content-font-delta, 0px))'
  : `${Math.round((FIXED_FONT_SIZE_PX * 22) / 14)}px`
const CODE_FONT = `400 ${FONT_SIZE} / ${LINE_HEIGHT} var(--ds-font-family-code)`
const TABLE_FONT = `${FONT_SIZE} / ${LINE_HEIGHT} var(--dsw-font-family)`
const TABLE_HEAD_FONT = `500 ${FONT_SIZE} / ${LINE_HEIGHT} var(--dsw-font-family)`

// ── 右栏 tab 宽度参数（来自 dsh-rightbar-tab-width）───────────
const CAPSULE_WIDTH_PX = 100

export const CSS = `
/* ═══ 1. 对话全宽（来自 dsh-fullwidth-chat）═══════════════════ */
[data-slot='main.conversation'] [data-conversation-content] {
  --dsh-chat-content-width: 100%;
}

/* ═══ 2. 右栏 tab 固定宽度（来自 dsh-rightbar-tab-width）═════ */
[data-dockkit-tab][role="tab"] {
  box-sizing: border-box;
  min-width: ${CAPSULE_WIDTH_PX}px;
  max-width: ${CAPSULE_WIDTH_PX}px;
}

/* ═══ 3. 右栏预览/变更审查字号（来自 dsh-rightbar-fonts）═════ */
[data-textpreview-body] {
  font-size: ${FONT_SIZE} !important;
  --dsw-font-markdown-code-block: ${CODE_FONT};
}

[data-changes-review] {
  --dsw-font-markdown-code-block: ${CODE_FONT};
}

[data-changes-review] [data-diff-line] {
  min-height: ${LINE_HEIGHT} !important;
  line-height: ${LINE_HEIGHT} !important;
}

[data-document-markdown] {
  --dsw-font-markdown-table: ${TABLE_FONT};
  --dsw-font-markdown-table-head: ${TABLE_HEAD_FONT};
  --dsw-font-markdown-code-block: ${CODE_FONT};
}

[data-textpreview-body] [data-document-markdown] :not(pre) > code {
  font-size: 1em !important;
}

/* ═══ 4. 对话卡片 14px 字号与间距（来自 dsh-code-card-fonts，已修复）═══ */
body {
  --dsh-chat-flow-gap: calc(14px * 0.5);
}

body [data-step-process-body] {
  --dsh-chat-flow-gap: calc(14px * 0.5);
}

/* 披露行标题/摘要：覆盖 secondary 变量（修复失效的 nth-child 定位） */
[data-chat-flow-kind] [data-disclosure-row] {
  --dsh-content-font-size-secondary: 14px;
}

/* 样例卡(bash)标题/摘要：同上 */
[data-sample] {
  --dsh-content-font-size-secondary: 14px;
}

/* compaction 标题/摘要 */
[data-chat-flow-kind="compaction"] button > span:nth-last-child(3),
[data-chat-flow-kind="manual-compaction"] button > span:nth-last-child(3) {
  font-size: 14px !important;
}

[data-chat-flow-kind="compaction"] button > span:last-child,
[data-chat-flow-kind="manual-compaction"] button > span:last-child {
  font-size: 14px !important;
}

/* code / inline code / table */
[data-chat-flow-kind] pre,
[data-chat-flow-kind] pre code {
  font-size: 14px !important;
}

[data-chat-flow-kind] :not(pre) > code {
  font-size: 14px !important;
}

[data-chat-flow-kind] table th,
[data-chat-flow-kind] table td {
  font-size: 14px !important;
}

/* 展开内容 + compact markdown */
[data-chat-flow-kind] [data-open]:not([data-turn-process]) > :not([data-disclosure-row]) {
  font-size: 14px !important;
}

[data-chat-flow-kind] [data-open]:not([data-turn-process]) [data-markdown-variant="compact"] {
  font-size: 14px !important;
}

/* compaction 展开体 */
[data-chat-flow-kind="compaction"] button[aria-expanded="true"] + div,
[data-chat-flow-kind="manual-compaction"] button[aria-expanded="true"] + div {
  font-size: 14px !important;
}

/* 代码字体变量 */
[data-tool],
[data-sample] {
  --dsw-font-markdown-code-block-small: 14px/16px var(--ds-font-family-code);
  --dsw-font-markdown-code-block: 14px/19px var(--ds-font-family-code);
}

[data-sample] + * {
  --dsw-font-markdown-code-block-small: 14px/16px var(--ds-font-family-code);
  --dsw-font-markdown-code-block: 14px/19px var(--ds-font-family-code);
}

/* turn-trigger */
[data-turn-trigger] > button > span:nth-child(2),
[data-turn-trigger] > div > p,
[data-turn-trigger] > div > div {
  font-size: 14px !important;
}
`
