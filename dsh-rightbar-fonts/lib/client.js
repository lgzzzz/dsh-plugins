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
var CSS = `
[data-textpreview-body] {
  font-size: ${FONT_SIZE} !important;
  --dsw-font-markdown-code-block: ${CODE_FONT};
}

[data-changes-review] {
  --dsw-font-markdown-code-block: ${CODE_FONT};
}

[data-changes-review] [data-diff-line] {
  min-height: ${LINE_HEIGHT} !important;
  line-height: ${LINE_HEIGHT} !important;
}

[data-document-markdown] {
  --dsw-font-markdown-table: ${TABLE_FONT};
  --dsw-font-markdown-table-head: ${TABLE_HEAD_FONT};
  --dsw-font-markdown-code-block: ${CODE_FONT};
}

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
