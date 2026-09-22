/**
 * 卡片字号补丁样式真源:文本统一 14px、卡片间距 calc(14px * 0.5) = 7px。
 * 不覆盖 --dsh-content-font-size(「字号大小」仍可调);选择器按稳定 data 属性命中,改后须 npm run build。
 */

export const CSS = `
/* --dsh-chat-flow-gap 须设在 body:字号轴是 body 上的内联样式 */
body {
  --dsh-chat-flow-gap: calc(14px * 0.5);
}

/* 上游 0.1.7-alpha.1 起「思考/工具调用」过程组自带容器(ChatGroupSeat),其 body 元素
   自己声明 --dsh-chat-flow-gap(收起滚动态 8px、展开态 .expandedBody 16px),组内成员卡片
   的 margin-top 由 .content > 兄弟选择器取该变量。自定义属性按「最近声明者」继承,
   它比 body 更近,故 body 上的 7px 到不了成员卡片——须在同一元素上以更高特异性重指
   (0,1,1 压过上游 (0,1,0));两种状态共用 data-step-process-body,一条规则通吃。
   成员自带的 [data-turn-process-answer]{--dsh-chat-flow-gap:8px} 是元素自身声明,不受影响。 */
body [data-step-process-body] {
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

/* ---- 上游 0.1.7-alpha.1 新增卡片面 ---- */

/* ToolDetails 紧凑详情卡(工具历史结果):根自带 font: var(--dsw-font-xs-13),且**不吃**上面在
   [data-tool] 上的 --dsw-font-markdown-code-block-small 重指(它用的是 xs-13 token)。
   该根**没有**无条件稳定 data 属性(只有条件性的 data-inspect / data-caption;滚动类名是
   CSS-module 哈希,不可写),故按 DisclosureRow 展开体结构定位:展开根 [data-open] 的 body
   包裹 div 里,唯一「直接含 ul(条目列表)或 p(空态)」的 div 即该卡根。
   只改 font-size:卡内按设计应为小号的元素(caption / statusText / badge / subtitle 12px、
   prose / code 13px、状态图标 16px、inspect 按钮 11px)各自有显式 font-size 声明,
   不继承本值,保持原状;其余正文(条目文本 / path / 字段 / 列表)统一 14px。
   同结构命中的其它展开体根(如问答卡的 div.card)其文本子元素也都自带显式字号,无副作用。 */
[data-tool] [data-open] > div > div:has(> ul),
[data-tool] [data-open] > div > div:has(> p) {
  font-size: 14px !important;
}

/* turn-trigger 节点卡(0.1.7-alpha.1 新增节点 kind;自带稳定出口 data-turn-trigger):
   标题 = header button 内第 2 个 span(上游 font: var(--dsw-font-xs-13) 简写,须 !important);
   展开体 = section 的 body div 内 p(说明)与 div(正文,其内 pre 已由上面的 code 规则覆盖);
   time 时间戳按既有约定保持组件自身字号。 */
[data-turn-trigger] > button > span:nth-child(2),
[data-turn-trigger] > div > p,
[data-turn-trigger] > div > div {
  font-size: 14px !important;
}
`
