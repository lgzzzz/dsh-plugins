export const CSS = `
/* 对话正文宽度从 920px 变为 100%（撑满可用空间） */
[data-slot='main.conversation'] [data-conversation-content] {
  --dsh-chat-content-width: 100%;
}

/* 右栏 tab 宽度从自适应变为固定 100px */
[data-dockkit-tab][role="tab"] {
  box-sizing: border-box;
  min-width: 100px;
  max-width: 100px;
}

/* 右栏预览正文跟随应用字号（默认 14px），代码块字体从 11px 变为 14px */
[data-textpreview-body] {
  font-size: var(--dsh-content-font-size, 14px) !important;
  --dsw-font-markdown-code-block: 400 var(--dsh-content-font-size, 14px) / calc(22px + var(--dsh-content-font-delta, 0px)) var(--ds-font-family-code);
}

/* 变更审查代码块字体从 11px 变为 14px */
[data-changes-review] {
  --dsw-font-markdown-code-block: 400 var(--dsh-content-font-size, 14px) / calc(22px + var(--dsh-content-font-delta, 0px)) var(--ds-font-family-code);
}

/* 变更审查 diff 行高从 18px 变为 22px（随 --dsh-content-font-delta 缩放） */
[data-changes-review] [data-diff-line] {
  min-height: calc(22px + var(--dsh-content-font-delta, 0px)) !important;
  line-height: calc(22px + var(--dsh-content-font-delta, 0px)) !important;
}

/* 文档表格/表头字体从 13px 变为 14px，代码块字体从 11px 变为 14px */
[data-document-markdown] {
  --dsw-font-markdown-table: var(--dsh-content-font-size, 14px) / calc(22px + var(--dsh-content-font-delta, 0px)) var(--dsw-font-family);
  --dsw-font-markdown-table-head: 500 var(--dsh-content-font-size, 14px) / calc(22px + var(--dsh-content-font-delta, 0px)) var(--dsw-font-family);
  --dsw-font-markdown-code-block: 400 var(--dsh-content-font-size, 14px) / calc(22px + var(--dsh-content-font-delta, 0px)) var(--ds-font-family-code);
}

/* 文档行内代码字体从 0.875em（约 12px）变为跟随正文 1em */
[data-textpreview-body] [data-document-markdown] :not(pre) > code {
  font-size: 1em !important;
}


/* 披露行标题/摘要字体从 13px 变为 14px */
[data-chat-flow-kind] [data-disclosure-row] {
  --dsh-content-font-size-secondary: 14px;
}

/* 样例卡(bash)标题/摘要字体从 13px 变为 14px */
[data-sample] {
  --dsh-content-font-size-secondary: 14px;
}

/* 压缩卡标题/摘要/展开体字体从 13px 变为 14px */
[data-chat-flow-kind="compaction"],
[data-chat-flow-kind="manual-compaction"] {
  --dsh-content-font-size-secondary: 14px;
}

/* 卡片内代码块字体从 11px 变为 14px */
[data-chat-flow-kind] pre,
[data-chat-flow-kind] pre code {
  font-size: 14px !important;
}

/* 卡片内行内代码字体从 12px 变为 14px */
[data-chat-flow-kind] :not(pre) > code {
  font-size: 14px !important;
}

/* 卡片内表格字体从 13px 变为 14px */
[data-chat-flow-kind] table th,
[data-chat-flow-kind] table td {
  font-size: 14px !important;
}

/* 展开内容正文从 12px 变为 14px */
[data-chat-flow-kind] [data-open]:not([data-turn-process]) > :not([data-disclosure-row]) {
  font-size: 14px !important;
}

/* compact markdown 正文字体从 13px 变为 14px */
[data-chat-flow-kind] [data-open]:not([data-turn-process]) [data-markdown-variant="compact"] {
  font-size: 14px !important;
}

/* 工具卡/样例卡代码块与小号代码字体从 11px 变为 14px */
[data-tool],
[data-sample] {
  --dsw-font-markdown-code-block-small: 14px/16px var(--ds-font-family-code);
  --dsw-font-markdown-code-block: 14px/19px var(--ds-font-family-code);
}

/* 样例卡后续内容代码块与小号代码字体从 11px 变为 14px */
[data-sample] + * {
  --dsw-font-markdown-code-block-small: 14px/16px var(--ds-font-family-code);
  --dsw-font-markdown-code-block: 14px/19px var(--ds-font-family-code);
}

/* 触发条标题字体从跟随应用字号变为固定 14px */
[data-turn-trigger] > button {
  --dsh-content-font-size: 14px;
}

/* 触发条展开体正文字体从 12px/18px 变为 14px/21px */
[data-turn-trigger] > div {
  --dsw-font-xxs-12: 14px/21px var(--dsw-font-family);
}
`
