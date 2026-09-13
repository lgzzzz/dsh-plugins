window.__ModuleLoader__.load({ id: "dsh-rightbar-tab-width", factory: (require) => {
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
var CAPSULE_WIDTH_PX = 100;
var CSS = `/* dsh-rightbar-tab-width: fix every docked right-sidebar tab capsule to ${CAPSULE_WIDTH_PX}px */
[data-dockkit-tab][role="tab"] {
  box-sizing: border-box;
  min-width: ${CAPSULE_WIDTH_PX}px;
  max-width: ${CAPSULE_WIDTH_PX}px;
}
`;

// src/client.ts
var name = "dsh-rightbar-tab-width";
function apply(ctx) {
  installStyles(ctx);
}
function installStyles(ctx) {
  const tag = document.createElement("style");
  tag.dataset.plugin = "dsh-rightbar-tab-width";
  tag.textContent = CSS;
  document.head.appendChild(tag);
  if (typeof (ctx == null ? void 0 : ctx.effect) === "function") {
    ctx.effect(() => () => tag.remove());
  }
}
return module.exports; } });
