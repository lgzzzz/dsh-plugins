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

// src/question-drafts.ts
var COMPOSER_SLOT = "conversation.composer";
function questionDraftStore(services, pending, sessionId) {
  const slots = services.slots;
  const uiSession = services.uiSession;
  if (slots === null || slots === void 0 || uiSession === null || uiSession === void 0) return void 0;
  if (typeof slots.entries !== "function" || typeof slots.resolveStore !== "function") return void 0;
  const binding = resolveBinding(uiSession, sessionId);
  if (binding === void 0) return void 0;
  for (const entry of entriesOf(slots)) {
    const handle = entry == null ? void 0 : entry.store;
    if (handle === void 0 || handle === null) continue;
    if (!entryOwnsPending(entry, pending, sessionId)) continue;
    let instance;
    try {
      instance = slots.resolveStore(handle, binding);
    } catch {
      return void 0;
    }
    return asDraftStore(instance);
  }
  return void 0;
}
function entryOwnsPending(entry, pending, sessionId) {
  const select = entry.select;
  if (typeof select !== "function") return false;
  try {
    const matched = select({ sessionId, pendingInteraction: pending });
    return matched !== null && matched !== void 0;
  } catch {
    return false;
  }
}
function entriesOf(slots) {
  var _a;
  try {
    const entries = (_a = slots.entries) == null ? void 0 : _a.call(slots, COMPOSER_SLOT);
    return Array.isArray(entries) ? entries : [];
  } catch {
    return [];
  }
}
function resolveBinding(uiSession, sessionId) {
  const resolve = uiSession.resolve;
  if (typeof resolve !== "function") return void 0;
  let binding;
  try {
    binding = resolve.call(uiSession, sessionId);
  } catch {
    return void 0;
  }
  if (typeof binding !== "object" || binding === null) return void 0;
  const key = binding.key;
  return typeof key === "string" && key !== "" ? binding : void 0;
}
function asDraftStore(value) {
  if (typeof value !== "object" || value === null) return void 0;
  const candidate = value;
  if (typeof candidate.getSnapshot !== "function") return void 0;
  const actions = candidate.actions;
  if (typeof actions !== "object" || actions === null) return void 0;
  if (typeof actions.replace !== "function") return void 0;
  return candidate;
}
function freshProgress(questions) {
  return { index: 0, drafts: questions.map(() => ({ selected: [], custom: "", skipped: false })) };
}
function readProgress(store, requestKey, questions) {
  var _a;
  const snapshot = asSnapshot((_a = store.getSnapshot) == null ? void 0 : _a.call(store));
  if (snapshot === void 0 || snapshot.requestKey !== requestKey) return freshProgress(questions);
  const progress = snapshot.progress;
  if (progress === void 0) return freshProgress(questions);
  const drafts = progress.drafts;
  if (!Array.isArray(drafts) || drafts.length !== questions.length) return freshProgress(questions);
  const index = progress.index;
  return {
    index: typeof index === "number" && Number.isInteger(index) && index >= 0 && index < questions.length ? index : 0,
    drafts: drafts.map(cloneDraft)
  };
}
function asSnapshot(value) {
  if (typeof value !== "object" || value === null) return void 0;
  return value;
}
function cloneDraft(draft) {
  return {
    selected: Array.isArray(draft == null ? void 0 : draft.selected) ? [...draft.selected] : [],
    custom: typeof (draft == null ? void 0 : draft.custom) === "string" ? draft.custom : "",
    skipped: (draft == null ? void 0 : draft.skipped) === true
  };
}
function writeProgress(store, requestKey, progress) {
  var _a;
  const replace = (_a = store.actions) == null ? void 0 : _a.replace;
  if (typeof replace !== "function") return false;
  try {
    replace.call(store.actions, requestKey, progress);
    return true;
  } catch {
    return false;
  }
}
function clearProgress(store, requestKey) {
  var _a;
  const clear = (_a = store.actions) == null ? void 0 : _a.clear;
  if (typeof clear !== "function") return;
  try {
    clear.call(store.actions, requestKey);
  } catch {
  }
}

