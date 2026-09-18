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

/* \u5C55\u5F00\u6B63\u6587:\u5C55\u5F00\u6839 [data-open] \u5185\u3001\u8868\u5934\u5916\u7684\u5144\u5F1F\u8282\u70B9(turn-process \u4E5F\u5E26 data-open,\u5DF2\u6392\u9664) */
[data-chat-flow-kind] [data-open]:not([data-turn-process]) > :not([data-disclosure-row]) {
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
