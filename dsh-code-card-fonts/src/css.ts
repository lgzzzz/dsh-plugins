/**
 * 卡片字号补丁的样式真源(经 scripts/build-client.mjs 打包进浏览器半部)。
 *
 * 功能:卡片标题 15px;摘要行、展开正文、代码块、内联代码 14px;消息卡片间距
 * = 内容字号一半(14px × 0.5)。选择器均基于稳定 data 属性精确命中,不使用
 * `[data-x], [data-x] *` 全量覆盖,避免压扁卡内元信息字号的例外(如 inspect
 * 按钮 11px)。
 *
 * 注意事项:改字号/间距后执行 `npm run build` 重建 lib/client.js(产物,禁止
 * 手改);按行内结构定位的规则(第 N 个子元素等)在卡片结构变动后可能失效,
 * 需同步核对。
 */

export const CSS = `
/* 间距 = 内容字号一半。声明在 body 而非 :root:--dsh-content-font-size 由主题
   以内联样式设在 body 上,放 :root 会取不到实际值、恒用回退 14px。 */
body {
  --dsh-chat-flow-gap: calc(14px * 0.5);
}

/* ===== 卡片标题 — 15px(写死,与字号设置无关)===== */
/* DisclosureRow 系卡片:表头行第 2 个直属子元素恒为标题。 */
[data-chat-flow-kind] [data-disclosure-row] > span:nth-child(2) {
  font-size: 15px !important;
}

/* Bash 卡片([data-sample],不走 DisclosureRow):标题为表头倒数第 3 个 span。 */
[data-sample] > span:nth-last-child(3) {
  font-size: 15px !important;
}

/* 压缩标记(auto/manual):标题位于表头 <button> 内,倒数第 3 个 span。 */
[data-chat-flow-kind="compaction"] button > span:nth-last-child(3),
[data-chat-flow-kind="manual-compaction"] button > span:nth-last-child(3) {
  font-size: 15px !important;
}

/* ===== 卡片表头摘要行 — 14px ===== */
/* DisclosureRow 系:标题(第 2 子元素)之后的所有直属子元素即整条摘要行。 */
[data-chat-flow-kind] [data-disclosure-row] > :nth-child(n+3) {
  font-size: 14px !important;
}

/* Bash 卡片:摘要为表头最后一个 span。 */
[data-sample] > span:last-child {
  font-size: 14px !important;
}

/* 压缩标记:摘要为表头 <button> 最后一个 span。 */
[data-chat-flow-kind="compaction"] button > span:last-child,
[data-chat-flow-kind="manual-compaction"] button > span:last-child {
  font-size: 14px !important;
}

/* ===== 代码块与内联代码 — 14px ===== */
[data-chat-flow-kind] pre,
[data-chat-flow-kind] pre code {
  font-size: 14px !important;
}

/* 内联代码:应用侧 :not(pre)>code 自带 font-size: .875em !important
   (特异性 0,1,2)。须保持等特异性(属性 + :not(pre) + code)并以本样式后注入
   的文档顺序胜出——勿降特异性。 */
[data-chat-flow-kind] :not(pre) > code {
  font-size: 14px !important;
}

/* ===== 卡片展开正文 — 14px ===== */
/* DisclosureRow 系:展开根 [data-open] 内、表头行 [data-disclosure-row] 之外的
   兄弟节点即正文(turn-process 开关也带 data-open,已显式排除)。 */
[data-chat-flow-kind] [data-open]:not([data-turn-process]) > :not([data-disclosure-row]) {
  font-size: 14px !important;
}

/* 压缩标记:展开后紧接表头 <button> 的 <div> 即正文。 */
[data-chat-flow-kind="compaction"] button[aria-expanded="true"] + div,
[data-chat-flow-kind="manual-compaction"] button[aria-expanded="true"] + div {
  font-size: 14px !important;
}

/* ===== 工具/bash 卡片内容 — 14px(重指代码字体 token)=====
 * I/O 文本、终端、read/diff/search/web 正文消费这两个 token(主题默认 11px,
 * 过小);在卡片根重指 token,仅内容文本变化,inspect 按钮(11px)等保持自身字号。 */
[data-tool],
[data-sample] {
  --dsw-font-markdown-code-block-small: 14px/16px var(--ds-font-family-code);
  --dsw-font-markdown-code-block: 14px/19px var(--ds-font-family-code);
}

/* Bash 卡片(BashRow)结构特例:data-sample 只打在**表头行**上,展开后的正文
 * (.bodyWrap,内含命令输入与执行结果的 ioCard / TerminalBlock)是表头的**相邻
 * 兄弟节点**,不在 [data-sample] 内、也不是 [data-tool] 的后代——上一组 token
 * 重指到不了它。故在表头的下一个兄弟(即正文容器)上再重指一次,命令与执行
 * 结果文本随 token 变为 14px。 */
[data-sample] + * {
  --dsw-font-markdown-code-block-small: 14px/16px var(--ds-font-family-code);
  --dsw-font-markdown-code-block: 14px/19px var(--ds-font-family-code);
}
`