// src/sidebar-order.ts
var FLAT_ORDER_KEY = "__flat_session_order__";
var UNGROUPED_KEY = "";
var WORKSPACE_SLOT = "sidebar.workspaces";
function sidebarOrderedSessionIds(snapshot, services) {
  var _a, _b, _c, _d, _e, _f, _g;
  const view = readSidebarViewState(services);
  if (view === void 0) return [];
  const workspaceSnapshot = (_c = (_b = (_a = services.workspaces) == null ? void 0 : _a.list) == null ? void 0 : _b.getSnapshot) == null ? void 0 : _c.call(_b);
  if (workspaceSnapshot === void 0) return [];
  const byId = (_d = snapshot.byId) != null ? _d : {};
  const current = snapshot.current;
  const archived = new Set((_e = workspaceSnapshot.archivedSessionIds) != null ? _e : []);
  const order = view.sessionOrderByAccount;
  const visible = (id) => {
    const summary = byId[id];
    return summary !== void 0 && sessionVisible(summary, current, archived);
  };
  const recency = (a, b) => compareRecency(a, b, byId);
  if (view.groupBy === "flat") {
    const base = ((_f = snapshot.ids) != null ? _f : []).filter(visible);
    base.sort(recency);
    return reconcileOrder(base, order == null ? void 0 : order[FLAT_ORDER_KEY]);
  }
  if (view.groupBy !== "workspace") return [];
  const items = workspaceSnapshot.items;
  if (items === void 0) return [];
  const ids = [];
  const accounted = /* @__PURE__ */ new Set();
  for (const workspace of items) {
    for (const id of groupOrder(workspace, order)) {
      accounted.add(id);
      if (visible(id)) ids.push(id);
    }
  }
  const stray = ((_g = snapshot.ids) != null ? _g : []).filter((id) => !accounted.has(id) && visible(id));
  const ungrouped = order == null ? void 0 : order[UNGROUPED_KEY];
  if (ungrouped === void 0) {
    stray.sort(recency);
    ids.push(...stray);
  } else {
    ids.push(...orderedUngrouped(stray, ungrouped, recency));
  }
  return ids;
}
function readSidebarViewState(services) {
  var _a;
  const slots = services.slots;
  if (slots === null || slots === void 0) return void 0;
  if (typeof slots.entries !== "function" || typeof slots.resolveStore !== "function") return void 0;
  for (const entry of entriesOf2(slots)) {
    const handle = entry == null ? void 0 : entry.store;
    if (handle === void 0 || handle === null) continue;
    const instance = liveInstance(slots, handle);
    const state = asViewState((_a = instance == null ? void 0 : instance.getSnapshot) == null ? void 0 : _a.call(instance));
    if (state !== void 0) return state;
  }
  return void 0;
}
function entriesOf2(slots) {
  var _a;
  try {
    const entries = (_a = slots.entries) == null ? void 0 : _a.call(slots, WORKSPACE_SLOT);
    return Array.isArray(entries) ? entries : [];
  } catch {
    return [];
  }
}
function liveInstance(slots, handle) {
  var _a;
  try {
    return (_a = slots.resolveStore) == null ? void 0 : _a.call(slots, handle, void 0);
  } catch {
    return void 0;
  }
}
function asViewState(raw) {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return void 0;
  return raw;
}
function groupOrder(workspace, order) {
  var _a;
  const sessionIds = (_a = workspace.sessionIds) != null ? _a : [];
  return reconcileOrder(sessionIds, order == null ? void 0 : order[workspace.workspaceId]);
}
function reconcileOrder(ids, stored) {
  if (stored === void 0) return [...ids];
  const known = new Set(ids);
  const out = [];
  const included = /* @__PURE__ */ new Set();
  for (const id of stored) {
    if (!known.has(id) || included.has(id)) continue;
    out.push(id);
    included.add(id);
  }
  for (const id of ids) {
    if (included.has(id)) continue;
    out.push(id);
  }
  return out;
}
function orderedUngrouped(ids, stored, recency) {
  const known = new Set(ids);
  const out = [];
  const included = /* @__PURE__ */ new Set();
  for (const id of stored) {
    if (!known.has(id) || included.has(id)) continue;
    out.push(id);
    included.add(id);
  }
  const rest = ids.filter((id) => !included.has(id));
  rest.sort(recency);
  return [...out, ...rest];
}
function compareRecency(a, b, byId) {
  var _a, _b, _c, _d;
  const aUpdated = (_b = (_a = byId[a]) == null ? void 0 : _a.updatedAt) != null ? _b : Number.NEGATIVE_INFINITY;
  const bUpdated = (_d = (_c = byId[b]) == null ? void 0 : _c.updatedAt) != null ? _d : Number.NEGATIVE_INFINITY;
  if (bUpdated !== aUpdated) return bUpdated - aUpdated;
  return a < b ? -1 : 1;
}
function sessionVisible(summary, current, archived) {
  return summary.origin !== "subagent" && !archived.has(summary.id) && (!summary.blank || summary.id === current);
}

