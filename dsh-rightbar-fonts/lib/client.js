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
