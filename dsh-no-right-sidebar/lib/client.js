window.__ModuleLoader__.load({ id: "dsh-no-right-sidebar", factory: (require) => {
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
var name = "dsh-no-right-sidebar";
function apply(ctx) {
  const stub = {
    openResource(address) {
      console.debug(
        "[dsh-no-right-sidebar] sidebarRight.openResource \u5DF2\u5FFD\u7565(\u53F3\u4FA7\u8FB9\u680F\u5DF2\u505C\u7528):",
        address
      );
    },
    openTab(kind) {
      console.debug(
        "[dsh-no-right-sidebar] sidebarRight.openTab \u5DF2\u5FFD\u7565(\u53F3\u4FA7\u8FB9\u680F\u5DF2\u505C\u7528):",
        kind
      );
    }
  };
  ctx.reflect.provide("sidebarRight", stub);
}
return module.exports; } });
