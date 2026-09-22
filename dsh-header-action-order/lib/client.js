window.__ModuleLoader__.load({ id: "dsh-header-action-order", factory: (require) => {
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

// src/order.ts
var HEADER_ACTION_SLOT = "conversation.session.header.actions";
var HEADER_ACTION_ORDER = [
  "agent-preset",
  "agent-team",
  "subagent-catalog",
  "schedule-catalog",
  "job-list"
];
var UNLISTED_ORDER_BASE = 1e3;
function planOrderWrites(entries, preferred = HEADER_ACTION_ORDER) {
  var _a;
  const rank = /* @__PURE__ */ new Map();
  for (let index = 0; index < preferred.length; index += 1) {
    const id = preferred[index];
    if (id !== void 0 && !rank.has(id)) rank.set(id, index);
  }
  const unlisted = entries.filter((entry) => {
    var _a2;
    const id = (_a2 = entry.options) == null ? void 0 : _a2.id;
    return id === void 0 || !rank.has(id);
  });
  const unlistedRank = /* @__PURE__ */ new Map();
  for (const [index, entry] of [...unlisted].sort(byCurrentOrder).entries()) unlistedRank.set(entry, index);
  const writes = [];
  for (const entry of entries) {
    const target = entry.options;
    if (target === void 0) continue;
    const id = target.id;
    const listed = id !== void 0 ? rank.get(id) : void 0;
    const next = listed != null ? listed : UNLISTED_ORDER_BASE + ((_a = unlistedRank.get(entry)) != null ? _a : 0);
    if (target.order !== next) writes.push({ target, order: next, id: id != null ? id : "(no id)" });
  }
  return writes;
}
function byCurrentOrder(left, right) {
  var _a, _b, _c, _d;
  return ((_b = (_a = left.options) == null ? void 0 : _a.order) != null ? _b : 0) - ((_d = (_c = right.options) == null ? void 0 : _c.order) != null ? _d : 0);
}
function applyHeaderActionOrder(slots, preferred = HEADER_ACTION_ORDER) {
  if (typeof slots.entries !== "function") return 0;
  const entries = slots.entries(HEADER_ACTION_SLOT);
  if (entries === void 0 || entries === null) return 0;
  let written = 0;
  for (const write of planOrderWrites(entries, preferred)) {
    try {
      write.target.order = write.order;
      written += 1;
    } catch (error) {
      console.warn(`[dsh-header-action-order] \u65E0\u6CD5\u6539\u5199 ${write.id} \u7684 order:`, error);
    }
  }
  return written;
}

// src/client.ts
var name = "dsh-header-action-order";
var inject = ["slots"];
function getSlots(ctx) {
  if (ctx.get === void 0 || ctx.get === null) return void 0;
  const value = ctx.get("slots");
  return value === null || value === void 0 ? void 0 : value;
}
function apply(ctx) {
  const slots = getSlots(ctx);
  if (slots === void 0) return;
  const reapply = () => {
    try {
      applyHeaderActionOrder(slots, HEADER_ACTION_ORDER);
    } catch (error) {
      console.warn("[dsh-header-action-order] \u91CD\u6392\u5931\u8D25:", error);
    }
  };
  if (typeof slots.inject !== "function") {
    reapply();
    return;
  }
  slots.inject(HEADER_ACTION_SLOT, () => {
    reapply();
    const unsubscribe = typeof slots.subscribe === "function" ? slots.subscribe(HEADER_ACTION_SLOT, reapply) : void 0;
    return () => {
      if (typeof unsubscribe === "function") unsubscribe();
    };
  });
}
return module.exports; } });
