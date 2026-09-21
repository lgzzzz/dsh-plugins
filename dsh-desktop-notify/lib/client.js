window.__ModuleLoader__.load({ id: "dsh-desktop-notify", factory: (require) => {
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

// src/notify-action.ts
var import_react = require("react");
var STYLE_TAG_ID = "dsh-desktop-notify/action.css";
var CSS = [
  ".dsh-desktop-notify-action{position:relative;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border:0;border-radius:9999px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;flex:none}",
  ".dsh-desktop-notify-action:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}",
  ".dsh-desktop-notify-action[data-state=off]{color:var(--dsw-alias-label-dimmed)}",
  ".dsh-desktop-notify-action:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,currentColor);outline-offset:1px}",
  ".dsh-desktop-notify-dot{position:absolute;top:4px;inset-inline-end:4px;width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-brand-primary,currentColor)}"
].join("");
function ensureActionStyles(doc) {
  if (doc.querySelector(`style[data-plugin-css="${STYLE_TAG_ID}"]`) !== null) return;
  const tag = doc.createElement("style");
  tag.dataset.plugin = "dsh-desktop-notify";
  tag.dataset.pluginCss = STYLE_TAG_ID;
  tag.textContent = CSS;
  doc.head.appendChild(tag);
}
function hintOf(state) {
  if (state.permission === "unsupported") return "\u672C\u6D4F\u89C8\u5668\u4E0D\u652F\u6301\u684C\u9762\u901A\u77E5";
  if (state.permission === "denied") {
    return "\u684C\u9762\u901A\u77E5\u5DF2\u88AB\u6D4F\u89C8\u5668\u62D2\u7EDD:\u8BF7\u5728 Chrome\u300C\u8BBE\u7F6E \u2192 \u9690\u79C1\u4E0E\u5B89\u5168 \u2192 \u7F51\u7AD9\u8BBE\u7F6E \u2192 \u901A\u77E5\u300D\u91CC\u5141\u8BB8 127.0.0.1:3080,\u518D\u56DE\u5230\u672C\u9875";
  }
  if (state.permission !== "granted") return "\u5F00\u542F\u684C\u9762\u901A\u77E5:\u56DE\u5408\u7ED3\u675F\u6216\u9700\u8981\u4F60\u5904\u7406\u65F6\u5F39\u7CFB\u7EDF\u901A\u77E5";
  return state.enabled ? "\u684C\u9762\u901A\u77E5\u5DF2\u5F00\u542F,\u70B9\u51FB\u5173\u95ED" : "\u684C\u9762\u901A\u77E5\u5DF2\u5173\u95ED,\u70B9\u51FB\u5F00\u542F";
}
function bellIcon() {
  return (0, import_react.createElement)(
    "svg",
    {
      width: 14,
      height: 14,
      viewBox: "0 0 16 16",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.3,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      "aria-hidden": "true"
    },
    (0, import_react.createElement)("path", { d: "M8 2.2a3.9 3.9 0 0 0-3.9 3.9c0 3-1 4.2-1 4.2h9.8s-1-1.2-1-4.2A3.9 3.9 0 0 0 8 2.2Z" }),
    (0, import_react.createElement)("path", { d: "M6.7 12.4a1.5 1.5 0 0 0 2.6 0" })
  );
}
function createNotifyAction(store) {
  return function NotifyAction() {
    const [state, setState] = (0, import_react.useState)(() => store.getSnapshot());
    (0, import_react.useEffect)(
      () => store.subscribe(() => {
        setState(store.getSnapshot());
      }),
      []
    );
    if (state.permission === "unsupported") return null;
    const hint = hintOf(state);
    const on = state.permission === "granted" && state.enabled;
    const off = state.permission === "denied" || state.permission === "granted" && !state.enabled;
    return (0, import_react.createElement)(
      "button",
      {
        type: "button",
        className: "dsh-desktop-notify-action",
        "data-state": on ? "on" : off ? "off" : "pending",
        title: hint,
        "aria-label": hint,
        onClick: () => {
          void store.activate();
        }
      },
      bellIcon(),
      state.permission === "default" ? (0, import_react.createElement)("span", { className: "dsh-desktop-notify-dot" }) : null
    );
  };
}

// src/notify-delivery.ts
function createBrowserDelivery(win, doc) {
  const ctor = win.Notification;
  return {
    isPageActive: () => {
      if (typeof doc.hasFocus === "function" && !doc.hasFocus()) return false;
      return doc.visibilityState === "visible";
    },
    deliver(plan) {
      if (ctor === null || ctor === void 0) return;
      try {
        const notification = new ctor(plan.title, {
          body: plan.body,
          tag: plan.tag,
          // 同一个 tag 的后续通知仍要重新提醒,否则第二条会被静默替换掉
          renotify: true,
          silent: false
        });
        notification.onclick = () => {
          var _a;
          try {
            win.focus();
          } catch {
          }
          (_a = notification.close) == null ? void 0 : _a.call(notification);
        };
      } catch (error) {
        console.warn("[dsh-desktop-notify] notify failed:", error);
      }
    }
  };
}

// src/notify-store.ts
var ENABLED_STORAGE_KEY = "dsh.desktop-notify.enabled";
function normalize(raw) {
  if (raw === "granted") return "granted";
  if (raw === "denied") return "denied";
  return "default";
}
function createNotifyStore(env) {
  const listeners = /* @__PURE__ */ new Set();
  const readPermission = () => env.supported ? normalize(env.permission()) : "unsupported";
  let snapshot = {
    permission: readPermission(),
    // 默认开启:用户点按钮授权后立即生效;主动关掉才写 0
    enabled: env.readEnabled() !== false
  };
  const publish = (next) => {
    if (next.permission === snapshot.permission && next.enabled === snapshot.enabled) return;
    snapshot = next;
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch (error) {
        console.warn("[dsh-desktop-notify] store listener failed:", error);
      }
    }
  };
  const setPermission = (permission) => {
    publish({ permission, enabled: snapshot.enabled });
  };
  const setEnabled = (enabled) => {
    env.writeEnabled(enabled);
    publish({ permission: snapshot.permission, enabled });
  };
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    isActive: () => snapshot.permission === "granted" && snapshot.enabled,
    refresh: () => {
      setPermission(readPermission());
    },
    async activate() {
      if (!env.supported) return;
      const current = readPermission();
      if (current === "denied") {
        setPermission(current);
        return;
      }
      if (current !== "granted") {
        let result = current;
        try {
          result = normalize(await env.requestPermission());
        } catch (error) {
          console.warn("[dsh-desktop-notify] requestPermission failed:", error);
          result = readPermission();
        }
        setPermission(result);
        if (result === "granted") setEnabled(true);
        return;
      }
      setEnabled(!snapshot.enabled);
    }
  };
}

// src/notify-env.ts
function notificationCtor(win) {
  const ctor = win.Notification;
  return ctor === null || ctor === void 0 ? void 0 : ctor;
}
function createBrowserNotifyEnv(win) {
  const ctor = notificationCtor(win);
  return {
    supported: ctor !== void 0,
    permission: () => {
      const value = ctor == null ? void 0 : ctor.permission;
      return value === null || value === void 0 ? "default" : value;
    },
    async requestPermission() {
      const request = ctor == null ? void 0 : ctor.requestPermission;
      if (ctor === void 0 || request === void 0) return "default";
      if (request.length >= 1) {
        return await new Promise((resolve) => {
          try {
            request.call(ctor, (value) => {
              resolve(value);
            });
          } catch {
            resolve("default");
          }
        });
      }
      const result = request.call(ctor);
      if (result !== void 0 && typeof result.then === "function") return await result;
      return "default";
    },
    readEnabled: () => {
      const raw = readStorage(win, ENABLED_STORAGE_KEY);
      return raw === null ? void 0 : raw !== "0";
    },
    writeEnabled: (enabled) => {
      try {
        win.localStorage.setItem(ENABLED_STORAGE_KEY, enabled ? "1" : "0");
      } catch {
      }
    }
  };
}
function readStorage(win, key) {
  try {
    return win.localStorage.getItem(key);
  } catch {
    return null;
  }
}

// src/notify-policy.ts
var BODY_LIMIT = 96;
var TITLES = {
  "turn-complete": "DSH \xB7 \u56DE\u5408\u5B8C\u6210",
  approval: "DSH \xB7 \u9700\u8981\u4F60\u5BA1\u6279",
  question: "DSH \xB7 \u9700\u8981\u4F60\u56DE\u7B54",
  "plan-review": "DSH \xB7 \u8BA1\u5212\u5F85\u786E\u8BA4"
};
function clip(text, limit = BODY_LIMIT) {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= limit ? flat : `${flat.slice(0, limit - 1)}\u2026`;
}
function labelOf(row, sessionId) {
  const display = row == null ? void 0 : row.displayTitle;
  if (display !== void 0 && display !== "") return display;
  const title = row == null ? void 0 : row.title;
  if (title !== void 0 && title !== "") return title;
  return sessionId;
}
function reasonOf(interaction) {
  if (interaction.kind === "approval") return "approval";
  if (interaction.kind === "plan-review") return "plan-review";
  return "question";
}
function detailOf(interaction) {
  var _a, _b, _c;
  if (interaction.kind === "approval") {
    const tool = interaction.toolName;
    const reason = interaction.reason;
    if (tool !== void 0 && tool !== "" && reason !== void 0 && reason !== "") return `${tool} \xB7 ${reason}`;
    if (tool !== void 0 && tool !== "") return tool;
    return "\u6709\u4E00\u6761\u5DE5\u5177\u8C03\u7528\u7B49\u4F60\u51B3\u5B9A";
  }
  const first = (_a = interaction.questions) == null ? void 0 : _a[0];
  const question = (_c = (_b = first == null ? void 0 : first.question) != null ? _b : first == null ? void 0 : first.header) != null ? _c : first == null ? void 0 : first.detail;
  if (question !== void 0 && question !== "") return question;
  return interaction.kind === "plan-review" ? "\u8BA1\u5212\u5DF2\u5C31\u7EEA,\u7B49\u4F60\u786E\u8BA4" : "\u6709\u4E00\u4E2A\u63D0\u95EE\u7B49\u4F60\u56DE\u7B54";
}
function createNotifyPolicy() {
  let baseline;
  return {
    observe(snapshot) {
      var _a;
      const next = /* @__PURE__ */ new Map();
      for (const [sessionId, status] of snapshot.statuses) next.set(sessionId, status);
      const plans = [];
      if (baseline !== void 0) {
        for (const [sessionId, status] of next) {
          const row = snapshot.rows[sessionId];
          if (row === void 0 || row.origin === "subagent") continue;
          const previous = baseline.get(sessionId);
          const label = labelOf(row, sessionId);
          if ((previous == null ? void 0 : previous.running) === true && status.running === false) {
            plans.push({
              sessionId,
              reason: "turn-complete",
              title: TITLES["turn-complete"],
              body: clip(label),
              tag: `dsh-notify:${sessionId}:turn-complete`
            });
          }
          const interaction = status.pendingInteraction;
          if (interaction !== void 0 && interaction.key !== ((_a = previous == null ? void 0 : previous.pendingInteraction) == null ? void 0 : _a.key)) {
            const reason = reasonOf(interaction);
            const detail = detailOf(interaction);
            plans.push({
              sessionId,
              reason,
              title: TITLES[reason],
              body: clip(detail === "" ? label : `${label} \xB7 ${detail}`),
              tag: `dsh-notify:${sessionId}:${reason}`
            });
          }
        }
      }
      baseline = next;
      return plans;
    }
  };
}

// src/notify-runtime.ts
function readPolicySnapshot(services) {
  var _a, _b, _c, _d, _e, _f, _g;
  const statuses = (_c = (_b = (_a = services.uiSession) == null ? void 0 : _a.sessionStatus) == null ? void 0 : _b.getSnapshot) == null ? void 0 : _c.call(_b);
  const rows = (_g = (_f = (_e = (_d = services.sessions) == null ? void 0 : _d.list) == null ? void 0 : _e.getSnapshot) == null ? void 0 : _f.call(_e)) == null ? void 0 : _g.byId;
  return {
    statuses: statuses === null || statuses === void 0 ? /* @__PURE__ */ new Map() : statuses,
    rows: rows === null || rows === void 0 ? {} : rows
  };
}
function startNotifyRuntime(deps) {
  var _a;
  const source = (_a = deps.services.uiSession) == null ? void 0 : _a.sessionStatus;
  if (source === null || source === void 0) return () => {
  };
  const getSnapshot = source.getSnapshot;
  const subscribe = source.subscribe;
  if (getSnapshot === void 0 || subscribe === void 0) return () => {
  };
  const policy = createNotifyPolicy();
  const onStatusChange = () => {
    const plans = policy.observe(readPolicySnapshot(deps.services));
    if (plans.length === 0) return;
    if (!deps.store.isActive()) return;
    if (deps.isPageActive()) return;
    for (const plan of plans) deps.deliver(plan);
  };
  const dispose = subscribe.call(source, onStatusChange);
  return typeof dispose === "function" ? dispose : () => {
  };
}

// src/client.ts
var name = "dsh-desktop-notify";
var inject = ["sessions", "uiSession", "slots"];
var ACTION_SLOT = "conversation.session.header.actions";
var ACTION_ID = "desktop-notify";
var ACTION_ORDER = 120;
function getService(ctx, serviceName) {
  if (ctx.get === void 0 || ctx.get === null) return void 0;
  const value = ctx.get(serviceName);
  return value === null || value === void 0 ? void 0 : value;
}
function apply(ctx) {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const services = {
    sessions: getService(ctx, "sessions"),
    uiSession: getService(ctx, "uiSession"),
    slots: getService(ctx, "slots")
  };
  const store = createNotifyStore(createBrowserNotifyEnv(window));
  const delivery = createBrowserDelivery(window, document);
  const disposeRuntime = startNotifyRuntime({
    services,
    store,
    isPageActive: () => delivery.isPageActive(),
    deliver: (plan) => {
      delivery.deliver(plan);
    }
  });
  const onFocus = () => {
    store.refresh();
  };
  window.addEventListener("focus", onFocus);
  ensureActionStyles(document);
  const slots = services.slots;
  if ((slots == null ? void 0 : slots.inject) !== void 0 && slots.register !== void 0) {
    slots.inject(
      ACTION_SLOT,
      () => {
        var _a;
        return (_a = slots.register) == null ? void 0 : _a.call(slots, { name: ACTION_SLOT, id: ACTION_ID, order: ACTION_ORDER }, createNotifyAction(store));
      }
    );
  }
  if (typeof ctx.effect === "function") {
    ctx.effect(() => () => {
      window.removeEventListener("focus", onFocus);
      disposeRuntime();
    });
  }
}
return module.exports; } });