// src/actions.ts
function pendingMap(services) {
  var _a, _b;
  const uiSession = services.uiSession;
  if (uiSession === null || uiSession === void 0) return void 0;
  const snapshot = (_b = (_a = uiSession.pendingInteractions) == null ? void 0 : _a.getSnapshot) == null ? void 0 : _b.call(_a);
  if (snapshot !== void 0) return snapshot;
  return uiSession.pendingSnapshot;
}
function currentSessionId(services) {
  var _a, _b, _c, _d;
  const current = (_d = (_c = (_b = (_a = services.sessions) == null ? void 0 : _a.list) == null ? void 0 : _b.getSnapshot) == null ? void 0 : _c.call(_b)) == null ? void 0 : _d.current;
  return current === void 0 || current === "" ? void 0 : current;
}
function hasPendingCard(services) {
  const map = pendingMap(services);
  if (map === void 0 || map.size === 0) return false;
  const current = currentSessionId(services);
  if (current === void 0) return false;
  return map.has(current);
}
function pendingInteraction(services) {
  const map = pendingMap(services);
  if (map === void 0 || map.size === 0) return void 0;
  const current = currentSessionId(services);
  if (current !== void 0) {
    const scoped = map.get(current);
    if (scoped !== void 0) return scoped;
  }
  const first = map.values().next();
  return first.done === true ? void 0 : first.value;
}
function pendingQuestion(services) {
  const pending = pendingInteraction(services);
  if (pending === void 0) return void 0;
  return pending.kind === "question" || pending.kind === "plan-review" ? pending : void 0;
}
function fireAndForget(run) {
  try {
    void Promise.resolve(run()).catch(() => {
    });
    return true;
  } catch {
    return false;
  }
}
function answerApproval(services, outcome) {
  const pending = pendingInteraction(services);
  if (pending === void 0 || pending.kind !== "approval") return false;
  if (typeof pending.answer !== "function") return false;
  return fireAndForget(() => {
    var _a;
    return (_a = pending.answer) == null ? void 0 : _a.call(pending, outcome);
  });
}
function answered(draft) {
  return draft.selected.length > 0 || draft.custom.trim() !== "";
}
function completed(draft) {
  return answered(draft) || draft.skipped;
}
function requestKeyOf(pending) {
  const key = pending.key;
  return typeof key === "string" && key !== "" ? key : void 0;
}
function draftStoreOf(services, pending) {
  const sessionId = pending.sessionId;
  if (typeof sessionId !== "string" || sessionId === "") return void 0;
  return questionDraftStore(services, pending, sessionId);
}
function planReviewLabels(pending) {
  var _a, _b, _c;
  const question = (_a = pending.questions) == null ? void 0 : _a[0];
  if (question === void 0) return void 0;
  const approveLabel = (_b = question.intent) == null ? void 0 : _b.approve;
  const options = (_c = question.options) != null ? _c : [];
  const approve = approveLabel === void 0 ? void 0 : options.find((option) => option.label === approveLabel);
  const decline = approveLabel === void 0 ? void 0 : options.find((option) => option.label !== approveLabel);
  return {
    id: question.id,
    ...approve === void 0 ? {} : { approve: approve.label },
    ...decline === void 0 ? {} : { decline: decline.label }
  };
}
function answerPlanReview(pending, decision) {
  if (decision === "discuss") {
    if (typeof pending.cancel !== "function") return false;
    return fireAndForget(() => {
      var _a;
      return (_a = pending.cancel) == null ? void 0 : _a.call(pending);
    });
  }
  const labels = planReviewLabels(pending);
  if (labels === void 0 || typeof pending.answer !== "function") return false;
  const label = decision === "approve" ? labels.approve : labels.decline;
  if (label === void 0) return false;
  return fireAndForget(() => {
    var _a;
    return (_a = pending.answer) == null ? void 0 : _a.call(pending, { answers: [{ id: labels.id, selected: [label] }] });
  });
}
function pickQuestionOption(services, n) {
  var _a, _b;
  const pending = pendingQuestion(services);
  if (pending === void 0) return false;
  if (pending.kind === "plan-review") {
    if (n === 1) return answerPlanReview(pending, "approve");
    if (n === 2) return answerPlanReview(pending, "decline");
    if (n === 3) return answerPlanReview(pending, "discuss");
    return false;
  }
  const questions = (_a = pending.questions) != null ? _a : [];
  if (questions.length === 0) return false;
  const requestKey = requestKeyOf(pending);
  if (requestKey === void 0) return false;
  const store = draftStoreOf(services, pending);
  if (store === void 0) return false;
  const progress = readProgress(store, requestKey, questions);
  const question = questions[progress.index];
  const draft = progress.drafts[progress.index];
  if (question === void 0 || draft === void 0) return false;
  const option = ((_b = question.options) != null ? _b : [])[n - 1];
  if (option === void 0) return false;
  if (question.multiSelect === true) {
    draft.selected = draft.selected.includes(option.label) ? draft.selected.filter((label) => label !== option.label) : [...draft.selected, option.label];
  } else {
    draft.selected = [option.label];
    draft.custom = "";
  }
  draft.skipped = false;
  return writeProgress(store, requestKey, progress);
}
function moveQuestion(services, delta) {
  var _a;
  const pending = pendingQuestion(services);
  if (pending === void 0 || pending.kind === "plan-review") return false;
  const questions = (_a = pending.questions) != null ? _a : [];
  if (questions.length === 0) return false;
  const requestKey = requestKeyOf(pending);
  if (requestKey === void 0) return false;
  const store = draftStoreOf(services, pending);
  if (store === void 0) return false;
  const progress = readProgress(store, requestKey, questions);
  const next = progress.index + delta;
  if (next < 0 || next >= questions.length) return false;
  progress.index = next;
  return writeProgress(store, requestKey, progress);
}
function submitQuestion(services) {
  var _a;
  const pending = pendingQuestion(services);
  if (pending === void 0) return false;
  if (pending.kind === "plan-review") return answerPlanReview(pending, "approve");
  const questions = (_a = pending.questions) != null ? _a : [];
  if (questions.length === 0) return false;
  const requestKey = requestKeyOf(pending);
  if (requestKey === void 0) return false;
  const store = draftStoreOf(services, pending);
  if (store === void 0) return false;
  const progress = readProgress(store, requestKey, questions);
  const draft = progress.drafts[progress.index];
  if (draft === void 0 || !answered(draft)) return false;
  if (progress.index < questions.length - 1) {
    progress.index += 1;
    return writeProgress(store, requestKey, progress);
  }
  if (progress.drafts.some((item) => !completed(item))) return false;
  if (typeof pending.answer !== "function") return false;
  const answers = questions.map((item, index) => {
    var _a2;
    const value = (_a2 = progress.drafts[index]) != null ? _a2 : { selected: [], custom: "", skipped: false };
    if (value.skipped) return { id: item.id, selected: [] };
    const custom = value.custom.trim();
    return {
      id: item.id,
      selected: custom === "" || item.multiSelect === true ? [...value.selected] : [],
      ...custom === "" ? {} : { custom }
    };
  });
  const settled = fireAndForget(() => {
    var _a2;
    return (_a2 = pending.answer) == null ? void 0 : _a2.call(pending, { answers });
  });
  if (settled) clearProgress(store, requestKey);
  return settled;
}
function isEditableTarget(target) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}
function toggleSidebar(services) {
  const layout = services.layout;
  if (layout === null || layout === void 0 || typeof layout.toggleSidebar !== "function") return false;
  layout.toggleSidebar();
  return true;
}
function stopCurrentSessionTree(services) {
  var _a, _b;
  const sessions = services.sessions;
  const snapshot = (_b = (_a = sessions == null ? void 0 : sessions.list) == null ? void 0 : _a.getSnapshot) == null ? void 0 : _b.call(_a);
  if (sessions === null || sessions === void 0 || snapshot === null || snapshot === void 0) return false;
  const current = snapshot.current;
  if (current === void 0 || current === "") return false;
  const cancelled = /* @__PURE__ */ new Set();
  const visit = (id, seen) => {
    var _a2;
    if (id === void 0 || id === "" || seen.has(id)) return;
    seen.add(id);
    cancelIfRunning(id, sessions, cancelled);
    const catalog = (_a2 = snapshot.subagentsByParent) == null ? void 0 : _a2[id];
    const entries = catalog == null ? void 0 : catalog.entries;
    if (entries === void 0) return;
    for (const entry of entries) {
      if (entry.kind !== "child") continue;
      visit(entry.id, seen);
    }
  };
  visit(current, /* @__PURE__ */ new Set());
  return cancelled.size > 0;
}
function cancelIfRunning(id, sessions, cancelled) {
  var _a, _b;
  const binding = (_a = sessions.binding) == null ? void 0 : _a.call(sessions, id);
  const session = binding == null ? void 0 : binding.session;
  if (session === void 0) return false;
  const snapshot = (_b = session.getSnapshot) == null ? void 0 : _b.call(session);
  if ((snapshot == null ? void 0 : snapshot.running) !== true) return false;
  const subagent = snapshot.subagent;
  const address = subagent === null || subagent === void 0 ? void 0 : subagent.address;
  if (address !== void 0 && address.mode === "one-shot") return false;
  if (typeof session.cancel !== "function") return false;
  try {
    void Promise.resolve(session.cancel()).catch(() => {
    });
    cancelled.add(id);
    return true;
  } catch {
    return false;
  }
}
function openNeighborSession(services, delta) {
  var _a, _b;
  const sessions = services.sessions;
  const snapshot = (_b = (_a = sessions == null ? void 0 : sessions.list) == null ? void 0 : _a.getSnapshot) == null ? void 0 : _b.call(_a);
  if (sessions === null || sessions === void 0 || snapshot === null || snapshot === void 0) return false;
  if (snapshot.ids === void 0 || snapshot.ids.length === 0 || snapshot.byId === void 0 || typeof sessions.open !== "function") {
    return false;
  }
  const axis = sidebarOrderedSessionIds(snapshot, services);
  if (axis.length === 0) return false;
  const current = snapshot.current;
  const anchor = current === void 0 ? -1 : axis.indexOf(current);
  if (anchor < 0) return false;
  const active = activeSessionIds(snapshot, services);
  for (let i = anchor + delta; i >= 0 && i < axis.length; i += delta) {
    const id = axis[i];
    if (id === void 0) continue;
    if (active.has(id)) {
      sessions.open(id);
      return true;
    }
  }
  return false;
}
function activeSessionIds(snapshot, services) {
  var _a, _b;
  const pending = pendingMap(services);
  const active = /* @__PURE__ */ new Set();
  for (const id of (_a = snapshot.ids) != null ? _a : []) {
    const summary = (_b = snapshot.byId) == null ? void 0 : _b[id];
    if (summary === void 0) continue;
    if (summary.running === true || summary.completed === true || pending !== void 0 && pending.has(id)) {
      active.add(id);
    }
  }
  return active;
}

