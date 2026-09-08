window.__ModuleLoader__.load({ id: "dsh-kbd-hotkeys", factory: (require) => {
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

// src/actions.ts
function detectStateA() {
  return document.querySelector("[data-approval-key], [data-question-key], [data-plan-review-key]") !== null;
}
function isEditableTarget(target) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}
function focusComposer() {
  const input = document.querySelector("[data-composer-input]");
  if (input === null) return false;
  input.focus({ preventScroll: true });
  return true;
}
function openModelSelector() {
  const card = document.querySelector("[data-composer-card]");
  const trigger = (card != null ? card : document).querySelector('button[aria-haspopup="menu"]');
  if (trigger === null) return false;
  trigger.click();
  return true;
}
function openSettings() {
  const triggers = document.querySelectorAll('button[aria-haspopup="dialog"]');
  if (triggers.length === 0) return false;
  const trigger = triggers[triggers.length - 1];
  if (trigger.disabled) return false;
  trigger.click();
  return true;
}
function toggleSidebar(services) {
  const layout = services.layout;
  if (layout === null || layout === void 0 || typeof layout.toggleSidebar !== "function") return false;
  layout.toggleSidebar();
  return true;
}
function switchView(delta) {
  const tablist = findSessionViewTablist();
  if (tablist === null) return false;
  const tabs = [...tablist.querySelectorAll('[role="tab"]')];
  if (tabs.length === 0) return false;
  const current = tabs.findIndex((el) => el.getAttribute("aria-selected") === "true");
  const base = current < 0 ? delta > 0 ? -1 : tabs.length : current;
  const nextIndex = (base + delta + tabs.length) % tabs.length;
  const nextTab = tabs[nextIndex];
  if (nextTab === void 0) return false;
  nextTab.click();
  return true;
}
function findSessionViewTablist() {
  const tablists = document.querySelectorAll('[role="tablist"]');
  for (const tablist of tablists) {
    const tabs = tablist.querySelectorAll('[role="tab"]');
    if (tabs.length === 0) continue;
    let hasControls = false;
    for (const tab of tabs) {
      const controls = tab.getAttribute("aria-controls");
      if (controls !== null && controls !== "") {
        hasControls = true;
        break;
      }
    }
    if (!hasControls) return tablist;
  }
  return null;
}
function openNeighborSession(services, delta) {
  var _a, _b;
  const sessions = services.sessions;
  const snapshot = (_b = (_a = sessions == null ? void 0 : sessions.list) == null ? void 0 : _a.getSnapshot) == null ? void 0 : _b.call(_a);
  if (sessions === null || sessions === void 0 || snapshot === null || snapshot === void 0) return false;
  if (snapshot.ids === void 0 || snapshot.ids.length === 0 || snapshot.byId === void 0 || typeof sessions.open !== "function") {
    return false;
  }
  const axis = visibleSessionsByRecency(snapshot, services);
  if (axis.length === 0) return false;
  const current = snapshot.current;
  const anchor = current === void 0 ? -1 : axis.findIndex((row) => row.id === current);
  if (anchor < 0) return false;
  const active = activeSessionIds(snapshot, services);
  for (let i = anchor + delta; i >= 0 && i < axis.length; i += delta) {
    const row = axis[i];
    if (row === void 0) continue;
    if (active.has(row.id)) {
      sessions.open(row.id);
      return true;
    }
  }
  return false;
}
function activeSessionIds(snapshot, services) {
  var _a, _b, _c;
  const pending = (_a = services.uiSession) == null ? void 0 : _a.pendingSnapshot;
  const active = /* @__PURE__ */ new Set();
  for (const id of (_b = snapshot.ids) != null ? _b : []) {
    const summary = (_c = snapshot.byId) == null ? void 0 : _c[id];
    if (summary === void 0) continue;
    if (summary.running === true || summary.completed === true || pending !== void 0 && pending.has(id)) {
      active.add(id);
    }
  }
  return active;
}
function visibleSessionsByRecency(snapshot, services) {
  var _a, _b, _c, _d, _e, _f, _g;
  const archived = new Set((_e = (_d = (_c = (_b = (_a = services.workspaces) == null ? void 0 : _a.list) == null ? void 0 : _b.getSnapshot) == null ? void 0 : _c.call(_b)) == null ? void 0 : _d.archivedSessionIds) != null ? _e : []);
  const rows = [];
  for (const id of (_f = snapshot.ids) != null ? _f : []) {
    const summary = (_g = snapshot.byId) == null ? void 0 : _g[id];
    if (summary === void 0 || !sessionVisible(summary, snapshot.current, archived)) continue;
    rows.push(summary);
  }
  rows.sort(byRecency);
  return rows;
}
function byRecency(a, b) {
  var _a, _b;
  const aUpdated = (_a = a.updatedAt) != null ? _a : Number.NEGATIVE_INFINITY;
  const bUpdated = (_b = b.updatedAt) != null ? _b : Number.NEGATIVE_INFINITY;
  if (bUpdated !== aUpdated) return bUpdated - aUpdated;
  return a.id < b.id ? -1 : 1;
}
function sessionVisible(summary, current, archived) {
  return summary.origin !== "subagent" && !archived.has(summary.id) && (!summary.blank || summary.id === current);
}
function pendingInteraction(services) {
  var _a, _b, _c;
  const uiSession = services.uiSession;
  const snapshot = uiSession === null || uiSession === void 0 ? void 0 : uiSession.pendingSnapshot;
  if (snapshot === void 0 || snapshot.size === 0) return void 0;
  const current = (_c = (_b = (_a = services.sessions) == null ? void 0 : _a.list) == null ? void 0 : _b.getSnapshot) == null ? void 0 : _c.call(_b).current;
  if (current !== void 0) {
    const scoped = snapshot.get(current);
    if (scoped !== void 0) return scoped;
  }
  const first = snapshot.values().next();
  return first.done === true ? void 0 : first.value;
}
function answerApproval(services, outcome) {
  const pending = pendingInteraction(services);
  if (pending !== void 0 && pending.kind === "approval" && typeof pending.answer === "function") {
    try {
      void Promise.resolve(pending.answer(outcome)).catch(() => {
      });
      return true;
    } catch {
    }
  }
  const cards = document.querySelectorAll("[data-approval-key]");
  if (cards.length === 0) return false;
  const card = cards[cards.length - 1];
  const buttons = [...card.querySelectorAll("button")].filter((b) => !b.disabled);
  if (buttons.length < 2) return false;
  const button = outcome === "allowed-once" ? buttons[buttons.length - 1] : buttons[0];
  button.click();
  return true;
}
function pickQuestionOption(n) {
  const question = document.querySelector("[data-question-key]");
  if (question !== null) {
    const options = question.querySelectorAll(
      '[data-question-scroll] button[role="radio"], [data-question-scroll] button[role="checkbox"]'
    );
    const option = options[n - 1];
    if (option !== void 0 && !option.disabled) {
      option.click();
      return true;
    }
    return false;
  }
  const plan = document.querySelector("[data-plan-review-key]");
  if (plan !== null) {
    const buttons = planButtons(plan);
    const button = buttons[n - 1];
    if (button !== void 0 && !button.disabled) {
      button.click();
      return true;
    }
  }
  return false;
}
function submitQuestion() {
  const question = document.querySelector("[data-question-key]");
  if (question !== null) {
    const buttons = footerButtons(question, "[data-question-scroll]");
    const submit = buttons[buttons.length - 1];
    if (submit !== void 0 && !submit.disabled) {
      submit.click();
      return true;
    }
    return false;
  }
  const plan = document.querySelector("[data-plan-review-key]");
  if (plan !== null) {
    const approve = planButtons(plan)[0];
    if (approve !== void 0 && !approve.disabled) {
      approve.click();
      return true;
    }
  }
  return false;
}
function footerButtons(card, scrollSelector) {
  return [...card.querySelectorAll("button")].filter(
    (b) => b.closest(scrollSelector) === null
  );
}
function planButtons(card) {
  return footerButtons(card, "[data-plan-review-scroll]");
}

// src/config.ts
var ACTIONS = [
  // P0 回合级高频(审批动作放行任意态:服务级 pendingSnapshot 判定,
  // 不受 React 渲染卡片时序影响;问答卡片依赖 DOM,仅态 A 固定分发)
  { id: "approval.allow", label: "\u5BA1\u6279:\u5141\u8BB8\u4E00\u6B21", group: "\u5BA1\u6279(P0)", states: ["A", "B", "C"] },
  { id: "approval.reject", label: "\u5BA1\u6279:\u62D2\u7EDD", group: "\u5BA1\u6279(P0)", states: ["A", "B", "C"] },
  { id: "question.option", label: "\u95EE\u9898:\u6309 1\u20139 \u9009\u62E9\u9009\u9879", group: "\u95EE\u7B54\u5361\u7247(P0)", states: ["A"] },
  { id: "question.submit", label: "\u95EE\u9898:Enter \u786E\u8BA4 / \u63D0\u4EA4", group: "\u95EE\u7B54\u5361\u7247(P0)", states: ["A"] },
  // P1 会话级
  { id: "sidebar.toggle", label: "\u5F00\u5173\u4FA7\u680F", group: "\u4F1A\u8BDD(P1)", states: ["C"] },
  { id: "session.prev", label: "\u4E0A\u4E00\u4E2A\u6D3B\u8DC3\u4F1A\u8BDD", group: "\u4F1A\u8BDD(P1)", states: ["A", "B", "C"] },
  { id: "session.next", label: "\u4E0B\u4E00\u4E2A\u6D3B\u8DC3\u4F1A\u8BDD", group: "\u4F1A\u8BDD(P1)", states: ["A", "B", "C"] },
  { id: "view.prev", label: "\u4E0A\u4E00\u4E2A\u4F1A\u8BDD\u89C6\u56FE\u6807\u7B7E", group: "\u4F1A\u8BDD\u89C6\u56FE(P1)", states: ["A", "B", "C"] },
  { id: "view.next", label: "\u4E0B\u4E00\u4E2A\u4F1A\u8BDD\u89C6\u56FE\u6807\u7B7E", group: "\u4F1A\u8BDD\u89C6\u56FE(P1)", states: ["A", "B", "C"] },
  { id: "settings.open", label: "\u6253\u5F00\u8BBE\u7F6E", group: "\u9762\u677F(P1)", states: ["A", "B", "C"] },
  { id: "model.open", label: "\u6253\u5F00\u6A21\u578B\u9009\u62E9\u5668", group: "\u9762\u677F(P1)", states: ["B", "C"] },
  { id: "composer.focus", label: "\u805A\u7126\u8F93\u5165\u6846", group: "\u9762\u677F(P1)", states: ["C"] },
  { id: "help.toggle", label: "\u5FEB\u6377\u952E\u901F\u67E5\u8868", group: "\u9762\u677F(P1)", states: ["A", "B", "C"] }
];
var ACTION_BY_ID = new Map(ACTIONS.map((a) => [a.id, a]));
var DEFAULT_BINDINGS = {
  "approval.allow": "mod+alt+enter",
  "approval.reject": "mod+alt+backspace",
  "sidebar.toggle": "mod+b",
  "session.prev": "mod+alt+arrowup",
  "session.next": "mod+alt+arrowdown",
  "view.prev": "mod+alt+arrowleft",
  "view.next": "mod+alt+arrowright",
  // settings.open 不提供默认键位:原 Ctrl/Cmd+. 已移除;
  // 需要时经 localStorage["dsh-kbd-hotkeys:v1"].bindings 自绑定(动作 id: settings.open)。
  // model.open 不提供默认键位:原 Ctrl/Cmd+Alt+M 已移除;
  // 需要时经 localStorage["dsh-kbd-hotkeys:v1"].bindings 自绑定(动作 id: model.open)。
  // composer.focus 不提供默认键位:原 Ctrl/Cmd+Alt+E 已移除;
  // 需要时经 localStorage["dsh-kbd-hotkeys:v1"].bindings 自绑定(动作 id: composer.focus)。
  "help.toggle": "mod+/"
};
var HIDDEN_FROM_HELP_WHEN_UNBOUND = /* @__PURE__ */ new Set([
  "settings.open",
  "model.open",
  "composer.focus"
]);
function comboActionMap(bindings) {
  const map = /* @__PURE__ */ new Map();
  for (const [id, combo] of Object.entries(bindings)) {
    if (combo !== "") map.set(combo, id);
  }
  return map;
}
var STORAGE_KEY = "dsh-kbd-hotkeys:v1";
function loadConfig() {
  const bindings = { ...DEFAULT_BINDINGS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw !== null) {
      const parsed = JSON.parse(raw);
      if (typeof parsed === "object" && parsed !== null) {
        const obj = parsed;
        if (typeof obj.bindings === "object" && obj.bindings !== null) {
          for (const [id, combo] of Object.entries(obj.bindings)) {
            if (typeof combo === "string" && combo !== "") bindings[id] = normalizeComboString(combo);
          }
        }
      }
    }
  } catch {
  }
  return { bindings };
}
function isMac() {
  var _a, _b;
  if (typeof navigator === "undefined") return false;
  const source = `${(_a = navigator.platform) != null ? _a : ""} ${(_b = navigator.userAgent) != null ? _b : ""}`;
  return /mac|iphone|ipad|ipod/i.test(source);
}
var CODE_KEYS = {
  Semicolon: ";",
  Quote: "'",
  Backquote: "`",
  Backslash: "\\",
  BracketLeft: "[",
  BracketRight: "]",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Minus: "-",
  Equal: "=",
  Space: "space",
  Enter: "enter",
  Backspace: "backspace",
  Escape: "escape",
  Tab: "tab",
  ArrowUp: "arrowup",
  ArrowDown: "arrowdown",
  ArrowLeft: "arrowleft",
  ArrowRight: "arrowright",
  PageUp: "pageup",
  PageDown: "pagedown",
  Home: "home",
  End: "end",
  Delete: "delete",
  Insert: "insert"
};
function keyTokenOf(event) {
  const code = event.code;
  if (code !== "") {
    if (Object.prototype.hasOwnProperty.call(CODE_KEYS, code)) return CODE_KEYS[code];
    if (code.startsWith("Key")) return code.slice(3).toLowerCase();
    if (code.startsWith("Digit")) return code.slice(5);
    if (code.startsWith("Numpad") && /^[0-9]$/.test(code.slice(6))) return code.slice(6);
  }
  return event.key.toLowerCase();
}
function comboOf(event) {
  const parts = [];
  if (event.ctrlKey || event.metaKey) parts.push("mod");
  if (event.altKey) parts.push("alt");
  if (event.shiftKey) parts.push("shift");
  parts.push(keyTokenOf(event));
  return parts.join("+");
}
function normalizeComboString(combo) {
  var _a;
  const key = (_a = combo.split("+").pop()) != null ? _a : "";
  const parts = [];
  for (const token of combo.split("+").slice(0, -1)) {
    const t = token.trim().toLowerCase();
    if (t === "mod" || t === "cmd" || t === "meta" || t === "ctrl" || t === "control" || t === "command") parts.push("mod");
    else if (t === "alt" || t === "option") parts.push("alt");
    else if (t === "shift") parts.push("shift");
  }
  parts.push(key.trim().toLowerCase());
  return parts.join("+");
}
function prettyCombo(combo) {
  const mac = isMac();
  return combo.split("+").map((token) => {
    var _a;
    if (token === "mod") return mac ? "\u2318" : "Ctrl";
    if (token === "alt") return mac ? "\u2325" : "Alt";
    if (token === "shift") return mac ? "\u21E7" : "Shift";
    const special = {
      enter: "\u21B5",
      backspace: "\u232B",
      escape: "Esc",
      arrowup: "\u2191",
      arrowdown: "\u2193",
      arrowleft: "\u2190",
      arrowright: "\u2192",
      pageup: "PageUp",
      pagedown: "PageDown",
      space: "Space"
    };
    return (_a = special[token]) != null ? _a : token.length === 1 ? token.toUpperCase() : token;
  }).join(mac ? "" : "+");
}

// src/overlay.ts
var STYLE_ID = "dsh-kbd-hotkeys/style";
var STYLE = [
  ".dsh-kbd-backdrop{position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.35);display:flex;align-items:flex-start;justify-content:center;padding-top:12vh;font-family:var(--dsw-font-family,system-ui,-apple-system,sans-serif)}",
  ".dsh-kbd-panel{width:min(560px,calc(100vw - 48px));max-height:64vh;background:var(--dsw-specific-menu,#fff);color:var(--dsw-alias-label-primary,#111);box-shadow:var(--dsw-elevation-prominent,0 12px 40px rgba(0,0,0,.25));border-radius:14px;display:flex;flex-direction:column;overflow:hidden}",
  ".dsh-kbd-help{padding:14px 18px;overflow-y:auto}",
  ".dsh-kbd-help h3{margin:14px 0 6px;font-size:12px;font-weight:600;color:var(--dsw-alias-label-tertiary,#999)}",
  ".dsh-kbd-help h3:first-child{margin-top:0}",
  ".dsh-kbd-helpRow{display:flex;align-items:center;gap:12px;padding:5px 0;font-size:13px}",
  ".dsh-kbd-helpRow .dsh-kbd-itemLabel{flex:1}",
  ".dsh-kbd-help kbd{font-family:var(--ds-font-family-code,ui-monospace,monospace);font-size:11px;line-height:18px;padding:1px 6px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12));border-bottom-width:2px;border-radius:6px;background:var(--dsw-alias-bg-base,transparent)}"
].join("\n");
function ensureStyle() {
  if (document.getElementById(STYLE_ID) !== null) return;
  const tag = document.createElement("style");
  tag.id = STYLE_ID;
  tag.textContent = STYLE;
  document.head.appendChild(tag);
}
function createOverlays(deps) {
  ensureStyle();
  let root = null;
  let open = false;
  function isOpen() {
    return open;
  }
  function contains(target) {
    return root !== null && target !== null && root.contains(target);
  }
  function close() {
    if (root !== null) root.remove();
    root = null;
    open = false;
  }
  function mount() {
    close();
    ensureStyle();
    const backdrop = document.createElement("div");
    backdrop.className = "dsh-kbd-backdrop";
    const panel = document.createElement("div");
    panel.className = "dsh-kbd-panel";
    panel.appendChild(renderHelp());
    backdrop.appendChild(panel);
    backdrop.addEventListener("mousedown", (event) => {
      if (event.target === backdrop) close();
    });
    document.body.appendChild(backdrop);
    root = backdrop;
    open = true;
  }
  function renderHelp() {
    const container = document.createElement("div");
    container.className = "dsh-kbd-help";
    const config = deps.getConfig();
    let lastGroup = "";
    for (const action of ACTIONS) {
      if (HIDDEN_FROM_HELP_WHEN_UNBOUND.has(action.id) && (config.bindings[action.id] === void 0 || config.bindings[action.id] === "")) {
        continue;
      }
      if (action.group !== lastGroup) {
        lastGroup = action.group;
        const heading = document.createElement("h3");
        heading.textContent = action.group;
        container.appendChild(heading);
      }
      const row = document.createElement("div");
      row.className = "dsh-kbd-helpRow";
      const label = document.createElement("span");
      label.className = "dsh-kbd-itemLabel";
      label.textContent = action.label;
      const key = document.createElement("kbd");
      const combo = config.bindings[action.id];
      key.textContent = action.id === "question.option" || action.id === "question.submit" ? action.id === "question.option" ? "1\u20139" : "Enter" : combo === void 0 ? "\u672A\u7ED1\u5B9A" : prettyCombo(combo);
      row.appendChild(label);
      row.appendChild(key);
      container.appendChild(row);
    }
    return container;
  }
  function toggleHelp() {
    if (open) close();
    else mount();
  }
  function handleKey(event) {
    if (!open) return false;
    if (event.key === "Escape") {
      close();
      return true;
    }
    const combo = `${event.ctrlKey || event.metaKey ? "mod+" : ""}${event.altKey ? "alt+" : ""}${event.shiftKey ? "shift+" : ""}${event.key.toLowerCase()}`;
    if (combo === "mod+/") {
      close();
      return true;
    }
    return false;
  }
  function destroy() {
    var _a;
    close();
    (_a = document.getElementById(STYLE_ID)) == null ? void 0 : _a.remove();
  }
  return { isOpen, contains, handleKey, toggleHelp, destroy };
}

// src/client.ts
var name = "dsh-kbd-hotkeys";
var inject = ["sessions", "uiSession", "layout", "workspaces"];
function getService(ctx, serviceName) {
  if (ctx.get === void 0 || ctx.get === null) return void 0;
  const value = ctx.get(serviceName);
  return value === null || value === void 0 ? void 0 : value;
}
function runAction(id, services, overlays) {
  try {
    switch (id) {
      case "approval.allow":
        return answerApproval(services, "allowed-once");
      case "approval.reject":
        return answerApproval(services, "rejected");
      case "question.option":
        return false;
      // 数字键走固定分发逻辑,不作为可执行动作
      case "question.submit":
        return submitQuestion();
      case "sidebar.toggle":
        return toggleSidebar(services);
      case "session.prev":
        return openNeighborSession(services, -1);
      case "session.next":
        return openNeighborSession(services, 1);
      case "view.prev":
        return switchView(-1);
      case "view.next":
        return switchView(1);
      case "settings.open":
        return openSettings();
      case "model.open":
        return openModelSelector();
      case "composer.focus":
        return focusComposer();
      case "help.toggle":
        overlays.toggleHelp();
        return true;
      default:
        return false;
    }
  } catch (error) {
    console.warn("[dsh-kbd-hotkeys] action failed:", id, error);
    return false;
  }
}
function apply(ctx) {
  if (typeof document === "undefined") return;
  const services = {
    sessions: getService(ctx, "sessions"),
    uiSession: getService(ctx, "uiSession"),
    layout: getService(ctx, "layout"),
    workspaces: getService(ctx, "workspaces")
  };
  const config = loadConfig();
  const actionByCombo = comboActionMap(config.bindings);
  const overlays = createOverlays({
    getConfig: () => config
  });
  const swallow = (event) => {
    event.preventDefault();
    event.stopPropagation();
  };
  const onKeyDown = (event) => {
    if (event.repeat && event.key === "Escape") return;
    if (overlays.isOpen()) {
      const handled = overlays.handleKey(event);
      if (handled) {
        swallow(event);
        return;
      }
      const target = event.target;
      if (target instanceof Node && overlays.contains(target)) return;
      swallow(event);
      return;
    }
    if (event.isComposing) return;
    const combo = comboOf(event);
    if (combo === "mod" || combo === "alt" || combo === "shift" || combo === "mod+alt" || combo === "mod+shift" || combo === "alt+shift") {
      return;
    }
    const editable = isEditableTarget(event.target);
    const stateA = detectStateA();
    const state = stateA ? "A" : editable ? "B" : "C";
    if (state === "A" && !editable) {
      if (/^[1-9]$/.test(combo) && pickQuestionOption(Number(combo))) {
        swallow(event);
        return;
      }
      if (combo === "enter" && submitQuestion()) {
        swallow(event);
        return;
      }
    }
    const actionId = actionByCombo.get(combo);
    if (actionId === void 0) return;
    const def = ACTION_BY_ID.get(actionId);
    if (def === void 0) return;
    if (!def.states.includes(state)) return;
    if (runAction(actionId, services, overlays)) swallow(event);
  };
  document.addEventListener("keydown", onKeyDown, true);
  if (typeof ctx.effect === "function") {
    ctx.effect(() => () => {
      document.removeEventListener("keydown", onKeyDown, true);
      overlays.destroy();
    });
  }
}
return module.exports; } });
