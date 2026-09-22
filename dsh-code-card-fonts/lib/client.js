window.__ModuleLoader__.load({ id: "dsh-code-card-fonts", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client.ts
var client_exports = {};
__export(client_exports, {
  apply: () => apply,
  name: () => name
});
module.exports = __toCommonJS(client_exports);

// src/css.ts
var CSS = `
/* --dsh-chat-flow-gap \u987B\u8BBE\u5728 body:\u5B57\u53F7\u8F74\u662F body \u4E0A\u7684\u5185\u8054\u6837\u5F0F */
body {
  --dsh-chat-flow-gap: calc(14px * 0.5);
}

/* \u4E0A\u6E38 0.1.7-alpha.1 \u8D77\u300C\u601D\u8003/\u5DE5\u5177\u8C03\u7528\u300D\u8FC7\u7A0B\u7EC4\u81EA\u5E26\u5BB9\u5668(ChatGroupSeat),\u5176 body \u5143\u7D20
   \u81EA\u5DF1\u58F0\u660E --dsh-chat-flow-gap(\u6536\u8D77\u6EDA\u52A8\u6001 8px\u3001\u5C55\u5F00\u6001 .expandedBody 16px),\u7EC4\u5185\u6210\u5458\u5361\u7247
   \u7684 margin-top \u7531 .content > \u5144\u5F1F\u9009\u62E9\u5668\u53D6\u8BE5\u53D8\u91CF\u3002\u81EA\u5B9A\u4E49\u5C5E\u6027\u6309\u300C\u6700\u8FD1\u58F0\u660E\u8005\u300D\u7EE7\u627F,
   \u5B83\u6BD4 body \u66F4\u8FD1,\u6545 body \u4E0A\u7684 7px \u5230\u4E0D\u4E86\u6210\u5458\u5361\u7247\u2014\u2014\u987B\u5728\u540C\u4E00\u5143\u7D20\u4E0A\u4EE5\u66F4\u9AD8\u7279\u5F02\u6027\u91CD\u6307
   (0,1,1 \u538B\u8FC7\u4E0A\u6E38 (0,1,0));\u4E24\u79CD\u72B6\u6001\u5171\u7528 data-step-process-body,\u4E00\u6761\u89C4\u5219\u901A\u5403\u3002
   \u6210\u5458\u81EA\u5E26\u7684 [data-turn-process-answer]{--dsh-chat-flow-gap:8px} \u662F\u5143\u7D20\u81EA\u8EAB\u58F0\u660E,\u4E0D\u53D7\u5F71\u54CD\u3002 */
body [data-step-process-body] {
  --dsh-chat-flow-gap: calc(14px * 0.5);
}

/* \u5361\u7247\u6807\u9898 = DisclosureRow \u8868\u5934\u7B2C 2 \u4E2A\u76F4\u5C5E\u5B50\u5143\u7D20 */
[data-chat-flow-kind] [data-disclosure-row] > span:nth-child(2) {
  font-size: 14px !important;
}

/* Bash \u5361\u7247([data-sample])\u6807\u9898 = \u8868\u5934\u5012\u6570\u7B2C 3 \u4E2A span */
[data-sample] > span:nth-last-child(3) {
  font-size: 14px !important;
}

/* \u538B\u7F29\u6807\u8BB0\u6807\u9898 = \u8868\u5934 button \u5185\u5012\u6570\u7B2C 3 \u4E2A span */
[data-chat-flow-kind="compaction"] button > span:nth-last-child(3),
[data-chat-flow-kind="manual-compaction"] button > span:nth-last-child(3) {
  font-size: 14px !important;
}

/* \u6458\u8981\u884C = \u6807\u9898\u4E4B\u540E\u7684\u76F4\u5C5E\u5B50\u5143\u7D20(\u7B2C 3 \u4E2A\u8D77) */
[data-chat-flow-kind] [data-disclosure-row] > :nth-child(n+3) {
  font-size: 14px !important;
}

/* Bash \u5361\u7247\u6458\u8981 = \u8868\u5934\u6700\u540E\u4E00\u4E2A span */
[data-sample] > span:last-child {
  font-size: 14px !important;
}

/* \u538B\u7F29\u6807\u8BB0\u6458\u8981 = button \u5185\u6700\u540E\u4E00\u4E2A span */
[data-chat-flow-kind="compaction"] button > span:last-child,
[data-chat-flow-kind="manual-compaction"] button > span:last-child {
  font-size: 14px !important;
}

[data-chat-flow-kind] pre,
[data-chat-flow-kind] pre code {
  font-size: 14px !important;
}

/* \u5185\u8054\u4EE3\u7801:\u4E0A\u6E38 :not(pre)>code \u4E3A (0,1,2),\u987B\u540C\u7279\u5F02\u6027\u9760\u540E\u6CE8\u5165\u80DC\u51FA */
[data-chat-flow-kind] :not(pre) > code {
  font-size: 14px !important;
}

/* \u8868\u683C\u5355\u5143\u683C:\u4E0A\u6E38 th/td \u53D6\u5B57\u53F7\u8F74\u51CF 1px \u7684 secondary \u53D8\u91CF;\u672C\u89C4\u5219 (0,1,2) \u538B\u8FC7 ._tableScroll_* (0,1,1) */
[data-chat-flow-kind] table th,
[data-chat-flow-kind] table td {
  font-size: 14px !important;
}

/* \u5C55\u5F00\u6B63\u6587\u5305\u88F9\u5C42:\u5C55\u5F00\u6839 [data-open] \u5185\u3001\u8868\u5934\u5916\u7684\u5144\u5F1F\u8282\u70B9(turn-process \u4E5F\u5E26 data-open,\u5DF2\u6392\u9664) */
[data-chat-flow-kind] [data-open]:not([data-turn-process]) > :not([data-disclosure-row]) {
  font-size: 14px !important;
}

/* \u5C55\u5F00\u6B63\u6587\u7684 Markdown \u6839:\u4E0A\u6E38 0.1.6-alpha.2 \u8D77 ReasoningRow \u7684\u5C55\u5F00\u6B63\u6587\u7531\u7EAF\u6587\u672C\u6539\u4E3A
   MarkdownText(variant="compact"),\u8BE5\u6839\u81EA\u5E26 font-size(--dsh-content-font-size-secondary,
   \u9ED8\u8BA4 13px)\u4E14\u662F\u5305\u88F9\u5C42\u7684\u5B59\u5143\u7D20;\u5143\u7D20\u81EA\u8EAB\u58F0\u660E\u6052\u80DC\u7EE7\u627F,\u6545\u987B\u5728 Markdown \u6839\u4E0A\u76F4\u63A5\u547D\u4E2D\u3002
   \u4E0D\u8BBE line-height:\u4E0A\u6E38 alpha.1 \u8BE5\u6B63\u6587\u884C\u9AD8\u4EA6\u53D6 secondary \u8F74,\u672C\u89C4\u5219\u53EA\u6539\u5B57\u53F7\u4EE5\u4FDD\u6301\u539F\u72B6\u3002 */
[data-chat-flow-kind] [data-open]:not([data-turn-process]) [data-markdown-variant="compact"] {
  font-size: 14px !important;
}

/* \u538B\u7F29\u6807\u8BB0\u6B63\u6587 = button[aria-expanded="true"] \u540E\u7684 div */
[data-chat-flow-kind="compaction"] button[aria-expanded="true"] + div,
[data-chat-flow-kind="manual-compaction"] button[aria-expanded="true"] + div {
  font-size: 14px !important;
}

/* \u5DE5\u5177/bash \u5361\u7247:\u5728\u5361\u7247\u6839\u91CD\u6307\u4EE3\u7801\u5B57\u4F53 token(\u4E3B\u9898\u9ED8\u8BA4 11px \u8FC7\u5C0F),inspect \u6309\u94AE\u4FDD\u6301\u81EA\u8EAB\u5B57\u53F7 */
[data-tool],
[data-sample] {
  --dsw-font-markdown-code-block-small: 14px/16px var(--ds-font-family-code);
  --dsw-font-markdown-code-block: 14px/19px var(--ds-font-family-code);
}

/* BashRow:data-sample \u53EA\u6253\u5728\u8868\u5934\u884C,\u6B63\u6587\u662F\u5176\u76F8\u90BB\u5144\u5F1F(\u4E0D\u5728 [data-sample] \u5185),\u6545\u8865\u4E00\u6B21 token \u91CD\u6307 */
[data-sample] + * {
  --dsw-font-markdown-code-block-small: 14px/16px var(--ds-font-family-code);
  --dsw-font-markdown-code-block: 14px/19px var(--ds-font-family-code);
}

/* ---- \u4E0A\u6E38 0.1.7-alpha.1 \u65B0\u589E\u5361\u7247\u9762 ---- */

/* ToolDetails \u7D27\u51D1\u8BE6\u60C5\u5361(\u5DE5\u5177\u5386\u53F2\u7ED3\u679C):\u6839\u81EA\u5E26 font: var(--dsw-font-xs-13),\u4E14**\u4E0D\u5403**\u4E0A\u9762\u5728
   [data-tool] \u4E0A\u7684 --dsw-font-markdown-code-block-small \u91CD\u6307(\u5B83\u7528\u7684\u662F xs-13 token)\u3002
   \u8BE5\u6839**\u6CA1\u6709**\u65E0\u6761\u4EF6\u7A33\u5B9A data \u5C5E\u6027(\u53EA\u6709\u6761\u4EF6\u6027\u7684 data-inspect / data-caption;\u6EDA\u52A8\u7C7B\u540D\u662F
   CSS-module \u54C8\u5E0C,\u4E0D\u53EF\u5199),\u6545\u6309 DisclosureRow \u5C55\u5F00\u4F53\u7ED3\u6784\u5B9A\u4F4D:\u5C55\u5F00\u6839 [data-open] \u7684 body
   \u5305\u88F9 div \u91CC,\u552F\u4E00\u300C\u76F4\u63A5\u542B ul(\u6761\u76EE\u5217\u8868)\u6216 p(\u7A7A\u6001)\u300D\u7684 div \u5373\u8BE5\u5361\u6839\u3002
   \u53EA\u6539 font-size:\u5361\u5185\u6309\u8BBE\u8BA1\u5E94\u4E3A\u5C0F\u53F7\u7684\u5143\u7D20(caption / statusText / badge / subtitle 12px\u3001
   prose / code 13px\u3001\u72B6\u6001\u56FE\u6807 16px\u3001inspect \u6309\u94AE 11px)\u5404\u81EA\u6709\u663E\u5F0F font-size \u58F0\u660E,
   \u4E0D\u7EE7\u627F\u672C\u503C,\u4FDD\u6301\u539F\u72B6;\u5176\u4F59\u6B63\u6587(\u6761\u76EE\u6587\u672C / path / \u5B57\u6BB5 / \u5217\u8868)\u7EDF\u4E00 14px\u3002
   \u540C\u7ED3\u6784\u547D\u4E2D\u7684\u5176\u5B83\u5C55\u5F00\u4F53\u6839(\u5982\u95EE\u7B54\u5361\u7684 div.card)\u5176\u6587\u672C\u5B50\u5143\u7D20\u4E5F\u90FD\u81EA\u5E26\u663E\u5F0F\u5B57\u53F7,\u65E0\u526F\u4F5C\u7528\u3002 */
[data-tool] [data-open] > div > div:has(> ul),
[data-tool] [data-open] > div > div:has(> p) {
  font-size: 14px !important;
}

/* turn-trigger \u8282\u70B9\u5361(0.1.7-alpha.1 \u65B0\u589E\u8282\u70B9 kind;\u81EA\u5E26\u7A33\u5B9A\u51FA\u53E3 data-turn-trigger):
   \u6807\u9898 = header button \u5185\u7B2C 2 \u4E2A span(\u4E0A\u6E38 font: var(--dsw-font-xs-13) \u7B80\u5199,\u987B !important);
   \u5C55\u5F00\u4F53 = section \u7684 body div \u5185 p(\u8BF4\u660E)\u4E0E div(\u6B63\u6587,\u5176\u5185 pre \u5DF2\u7531\u4E0A\u9762\u7684 code \u89C4\u5219\u8986\u76D6);
   time \u65F6\u95F4\u6233\u6309\u65E2\u6709\u7EA6\u5B9A\u4FDD\u6301\u7EC4\u4EF6\u81EA\u8EAB\u5B57\u53F7\u3002 */
[data-turn-trigger] > button > span:nth-child(2),
[data-turn-trigger] > div > p,
[data-turn-trigger] > div > div {
  font-size: 14px !important;
}
`;

// src/client.ts
var name = "dsh-code-card-fonts";
function apply(ctx) {
  installStyles(ctx);
}
function installStyles(ctx) {
  const tag = document.createElement("style");
  tag.dataset.plugin = "dsh-code-card-fonts";
  tag.textContent = CSS;
  document.head.appendChild(tag);
  if (typeof (ctx == null ? void 0 : ctx.effect) === "function") {
    ctx.effect(() => () => tag.remove());
  }
}
return module.exports; } });
