window.__ModuleLoader__.load({ id: "dsh-sidebar-default-collapsed", factory: (require) => {
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
  inject: () => inject,
  name: () => name
});
module.exports = __toCommonJS(client_exports);

// src/boot-collapse.ts
var ROOT_SLOT = "root";
var SIDEBAR_AUTO_COLLAPSE = 1024;
var BOOT_MARK = "__dshSidebarDefaultCollapsed";
function collapseSidebarOnBoot(services, win) {
  if (win[BOOT_MARK] === true) return "visited";
  const info = readLayoutInfo(services.slots);
  if (info === void 0) return "no-store";
  win[BOOT_MARK] = true;
  if (info.viewportWidth < SIDEBAR_AUTO_COLLAPSE) return "narrow";
  if (info.sidebar === 0) return "already-closed";
  const layout = services.layout;
  if (layout === null || layout === void 0) return "no-service";
  if (typeof layout.toggleSidebar !== "function") return "no-service";
  try {
    layout.toggleSidebar();
  } catch {
    return "failed";
  }
  return "closed";
}
function readLayoutInfo(slots) {
  if (slots === null || slots === void 0) return void 0;
  if (typeof slots.entries !== "function" || typeof slots.resolveStore !== "function") return void 0;
  for (const entry of entriesOf(slots)) {
    const handle = entry == null ? void 0 : entry.store;
    if (handle === null || handle === void 0) continue;
    const info = asLayoutInfo(snapshotOf(slots, handle));
    if (info !== void 0) return info;
  }
  return void 0;
}
function entriesOf(slots) {
  var _a;
  try {
    const entries = (_a = slots.entries) == null ? void 0 : _a.call(slots, ROOT_SLOT);
    return Array.isArray(entries) ? entries : [];
  } catch {
    return [];
  }
}
function snapshotOf(slots, handle) {
  var _a, _b, _c;
  try {
    return (_c = (_b = (_a = slots.resolveStore) == null ? void 0 : _a.call(slots, handle, void 0)) == null ? void 0 : _b.getSnapshot) == null ? void 0 : _c.call(_b);
  } catch {
    return void 0;
  }
}
function asLayoutInfo(snapshot) {
  if (!isPlainObject(snapshot)) return void 0;
  const info = snapshot.layoutInfo;
  if (!isPlainObject(info)) return void 0;
  const { sidebar, viewportWidth } = info;
  if (typeof sidebar !== "number" || typeof viewportWidth !== "number") return void 0;
  return { sidebar, viewportWidth };
}
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// src/client.ts
var name = "dsh-sidebar-default-collapsed";
var inject = ["layout", "slots"];
function getService(ctx, serviceName) {
  if (ctx.get === void 0 || ctx.get === null) return void 0;
  const value = ctx.get(serviceName);
  return value === null || value === void 0 ? void 0 : value;
}
function apply(ctx) {
  if (typeof window === "undefined") return;
  const services = {
    layout: getService(ctx, "layout"),
    slots: getService(ctx, "slots")
  };
  collapseSidebarOnBoot(services, window);
}
return module.exports; } });
