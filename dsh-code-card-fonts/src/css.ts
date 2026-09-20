/**
 * 卡片字号补丁样式真源:文本统一 14px、卡片间距 calc(14px * 0.5) = 7px。
 * 不覆盖 --dsh-content-font-size(「字号大小」仍可调);选择器按稳定 data 属性命中,改后须 npm run build。
 */

export const CSS = `
/* --dsh-chat-flow-gap 须设在 body:字号轴是 body 上的内联样式 */
body {
  --dsh-chat-flow-gap: calc(14px * 0.5);
}

/* 卡片标题 = DisclosureRow 表头第 2 个直属子元素 */
[data-chat-flow-kind] [data-disclosure-row] > span:nth-child(2) {
  font-size: 14px !important;
}

/* Bash 卡片([data-sample])标题 = 表头倒数第 3 个 span */
[data-sample] > span:nth-last-child(3) {
  font-size: 14px !important;
}

/* 压缩标记标题 = 表头 button 内倒数第 3 个 span */
[data-chat-flow-kind="compaction"] button > span:nth-last-child(3),
[data-chat-flow-kind="manual-compaction"] button > span:nth-last-child(3) {
  font-size: 14px !important;
}

/* 摘要行 = 标题之后的直属子元素(第 3 个起) */
[data-chat-flow-kind] [data-disclosure-row] > :nth-child(n+3) {
  font-size: 14px !important;
}

/* Bash 卡片摘要 = 表头最后一个 span */
[data-sample] > span:last-child {
  font-size: 14px !important;
}

/* 压缩标记摘要 = button 内最后一个 span */
[data-chat-flow-kind="compaction"] button > span:last-child,
[data-chat-flow-kind="manual-compaction"] button > span:last-child {
  font-size: 14px !important;
}

[data-chat-flow-kind] pre,
[data-chat-flow-kind] pre code {
  font-size: 14px !important;
}

/* 内联代码:上游 :not(pre)>code 为 (0,1,2),须同特异性靠后注入胜出 */
[data-chat-flow-kind] :not(pre) > code {
  font-size: 14px !important;
}

/* 表格单元格:上游 th/td 取字号轴减 1px 的 secondary 变量;本规则 (0,1,2) 压过 ._tableScroll_* (0,1,1) */
[data-chat-flow-kind] table th,
[data-chat-flow-kind] table td {
  font-size: 14px !important;
}

/* 展开正文包裹层:展开根 [data-open] 内、表头外的兄弟节点(turn-process 也带 data-open,已排除) */
[data-chat-flow-kind] [data-open]:not([data-turn-process]) > :not([data-disclosure-row]) {
  font-size: 14px !important;
}

/* 展开正文的 Markdown 根:上游 0.1.6-alpha.2 起 ReasoningRow 的展开正文由纯文本改为
   MarkdownText(variant="compact"),该根自带 font-size(--dsh-content-font-size-secondary,
   默认 13px)且是包裹层的孙元素;元素自身声明恒胜继承,故须在 Markdown 根上直接命中。
   不设 line-height:上游 alpha.1 该正文行高亦取 secondary 轴,本规则只改字号以保持原状。 */
[data-chat-flow-kind] [data-open]:not([data-turn-process]) [data-markdown-variant="compact"] {
  font-size: 14px !important;
}

/* 压缩标记正文 = button[aria-expanded="true"] 后的 div */
[data-chat-flow-kind="compaction"] button[aria-expanded="true"] + div,
[data-chat-flow-kind="manual-compaction"] button[aria-expanded="true"] + div {
  font-size: 14px !important;
}

/* 工具/bash 卡片:在卡片根重指代码字体 token(主题默认 11px 过小),inspect 按钮保持自身字号 */
[data-tool],
[data-sample] {
  --dsw-font-markdown-code-block-small: 14px/16px var(--ds-font-family-code);
  --dsw-font-markdown-code-block: 14px/19px var(--ds-font-family-code);
}

/* BashRow:data-sample 只打在表头行,正文是其相邻兄弟(不在 [data-sample] 内),故补一次 token 重指 */
[data-sample] + * {
  --dsw-font-markdown-code-block-small: 14px/16px var(--ds-font-family-code);
  --dsw-font-markdown-code-block: 14px/19px var(--ds-font-family-code);
}
`
