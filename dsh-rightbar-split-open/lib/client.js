window.__ModuleLoader__.load({ id: "dsh-rightbar-split-open", factory: (require) => {
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

// src/split-open.ts
var FILES_KIND = "files";
var FILES_PAGE_ADDRESS = "sidebar://files";
var FILE_ADDRESS_PREFIX = "dsh-resource://file/";
var TREE_RATIO = 0.2;
var RATIO_EPSILON = 1e-3;
function paneOf(layout, paneId) {
  var _a;
  if (layout === void 0 || typeof paneId !== "string" || paneId === "") return void 0;
  const node = (_a = layout.nodes) == null ? void 0 : _a[paneId];
  if (node === void 0 || node === null) return void 0;
  if (node.kind !== "pane") return void 0;
  return node;
}
function dockPaneOf(layout, paneId) {
  const pane = paneOf(layout, paneId);
  if (pane === void 0) return void 0;
  return pane.host === "dock" ? pane : void 0;
}
function dockPanes(layout) {
  var _a;
  const panes = [];
  if (layout === void 0) return panes;
  for (const node of Object.values((_a = layout.nodes) != null ? _a : {})) {
    if (node === void 0 || node === null) continue;
    if (node.kind !== "pane") continue;
    if (node.host === "dock") panes.push(node);
  }
  return panes;
}
function paneOfTab(layout, tabId) {
  var _a;
  if (typeof tabId !== "string" || tabId === "") return void 0;
  for (const pane of dockPanes(layout)) {
    if (((_a = pane.tabs) != null ? _a : []).includes(tabId)) return pane;
  }
  return void 0;
}
function tabRecordOf(layout, tabId) {
  var _a;
  if (layout === void 0 || typeof tabId !== "string" || tabId === "") return void 0;
  const record = (_a = layout.tabs) == null ? void 0 : _a[tabId];
  return record === void 0 || record === null ? void 0 : record;
}
function isFilesTab(record) {
  if (record === void 0) return false;
  return record.kind === FILES_KIND || record.contentId === FILES_PAGE_ADDRESS;
}
function isFileResourceTab(record) {
  if (record === void 0) return false;
  return typeof record.contentId === "string" && record.contentId.startsWith(FILE_ADDRESS_PREFIX);
}
function filesTabIn(pane, layout) {
  var _a;
  if (pane === void 0) return void 0;
  for (const tabId of (_a = pane.tabs) != null ? _a : []) {
    if (isFilesTab(tabRecordOf(layout, tabId))) return tabId;
  }
  return void 0;
}
function treePaneOf(layout) {
  if (layout === void 0) return void 0;
  for (const pane of dockPanes(layout)) {
    if (filesTabIn(pane, layout) !== void 0) return pane;
  }
  return void 0;
}
function filePaneOf(layout) {
  var _a;
  if (layout === void 0) return void 0;
  for (const pane of dockPanes(layout)) {
    if (filesTabIn(pane, layout) !== void 0) continue;
    for (const tabId of (_a = pane.tabs) != null ? _a : []) {
      if (isFileResourceTab(tabRecordOf(layout, tabId))) return pane;
    }
  }
  return void 0;
}
function siblingPaneOf(layout, paneId) {
  var _a, _b, _c;
  if (layout === void 0) return void 0;
  for (const node of Object.values((_a = layout.nodes) != null ? _a : {})) {
    if (node === void 0 || node === null) continue;
    if (node.kind !== "split") continue;
    if (!((_b = node.children) != null ? _b : []).includes(paneId)) continue;
    for (const childId of (_c = node.children) != null ? _c : []) {
      if (childId === paneId) continue;
      const sibling = dockPaneOf(layout, childId);
      if (sibling !== void 0) return sibling;
    }
  }
  return void 0;
}
function newFileTabsIn(prev, next, pane) {
  var _a, _b;
  if (prev === void 0 || next === void 0 || pane === void 0) return [];
  const found = [];
  for (const tabId of (_a = pane.tabs) != null ? _a : []) {
    const before = (_b = prev.tabs) == null ? void 0 : _b[tabId];
    if (before !== void 0 && before !== null) continue;
    if (!isFileResourceTab(tabRecordOf(next, tabId))) continue;
    found.push(tabId);
  }
  return found;
}
function planSplitOpen(prev, next) {
  if (prev === void 0 || next === void 0) return void 0;
  const treePane = treePaneOf(next);
  if (treePane === void 0) return void 0;
  const opened = newFileTabsIn(prev, next, treePane);
  const fileTabId = opened[0];
  if (fileTabId === void 0) return void 0;
  const filePane = filePaneOf(next);
  return filePane === void 0 ? { treePaneId: treePane.id, fileTabId } : { treePaneId: treePane.id, fileTabId, filePaneId: filePane.id };
}
function targetSizes(paneCount) {
  if (!Number.isFinite(paneCount) || paneCount < 1) return [];
  const count = Math.trunc(paneCount);
  if (count === 1) return [1];
  const tree = Math.min(TREE_RATIO + RATIO_EPSILON, 1 / count);
  if (count === 2) return [tree, 1 - tree];
  const rest = (1 - tree) / (count - 1);
  return [tree, ...Array.from({ length: count - 1 }, () => rest)];
}
function splitHolding(layout, paneIds) {
  var _a, _b;
  if (layout === void 0) return void 0;
  const wanted = paneIds.filter((paneId) => typeof paneId === "string" && paneId !== "");
  if (wanted.length === 0) return void 0;
  for (const node of Object.values((_a = layout.nodes) != null ? _a : {})) {
    if (node === void 0 || node === null) continue;
    if (node.kind !== "split") continue;
    const children = (_b = node.children) != null ? _b : [];
    if (wanted.every((paneId) => children.includes(paneId))) return node;
  }
  return void 0;
}
function treeIndexIn(split, treePaneId) {
  var _a;
  if (split === void 0) return -1;
  return ((_a = split.children) != null ? _a : []).indexOf(treePaneId);
}
function sizesForTreeFirst(split, treePaneId) {
  if (split === void 0) return void 0;
  if (treeIndexIn(split, treePaneId) !== 0) return void 0;
  return targetSizes(split.children.length);
}

// src/rightbar.ts
var RIGHTBAR_SLOT = "rightbar.session";
var WIRED = /* @__PURE__ */ Symbol.for("dsh-rightbar-split-open.wired");
var WIRE_ATTEMPTS = 6;
function installSessionWiring(services, onOpen) {
  const uiSession = services.uiSession;
  if (uiSession === null || uiSession === void 0) return void 0;
  const original = uiSession.resolve;
  if (typeof original !== "function") return void 0;
  if (uiSession[WIRED] === true) return void 0;
  const records = /* @__PURE__ */ new Map();
  let installed = true;
  const wire = (sessionId, binding, attempt) => {
    if (!installed) return;
    const existing = records.get(sessionId);
    if (existing !== void 0 && existing.disposed !== true) return;
    if (wireSession(records, services.slots, sessionId, binding, onOpen)) return;
    if (attempt + 1 >= WIRE_ATTEMPTS) return;
    scheduleMicrotask(() => {
      wire(sessionId, binding, attempt + 1);
    });
  };
  const wrapped = (sessionId) => {
    const result = original.call(uiSession, sessionId);
    if (installed && typeof sessionId === "string" && sessionId !== "") {
      const binding = result;
      scheduleMicrotask(() => {
        wire(sessionId, binding, 0);
      });
    }
    return result;
  };
  try {
    Object.defineProperty(uiSession, "resolve", {
      value: wrapped,
      writable: true,
      configurable: true,
      enumerable: false
    });
    uiSession[WIRED] = true;
  } catch {
    return void 0;
  }
  return {
    dispose() {
      var _a;
      installed = false;
      for (const record of records.values()) {
        record.disposed = true;
        (_a = record.unsubscribe) == null ? void 0 : _a.call(record);
      }
      records.clear();
      try {
        Object.defineProperty(uiSession, "resolve", {
          value: original,
          writable: true,
          configurable: true,
          enumerable: false
        });
        delete uiSession[WIRED];
      } catch {
      }
    }
  };
}
function wireSession(records, slots, sessionId, binding, onOpen) {
  var _a;
  const store = resolveStore(slots, binding);
  if (store === void 0) return false;
  const existing = records.get(sessionId);
  if (existing !== void 0 && existing.store === store && existing.disposed !== true) return true;
  if (existing !== void 0) {
    existing.disposed = true;
    (_a = existing.unsubscribe) == null ? void 0 : _a.call(existing);
  }
  const record = { sessionId, store };
  records.set(sessionId, record);
  if (typeof store.subscribe !== "function") return true;
  const commit = () => {
    if (record.disposed === true) return;
    observe(record, onOpen);
  };
  try {
    record.unsubscribe = store.subscribe(commit);
  } catch {
    record.unsubscribe = void 0;
  }
  record.baseline = readLayout(store, sessionId);
  return true;
}
function observe(record, onOpen) {
  const next = readLayout(record.store, record.sessionId);
  if (next === void 0) return;
  const previous = record.baseline;
  record.baseline = next;
  if (previous === void 0) return;
  const plan = planSplitOpen(previous, next);
  if (plan === void 0) return;
  onOpen({ sessionId: record.sessionId, store: record.store, layout: next, plan });
}
function readLayout(store, sessionId) {
  if (typeof store.getSnapshot !== "function") return void 0;
  let snapshot;
  try {
    snapshot = store.getSnapshot();
  } catch {
    return void 0;
  }
  if (typeof snapshot !== "object" || snapshot === null) return void 0;
  const bySession = snapshot.bySession;
  if (typeof bySession !== "object" || bySession === null) return void 0;
  const surface = bySession[sessionId];
  if (typeof surface !== "object" || surface === null) return void 0;
  const layout = surface.layout;
  if (typeof layout !== "object" || layout === null) return void 0;
  return layout;
}
function resolveStore(slots, binding) {
  if (slots === null || slots === void 0) return void 0;
  if (typeof slots.entries !== "function" || typeof slots.resolveStore !== "function") return void 0;
  if (typeof binding !== "object" || binding === null) return void 0;
  if (typeof binding.key !== "string") return void 0;
  let entries;
  try {
    const found = slots.entries(RIGHTBAR_SLOT);
    entries = Array.isArray(found) ? found : [];
  } catch {
    return void 0;
  }
  for (const entry of entries) {
    const handle = entry == null ? void 0 : entry.store;
    if (handle === void 0 || handle === null) continue;
    let instance;
    try {
      instance = slots.resolveStore(handle, binding);
    } catch {
      continue;
    }
    const store = asStore(instance);
    if (store !== void 0) return store;
  }
  return void 0;
}
function asStore(instance) {
  if (typeof instance !== "object" || instance === null) return void 0;
  if (typeof instance.getSnapshot !== "function") return void 0;
  return instance;
}
function scheduleMicrotask(task) {
  if (typeof queueMicrotask === "function") {
    queueMicrotask(task);
    return;
  }
  void Promise.resolve().then(task);
}

// src/session-split.ts
function createSplitHandler(sidebarRight) {
  return (event) => {
    try {
      handleOpen(sidebarRight, event);
    } catch (error) {
      console.warn("[dsh-rightbar-split-open] split-open failed:", error);
    }
  };
}
function handleOpen(sidebarRight, event) {
  const { sessionId, store, layout, plan } = event;
  if (typeof (sidebarRight == null ? void 0 : sidebarRight.split) !== "function") return;
  const sibling = siblingPaneOf(layout, plan.treePaneId);
  if (sibling !== void 0) {
    placeFileTab(store, sessionId, plan.fileTabId, sibling.id, plan.treePaneId);
    focusTree(store, sessionId, plan.treePaneId);
    return;
  }
  if (plan.filePaneId !== void 0) {
    placeFileTab(store, sessionId, plan.fileTabId, plan.filePaneId, plan.treePaneId);
    focusTree(store, sessionId, plan.treePaneId);
    return;
  }
  const created = splitPane(sidebarRight, plan.treePaneId);
  if (created === void 0) return;
  const afterSplit = readLayout(store, sessionId);
  if (afterSplit !== void 0) applyRatioIfTreeFirst(store, sessionId, afterSplit, plan.treePaneId);
  placeFileTab(store, sessionId, plan.fileTabId, created, plan.treePaneId, true);
  focusTree(store, sessionId, plan.treePaneId);
}
function splitPane(sidebarRight, treePaneId) {
  const split = sidebarRight.split;
  if (typeof split !== "function") return void 0;
  let created;
  try {
    created = split.call(sidebarRight, treePaneId);
  } catch {
    return void 0;
  }
  return typeof created === "string" && created !== "" ? created : void 0;
}
function placeFileTab(store, sessionId, fileTabId, targetPaneId, treePaneId, closeSeed = false) {
  const actions = store.actions;
  const placeTab = actions == null ? void 0 : actions.placeTab;
  if (actions === void 0 || actions === null || typeof placeTab !== "function") return;
  const fresh = readLayout(store, sessionId);
  if (fresh === void 0) return;
  if (dockPaneOf(fresh, targetPaneId) === void 0) return;
  const holder = paneOfTab(fresh, fileTabId);
  if (holder === void 0 || holder.id !== treePaneId) return;
  try {
    placeTab.call(actions, sessionId, fileTabId, targetPaneId, 0);
  } catch {
    return;
  }
  if (closeSeed) closeSeededPage(store, sessionId, targetPaneId, treePaneId);
}
function closeSeededPage(store, sessionId, paneId, treePaneId) {
  if (paneId === treePaneId) return;
  const actions = store.actions;
  const closeTab = actions == null ? void 0 : actions.closeTab;
  if (actions === void 0 || actions === null || typeof closeTab !== "function") return;
  const fresh = readLayout(store, sessionId);
  if (fresh === void 0) return;
  const pane = dockPaneOf(fresh, paneId);
  if (pane === void 0) return;
  const seeded = filesTabIn(pane, fresh);
  if (seeded === void 0) return;
  try {
    closeTab.call(actions, sessionId, seeded);
  } catch {
  }
}
function applyRatioIfTreeFirst(store, sessionId, layout, treePaneId) {
  const split = splitHolding(layout, [treePaneId]);
  if (split === void 0) return;
  const sizes = sizesForTreeFirst(split, treePaneId);
  if (sizes === void 0) return;
  const actions = store.actions;
  const resize = actions == null ? void 0 : actions.resizeSplit;
  if (actions === void 0 || actions === null || typeof resize !== "function") return;
  try {
    resize.call(actions, sessionId, split.id, sizes);
  } catch {
  }
}
function focusTree(store, sessionId, treePaneId) {
  const actions = store.actions;
  const focusTab = actions == null ? void 0 : actions.focusTab;
  if (actions === void 0 || actions === null || typeof focusTab !== "function") return;
  const layout = readLayout(store, sessionId);
  if (layout === void 0) return;
  const treePane = dockPaneOf(layout, treePaneId);
  const treeTabId = filesTabIn(treePane, layout);
  if (treeTabId === void 0) return;
  if ((treePane == null ? void 0 : treePane.activeTabId) === treeTabId) return;
  try {
    focusTab.call(actions, sessionId, treeTabId);
  } catch {
  }
}

// src/client.ts
var name = "dsh-rightbar-split-open";
var inject = ["uiSession", "slots", "sidebarRight"];
function getService(ctx, serviceName) {
  if (ctx.get === void 0 || ctx.get === null) return void 0;
  const value = ctx.get(serviceName);
  return value === null || value === void 0 ? void 0 : value;
}
function apply(ctx) {
  const uiSession = getService(ctx, "uiSession");
  const slots = getService(ctx, "slots");
  const sidebarRight = getService(ctx, "sidebarRight");
  if (uiSession === void 0 || slots === void 0 || sidebarRight === void 0) {
    console.warn("[dsh-rightbar-split-open] services unavailable; split-open disabled");
    return;
  }
  const handle = installSessionWiring({ uiSession, slots }, createSplitHandler(sidebarRight));
  if (handle === void 0) {
    console.warn("[dsh-rightbar-split-open] uiSession.resolve unavailable; split-open disabled");
    return;
  }
  if (typeof ctx.effect === "function") ctx.effect(() => () => {
    handle.dispose();
  });
}
return module.exports; } });
