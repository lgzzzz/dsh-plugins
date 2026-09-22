window.__ModuleLoader__.load({ id: "dsh-rightbar-diff-split", factory: (require) => {
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

// src/resolve.ts
var ROOT_SLOT = "root";
var RIGHTBAR_SLOT = "rightbar.session";
var PANE_TAB_SLOT = "sidebar.right.pane.tab";
var REVIEW_ENTRY_KEY = "@deepseek-ai/dsh-client-ui-deliverables";
var CHANGES_REVIEW_KIND = "changes-review";
function currentSessionId(services) {
  var _a, _b, _c;
  let snapshot;
  try {
    snapshot = (_c = (_b = (_a = services.uiSession) == null ? void 0 : _a.current) == null ? void 0 : _b.getSnapshot) == null ? void 0 : _c.call(_b);
  } catch {
    return void 0;
  }
  if (typeof snapshot !== "object" || snapshot === null) return void 0;
  const key = snapshot.key;
  return typeof key === "string" && key !== "" ? key : void 0;
}
function sessionScopeBinding(services, sessionId) {
  var _a;
  const uiSession = services.uiSession;
  const sessions = services.sessions;
  if (uiSession === null || uiSession === void 0) return void 0;
  if (sessions === null || sessions === void 0) return void 0;
  const bindingSource = uiSession.bindingSource;
  if (typeof bindingSource !== "function") return void 0;
  const owner = (_a = sessions.binding) == null ? void 0 : _a.call(sessions, sessionId);
  if (owner === null || owner === void 0) return void 0;
  let source;
  try {
    source = bindingSource.call(uiSession, { sessionId, binding: owner });
  } catch {
    return void 0;
  }
  const getSnapshot = source == null ? void 0 : source.getSnapshot;
  if (typeof getSnapshot !== "function") return void 0;
  let binding;
  try {
    binding = getSnapshot.call(source);
  } catch {
    return void 0;
  }
  if (typeof binding !== "object" || binding === null) return void 0;
  const key = binding.key;
  return typeof key === "string" && key !== "" ? binding : void 0;
}
function resolveLayoutStore(services) {
  const slots = usableSlots(services);
  if (slots === void 0) return void 0;
  for (const entry of entriesOf(slots, ROOT_SLOT)) {
    const handle = entry == null ? void 0 : entry.store;
    if (handle === null || handle === void 0) continue;
    const instance = resolveInstance(slots, handle, void 0);
    if (instance === void 0) continue;
    const snapshot = snapshotOf(instance);
    if (!isLayoutSnapshot(snapshot)) continue;
    return { instance, snapshot };
  }
  return void 0;
}
function resolveRightbarStore(services, sessionId) {
  const slots = usableSlots(services);
  if (slots === void 0) return void 0;
  const binding = sessionScopeBinding(services, sessionId);
  if (binding === void 0) return void 0;
  for (const entry of entriesOf(slots, RIGHTBAR_SLOT)) {
    const handle = entry == null ? void 0 : entry.store;
    if (handle === null || handle === void 0) continue;
    const instance = resolveInstance(slots, handle, binding);
    if (instance === void 0) continue;
    const snapshot = snapshotOf(instance);
    if (!isRightbarSnapshot(snapshot)) continue;
    return { instance, snapshot };
  }
  return void 0;
}
function resolveReviewStore(services, sessionId) {
  var _a;
  const slots = usableSlots(services);
  if (slots === void 0) return void 0;
  const binding = sessionScopeBinding(services, sessionId);
  if (binding === void 0) return void 0;
  for (const entry of entriesOf(slots, PANE_TAB_SLOT)) {
    if (entry === void 0 || entry === null) continue;
    if (((_a = entry.options) == null ? void 0 : _a.key) !== REVIEW_ENTRY_KEY) continue;
    const handle = entry.store;
    if (handle === null || handle === void 0) continue;
    const instance = resolveInstance(slots, handle, binding);
    if (instance === void 0) continue;
    const snapshot = snapshotOf(instance);
    if (!isReviewSnapshot(snapshot)) continue;
    const actions = instance.actions;
    if (typeof actions !== "object" || actions === null) continue;
    return { instance, snapshot, actions };
  }
  return void 0;
}
function layoutOf(state, sessionId) {
  var _a;
  const surface = (_a = state.bySession) == null ? void 0 : _a[sessionId];
  if (typeof surface !== "object" || surface === null) return void 0;
  const layout = surface.layout;
  if (typeof layout !== "object" || layout === null) return void 0;
  return layout;
}
function activeTabOf(layout) {
  var _a, _b;
  const paneId = layout.activePaneId;
  if (typeof paneId !== "string" || paneId === "") return void 0;
  const node = (_a = layout.nodes) == null ? void 0 : _a[paneId];
  if (typeof node !== "object" || node === null || node.kind !== "pane") return void 0;
  const tabId = node.activeTabId;
  if (typeof tabId !== "string" || tabId === "") return void 0;
  const record = (_b = layout.tabs) == null ? void 0 : _b[tabId];
  if (typeof record !== "object" || record === null) return void 0;
  return { id: tabId, kind: typeof record.kind === "string" ? record.kind : void 0 };
}
function splitOf(state, tabId) {
  const bucket = bucketOf(state, tabId);
  if (bucket === void 0) return void 0;
  const split = bucket.split;
  return typeof split === "boolean" ? split : void 0;
}
function bucketOf(state, tabId) {
  var _a;
  const bucket = (_a = state.byTab) == null ? void 0 : _a[tabId];
  if (typeof bucket !== "object" || bucket === null || Array.isArray(bucket)) return void 0;
  return bucket;
}
function usableSlots(services) {
  const slots = services.slots;
  if (slots === null || slots === void 0) return void 0;
  if (typeof slots.entries !== "function" || typeof slots.resolveStore !== "function") return void 0;
  return slots;
}
function entriesOf(slots, key) {
  var _a;
  try {
    const entries = (_a = slots.entries) == null ? void 0 : _a.call(slots, key);
    return Array.isArray(entries) ? entries : [];
  } catch {
    return [];
  }
}
function resolveInstance(slots, handle, binding) {
  var _a;
  try {
    const instance = (_a = slots.resolveStore) == null ? void 0 : _a.call(slots, handle, binding);
    if (typeof instance !== "object" || instance === null) return void 0;
    if (typeof instance.getSnapshot !== "function") return void 0;
    return instance;
  } catch {
    return void 0;
  }
}
function snapshotOf(instance) {
  var _a;
  try {
    return (_a = instance.getSnapshot) == null ? void 0 : _a.call(instance);
  } catch {
    return void 0;
  }
}
function isLayoutSnapshot(snapshot) {
  if (!isPlainObject(snapshot)) return false;
  const info = snapshot.layoutInfo;
  if (!isPlainObject(info)) return false;
  return typeof info.rightbarFullscreen === "boolean";
}
function isRightbarSnapshot(snapshot) {
  if (!isPlainObject(snapshot)) return false;
  return isPlainObject(snapshot.bySession);
}
function isReviewSnapshot(snapshot) {
  if (!isPlainObject(snapshot)) return false;
  return isPlainObject(snapshot.byTab);
}
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// src/diff-split.ts
function createDiffSplitSync(services, options = {}) {
  let fullscreen;
  let writes = 0;
  let lastOutcome = "unavailable";
  function record(outcome) {
    lastOutcome = outcome;
    return outcome;
  }
  function readFullscreen() {
    var _a;
    const resolved = resolveLayoutStore(services);
    const value = (_a = resolved == null ? void 0 : resolved.snapshot.layoutInfo) == null ? void 0 : _a.rightbarFullscreen;
    return typeof value === "boolean" ? value : void 0;
  }
  function currentActiveTab(sessionId) {
    const rightbar = resolveRightbarStore(services, sessionId);
    if (rightbar === void 0) return void 0;
    const layout = layoutOf(rightbar.snapshot, sessionId);
    if (layout === void 0) return void 0;
    return activeTabOf(layout);
  }
  function drive() {
    var _a, _b;
    const sessionId = currentSessionId(services);
    if (sessionId === void 0) return record("unavailable");
    const desired = readFullscreen();
    if (desired === void 0) return record("unavailable");
    fullscreen = desired;
    const active = currentActiveTab(sessionId);
    if (active === void 0 || active.kind !== CHANGES_REVIEW_KIND) return record("no-target");
    const review = resolveReviewStore(services, sessionId);
    if (review === void 0) return record("unavailable");
    const toggle = review.actions.toggledSplit;
    if (typeof toggle !== "function") return record("unavailable");
    if (bucketOf(review.snapshot, active.id) === void 0) return record("no-bucket");
    const current = splitOf(review.snapshot, active.id);
    if (current === void 0) return record("unknown");
    if (current === desired) return record("aligned");
    try {
      ;
      toggle.call(review.actions, active.id);
    } catch (error) {
      (_a = options.log) == null ? void 0 : _a.call(options, "write-failed", { tabId: active.id, error: String(error) });
      return record("write-failed");
    }
    writes += 1;
    (_b = options.log) == null ? void 0 : _b.call(options, "write", { tabId: active.id, split: desired });
    return record("written");
  }
  return {
    drive,
    state() {
      return { fullscreen, writes, lastOutcome };
    }
  };
}

// src/hover-preview.ts
var PREVIEW_ATTRIBUTE = "[data-changes-hover-preview]";
var CSS = `/* dsh-rightbar-diff-split: suppress the changed-files card's hover diff popup */
${PREVIEW_ATTRIBUTE} {
  display: none;
}
`;
function installHoverPreviewStyles(host, pluginId) {
  const documentLike = asStyleHost(host);
  if (documentLike === void 0) return void 0;
  const tag = documentLike.createElement("style");
  tag.dataset.plugin = pluginId;
  tag.textContent = CSS;
  documentLike.head.appendChild(tag);
  return () => {
    tag.remove();
  };
}
function asStyleHost(value) {
  if (typeof value !== "object" || value === null) return void 0;
  const candidate = value;
  if (typeof candidate.createElement !== "function") return void 0;
  if (typeof candidate.head !== "object" || candidate.head === null) return void 0;
  if (typeof candidate.head.appendChild !== "function") return void 0;
  return candidate;
}

// src/subscriptions.ts
function createSubscriptionHub(deps) {
  let disposers = [];
  function disposeAll() {
    const pending = disposers;
    disposers = [];
    for (const dispose of pending) {
      try {
        dispose();
      } catch {
      }
    }
  }
  function attach(instance, listener) {
    const subscribe = instance == null ? void 0 : instance.subscribe;
    if (typeof subscribe !== "function") return;
    let dispose;
    try {
      dispose = subscribe.call(instance, listener);
    } catch {
      return;
    }
    if (typeof dispose === "function") disposers.push(dispose);
  }
  return {
    rebuild() {
      var _a, _b, _c, _d;
      disposeAll();
      const services = deps.services;
      attach((_a = resolveLayoutStore(services)) == null ? void 0 : _a.instance, deps.onNotify);
      const sessionId = currentSessionId(services);
      if (sessionId !== void 0) {
        attach((_b = resolveRightbarStore(services, sessionId)) == null ? void 0 : _b.instance, deps.onNotify);
        attach((_c = resolveReviewStore(services, sessionId)) == null ? void 0 : _c.instance, deps.onNotify);
      }
      attach((_d = services.uiSession) == null ? void 0 : _d.current, deps.onRebuild);
      const slots = services.slots;
      const subscribeSlots = slots == null ? void 0 : slots.subscribe;
      if (slots !== void 0 && slots !== null && typeof subscribeSlots === "function") {
        for (const key of [ROOT_SLOT, RIGHTBAR_SLOT, PANE_TAB_SLOT]) {
          try {
            const dispose = subscribeSlots.call(slots, key, deps.onRebuild);
            if (typeof dispose === "function") disposers.push(dispose);
          } catch {
          }
        }
      }
    },
    dispose() {
      disposeAll();
    }
  };
}

// src/client.ts
var name = "dsh-rightbar-diff-split";
var inject = ["slots", "sessions", "uiSession"];
function getService(ctx, serviceName) {
  if (ctx.get === void 0 || ctx.get === null) return void 0;
  let value;
  try {
    value = ctx.get(serviceName);
  } catch {
    return void 0;
  }
  return value === null || value === void 0 ? void 0 : value;
}
function apply(ctx) {
  const uninstallStyles = typeof document === "undefined" ? void 0 : installHoverPreviewStyles(document, name);
  const services = {
    slots: getService(ctx, "slots"),
    sessions: getService(ctx, "sessions"),
    uiSession: getService(ctx, "uiSession")
  };
  const core = createDiffSplitSync(services);
  let hub;
  hub = createSubscriptionHub({
    services,
    // A/B/E:三份 store 的任意一次提交 → 就地回正(同一次同步通知内完成)
    onNotify: () => {
      core.drive();
    },
    // C/D:订阅拓扑变了 → 先重建订阅(拿新实例、先全量退订),再回正
    onRebuild: () => {
      hub == null ? void 0 : hub.rebuild();
      core.drive();
    }
  });
  hub.rebuild();
  core.drive();
  if (typeof ctx.effect === "function") {
    ctx.effect(() => () => {
      hub == null ? void 0 : hub.dispose();
      uninstallStyles == null ? void 0 : uninstallStyles();
    });
  }
}
return module.exports; } });
