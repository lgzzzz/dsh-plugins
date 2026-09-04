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
function conversationScroll() {
  return document.querySelector("[data-conversation-scroll]");
}
function scrollByPages(pages) {
  const el = conversationScroll();
  if (el === null) return;
  el.scrollTop += el.clientHeight * 0.85 * pages;
}
function scrollToEdge(edge) {
  const el = conversationScroll();
  if (el === null) return;
  el.scrollTop = edge === "top" ? 0 : el.scrollHeight;
}
async function copyText(text) {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard !== void 0) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  } catch {
    return false;
  }
}
async function copyLastReply() {
  var _a;
  const items = document.querySelectorAll('[data-chat-flow-kind="assistant"]');
  const last = items.length === 0 ? null : items[items.length - 1];
  const text = last === null ? "" : ((_a = last.innerText) != null ? _a : "").trim();
  if (text === "") return false;
  return copyText(text);
}
async function copyLastCodeBlock() {
  var _a, _b;
  const root = (_a = conversationScroll()) != null ? _a : document;
  const blocks = root.querySelectorAll("pre");
  const last = blocks.length === 0 ? null : blocks[blocks.length - 1];
  const text = last === null ? "" : ((_b = last.innerText) != null ? _b : "").trim();
  if (text === "") return false;
  return copyText(text);
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
function startNewSession(services) {
  const uiWorkspace = services.uiWorkspace;
  if (uiWorkspace === null || uiWorkspace === void 0 || typeof uiWorkspace.startSession !== "function") return false;
  uiWorkspace.startSession();
  return true;
}
function openNeighborSession(services, delta) {
  var _a, _b;
  const sessions = services.sessions;
  const snapshot = (_b = (_a = sessions == null ? void 0 : sessions.list) == null ? void 0 : _a.getSnapshot) == null ? void 0 : _b.call(_a);
  if (sessions === null || sessions === void 0 || snapshot === null || snapshot === void 0) return false;
  const ids = snapshot.ids;
  if (ids === void 0 || ids.length === 0 || typeof sessions.open !== "function") return false;
  const current = snapshot.current;
  const index = current === void 0 ? -1 : ids.indexOf(current);
  const nextIndex = index < 0 ? delta > 0 ? 0 : ids.length - 1 : Math.min(ids.length - 1, Math.max(0, index + delta));
  if (nextIndex === index) return false;
  const target = ids[nextIndex];
  if (target === void 0) return false;
  sessions.open(target);
  return true;
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
  { id: "session.new", label: "\u65B0\u5EFA\u4F1A\u8BDD", group: "\u4F1A\u8BDD(P0)", states: ["A", "B", "C"] },
  // P1 会话级
  { id: "sidebar.toggle", label: "\u5F00\u5173\u4FA7\u680F", group: "\u4F1A\u8BDD(P1)", states: ["C"] },
  { id: "session.prev", label: "\u4E0A\u4E00\u4E2A\u4F1A\u8BDD", group: "\u4F1A\u8BDD(P1)", states: ["A", "B", "C"] },
  { id: "session.next", label: "\u4E0B\u4E00\u4E2A\u4F1A\u8BDD", group: "\u4F1A\u8BDD(P1)", states: ["A", "B", "C"] },
  { id: "scroll.pageup", label: "\u5BF9\u8BDD\u4E0A\u7FFB\u4E00\u9875", group: "\u6EDA\u52A8(P1)", states: ["C"] },
  { id: "scroll.pagedown", label: "\u5BF9\u8BDD\u4E0B\u7FFB\u4E00\u9875", group: "\u6EDA\u52A8(P1)", states: ["C"] },
  { id: "scroll.top", label: "\u8DF3\u5230\u6700\u65E7\u6D88\u606F", group: "\u6EDA\u52A8(P1)", states: ["C"] },
  { id: "scroll.bottom", label: "\u8DF3\u5230\u6700\u65B0\u6D88\u606F", group: "\u6EDA\u52A8(P1)", states: ["C"] },
  { id: "reply.copy", label: "\u590D\u5236\u6700\u540E\u56DE\u590D", group: "\u590D\u5236(P1)", states: ["A", "B", "C"] },
  { id: "code.copy", label: "\u590D\u5236\u6700\u540E\u4EE3\u7801\u5757", group: "\u590D\u5236(P1)", states: ["A", "B", "C"] },
  { id: "settings.open", label: "\u6253\u5F00\u8BBE\u7F6E", group: "\u9762\u677F(P1)", states: ["A", "B", "C"] },
  { id: "model.open", label: "\u6253\u5F00\u6A21\u578B\u9009\u62E9\u5668", group: "\u9762\u677F(P1)", states: ["B", "C"] },
  { id: "composer.focus", label: "\u805A\u7126\u8F93\u5165\u6846", group: "\u9762\u677F(P1)", states: ["C"] },
  { id: "palette.toggle", label: "\u547D\u4EE4\u9762\u677F:\u641C\u7D22\u547D\u4EE4 / \u5207\u6362\u4F1A\u8BDD", group: "\u9762\u677F(P1)", states: ["A", "B", "C"] },
  { id: "help.toggle", label: "\u5FEB\u6377\u952E\u901F\u67E5\u8868", group: "\u9762\u677F(P1)", states: ["A", "B", "C"] }
];
var ACTION_BY_ID = new Map(ACTIONS.map((a) => [a.id, a]));
var DEFAULT_BINDINGS = {
  "approval.allow": "mod+alt+enter",
  "approval.reject": "mod+alt+backspace",
  "session.new": "mod+shift+o",
  "sidebar.toggle": "mod+b",
  "session.prev": "mod+alt+arrowleft",
  "session.next": "mod+alt+arrowright",
  "scroll.pageup": "pageup",
  "scroll.pagedown": "pagedown",
  "scroll.top": "mod+arrowup",
  "scroll.bottom": "mod+arrowdown",
  "reply.copy": "mod+shift+c",
  "code.copy": "mod+shift+;",
  "settings.open": "mod+.",
  "model.open": "mod+alt+m",
  "composer.focus": "mod+shift+e",
  "palette.toggle": "mod+k",
  "help.toggle": "mod+/"
};
var STORAGE_KEY = "dsh-kbd-hotkeys:v1";
function loadConfig() {
  const bindings = { ...DEFAULT_BINDINGS };
  let enabled = true;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw !== null) {
      const parsed = JSON.parse(raw);
      if (typeof parsed === "object" && parsed !== null) {
        const obj = parsed;
        if (typeof obj.enabled === "boolean") enabled = obj.enabled;
        if (typeof obj.bindings === "object" && obj.bindings !== null) {
          for (const [id, combo] of Object.entries(obj.bindings)) {
            if (typeof combo === "string" && combo !== "") bindings[id] = normalizeComboString(combo);
          }
        }
      }
    }
  } catch {
  }
  return { enabled, bindings };
}
function saveConfig(config) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ enabled: config.enabled, bindings: config.bindings }));
  } catch {
  }
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
  ".dsh-kbd-input{border:none;outline:none;background:transparent;color:inherit;font:inherit;font-size:15px;padding:14px 18px;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.08))}",
  ".dsh-kbd-input::placeholder{color:var(--dsw-alias-label-tertiary,#999)}",
  ".dsh-kbd-list{margin:0;padding:6px;list-style:none;overflow-y:auto;flex:1;min-height:0}",
  ".dsh-kbd-item{display:flex;align-items:center;gap:10px;width:100%;text-align:left;background:none;border:none;color:inherit;font:inherit;font-size:13px;line-height:20px;padding:9px 12px;border-radius:8px;cursor:pointer}",
  '.dsh-kbd-item[data-active="true"]{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06))}',
  ".dsh-kbd-itemLabel{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
  ".dsh-kbd-itemHint{flex:none;color:var(--dsw-alias-label-tertiary,#999);font-size:11px}",
  ".dsh-kbd-item kbd,.dsh-kbd-help kbd{font-family:var(--ds-font-family-code,ui-monospace,monospace);font-size:11px;line-height:18px;padding:1px 6px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12));border-bottom-width:2px;border-radius:6px;background:var(--dsw-alias-bg-base,transparent)}",
  ".dsh-kbd-foot{flex:none;padding:8px 16px;color:var(--dsw-alias-label-tertiary,#999);font-size:11px;border-top:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.08))}",
  ".dsh-kbd-empty{padding:24px 16px;color:var(--dsw-alias-label-tertiary,#999);font-size:13px;text-align:center}",
  ".dsh-kbd-help{padding:14px 18px;overflow-y:auto}",
  ".dsh-kbd-help h3{margin:14px 0 6px;font-size:12px;font-weight:600;color:var(--dsw-alias-label-tertiary,#999)}",
  ".dsh-kbd-help h3:first-child{margin-top:0}",
  ".dsh-kbd-helpRow{display:flex;align-items:center;gap:12px;padding:5px 0;font-size:13px}",
  ".dsh-kbd-helpRow .dsh-kbd-itemLabel{flex:1}",
  ".dsh-kbd-helpSwitch{display:flex;align-items:center;gap:8px;padding:10px 0 2px;font-size:13px;border-top:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.08));margin-top:12px}",
  ".dsh-kbd-toast{position:fixed;left:50%;bottom:96px;transform:translateX(-50%);z-index:2147483001;background:var(--dsw-alias-label-primary,#222);color:var(--dsw-alias-bg-base,#fff);font-size:12px;line-height:18px;padding:6px 14px;border-radius:999px;opacity:0;transition:opacity .15s;pointer-events:none}",
  '.dsh-kbd-toast[data-show="true"]{opacity:.92}'
].join("\n");
function showToast(message) {
  const toast = document.createElement("div");
  toast.className = "dsh-kbd-toast";
  toast.textContent = message;
  document.body.appendChild(toast);
  requestAnimationFrame(() => {
    toast.dataset.show = "true";
  });
  window.setTimeout(() => {
    toast.dataset.show = "false";
    window.setTimeout(() => {
      toast.remove();
    }, 200);
  }, 1400);
}
function ensureStyle() {
  if (document.getElementById(STYLE_ID) !== null) return;
  const tag = document.createElement("style");
  tag.id = STYLE_ID;
  tag.textContent = STYLE;
  document.head.appendChild(tag);
}
function sessionLabel(summary, id) {
  var _a;
  const named = (_a = summary == null ? void 0 : summary.displayTitle) != null ? _a : summary == null ? void 0 : summary.title;
  return named === void 0 || named === "" ? id : named;
}
function createOverlays(deps) {
  ensureStyle();
  let root = null;
  let mode = null;
  let input = null;
  let list = null;
  let items = [];
  let activeIndex = 0;
  function isOpen() {
    return mode !== null;
  }
  function contains(target) {
    return root !== null && target !== null && root.contains(target);
  }
  function close() {
    if (root !== null) root.remove();
    root = null;
    mode = null;
    input = null;
    list = null;
    items = [];
  }
  function mount(nextMode) {
    close();
    ensureStyle();
    const backdrop = document.createElement("div");
    backdrop.className = "dsh-kbd-backdrop";
    const panel = document.createElement("div");
    panel.className = "dsh-kbd-panel";
    backdrop.appendChild(panel);
    if (nextMode === "palette") {
      input = document.createElement("input");
      input.className = "dsh-kbd-input";
      input.placeholder = "\u641C\u7D22\u547D\u4EE4\u6216\u4F1A\u8BDD\u2026(\u2191\u2193 \u9009\u62E9,Enter \u786E\u8BA4)";
      input.addEventListener("input", () => renderPalette());
      panel.appendChild(input);
      list = document.createElement("ul");
      list.className = "dsh-kbd-list";
      panel.appendChild(list);
      const foot = document.createElement("div");
      foot.className = "dsh-kbd-foot";
      foot.textContent = "Enter \u786E\u8BA4 \xB7 \u2191\u2193 \u9009\u62E9 \xB7 Esc \u5173\u95ED";
      panel.appendChild(foot);
    } else {
      panel.appendChild(renderHelp());
    }
    backdrop.addEventListener("mousedown", (event) => {
      if (event.target === backdrop) close();
    });
    document.body.appendChild(backdrop);
    root = backdrop;
    mode = nextMode;
    if (nextMode === "palette") {
      renderPalette();
      input == null ? void 0 : input.focus();
    }
  }
  function buildItems() {
    var _a, _b, _c, _d, _e;
    const result = [];
    for (const action of ACTIONS) {
      if (!action.states.includes("C")) continue;
      if (action.id === "palette.toggle" || action.id === "help.toggle") continue;
      const combo = deps.getConfig().bindings[action.id];
      result.push({
        kind: "action",
        id: action.id,
        label: action.label,
        hint: combo === void 0 ? "" : prettyCombo(combo)
      });
    }
    const snapshot = (_c = (_b = (_a = deps.services.sessions) == null ? void 0 : _a.list) == null ? void 0 : _b.getSnapshot) == null ? void 0 : _c.call(_b);
    const ids = (_d = snapshot == null ? void 0 : snapshot.ids) != null ? _d : [];
    const byId = (_e = snapshot == null ? void 0 : snapshot.byId) != null ? _e : {};
    const current = snapshot == null ? void 0 : snapshot.current;
    const summaries = ids.map((id) => byId[id]).filter((s) => s !== void 0).sort((left, right) => {
      var _a2, _b2;
      if (left.id === current) return -1;
      if (right.id === current) return 1;
      return ((_a2 = right.updatedAt) != null ? _a2 : 0) - ((_b2 = left.updatedAt) != null ? _b2 : 0);
    }).slice(0, 40);
    for (const summary of summaries) {
      result.push({
        kind: "session",
        id: summary.id,
        sessionId: summary.id,
        label: sessionLabel(summary, summary.id),
        hint: summary.id === current ? "\u5F53\u524D" : summary.running === true ? "\u8FD0\u884C\u4E2D" : ""
      });
    }
    return result;
  }
  function renderPalette() {
    var _a;
    if (list === null) return;
    const query = ((_a = input == null ? void 0 : input.value) != null ? _a : "").trim().toLowerCase();
    items = buildItems().filter((item) => query === "" || item.label.toLowerCase().includes(query));
    if (activeIndex >= items.length) activeIndex = 0;
    list.textContent = "";
    if (items.length === 0) {
      const empty = document.createElement("li");
      empty.className = "dsh-kbd-empty";
      empty.textContent = "\u65E0\u5339\u914D\u547D\u4EE4\u6216\u4F1A\u8BDD";
      list.appendChild(empty);
      return;
    }
    items.forEach((item, index) => {
      const li = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "dsh-kbd-item";
      button.dataset.active = String(index === activeIndex);
      const label = document.createElement("span");
      label.className = "dsh-kbd-itemLabel";
      label.textContent = item.label;
      const hint = document.createElement("span");
      hint.className = "dsh-kbd-itemHint";
      hint.textContent = item.hint;
      button.appendChild(label);
      button.appendChild(hint);
      button.addEventListener("click", () => {
        activate(index);
      });
      button.addEventListener("mousemove", () => {
        if (activeIndex !== index) {
          activeIndex = index;
          syncActive();
        }
      });
      li.appendChild(button);
      list == null ? void 0 : list.appendChild(li);
    });
  }
  function syncActive() {
    if (list === null) return;
    const buttons = list.querySelectorAll(".dsh-kbd-item");
    buttons.forEach((button, index) => {
      button.dataset.active = String(index === activeIndex);
      if (index === activeIndex) button.scrollIntoView({ block: "nearest" });
    });
  }
  function activate(index) {
    const item = items[index];
    if (item === void 0) return;
    if (item.kind === "action") {
      const handled = deps.runAction(item.id);
      if (!handled) return;
      close();
      return;
    }
    const sessions = deps.services.sessions;
    if (sessions !== null && sessions !== void 0 && typeof sessions.open === "function" && item.sessionId !== void 0) {
      sessions.open(item.sessionId);
    }
    close();
  }
  function renderHelp() {
    const container = document.createElement("div");
    container.className = "dsh-kbd-help";
    const config = deps.getConfig();
    let lastGroup = "";
    for (const action of ACTIONS) {
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
    const hint = document.createElement("div");
    hint.className = "dsh-kbd-helpRow";
    const hintLabel = document.createElement("span");
    hintLabel.className = "dsh-kbd-itemLabel";
    hintLabel.textContent = "\u6B64\u5916:Esc \u4E2D\u65AD\u56DE\u5408(\u7531 dsh-new-session \u63D0\u4F9B);Shift+Esc \u805A\u7126\u8F93\u5165\u6846";
    const hintKey = document.createElement("kbd");
    hintKey.textContent = "Esc";
    hint.appendChild(hintLabel);
    hint.appendChild(hintKey);
    container.appendChild(hint);
    const switchRow = document.createElement("label");
    switchRow.className = "dsh-kbd-helpSwitch";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = config.enabled;
    checkbox.addEventListener("change", () => {
      deps.setEnabled(checkbox.checked);
      showToast(checkbox.checked ? "\u5FEB\u6377\u952E\u5DF2\u542F\u7528" : "\u5FEB\u6377\u952E\u5DF2\u505C\u7528");
    });
    const switchLabel = document.createElement("span");
    switchLabel.textContent = "\u542F\u7528\u5168\u90E8\u5FEB\u6377\u952E(\u603B\u5F00\u5173)";
    switchRow.appendChild(checkbox);
    switchRow.appendChild(switchLabel);
    container.appendChild(switchRow);
    const note = document.createElement("div");
    note.className = "dsh-kbd-foot";
    note.textContent = '\u81EA\u5B9A\u4E49\u952E\u4F4D:localStorage["dsh-kbd-hotkeys:v1"] \u7684 bindings \u5B57\u6BB5(\u89C1\u63D2\u4EF6 README)';
    container.appendChild(note);
    return container;
  }
  function togglePalette() {
    if (mode === "palette") close();
    else mount("palette");
  }
  function toggleHelp() {
    if (mode === "help") close();
    else mount("help");
  }
  function handleKey(event) {
    if (mode === null) return false;
    const combo = `${event.ctrlKey || event.metaKey ? "mod+" : ""}${event.altKey ? "alt+" : ""}${event.shiftKey ? "shift+" : ""}${event.key.toLowerCase()}`;
    if (event.key === "Escape") {
      close();
      return true;
    }
    if (combo === "mod+k" || combo === "mod+/") {
      close();
      return true;
    }
    if (mode === "palette") {
      if (event.key === "ArrowDown") {
        if (items.length > 0) {
          activeIndex = (activeIndex + 1) % items.length;
          syncActive();
        }
        return true;
      }
      if (event.key === "ArrowUp") {
        if (items.length > 0) {
          activeIndex = (activeIndex - 1 + items.length) % items.length;
          syncActive();
        }
        return true;
      }
      if (event.key === "Enter") {
        activate(activeIndex);
        return true;
      }
    }
    return false;
  }
  function destroy() {
    var _a;
    close();
    (_a = document.getElementById(STYLE_ID)) == null ? void 0 : _a.remove();
  }
  return { isOpen, contains, handleKey, togglePalette, toggleHelp, destroy };
}

// src/client.ts
var name = "dsh-kbd-hotkeys";
var inject = ["sessions", "uiSession", "uiWorkspace", "layout"];
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
      case "session.new":
        return startNewSession(services);
      case "sidebar.toggle":
        return toggleSidebar(services);
      case "session.prev":
        return openNeighborSession(services, -1);
      case "session.next":
        return openNeighborSession(services, 1);
      case "scroll.pageup":
        scrollByPages(-1);
        return true;
      case "scroll.pagedown":
        scrollByPages(1);
        return true;
      case "scroll.top":
        scrollToEdge("top");
        return true;
      case "scroll.bottom":
        scrollToEdge("bottom");
        return true;
      case "reply.copy":
        void copyLastReply().then((ok) => {
          showToast(ok ? "\u5DF2\u590D\u5236\u6700\u540E\u56DE\u590D" : "\u6CA1\u6709\u53EF\u590D\u5236\u7684\u56DE\u590D");
        });
        return true;
      case "code.copy":
        void copyLastCodeBlock().then((ok) => {
          showToast(ok ? "\u5DF2\u590D\u5236\u6700\u540E\u4EE3\u7801\u5757" : "\u6CA1\u6709\u53EF\u590D\u5236\u7684\u4EE3\u7801\u5757");
        });
        return true;
      case "settings.open":
        return openSettings();
      case "model.open":
        return openModelSelector();
      case "composer.focus":
        return focusComposer();
      case "palette.toggle":
        overlays.togglePalette();
        return true;
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
    uiWorkspace: getService(ctx, "uiWorkspace"),
    layout: getService(ctx, "layout")
  };
  let config = loadConfig();
  const overlays = createOverlays({
    services,
    getConfig: () => config,
    setEnabled: (enabled) => {
      config = { ...config, enabled };
      saveConfig(config);
    },
    runAction: (id) => runAction(id, services, overlays)
  });
  const swallow = (event) => {
    event.preventDefault();
    event.stopPropagation();
  };
  const onKeyDown = (event) => {
    if (event.repeat && event.key === "Escape") return;
    if (!config.enabled) return;
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
    if (combo === "shift+escape" && !editable && focusComposer()) {
      swallow(event);
      return;
    }
    const actionId = config.bindings[combo];
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
