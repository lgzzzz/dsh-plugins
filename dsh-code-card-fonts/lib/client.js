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
/* \u95F4\u8DDD = \u5185\u5BB9\u5B57\u53F7\u4E00\u534A\u3002\u58F0\u660E\u5728 body \u800C\u975E :root:--dsh-content-font-size \u7531\u4E3B\u9898
   \u4EE5\u5185\u8054\u6837\u5F0F\u8BBE\u5728 body \u4E0A,\u653E :root \u4F1A\u53D6\u4E0D\u5230\u5B9E\u9645\u503C\u3001\u6052\u7528\u56DE\u9000 14px\u3002 */
body {
  --dsh-chat-flow-gap: calc(14px * 0.5);
}

/* ===== \u5361\u7247\u6807\u9898 \u2014 15px(\u5199\u6B7B,\u4E0E\u5B57\u53F7\u8BBE\u7F6E\u65E0\u5173)===== */
/* DisclosureRow \u7CFB\u5361\u7247:\u8868\u5934\u884C\u7B2C 2 \u4E2A\u76F4\u5C5E\u5B50\u5143\u7D20\u6052\u4E3A\u6807\u9898\u3002 */
[data-chat-flow-kind] [data-disclosure-row] > span:nth-child(2) {
  font-size: 15px !important;
}

/* Bash \u5361\u7247([data-sample],\u4E0D\u8D70 DisclosureRow):\u6807\u9898\u4E3A\u8868\u5934\u5012\u6570\u7B2C 3 \u4E2A span\u3002 */
[data-sample] > span:nth-last-child(3) {
  font-size: 15px !important;
}

/* \u538B\u7F29\u6807\u8BB0(auto/manual):\u6807\u9898\u4F4D\u4E8E\u8868\u5934 <button> \u5185,\u5012\u6570\u7B2C 3 \u4E2A span\u3002 */
[data-chat-flow-kind="compaction"] button > span:nth-last-child(3),
[data-chat-flow-kind="manual-compaction"] button > span:nth-last-child(3) {
  font-size: 15px !important;
}

/* ===== \u5361\u7247\u8868\u5934\u6458\u8981\u884C \u2014 14px ===== */
/* DisclosureRow \u7CFB:\u6807\u9898(\u7B2C 2 \u5B50\u5143\u7D20)\u4E4B\u540E\u7684\u6240\u6709\u76F4\u5C5E\u5B50\u5143\u7D20\u5373\u6574\u6761\u6458\u8981\u884C\u3002 */
[data-chat-flow-kind] [data-disclosure-row] > :nth-child(n+3) {
  font-size: 14px !important;
}

/* Bash \u5361\u7247:\u6458\u8981\u4E3A\u8868\u5934\u6700\u540E\u4E00\u4E2A span\u3002 */
[data-sample] > span:last-child {
  font-size: 14px !important;
}

/* \u538B\u7F29\u6807\u8BB0:\u6458\u8981\u4E3A\u8868\u5934 <button> \u6700\u540E\u4E00\u4E2A span\u3002 */
[data-chat-flow-kind="compaction"] button > span:last-child,
[data-chat-flow-kind="manual-compaction"] button > span:last-child {
  font-size: 14px !important;
}

/* ===== \u4EE3\u7801\u5757\u4E0E\u5185\u8054\u4EE3\u7801 \u2014 14px ===== */
[data-chat-flow-kind] pre,
[data-chat-flow-kind] pre code {
  font-size: 14px !important;
}

/* \u5185\u8054\u4EE3\u7801:\u5E94\u7528\u4FA7 :not(pre)>code \u81EA\u5E26 font-size: .875em !important
   (\u7279\u5F02\u6027 0,1,2)\u3002\u987B\u4FDD\u6301\u7B49\u7279\u5F02\u6027(\u5C5E\u6027 + :not(pre) + code)\u5E76\u4EE5\u672C\u6837\u5F0F\u540E\u6CE8\u5165
   \u7684\u6587\u6863\u987A\u5E8F\u80DC\u51FA\u2014\u2014\u52FF\u964D\u7279\u5F02\u6027\u3002 */
[data-chat-flow-kind] :not(pre) > code {
  font-size: 14px !important;
}

/* ===== \u5361\u7247\u5C55\u5F00\u6B63\u6587 \u2014 14px ===== */
/* DisclosureRow \u7CFB:\u5C55\u5F00\u6839 [data-open] \u5185\u3001\u8868\u5934\u884C [data-disclosure-row] \u4E4B\u5916\u7684
   \u5144\u5F1F\u8282\u70B9\u5373\u6B63\u6587(turn-process \u5F00\u5173\u4E5F\u5E26 data-open,\u5DF2\u663E\u5F0F\u6392\u9664)\u3002 */
[data-chat-flow-kind] [data-open]:not([data-turn-process]) > :not([data-disclosure-row]) {
  font-size: 14px !important;
}

/* \u538B\u7F29\u6807\u8BB0:\u5C55\u5F00\u540E\u7D27\u63A5\u8868\u5934 <button> \u7684 <div> \u5373\u6B63\u6587\u3002 */
[data-chat-flow-kind="compaction"] button[aria-expanded="true"] + div,
[data-chat-flow-kind="manual-compaction"] button[aria-expanded="true"] + div {
  font-size: 14px !important;
}

/* ===== \u5DE5\u5177/bash \u5361\u7247\u5185\u5BB9 \u2014 14px(\u91CD\u6307\u4EE3\u7801\u5B57\u4F53 token)=====
 * I/O \u6587\u672C\u3001\u7EC8\u7AEF\u3001read/diff/search/web \u6B63\u6587\u6D88\u8D39\u8FD9\u4E24\u4E2A token;\u5728\u5361\u7247\u6839\u91CD\u6307
 * token,\u4EC5\u5185\u5BB9\u6587\u672C\u53D8\u5316,inspect \u6309\u94AE(11px)\u7B49\u4FDD\u6301\u81EA\u8EAB\u5B57\u53F7\u3002 */
[data-tool],
[data-sample] {
  --dsw-font-markdown-code-block-small: 14px/16px var(--ds-font-family-code);
  --dsw-font-markdown-code-block: 14px/19px var(--ds-font-family-code);
}
`;

// src/client.ts
var name = "dsh-code-card-fonts";
function apply(ctx) {
  const tag = document.createElement("style");
  tag.dataset.plugin = "dsh-code-card-fonts";
  tag.textContent = CSS;
  document.head.appendChild(tag);
  if (typeof (ctx == null ? void 0 : ctx.effect) === "function") {
    ctx.effect(() => () => tag.remove());
  }
}
return module.exports; } });
