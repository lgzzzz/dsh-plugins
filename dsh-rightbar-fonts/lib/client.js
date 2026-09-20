window.__ModuleLoader__.load({ id: "dsh-rightbar-fonts", factory: (require) => {
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
var FIXED_FONT_SIZE_PX = null;
var FONT_SIZE = FIXED_FONT_SIZE_PX === null ? "var(--dsh-content-font-size, 14px)" : `${FIXED_FONT_SIZE_PX}px`;
var LINE_HEIGHT = FIXED_FONT_SIZE_PX === null ? "calc(22px + var(--dsh-content-font-delta, 0px))" : `${Math.round(FIXED_FONT_SIZE_PX * 22 / 14)}px`;
var CODE_FONT = `400 ${FONT_SIZE} / ${LINE_HEIGHT} var(--ds-font-family-code)`;
var TABLE_FONT = `${FONT_SIZE} / ${LINE_HEIGHT} var(--dsw-font-family)`;
var TABLE_HEAD_FONT = `500 ${FONT_SIZE} / ${LINE_HEIGHT} var(--dsw-font-family)`;
var CSS = `/* dsh-rightbar-fonts: right-sidebar preview + changes review follow the content font-size axis */
/* \u2460 \u53F3\u680F\u6587\u4EF6/\u6587\u672C/\u4EE3\u7801/Markdown \u9884\u89C8:\u6B63\u6587\u5BB9\u5668 [data-textpreview-body]
   \u2014\u2014 \u6B63\u6587\u63D0\u5230\u5B57\u53F7\u8F74\u4E3B\u6863(\u4E0A\u6E38\u53D6 secondary \u6863);
   \u2014\u2014 \u5BB9\u5668\u5185\u91CD\u6307\u4EE3\u7801 token:\u7EAF\u6587\u672C/\u4EE3\u7801\u9875 <pre data-textpreview-page>\u3001Markdown \u91CC\u7684\u4EE3\u7801\u5757\u3001
      CodeBlock \u9884\u89C8(\u5176 --dsl-code-block-content-font \u9ED8\u8BA4\u6307\u5411\u540C\u4E00 token)\u4E00\u5E76\u751F\u6548\u3002 */
[data-textpreview-body] {
  font-size: ${FONT_SIZE} !important;
  --dsw-font-markdown-code-block: ${CODE_FONT};
}

/* \u2461 \u53F3\u680F\u300C\u53D8\u66F4\u5BA1\u9605\u300D\u6807\u7B7E\u9875(dsh-resource://changes-review/\u2026):.body \u7528 font: var(--dsw-font-markdown-code-block) */
[data-changes-review] {
  --dsw-font-markdown-code-block: ${CODE_FONT};
}

/* diff \u6BCF\u884C\u7684\u884C\u9AD8/\u6700\u5C0F\u884C\u9AD8\u4E0A\u6E38\u786C\u7F16\u7801 22px,\u968F\u5B57\u53F7\u589E\u91CF\u540C\u6B65,\u5426\u5219\u5B57\u53F7\u6DA8\u4E86\u884C\u8DDD\u4E0D\u53D8\u4F1A\u66F4\u6324 */
[data-changes-review] [data-diff-line] {
  min-height: ${LINE_HEIGHT} !important;
  line-height: ${LINE_HEIGHT} !important;
}

/* \u2462 \u53F3\u680F Markdown \u9884\u89C8(\u951A\u70B9\u662F MarkdownBody \u6839 [data-document-markdown];\u5176\u5185 MarkdownText
   \u6839\u662F CSS-module \u54C8\u5E0C\u7C7B\u540D,\u9009\u4E0D\u4E2D\u4E5F\u4E0D\u8BE5\u9009,\u53EA\u5F53 token \u7EE7\u627F\u5C42\u7528):\u6B63\u6587\u672C\u6765\u5C31\u8D70\u5B57\u53F7\u8F74,\u4F46\u540C\u5BB9\u5668\u5185
   \u2014\u2014 \u8868\u683C th/td \u5403 secondary \u6863(\u8BBE\u7F6E \u22121px)\u3001\u4EE3\u7801\u56F4\u680F\u5403\u56FA\u5B9A 11px \u7684\u4EE3\u7801 token\u3001
      \u884C\u5185\u4EE3\u7801\u88AB\u4E0A\u6E38\u5199\u6B7B 0.875em(\u8868\u683C\u91CC\u518D\u5199\u6B7B 11px);
   \u8FD9\u91CC\u628A\u4E09\u8005\u4E00\u5E76\u63D0\u5230\u5B57\u53F7\u8F74\u4E3B\u6863,\u4E0E\u6B63\u6587\u540C\u53F7(\u9ED8\u8BA4 14px)\u3002 */
[data-document-markdown] {
  --dsw-font-markdown-table: ${TABLE_FONT};
  --dsw-font-markdown-table-head: ${TABLE_HEAD_FONT};
  --dsw-font-markdown-code-block: ${CODE_FONT};
}

/* \u884C\u5185\u4EE3\u7801:\u4E0A\u6E38\u6E90\u7801 \`.markdown :not(pre) > code{font: var(--dsw-font-markdown-code);
   font-size: .875em !important}\`(\u7C7B\u540D\u6784\u5EFA\u540E\u54C8\u5E0C\u4E3A ._markdown_xxx,\u4E0D\u80FD\u5199 .markdown)\u3002
   \u8868\u683C\u5185\u53E6\u6709 \`.tableScroll table code{font-size: 11px}\`,\u4F46\u5B83\u88AB\u4E0A\u6E38\u81EA\u5DF1\u90A3\u6761 !important \u538B\u6389,
   \u5B9E\u6D4B\u8868\u683C\u5185\u57FA\u7EBF\u662F 0.875 \xD7 13px = 11.375px\u3002
   \u9009\u62E9\u5668\u7528\u4E24\u4E2A data \u5C5E\u6027\u951A\u70B9([data-textpreview-body] \u662F MarkdownBody \u7684\u552F\u4E00\u6E32\u67D3\u7236\u7EA7),
   \u7279\u5F02\u6027 (0,2,2) \u538B\u8FC7\u4E0A\u6E38 (0,1,2),!important \u518D\u538B\u8FC7\u4E0A\u6E38\u90A3\u6761 !important\u3002
   1em \u5373\u7236\u7EA7\u5B57\u53F7 \u21D2 \u6B63\u6587 / \u5217\u8868 / \u5F15\u7528 / \u8868\u683C\u5355\u5143\u683C\u91CC\u5C31\u662F\u5B57\u53F7\u8F74(\u9ED8\u8BA4 14px),\u6807\u9898\u91CC\u968F\u6807\u9898\u9636\u68AF\u3002
   \u884C\u9AD8\u4FDD\u6301\u4E0A\u6E38\u4EE3\u7801 token \u7684 19px(\u82AF\u7247\u9AD8 20px \u4ECD\u5C0F\u4E8E\u6B63\u6587 24px \u884C\u9AD8),\u907F\u514D\u884C\u5185\u4EE3\u7801\u628A\u6574\u884C\u6491\u9AD8\u3002 */
[data-textpreview-body] [data-document-markdown] :not(pre) > code {
  font-size: 1em !important;
}
`;

// src/client.ts
var name = "dsh-rightbar-fonts";
function apply(ctx) {
  installStyles(ctx);
}
function installStyles(ctx) {
  const tag = document.createElement("style");
  tag.dataset.plugin = "dsh-rightbar-fonts";
  tag.textContent = CSS;
  document.head.appendChild(tag);
  if (typeof (ctx == null ? void 0 : ctx.effect) === "function") {
    ctx.effect(() => () => tag.remove());
  }
}
return module.exports; } });
