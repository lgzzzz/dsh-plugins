export const CSS = `
/* 对话正文撑满可用宽度 */
[data-slot='main.conversation'] [data-conversation-content] {
  --dsh-chat-content-width: 100%;
}

/* 右栏 tab 固定 100px 宽 */
[data-dockkit-tab][role="tab"] {
  box-sizing: border-box;
  min-width: 100px;
  max-width: 100px;
}

/* 右栏预览正文跟随应用字号（默认 14px），代码块同样 14px */
[data-textpreview-body] {
  font-size: var(--dsh-content-font-size, 14px) !important;
  --dsw-font-markdown-code-block: 400 var(--dsh-content-font-size, 14px) / calc(22px + var(--dsh-content-font-delta, 0px)) var(--ds-font-family-code);
}

/* 变更审查代码块字体 14px */
[data-changes-review] {
  --dsw-font-markdown-code-block: 400 var(--dsh-content-font-size, 14px) / calc(22px + var(--dsh-content-font-delta, 0px)) var(--ds-font-family-code);
}

/* 变更审查 diff 行高 22px（随 --dsh-content-font-delta 缩放） */
[data-changes-review] [data-diff-line] {
  min-height: calc(22px + var(--dsh-content-font-delta, 0px)) !important;
  line-height: calc(22px + var(--dsh-content-font-delta, 0px)) !important;
}

/* 文档表格 / 表头 14px，代码块 14px */
[data-document-markdown] {
  --dsw-font-markdown-table: var(--dsh-content-font-size, 14px) / calc(22px + var(--dsh-content-font-delta, 0px)) var(--dsw-font-family);
  --dsw-font-markdown-table-head: 500 var(--dsh-content-font-size, 14px) / calc(22px + var(--dsh-content-font-delta, 0px)) var(--dsw-font-family);
  --dsw-font-markdown-code-block: 400 var(--dsh-content-font-size, 14px) / calc(22px + var(--dsh-content-font-delta, 0px)) var(--ds-font-family-code);
}

/* 文档行内代码跟随正文 1em */
[data-textpreview-body] [data-document-markdown] :not(pre) > code {
  font-size: 1em !important;
}


/* 披露行标题 / 摘要 14px */
[data-chat-flow-kind] [data-disclosure-row] {
  --dsh-content-font-size-secondary: var(--dsh-content-font-size, 14px);
}

/* 样例卡（bash）标题 / 摘要 14px */
[data-sample] {
  --dsh-content-font-size-secondary: var(--dsh-content-font-size, 14px);
}

/* 压缩卡标题 / 摘要 / 展开体 14px */
[data-chat-flow-kind="compaction"],
[data-chat-flow-kind="manual-compaction"] {
  --dsh-content-font-size-secondary: var(--dsh-content-font-size, 14px);
}

/* 卡片内代码块 14px */
[data-chat-flow-kind] pre,
[data-chat-flow-kind] pre code {
  font-size: var(--dsh-content-font-size, 14px) !important;
}

/* 卡片内行内代码 14px */
[data-chat-flow-kind] :not(pre) > code {
  font-size: var(--dsh-content-font-size, 14px) !important;
}

/* 卡片内表格 14px */
[data-chat-flow-kind] table th,
[data-chat-flow-kind] table td {
  font-size: var(--dsh-content-font-size, 14px) !important;
}

/* 展开内容正文 14px */
[data-chat-flow-kind] [data-open]:not([data-turn-process]) > :not([data-disclosure-row]) {
  font-size: var(--dsh-content-font-size, 14px) !important;
}

/* compact markdown 正文 14px */
[data-chat-flow-kind] [data-open]:not([data-turn-process]) [data-markdown-variant="compact"] {
  font-size: var(--dsh-content-font-size, 14px) !important;
}

/* 工具卡 / 样例卡代码块与小号代码 14px */
[data-tool],
[data-sample] {
  --dsw-font-markdown-code-block-small: var(--dsh-content-font-size, 14px)/calc(var(--dsh-content-font-size, 14px) + 2px) var(--ds-font-family-code);
  --dsw-font-markdown-code-block: var(--dsh-content-font-size, 14px)/calc(var(--dsh-content-font-size, 14px) + 5px) var(--ds-font-family-code);
}

/* 样例卡后续内容代码块与小号代码 14px */
[data-sample] + * {
  --dsw-font-markdown-code-block-small: var(--dsh-content-font-size, 14px)/calc(var(--dsh-content-font-size, 14px) + 2px) var(--ds-font-family-code);
  --dsw-font-markdown-code-block: var(--dsh-content-font-size, 14px)/calc(var(--dsh-content-font-size, 14px) + 5px) var(--ds-font-family-code);
}

/* 触发条标题固定 14px */
[data-turn-trigger] > button {
  --dsh-content-font-size: var(--dsh-content-font-size, 14px);
}

/* 触发条展开体正文 14px / 21px */
[data-turn-trigger] > div {
  --dsw-font-xxs-12: var(--dsh-content-font-size, 14px)/calc(var(--dsh-content-font-size, 14px) + 7px) var(--dsw-font-family);
}

[data-slot="conversation.session.header"] * {
  font-size: var(--dsh-content-font-size, 14px) !important;
}

/* 子智能体会话树（role="tree" 精确锚点）自身与子元素 14px */
div[role="tree"]:is([aria-label="子智能体会话"], [aria-label="Subagent sessions"]),
div[role="tree"]:is([aria-label="子智能体会话"], [aria-label="Subagent sessions"]) * {
  font-size: var(--dsh-content-font-size, 14px) !important;
}
`