// src/config.ts
var ACTIONS = [
  // 回合级高频:审批与问答/计划评审均为服务级应答(uiSession 待处理交互),
  // `card` 态亦由该表判定,不受 React 渲染卡片时序影响;审批 Enter/Esc 与问答的
  // 数字键/方向键/Enter 由分发器固定分发(单键不参与 bindings 覆盖,避免与输入框
  // 光标移动 / 发送消息冲突)。
  { id: "approval.allow", label: "\u5BA1\u6279:\u5141\u8BB8\u4E00\u6B21", group: "\u5BA1\u6279", states: ["card"] },
  { id: "approval.reject", label: "\u5BA1\u6279:\u62D2\u7EDD", group: "\u5BA1\u6279", states: ["card"] },
  { id: "question.option", label: "\u95EE\u9898:\u6309 1\u20139 \u9009\u62E9\u9009\u9879(\u4E0D\u7FFB\u9898)", group: "\u95EE\u7B54\u5361\u7247", states: ["card"] },
  { id: "question.prev", label: "\u95EE\u9898:\u2190 \u4E0A\u4E00\u9898", group: "\u95EE\u7B54\u5361\u7247", states: ["card"] },
  { id: "question.next", label: "\u95EE\u9898:\u2192 \u4E0B\u4E00\u9898", group: "\u95EE\u7B54\u5361\u7247", states: ["card"] },
  { id: "question.submit", label: "\u95EE\u9898:Enter \u4E0B\u4E00\u9898 / \u672B\u9898\u63D0\u4EA4", group: "\u95EE\u7B54\u5361\u7247", states: ["card"] },
  // 会话级
  // sidebar.toggle 额外放行 editing:⌘/Ctrl+B 在输入框聚焦时同样开关侧栏
  // (带修饰键的组合不干扰文本编辑,与 `editing` 态「只保留带修饰键的全局组合」一致)。
  { id: "sidebar.toggle", label: "\u5F00\u5173\u4FA7\u680F", group: "\u4F1A\u8BDD", states: ["browse", "editing"] },
  { id: "session.prev", label: "\u4E0A\u4E00\u4E2A\u6D3B\u8DC3\u4F1A\u8BDD", group: "\u4F1A\u8BDD", states: ["card", "editing", "browse"] },
  { id: "session.next", label: "\u4E0B\u4E00\u4E2A\u6D3B\u8DC3\u4F1A\u8BDD", group: "\u4F1A\u8BDD", states: ["card", "editing", "browse"] },
  { id: "session.stop", label: "\u505C\u6B62\u5F53\u524D\u4F1A\u8BDD(\u65E0\u5BA1\u6279\u5361\u7247\u65F6;\u542B\u8FD0\u884C\u4E2D\u5B50\u4EE3\u7406)", group: "\u4F1A\u8BDD", states: ["card", "editing", "browse"] },
  { id: "help.toggle", label: "\u5FEB\u6377\u952E\u901F\u67E5\u8868", group: "\u9762\u677F", states: ["card", "editing", "browse"] }
];
var ACTION_BY_ID = new Map(ACTIONS.map((a) => [a.id, a]));
var FIXED_KEYS = {
  "approval.allow": "Enter",
  "approval.reject": "Esc",
  "question.option": "1\u20139",
  "question.prev": "\u2190",
  "question.next": "\u2192",
  "question.submit": "Enter"
};
var DEFAULT_BINDINGS = {
  "sidebar.toggle": "mod+b",
  "session.prev": "mod+alt+arrowup",
  "session.next": "mod+alt+arrowdown",
  // Esc:停止当前会话的整棵运行中交互树(自身 + 直系子代理后代;one-shot 跳过)。
  // 无运行中会话时不消费该键,页面默认 Esc 行为保留(浮层打开时由浮层优先处理)。
  "session.stop": "escape",
  "help.toggle": "mod+/"
};
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
  for (const id of Object.keys(FIXED_KEYS)) delete bindings[id];
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
      const fixed = FIXED_KEYS[action.id];
      const combo = config.bindings[action.id];
      key.textContent = fixed != null ? fixed : combo === void 0 ? "\u672A\u7ED1\u5B9A" : prettyCombo(combo);
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
var inject = ["sessions", "uiSession", "layout", "workspaces", "slots"];
function getService(ctx, serviceName) {
  if (ctx.get === void 0 || ctx.get === null) return void 0;
  const value = ctx.get(serviceName);
  return value === null || value === void 0 ? void 0 : value;
}
function runAction(id, services, overlays) {
  try {
    switch (id) {
      case "question.option":
        return false;
      // 数字键走固定分发逻辑,不作为可执行动作
      case "question.submit":
        return submitQuestion(services);
      case "sidebar.toggle":
        return toggleSidebar(services);
      case "session.prev":
        return openNeighborSession(services, -1);
      case "session.next":
        return openNeighborSession(services, 1);
      case "session.stop":
        stopCurrentSessionTree(services);
        return false;
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
    workspaces: getService(ctx, "workspaces"),
    slots: getService(ctx, "slots")
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
    const cardState = hasPendingCard(services);
    const state = cardState ? "card" : editable ? "editing" : "browse";
    if (state === "card") {
      if (combo === "enter" && answerApproval(services, "allowed-once")) {
        swallow(event);
        return;
      }
      if (combo === "escape" && answerApproval(services, "rejected")) {
        swallow(event);
        return;
      }
    }
    if (state === "card" && !editable) {
      if (/^[1-9]$/.test(combo) && pickQuestionOption(services, Number(combo))) {
        swallow(event);
        return;
      }
      if (combo === "arrowleft" && moveQuestion(services, -1)) {
        swallow(event);
        return;
      }
      if (combo === "arrowright" && moveQuestion(services, 1)) {
        swallow(event);
        return;
      }
      if (combo === "enter" && submitQuestion(services)) {
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
