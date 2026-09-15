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

// src/session-order.ts
function sessionRowVisible(summary, current, archived) {
  return summary.origin !== "subagent" && !archived.has(summary.id) && (!summary.blank || summary.id === current);
}
function sessionVisible(summary, current, archived, keepBlank = true) {
  if (!sessionRowVisible(summary, current, archived)) return false;
  if (summary.blank === true && !keepBlank) return false;
  return true;
}
function compareRecency(a, b, byId) {
  var _a, _b, _c, _d;
  const aUpdated = (_b = (_a = byId[a]) == null ? void 0 : _a.updatedAt) != null ? _b : Number.NEGATIVE_INFINITY;
  const bUpdated = (_d = (_c = byId[b]) == null ? void 0 : _c.updatedAt) != null ? _d : Number.NEGATIVE_INFINITY;
  if (bUpdated !== aUpdated) return bUpdated - aUpdated;
  return a < b ? -1 : 1;
}
function recencyOrder(ids, byId) {
  return ids.map((id, index) => ({ id, index })).sort((a, b) => compareRecency(a.id, b.id, byId) || a.index - b.index).map((entry) => entry.id);
}

// src/sidebar-order.ts
var FLAT_ORDER_KEY = "__flat_session_order__";
var UNGROUPED_KEY = "";
var WORKSPACE_SLOT = "sidebar.workspaces";
function sidebarOrderedSessionIds(snapshot, services) {
  var _a, _b, _c, _d;
  const view = readSidebarViewState(services);
  if (view === void 0) return [];
  const workspaceSnapshot = readWorkspaceSnapshot(services);
  if (workspaceSnapshot === void 0) return [];
  const byId = (_a = snapshot.byId) != null ? _a : {};
  const current = snapshot.current;
  const archived = new Set((_b = workspaceSnapshot.archivedSessionIds) != null ? _b : []);
  const order = view.sessionOrderByAccount;
  const visible = (id) => {
    const summary = byId[id];
    return summary !== void 0 && sessionVisible(summary, current, archived);
  };
  const recency = (a, b) => compareRecency(a, b, byId);
  if (view.groupBy === "flat") {
    const base = ((_c = snapshot.ids) != null ? _c : []).filter(visible);
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
  const stray = ((_d = snapshot.ids) != null ? _d : []).filter((id) => !accounted.has(id) && visible(id));
  const ungrouped = order == null ? void 0 : order[UNGROUPED_KEY];
  if (ungrouped === void 0) {
    stray.sort(recency);
    ids.push(...stray);
  } else {
    ids.push(...orderedUngrouped(stray, ungrouped, byId));
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
function readWorkspaceSnapshot(services) {
  var _a, _b, _c;
  let snapshot;
  try {
    snapshot = (_c = (_b = (_a = services.workspaces) == null ? void 0 : _a.list) == null ? void 0 : _b.getSnapshot) == null ? void 0 : _c.call(_b);
  } catch {
    return void 0;
  }
  if (typeof snapshot !== "object" || snapshot === null || Array.isArray(snapshot)) return void 0;
  return snapshot;
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
function orderedUngrouped(ids, stored, byId) {
  const known = new Set(ids);
  const out = [];
  const included = /* @__PURE__ */ new Set();
  for (const id of stored) {
    if (!known.has(id) || included.has(id)) continue;
    out.push(id);
    included.add(id);
  }
  const rest = ids.filter((id) => !included.has(id));
  rest.sort((a, b) => compareRecency(a, b, byId));
  return [...out, ...rest];
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
function toggleRightSidebar(services) {
  const sidebarRight = services.sidebarRight;
  if (sidebarRight === null || sidebarRight === void 0) return false;
  if (typeof sidebarRight.toggleExpanded !== "function") return false;
  try {
    sidebarRight.toggleExpanded();
    return true;
  } catch {
    return false;
  }
}
function startNewSession(services) {
  const uiWorkspace = services.uiWorkspace;
  if (uiWorkspace === null || uiWorkspace === void 0) return false;
  if (typeof uiWorkspace.startSession !== "function") return false;
  try {
    uiWorkspace.startSession();
    return true;
  } catch {
    return false;
  }
}
function focusComposer(services) {
  const root = composerRoot(services);
  if (root === void 0 || typeof root.focus !== "function") return false;
  try {
    root.focus({ preventScroll: true });
    return true;
  } catch {
    return false;
  }
}
function composerRoot(services) {
  var _a, _b, _c, _d;
  const sessions = services.sessions;
  const conversation = services.conversation;
  if (sessions === null || sessions === void 0) return void 0;
  if (conversation === null || conversation === void 0) return void 0;
  const input = conversation.input;
  if (input === null || input === void 0) return void 0;
  const current = currentSessionId(services);
  if (current === void 0) return void 0;
  let shell;
  let actx;
  try {
    actx = (_b = (_a = sessions.binding) == null ? void 0 : _a.call(sessions, current)) == null ? void 0 : _b.ctx;
  } catch {
    actx = void 0;
  }
  if (actx !== void 0 && typeof input.for === "function") {
    try {
      shell = (_c = input.for(actx)) != null ? _c : void 0;
    } catch {
      shell = void 0;
    }
  }
  if (shell === void 0 && typeof input.shell === "function") {
    try {
      shell = (_d = input.shell(current)) != null ? _d : void 0;
    } catch {
      shell = void 0;
    }
  }
  if (shell === null || shell === void 0) return void 0;
  const editor = shell.editor;
  if (editor === null || editor === void 0) return void 0;
  if (typeof editor.getRootElement !== "function") return void 0;
  const root = editor.getRootElement();
  return root === null || root === void 0 ? void 0 : root;
}
function isComposerTarget(services, target) {
  if (target === null || target === void 0) return false;
  const root = composerRoot(services);
  if (root === void 0) return false;
  if (typeof root.contains !== "function") return false;
  try {
    return root.contains(target);
  } catch {
    return false;
  }
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
  // 左栏为 ⌘/Ctrl+B、右栏为 ⌘/Ctrl+O(`O` = 打开 / 开合面板,Open panel;
  // 也避免把右栏塞进 `mod+alt` 那一档而占用方向键族的语义)。
  // 两者都额外放行 editing:带修饰键的组合不干扰文本编辑,与 `editing` 态
  // 「只保留带修饰键的全局组合」一致。
  { id: "sidebar.toggle", label: "\u5F00\u5173\u5DE6\u4FA7\u680F", group: "\u4F1A\u8BDD", states: ["browse", "editing"] },
  { id: "sidebarRight.toggle", label: "\u5F00\u5173\u53F3\u4FA7\u680F", group: "\u4F1A\u8BDD", states: ["browse", "editing"] },
  // 右栏标签切换 = ⌘/Ctrl+Alt+← / →:走 mod+alt 这一档(与右栏开关、文件浏览器的
  // 单修饰键区分开),因为方向键在 `mod+alt` 里已成体系——←/→ 是右栏内的标签轴,
  // ↑/↓ 是左栏里的会话轴,两者都放行三态:
  // 焦点在输入框(editing)时带修饰键的组合不干扰文本编辑;card 态下 ← / → 虽归
  // 问答卡片,但那是**裸**方向键(固定分发),与带 mod+alt 的组合键不冲突,故无需让路。
  { id: "sidebarRight.tabPrev", label: "\u53F3\u4FA7\u680F:\u4E0A\u4E00\u4E2A\u6807\u7B7E", group: "\u4F1A\u8BDD", states: ["card", "editing", "browse"] },
  { id: "sidebarRight.tabNext", label: "\u53F3\u4FA7\u680F:\u4E0B\u4E00\u4E2A\u6807\u7B7E", group: "\u4F1A\u8BDD", states: ["card", "editing", "browse"] },
  // 定位右栏文件浏览器(⌘/Ctrl+\):与右栏开关(⌘/Ctrl+O)同为「右栏」这一族
  // (单修饰键),同样三态放行——带修饰键的组合既不与卡片的裸 ← / → / 数字键冲突,
  // 也不干扰文本编辑。语义是「定位」而非「开关」:该面板已有文件浏览器页就聚焦它,
  // 没有就在面板末尾创建(上游 openTab 按目标面板去重),再加一步置顶。
  { id: "sidebarRight.files", label: "\u53F3\u4FA7\u680F:\u5B9A\u4F4D\u6587\u4EF6\u6D4F\u89C8\u5668(\u4E0D\u5B58\u5728\u5219\u521B\u5EFA)\u5E76\u7F6E\u9876", group: "\u4F1A\u8BDD", states: ["card", "editing", "browse"] },
  // 定位右栏终端(⌘/Ctrl+L):与文件浏览器定位(⌘/Ctrl+\)同族,同为「定位」语义,
  // 但**不做置顶**(终端是 multiple 页,用户可能开着多个,热键不替用户重排顺序)。
  // 关键差异见 sidebar-tabs.ts 的 revealRightSidebarTerminal:terminal 是
  // `multiple: true` 的页类型,上游每次 openTab 都铸一个带 UUID 的 contentId、
  // 因此不按 (kind, contentId) 去重——直接调 openTab 会每按一次多开一个终端,
  // 所以这里先在会话级 store 的布局里认页(record.kind === 'terminal'),
  // 已有就只聚焦(必要时展开右栏)、并把 DOM 焦点移进 xterm
  // (focusTerminalScreen;上游 focus 只聚焦标签,终端内容的自动聚焦 effect 在
  // 「本来就是当前标签」时不会重跑),没有才调 openTab('terminal') 新建。
  { id: "sidebarRight.terminal", label: "\u53F3\u4FA7\u680F:\u5B9A\u4F4D\u7EC8\u7AEF\u5E76\u805A\u7126(\u4E0D\u5B58\u5728\u5219\u65B0\u5EFA)", group: "\u4F1A\u8BDD", states: ["card", "editing", "browse"] },
  // 新建会话并跳转(⌘/Ctrl+N)= `/new` 命令的同一动作:调公开的
  // uiWorkspace.startSession()(与侧栏「新建会话」按钮、dsh-new-session 处理
  // command/executed('new') 后的调用逐字相同)。三态放行:创建新会话与当前
  // 会话是否有待回应卡片、焦点是否在输入框都无关,带修饰键的组合也既不占用
  // 卡片的裸键(数字 / ← / → / Enter)也不干扰文本编辑。
  { id: "session.new", label: "\u65B0\u5EFA\u4F1A\u8BDD\u5E76\u8DF3\u8F6C(\u7B49\u540C /new)", group: "\u4F1A\u8BDD", states: ["card", "editing", "browse"] },
  // 聚焦输入框放行 browse / editing,但 **editing 态另有一道元素级门闸**:
  // 「焦点在可编辑元素里」并不等于「焦点在 composer 里」——右侧栏终端(xterm 的
  // 隐藏 helper textarea)与 Monaco(inputarea textarea)都把 DOM 焦点放在一个真实的
  // <textarea> 上,焦点在那里时用户按下 ⌘/Ctrl+J 的意图恰恰是「跳回对话输入框」
  // (J = Jump,焦点跳转)。因此 editing 态只在焦点**不在** composer 自己的编辑区内时
  // 才执行聚焦(见 client.ts 里基于 isComposerTarget 的门闸,复用 ⇧Tab 那道门闸的
  // 同一取元素链路);焦点已在 composer 内时不再重复聚焦,但组合键**仍被吞掉**——
  // 旧键位 I 在同一位放行是为了保住 contenteditable 的「斜体」默认键,J 没有等价的
  // 默认行为,放行只会让 Win/Linux 浏览器的 Ctrl+J(下载页)跑出来。
  // card 态仍不放行:此时归卡片自己的输入框。
  { id: "composer.focus", label: "\u805A\u7126\u8F93\u5165\u6846", group: "\u4F1A\u8BDD", states: ["browse", "editing"] },
  { id: "session.prev", label: "\u4E0A\u4E00\u4E2A\u6D3B\u8DC3\u4F1A\u8BDD", group: "\u4F1A\u8BDD", states: ["card", "editing", "browse"] },
  { id: "session.next", label: "\u4E0B\u4E00\u4E2A\u6D3B\u8DC3\u4F1A\u8BDD", group: "\u4F1A\u8BDD", states: ["card", "editing", "browse"] },
  // 工作区切换浮窗(⌘/Ctrl+K):单修饰键这一档(`K` = Work-space),三态放行——
  // 带修饰键的组合既不与卡片的裸 ← / → / 数字键冲突,也不干扰文本编辑。
  // 浮窗打开后 ↑/↓ 只在列表里移动高亮、Enter 才调 uiWorkspace.openWorkspace
  // (连接工作区),故这一个动作 id 同时覆盖「开关浮窗」与「浮窗内导航」。
  { id: "workspace.pick", label: "\u5207\u6362\u5DE5\u4F5C\u533A(\u6D6E\u7A97:\u2191\u2193 \u9009\u62E9\u3001Enter \u5207\u6362)", group: "\u4F1A\u8BDD", states: ["card", "editing", "browse"] },
  // 模型浮窗(⌘/Ctrl+M):同属单修饰键这一档(`M` = Model),三态放行。
  // 列表 / 切换都走**上游同一个** per-session 模型目录(ctx.modelDirectories 的
  // directoryFor,与 `/model` 弹层、composer 模型座位同一份状态),
  // 故浮窗里的切换与两个上游入口完全同步(见 model-picker.ts)。
  { id: "model.pick", label: "\u5207\u6362\u6A21\u578B(\u6D6E\u7A97:\u2191\u2193 \u9009\u62E9\u3001Enter \u5207\u6362)", group: "\u4F1A\u8BDD", states: ["card", "editing", "browse"] },
  // 近期对话浮窗(⌘/Ctrl+I):单修饰键这一档(`I` = Input 会话),三态放行——
  // 带修饰键的组合既不与卡片的裸 ← / → / 数字键冲突,也不干扰文本编辑。
  // 浮窗内 ↑/↓ 在整份列表上跨工作区分组移动高亮、Enter 才打开会话
  // (`uiWorkspace.openSession`,与侧栏点会话行同一条公开服务调用;缺失时回退
  // 同一份服务实例上的 `sessions.open`),见 recent-sessions.ts。
  { id: "session.recent", label: "\u8FD1\u671F\u5BF9\u8BDD(\u6D6E\u7A97:\u6309\u5DE5\u4F5C\u533A\u5206\u7EC4\u3001\u2191\u2193 \u9009\u62E9\u3001Enter \u6253\u5F00)", group: "\u4F1A\u8BDD", states: ["card", "editing", "browse"] },
  // 思考强度循环(⇧Tab)只放行 browse / editing:card 态下 ⇧Tab 归卡片自己
  // (问答卡片的输入框仍需要正向/反向移动焦点)。editing 态另有一道**元素级门闸**
  // (见 client.ts 的 isComposerTarget):只有焦点在 composer 自己的编辑区内才接管,
  // 焦点在设置面板输入框 / Monaco 隐藏 textarea 等其它可编辑元素时一律放行——
  // ⇧Tab 是文本编辑的核心键(反向移动焦点 / 反向缩进),不能全局抢。
  { id: "model.effortNext", label: "\u5FAA\u73AF\u5207\u6362\u601D\u8003\u5F3A\u5EA6(\u21E7Tab;\u4EC5\u8F93\u5165\u6846/\u6D4F\u89C8\u6001)", group: "\u4F1A\u8BDD", states: ["browse", "editing"] },
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
  // 侧栏开关按「主面板 = 主键、次面板 = 邻键」分配:
  // - 左栏 = ⌘/Ctrl+B:与 VS Code / Slack / 各类编辑器的侧栏开关一致,也是上游
  //   `layout.toggleSidebar()` 的本名(sidebar / sidebarCol 不带限定词就指左栏);
  // - 右栏 = ⌘/Ctrl+O:同属单修饰键这一档,`O` 取「Open(打开/开合右栏面板)」联想
  //   (VS Code 亦用 ⌘0 而非 ⌘N 表示次面板);与左栏的 `B` 同档不同键。
  "sidebar.toggle": "mod+b",
  "sidebarRight.toggle": "mod+o",
  // 右栏标签切换 = ⌘/Ctrl+Alt+← / →:方向键表达「上一个 / 下一个」;与
  // ⌘/Ctrl+Alt+↑/↓ 的活跃会话跳转同族但不同轴(会话轴在左栏、标签轴在右栏)。
  // 边缘处**循环**,只有单个标签时不吞键(见 sidebar-tabs.ts)。
  "sidebarRight.tabPrev": "mod+alt+arrowleft",
  "sidebarRight.tabNext": "mod+alt+arrowright",
  // 定位右栏文件浏览器并置顶 = ⌘/Ctrl+\:反斜杠在主键区右端,与右栏开关
  // (⌘/Ctrl+O)同为「右栏」这一族。键名走 `comboOf` 的 e.code 归一化
  // (`Backslash` → `\`),与布局产出什么字符无关;JIS 等把 `\` 放在别的物理键上的
  // 键盘由 e.key 回退兜住。本键不再带 alt,故 Win/Linux 上「Ctrl+Alt 即 AltGr」
  // 的老问题在这里不存在(AltGr 层单独打出的 `\` 只会命中 `alt+\\`,不是本组合)。
  "sidebarRight.files": "mod+\\",
  // 定位右栏终端 = ⌘/Ctrl+L:与右栏开关(⌘/Ctrl+O)、文件浏览器定位(⌘/Ctrl+\)
  // 同属「单修饰键」这一档。`mod` 在 comboOf 里同时吸收 ctrlKey 与 metaKey,
  // 所以 macOS 上 ⌃L 与 ⌘L 都能触发,Win/Linux 就是 Ctrl+L。
  // 语义与文件浏览器同形(「定位」而非「开关」):该会话已有终端页就聚焦它并把
  // DOM 焦点移进 xterm(focusTerminalScreen),没有才新建;重复按不会堆积终端
  // (terminal 是 multiple 页,上游的 openTab 本身不去重,认页由 sidebar-tabs.ts
  // 自己完成)。
  // 注意 Ctrl/Cmd+L 是浏览器「聚焦地址栏」的保留键(见 README「已知限制」)。
  "sidebarRight.terminal": "mod+l",
  // 新建会话并跳转 = ⌘/Ctrl+N:跨应用肌肉记忆(浏览器 / 编辑器 / 终端的新建),
  // 语义 = `/new` 命令(公开的 uiWorkspace.startSession())。属单修饰键这一档,
  // 与 ⌘/Ctrl+K(工作区)、⌘/Ctrl+M(模型)并列。`mod` 在 comboOf 里同时吸收
  // ctrlKey 与 metaKey,故 macOS 上 ⌃N 与 ⌘N 都会触发;注意浏览器把
  // ⌘/Ctrl+N 当作「新建窗口」保留键(见 README「已知限制」)。
  "session.new": "mod+n",
  // 聚焦输入框(焦点跳转)= ⌘/Ctrl+J:`mod` 在 comboOf 里同时吸收 ctrlKey 与 metaKey,
  // 所以 macOS 上 ⌃J 与 ⌘J 都能触发,Win/Linux 就是 Ctrl+J。该组合落在「单修饰键」
  // 这一档,与 ⌘/Ctrl+B(左栏)、⌘/Ctrl+O(右栏)同族;语义上 J = Jump(焦点跳转),
  // 取代旧键位 ⌘/Ctrl+I(I = Input):好处是不再与 contenteditable 的「斜体」默认键
  // 同键,代价是终端里的 `⌃J`(= 0x0A,LF;readline 的 newline,与 Enter 同义)不再
  // 送给 PTY,要换行请按 Enter。注意 Win/Linux 的浏览器把 Ctrl+J 绑成「下载」页
  // (浏览器保留键),详见 README「已知限制」。
  "composer.focus": "mod+j",
  "session.prev": "mod+alt+arrowup",
  "session.next": "mod+alt+arrowdown",
  // 工作区切换浮窗 = ⌘/Ctrl+K:属「单修饰键」这一档,`K` 取「工作区(Work-space)」
  // 联想;`mod` 在 comboOf 里同时吸收 ctrlKey 与 metaKey,故 macOS 上按 ⌃K 或 ⌘K
  // 均可(Win/Linux 就是 Ctrl+K)。
  // 打开后 ↑/↓ 移动高亮、Enter 切换、Esc 关闭(见 overlay.ts)。
  // 注意 Ctrl+K 是浏览器保留键(地址栏搜索),详见 README「已知限制」。
  "workspace.pick": "mod+k",
  // 模型浮窗 = ⌘/Ctrl+M:同为「单修饰键」这一档,`M` 取「模型(Model)」联想,
  // 与 ⌘/Ctrl+K(工作区)并列。`mod` 在 comboOf 里同时吸收 ctrlKey 与 metaKey,
  // 故 macOS 上按 ⌃M 或 ⌘M 均可(Win/Linux 就是 Ctrl+M)。浮窗内 ↑/↓ 选择、
  // Enter 切换、⇧Tab 调强度、Esc 关闭。
  "model.pick": "mod+m",
  // 近期对话浮窗 = ⌘/Ctrl+I:属「单修饰键」这一档,`I` 取「Input / 会话」联想
  // (与 ⌘/Ctrl+K 工作区、⌘/Ctrl+M 模型并列)。`mod` 在 comboOf 里同时吸收
  // ctrlKey 与 metaKey,故 macOS 上按 ⌃I 或 ⌘I 均可(Win/Linux 就是 Ctrl+I)。
  // 浮窗内:↑/↓ 在整份列表上**跨工作区分组**移动高亮(不打开会话——免得连按就连开
  // 一串)、Enter 才打开高亮会话(`uiWorkspace.openSession`,与侧栏点会话行同一条
  // 服务调用;缺失时回退 `sessions.open`)、
  // Esc 或同组合键关闭、⌘/ 换成速查表。注意 `Ctrl+I` 在 contenteditable 里是
  // 浏览器默认的「斜体」键,这里会被 preventDefault 抢走(见 README「已知限制」);
  // 焦点跳转(⌘/Ctrl+J)是另一回事,不受影响。
  "session.recent": "mod+i",
  // 思考强度循环 = ⇧Tab:上游 composer 座位把强度档收在「模型菜单 → Effort」二级
  // 面板里(没有默认键位),这里给一个免鼠标的循环键。Shift 单独作修饰键不与任何
  // 已有组合冲突(bindings 里没有其它 shift+ 项);`comboOf` 走 e.code 归一化
  // (`Tab` → `tab`),不随布局漂移。no-op(模型无强度档 / 只有一档 / 目录不可用)时
  // **不吞键**,页面默认的 ⇧Tab 行为照常;editing 态另需焦点落在 composer 内(见 client.ts)。
  "model.effortNext": "shift+tab",
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

// src/model-picker.ts
var PROVIDER_DEFAULT = "Default";
var NO_SESSION_NOTICE = "\u5F53\u524D\u6CA1\u6709\u53EF\u5207\u6362\u6A21\u578B\u7684\u4F1A\u8BDD";
function subagentAddressOf(services, sessionId) {
  const sessions = services.sessions;
  const fn = sessions == null ? void 0 : sessions.subagentAddress;
  if (typeof fn !== "function") return void 0;
  try {
    return fn.call(sessions, sessionId);
  } catch {
    return void 0;
  }
}
function directoryOf(services) {
  const resolver = services.modelDirectories;
  if (resolver === null || resolver === void 0) return void 0;
  if (typeof resolver.directoryFor !== "function") return void 0;
  const sessionId = currentSessionId(services);
  if (sessionId === void 0) return void 0;
  if (subagentAddressOf(services, sessionId) !== void 0) return void 0;
  try {
    const directory = resolver.directoryFor(sessionId);
    return directory === null || directory === void 0 ? void 0 : directory;
  } catch {
    return void 0;
  }
}
function stateOf(directory) {
  var _a, _b;
  try {
    const state = (_b = (_a = directory.store) == null ? void 0 : _a.getSnapshot) == null ? void 0 : _b.call(_a);
    return state === null || state === void 0 ? {} : state;
  } catch {
    return {};
  }
}
function modelOf(state, provider, model) {
  var _a, _b;
  for (const group of (_a = state.groups) != null ? _a : []) {
    if (group === null || group === void 0 || group.id !== provider) continue;
    for (const item of (_b = group.models) != null ? _b : []) {
      if (item !== null && item !== void 0 && item.id === model) return item;
    }
  }
  return void 0;
}
function isSameModel(selection, provider, model) {
  return selection !== null && selection !== void 0 && selection.provider === provider && selection.model === model;
}
function rowSelectionOf(group, model, current) {
  var _a, _b, _c;
  const reasoningEffort = isSameModel(current, group.id, model.id) ? (_b = current == null ? void 0 : current.reasoningEffort) != null ? _b : (_a = model.reasoning) == null ? void 0 : _a.defaultEffort : (_c = model.reasoning) == null ? void 0 : _c.defaultEffort;
  return {
    provider: group.id,
    model: model.id,
    ...reasoningEffort === void 0 ? {} : { reasoningEffort }
  };
}
function effortLabelOf(reasoning, effort) {
  var _a;
  if (effort === void 0 || effort === "") return PROVIDER_DEFAULT;
  for (const level of (_a = reasoning.efforts) != null ? _a : []) {
    if (level === null || level === void 0 || level.id !== effort) continue;
    return typeof level.name === "string" && level.name !== "" ? level.name : level.id;
  }
  return effort;
}
function currentViewOf(state) {
  var _a;
  const current = state.current;
  if (current === null || current === void 0) return null;
  const model = modelOf(state, current.provider, current.model);
  const name2 = model == null ? void 0 : model.name;
  const label = typeof name2 === "string" && name2 !== "" ? name2 : `${current.provider}/${current.model}`;
  const reasoning = model == null ? void 0 : model.reasoning;
  if (reasoning === void 0) return { label, effort: "" };
  return { label, effort: effortLabelOf(reasoning, (_a = current.reasoningEffort) != null ? _a : reasoning.defaultEffort) };
}
function defaultNotice(state) {
  if (state.status === "error" && typeof state.error === "string" && state.error !== "") {
    return `\u6A21\u578B\u76EE\u5F55\u52A0\u8F7D\u5931\u8D25\uFF1A${state.error}`;
  }
  if (state.status === void 0 || state.status === "idle" || state.status === "loading") {
    return "\u6B63\u5728\u52A0\u8F7D\u6A21\u578B\u76EE\u5F55\u2026";
  }
  return "\u5F53\u524D\u6CA1\u6709\u53EF\u7528\u7684\u6A21\u578B";
}
function viewOf(state, notice = "", footnote = "") {
  var _a, _b, _c, _d;
  const rows = [];
  for (const group of (_a = state.groups) != null ? _a : []) {
    if (group === null || group === void 0) continue;
    const provider = typeof group.name === "string" && group.name !== "" ? group.name : group.id;
    for (const model of (_b = group.models) != null ? _b : []) {
      if (model === null || model === void 0) continue;
      rows.push({
        selection: rowSelectionOf(group, model, state.current),
        label: typeof model.name === "string" && model.name !== "" ? model.name : model.id,
        detail: provider,
        provider,
        current: isSameModel(state.current, group.id, model.id)
      });
    }
  }
  const failed = (_d = (_c = state.failures) == null ? void 0 : _c.length) != null ? _d : 0;
  const notes = [footnote];
  if (failed > 0) notes.push(`${String(failed)} \u4E2A\u63D0\u4F9B\u65B9\u7684\u76EE\u5F55\u52A0\u8F7D\u5931\u8D25`);
  return {
    current: currentViewOf(state),
    rows,
    notice: rows.length > 0 ? "" : notice !== "" ? notice : defaultNotice(state),
    footnote: notes.filter((text) => text !== "").join(" \xB7 ")
  };
}
async function modelPickerView(services) {
  const directory = directoryOf(services);
  if (directory === void 0) return viewOf({}, NO_SESSION_NOTICE);
  const state = stateOf(directory);
  if (typeof directory.load !== "function") return viewOf(state);
  try {
    const loaded = await directory.load();
    return viewOf(loaded === null || loaded === void 0 ? state : loaded);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return viewOf(state, "", `\u6A21\u578B\u76EE\u5F55\u52A0\u8F7D\u5931\u8D25\uFF1A${message}`);
  }
}
function selectModel(services, selection) {
  const directory = directoryOf(services);
  if (directory === void 0) return false;
  return fireSelect(directory, selection);
}
function fireSelect(directory, selection) {
  if (typeof directory.select !== "function") return false;
  if (typeof selection.provider !== "string" || selection.provider === "") return false;
  if (typeof selection.model !== "string" || selection.model === "") return false;
  try {
    void Promise.resolve(directory.select(selection)).catch(() => {
    });
    return true;
  } catch {
    return false;
  }
}
function cycleEffort(services) {
  var _a, _b, _c;
  const miss = { ok: false, effortLabel: "" };
  const directory = directoryOf(services);
  if (directory === void 0) return miss;
  const state = stateOf(directory);
  const current = state.current;
  if (current === null || current === void 0) return miss;
  const reasoning = (_a = modelOf(state, current.provider, current.model)) == null ? void 0 : _a.reasoning;
  if (reasoning === void 0) return miss;
  const choices = [
    ...reasoning.defaultEffort === void 0 ? [void 0] : [],
    ...((_b = reasoning.efforts) != null ? _b : []).map((level) => level.id)
  ];
  if (choices.length <= 1) return miss;
  const effective = (_c = current.reasoningEffort) != null ? _c : reasoning.defaultEffort;
  const at = choices.indexOf(effective);
  const next = choices[(at + 1) % choices.length];
  const selection = {
    provider: current.provider,
    model: current.model,
    ...next === void 0 ? {} : { reasoningEffort: next }
  };
  if (!fireSelect(directory, selection)) return miss;
  return { ok: true, effortLabel: effortLabelOf(reasoning, next) };
}

// src/overlay.ts
var STYLE_ID = "dsh-kbd-hotkeys/style";
var STYLE = [
  ".dsh-kbd-backdrop{position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.35);display:flex;align-items:flex-start;justify-content:center;padding-top:12vh;font-family:var(--dsw-font-family,system-ui,-apple-system,sans-serif)}",
  ".dsh-kbd-panel{width:min(560px,calc(100vw - 48px));max-height:64vh;background:var(--dsw-specific-menu,#fff);color:var(--dsw-alias-label-primary,#111);box-shadow:var(--dsw-elevation-prominent,0 12px 40px rgba(0,0,0,.25));border-radius:14px;display:flex;flex-direction:column;overflow:hidden}",
  // 近期对话浮窗最多 10 行,面板高度按内容给足:高度是内容尺寸(不写死),这里只把
  // 上限从 64vh 抬到「视口可用高度」(backdrop 顶部留白 12vh,底部再留 24px)——
  // 于是 10 行 + 组标题 + 页眉/页脚在常见窗口高度下能整屏看全、列表不滚动,
  // 只有内容真的超过视口时列表才内部滚动。必须排在 `.dsh-kbd-panel` 之后
  // (同特异性,后声明的生效)。其余三个浮窗(速查表/工作区/模型)仍用 64vh。
  ".dsh-kbd-panel--recent{max-height:calc(88vh - 24px)}",
  ".dsh-kbd-help{padding:14px 18px;overflow-y:auto}",
  ".dsh-kbd-help h3{margin:14px 0 6px;font-size:12px;font-weight:600;color:var(--dsw-alias-label-tertiary,#999)}",
  ".dsh-kbd-help h3:first-child{margin-top:0}",
  ".dsh-kbd-helpRow{display:flex;align-items:center;gap:12px;padding:5px 0;font-size:13px}",
  ".dsh-kbd-helpRow .dsh-kbd-itemLabel{flex:1}",
  ".dsh-kbd-help kbd{font-family:var(--ds-font-family-code,ui-monospace,monospace);font-size:11px;line-height:18px;padding:1px 6px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12));border-bottom-width:2px;border-radius:6px;background:var(--dsw-alias-bg-base,transparent)}",
  ".dsh-kbd-panelHeading{padding:14px 18px 8px;font-size:12px;font-weight:600;color:var(--dsw-alias-label-tertiary,#999)}",
  ".dsh-kbd-list{display:flex;flex-direction:column;gap:2px;padding:0 8px;overflow-y:auto}",
  ".dsh-kbd-row{display:flex;align-items:center;gap:10px;padding:7px 10px;border-radius:8px;font-size:13px;line-height:18px}",
  ".dsh-kbd-row.isActive{background:var(--dsw-specific-sidebar-nav-item-active,var(--dsw-alias-interactive-bg-active,rgba(127,127,127,.18)))}",
  // 分组列表(近期对话浮窗)的行:与工作区 / 模型浮窗的行同形,只多一层缩进,
  // 让「组标题 → 组内会话」的层级一眼可辨。刻意用不同类名,便于诊断脚本区分
  // 两个浮窗各自渲染的行。
  ".dsh-kbd-groupRow{display:flex;align-items:center;gap:10px;padding:6px 10px 6px 20px;border-radius:8px;font-size:13px;line-height:18px}",
  ".dsh-kbd-groupRow.isActive{background:var(--dsw-specific-sidebar-nav-item-active,var(--dsw-alias-interactive-bg-active,rgba(127,127,127,.18)))}",
  ".dsh-kbd-rowMain{display:flex;flex-direction:column;gap:1px;flex:1;min-width:0}",
  ".dsh-kbd-rowLabel,.dsh-kbd-rowDetail{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
  ".dsh-kbd-rowDetail{font-size:11px;color:var(--dsw-alias-label-tertiary,#999)}",
  ".dsh-kbd-rowBadge{flex:none;font-size:11px;color:var(--dsw-alias-brand-primary,#4a6cf7)}",
  ".dsh-kbd-rowCount{flex:none;font-size:11px;color:var(--dsw-alias-label-tertiary,#999)}",
  ".dsh-kbd-empty{padding:4px 18px 16px;font-size:13px;color:var(--dsw-alias-label-tertiary,#999)}",
  ".dsh-kbd-hint{padding:10px 18px 14px;font-size:11px;color:var(--dsw-alias-label-tertiary,#999)}",
  ".dsh-kbd-current{padding:0 18px 6px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#999)}",
  ".dsh-kbd-group{padding:8px 10px 4px;font-size:11px;font-weight:600;color:var(--dsw-alias-label-tertiary,#999)}"
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
  let kind = null;
  let rowEls = [];
  let rowTargets = [];
  let cursor = 0;
  let modelList = null;
  let modelCurrentEl = null;
  let modelLabel = "";
  let modelEffort = "";
  let modelSeq = 0;
  function isOpen() {
    return kind !== null;
  }
  function contains(target) {
    return root !== null && target !== null && root.contains(target);
  }
  function close() {
    if (root !== null) root.remove();
    root = null;
    kind = null;
    rowEls = [];
    rowTargets = [];
    cursor = 0;
    modelList = null;
    modelCurrentEl = null;
    modelLabel = "";
    modelEffort = "";
    modelSeq += 1;
  }
  function mount(next) {
    close();
    ensureStyle();
    const backdrop = document.createElement("div");
    backdrop.className = "dsh-kbd-backdrop";
    const panel = document.createElement("div");
    panel.className = next === "recent" ? "dsh-kbd-panel dsh-kbd-panel--recent" : "dsh-kbd-panel";
    if (next === "help") panel.appendChild(renderHelp());
    else if (next === "workspace") renderWorkspacePicker(panel);
    else if (next === "recent") renderRecentPicker(panel);
    else renderModelPicker(panel);
    backdrop.appendChild(panel);
    backdrop.addEventListener("mousedown", (event) => {
      if (event.target === backdrop) close();
    });
    document.body.appendChild(backdrop);
    root = backdrop;
    kind = next;
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
  function renderWorkspacePicker(panel) {
    const heading = document.createElement("div");
    heading.className = "dsh-kbd-panelHeading";
    heading.textContent = "\u5207\u6362\u5DE5\u4F5C\u533A";
    panel.appendChild(heading);
    const rows = deps.listWorkspaces();
    if (rows.length === 0) {
      const empty = document.createElement("div");
      empty.className = "dsh-kbd-empty";
      empty.textContent = "\u5F53\u524D\u6CA1\u6709\u5DF2\u767B\u8BB0\u7684\u5DE5\u4F5C\u533A";
      panel.appendChild(empty);
      panel.appendChild(renderHint("\u2191 \u2193 \u9009\u62E9 \xB7 Enter \u5207\u6362 \xB7 Esc \u5173\u95ED"));
      return;
    }
    const list = document.createElement("div");
    list.className = "dsh-kbd-list";
    const els = [];
    const targets = [];
    rows.forEach((row, index) => {
      const el = document.createElement("div");
      el.className = "dsh-kbd-row";
      el.appendChild(renderRowMain(row));
      if (row.current) {
        const badge = document.createElement("span");
        badge.className = "dsh-kbd-rowBadge";
        badge.textContent = "\u5F53\u524D";
        el.appendChild(badge);
      }
      const count = document.createElement("span");
      count.className = "dsh-kbd-rowCount";
      count.textContent = `${String(row.sessionCount)} \u4E2A\u4F1A\u8BDD`;
      el.appendChild(count);
      bindRow(el, index);
      list.appendChild(el);
      els.push(el);
      targets.push({ workspaceId: row.workspaceId });
    });
    panel.appendChild(list);
    panel.appendChild(renderHint("\u2191 \u2193 \u9009\u62E9 \xB7 Enter \u5207\u6362 \xB7 Esc \u5173\u95ED"));
    rowEls = els;
    rowTargets = targets;
    setCursor(Math.max(0, rows.findIndex((row) => row.current)));
  }
  function renderRecentPicker(panel) {
    const heading = document.createElement("div");
    heading.className = "dsh-kbd-panelHeading";
    heading.textContent = "\u8FD1\u671F\u5BF9\u8BDD";
    panel.appendChild(heading);
    const view = deps.listRecentSessions();
    if (view.rows.length === 0) {
      const empty = document.createElement("div");
      empty.className = "dsh-kbd-empty";
      empty.textContent = view.notice !== "" ? view.notice : "\u5F53\u524D\u6CA1\u6709\u53EF\u6253\u5F00\u7684\u5BF9\u8BDD";
      panel.appendChild(empty);
      panel.appendChild(renderHint("\u2191 \u2193 \u9009\u62E9 \xB7 Enter \u6253\u5F00 \xB7 Esc \u5173\u95ED"));
      return;
    }
    const list = document.createElement("div");
    list.className = "dsh-kbd-list";
    const els = [];
    const targets = [];
    for (const group of view.groups) {
      if (group.label !== "") {
        const groupHeading = document.createElement("div");
        groupHeading.className = "dsh-kbd-group";
        groupHeading.textContent = group.label;
        list.appendChild(groupHeading);
      }
      for (const row of group.rows) {
        const el = document.createElement("div");
        el.className = "dsh-kbd-groupRow";
        el.appendChild(renderRowMain(row));
        el.appendChild(renderStatusBadges(row));
        if (row.current) el.appendChild(renderBadge("\u5F53\u524D"));
        bindRow(el, els.length);
        list.appendChild(el);
        els.push(el);
        targets.push({ sessionId: row.sessionId });
      }
    }
    panel.appendChild(list);
    panel.appendChild(renderHint("\u2191 \u2193 \u9009\u62E9 \xB7 Enter \u6253\u5F00 \xB7 Esc \u5173\u95ED"));
    rowEls = els;
    rowTargets = targets;
    setCursor(view.initialIndex);
  }
  function renderRowMain(row) {
    const main = document.createElement("div");
    main.className = "dsh-kbd-rowMain";
    const label = document.createElement("div");
    label.className = "dsh-kbd-rowLabel";
    label.textContent = row.label;
    main.appendChild(label);
    if (row.detail !== "") {
      const detail = document.createElement("div");
      detail.className = "dsh-kbd-rowDetail";
      detail.textContent = row.detail;
      main.appendChild(detail);
    }
    return main;
  }
  function renderBadge(text) {
    const badge = document.createElement("span");
    badge.className = "dsh-kbd-rowBadge";
    badge.textContent = text;
    return badge;
  }
  function renderStatusBadges(row) {
    const badge = document.createElement("span");
    badge.className = "dsh-kbd-rowBadge";
    badge.textContent = row.pending ? "\u5F85\u56DE\u5E94" : row.running ? "\u8FD0\u884C\u4E2D" : row.completed ? "\u5B8C\u6210" : "";
    return badge;
  }
  function bindRow(el, index) {
    el.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      choose(index);
    });
    el.addEventListener("mouseenter", () => {
      setCursor(index);
    });
  }
  function renderHint(text) {
    const hint = document.createElement("div");
    hint.className = "dsh-kbd-hint";
    hint.textContent = text;
    return hint;
  }
  function renderModelPicker(panel) {
    const heading = document.createElement("div");
    heading.className = "dsh-kbd-panelHeading";
    heading.textContent = "\u9009\u62E9\u6A21\u578B";
    panel.appendChild(heading);
    const current = document.createElement("div");
    current.className = "dsh-kbd-current";
    panel.appendChild(current);
    modelCurrentEl = current;
    const list = document.createElement("div");
    list.className = "dsh-kbd-list";
    const loading = document.createElement("div");
    loading.className = "dsh-kbd-empty";
    loading.textContent = "\u6B63\u5728\u52A0\u8F7D\u6A21\u578B\u76EE\u5F55\u2026";
    list.appendChild(loading);
    panel.appendChild(list);
    modelList = list;
    const hint = document.createElement("div");
    hint.className = "dsh-kbd-hint";
    hint.textContent = "\u2191 \u2193 \u9009\u62E9 \xB7 Enter \u5207\u6362 \xB7 \u21E7Tab \u8C03\u6574\u601D\u8003\u5F3A\u5EA6 \xB7 Esc \u5173\u95ED";
    panel.appendChild(hint);
    const seq = ++modelSeq;
    const stale = () => kind !== "model" || seq !== modelSeq;
    void Promise.resolve().then(() => deps.listModels()).then(
      (view) => {
        if (!stale()) paintModelView(view);
      },
      () => {
        if (!stale()) paintModelView({ current: null, rows: [], notice: "\u6A21\u578B\u76EE\u5F55\u4E0D\u53EF\u7528", footnote: "" });
      }
    );
  }
  function paintModelView(view) {
    var _a, _b, _c, _d;
    const list = modelList;
    if (list === null) return;
    modelLabel = (_b = (_a = view.current) == null ? void 0 : _a.label) != null ? _b : "";
    modelEffort = (_d = (_c = view.current) == null ? void 0 : _c.effort) != null ? _d : "";
    paintModelCurrent();
    for (const child of [...list.children]) child.remove();
    const rows = view.rows;
    if (rows.length === 0) {
      const empty = document.createElement("div");
      empty.className = "dsh-kbd-empty";
      empty.textContent = view.notice !== "" ? view.notice : "\u5F53\u524D\u6CA1\u6709\u53EF\u7528\u7684\u6A21\u578B";
      list.appendChild(empty);
      if (view.footnote !== "") list.appendChild(renderFootnote(view.footnote));
      rowEls = [];
      rowTargets = [];
      return;
    }
    const els = [];
    const targets = [];
    let lastProvider = "";
    rows.forEach((row, index) => {
      if (row.provider !== lastProvider) {
        lastProvider = row.provider;
        list.appendChild(renderGroupHeading(row));
      }
      const el = document.createElement("div");
      el.className = "dsh-kbd-row";
      el.appendChild(renderRowMain(row));
      if (row.current) el.appendChild(renderBadge("\u5F53\u524D"));
      bindRow(el, index);
      list.appendChild(el);
      els.push(el);
      targets.push({ selection: { ...row.selection } });
    });
    if (view.footnote !== "") list.appendChild(renderFootnote(view.footnote));
    rowEls = els;
    rowTargets = targets;
    setCursor(Math.max(0, rows.findIndex((row) => row.current)));
  }
  function renderFootnote(text) {
    const footnote = document.createElement("div");
    footnote.className = "dsh-kbd-hint";
    footnote.textContent = text;
    return footnote;
  }
  function renderGroupHeading(row) {
    const heading = document.createElement("div");
    heading.className = "dsh-kbd-group";
    heading.textContent = row.provider;
    return heading;
  }
  function paintModelCurrent() {
    if (modelCurrentEl === null) return;
    if (modelLabel === "") {
      modelCurrentEl.textContent = "";
      return;
    }
    modelCurrentEl.textContent = modelEffort === "" ? `\u5F53\u524D\uFF1A${modelLabel}` : `\u5F53\u524D\uFF1A${modelLabel} \xB7 ${modelEffort}`;
  }
  function setCursor(index) {
    if (rowEls.length === 0) return;
    const next = Math.max(0, Math.min(index, rowEls.length - 1));
    cursor = next;
    rowEls.forEach((el, i) => {
      var _a;
      const base = (_a = el.className.split(" ").filter((name2) => name2 !== "isActive")[0]) != null ? _a : "dsh-kbd-row";
      el.className = i === next ? `${base} isActive` : base;
    });
    const active = rowEls[next];
    if (active !== void 0 && typeof active.scrollIntoView === "function") {
      active.scrollIntoView({ block: "nearest" });
    }
  }
  function choose(index) {
    const target = rowTargets[index];
    if (target === void 0) return;
    if (kind === "model") {
      const selection = target.selection;
      if (selection === void 0) return;
      const next = { ...selection };
      close();
      deps.selectModel(next);
      return;
    }
    if (kind === "recent") {
      const sessionId = target.sessionId;
      if (sessionId === void 0) return;
      close();
      deps.selectRecentSession(sessionId);
      return;
    }
    const workspaceId = target.workspaceId;
    if (workspaceId === void 0) return;
    close();
    deps.selectWorkspace(workspaceId);
  }
  function bindingOf(actionId) {
    return deps.getConfig().bindings[actionId];
  }
  function toggleHelp() {
    if (kind === "help") close();
    else mount("help");
  }
  function toggleWorkspacePicker() {
    if (kind === "workspace") close();
    else mount("workspace");
  }
  function toggleRecentPicker() {
    if (kind === "recent") close();
    else mount("recent");
  }
  function toggleModelPicker() {
    if (kind === "model") close();
    else mount("model");
  }
  function handleKey(event) {
    if (kind === null) return false;
    if (event.key === "Escape") {
      close();
      return true;
    }
    const combo = comboOf(event);
    if (kind === "workspace" || kind === "recent") {
      if (combo === "arrowup") {
        setCursor(cursor - 1);
        return true;
      }
      if (combo === "arrowdown") {
        setCursor(cursor + 1);
        return true;
      }
      if (combo === "enter" && rowTargets.length > 0) {
        choose(cursor);
        return true;
      }
    }
    if (kind === "model") {
      if (combo === "arrowup") {
        setCursor(cursor - 1);
        return true;
      }
      if (combo === "arrowdown") {
        setCursor(cursor + 1);
        return true;
      }
      if (combo === "enter" && rowTargets.length > 0) {
        choose(cursor);
        return true;
      }
      if (combo === bindingOf("model.effortNext")) {
        const result = deps.cycleEffort();
        if (result.ok) {
          modelEffort = result.effortLabel;
          paintModelCurrent();
        }
        return true;
      }
    }
    if (combo === bindingOf("session.recent")) {
      toggleRecentPicker();
      return true;
    }
    if (combo === bindingOf("model.pick")) {
      toggleModelPicker();
      return true;
    }
    if (combo === bindingOf("workspace.pick")) {
      toggleWorkspacePicker();
      return true;
    }
    if (combo === bindingOf("help.toggle")) {
      toggleHelp();
      return true;
    }
    return false;
  }
  function destroy() {
    var _a;
    close();
    (_a = document.getElementById(STYLE_ID)) == null ? void 0 : _a.remove();
  }
  return { isOpen, contains, handleKey, toggleHelp, toggleWorkspacePicker, toggleModelPicker, toggleRecentPicker, destroy };
}

// src/workspace-switcher.ts
function workspaceRows(services) {
  var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k;
  const snapshot = (_c = (_b = (_a = services.workspaces) == null ? void 0 : _a.list) == null ? void 0 : _b.getSnapshot) == null ? void 0 : _c.call(_b);
  const items = snapshot == null ? void 0 : snapshot.items;
  if (!Array.isArray(items)) return [];
  const current = (_g = (_f = (_e = (_d = services.sessions) == null ? void 0 : _d.list) == null ? void 0 : _e.getSnapshot) == null ? void 0 : _f.call(_e)) == null ? void 0 : _g.current;
  const rows = [];
  for (const item of items) {
    if (item === null || item === void 0) continue;
    const id = item.workspaceId;
    if (typeof id !== "string" || id === "") continue;
    rows.push({
      workspaceId: id,
      label: workspaceLabel(item),
      detail: typeof item.path === "string" ? item.path : "",
      sessionCount: (_i = (_h = item.sessionIds) == null ? void 0 : _h.length) != null ? _i : 0,
      current: current !== void 0 && current !== "" && ((_k = (_j = item.sessionIds) == null ? void 0 : _j.includes(current)) != null ? _k : false)
    });
  }
  for (const row of rows) {
    if (row.detail === row.label) row.detail = "";
  }
  return rows;
}
function switchWorkspace(services, workspaceId) {
  const uiWorkspace = services.uiWorkspace;
  if (uiWorkspace === null || uiWorkspace === void 0) return false;
  if (typeof uiWorkspace.openWorkspace !== "function") return false;
  if (typeof workspaceId !== "string" || workspaceId === "") return false;
  try {
    void Promise.resolve(uiWorkspace.openWorkspace(workspaceId)).catch(() => {
    });
    return true;
  } catch {
    return false;
  }
}
function workspaceLabel(item) {
  const title = typeof item.title === "string" ? item.title.trim() : "";
  if (title !== "") return title;
  const path = typeof item.path === "string" ? item.path : "";
  const base = pathBasename(path);
  return base !== "" ? base : path;
}
function pathBasename(path) {
  const trimmed = path.replace(/[/\\]+$/, "");
  const separator = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return trimmed.slice(separator + 1);
}

// src/recent-sessions.ts
var UNGROUPED_KEY2 = "";
var EMPTY_NOTICE = "\u5F53\u524D\u6CA1\u6709\u53EF\u6253\u5F00\u7684\u5BF9\u8BDD";
var RECENT_LIMIT = 10;
function recentSessionsView(services) {
  var _a, _b, _c, _d, _e, _f;
  const snapshot = (_c = (_b = (_a = services.sessions) == null ? void 0 : _a.list) == null ? void 0 : _b.getSnapshot) == null ? void 0 : _c.call(_b);
  const byId = snapshot == null ? void 0 : snapshot.byId;
  const ids = snapshot == null ? void 0 : snapshot.ids;
  if (byId === void 0 || byId === null || !Array.isArray(ids) || ids.length === 0) {
    return emptyView();
  }
  const current = snapshot == null ? void 0 : snapshot.current;
  const pending = pendingSessionIds(services);
  const workspaceSnapshot = readWorkspaceSnapshot(services);
  const archived = new Set((_d = workspaceSnapshot == null ? void 0 : workspaceSnapshot.archivedSessionIds) != null ? _d : []);
  const visible = (id) => {
    const summary = byId[id];
    return summary !== void 0 && sessionVisible(summary, current, archived, false);
  };
  const rows = [];
  const groups = [];
  const accounted = /* @__PURE__ */ new Set();
  const buckets = [];
  const all = [];
  for (const item of (_e = workspaceSnapshot == null ? void 0 : workspaceSnapshot.items) != null ? _e : []) {
    if (item === null || item === void 0) continue;
    const workspaceId = item.workspaceId;
    if (typeof workspaceId !== "string" || workspaceId === "") continue;
    const members = ((_f = item.sessionIds) != null ? _f : []).filter(visible);
    for (const id of members) accounted.add(id);
    if (members.length === 0) continue;
    buckets.push({ workspaceId, label: workspaceLabel2(item), members });
    all.push(...members);
  }
  const stray = ids.filter((id) => !accounted.has(id) && visible(id));
  if (stray.length > 0) {
    buckets.push({ workspaceId: UNGROUPED_KEY2, label: "", members: stray });
    all.push(...stray);
  }
  const order = recencyOrder(all, byId);
  const kept = new Set(order.slice(0, RECENT_LIMIT));
  if (current !== void 0 && current !== "" && kept.size === RECENT_LIMIT && !kept.has(current) && visible(current)) {
    kept.delete(order[RECENT_LIMIT - 1]);
    kept.add(current);
  }
  for (const bucket of buckets) {
    const members = bucket.members.filter((id) => kept.has(id));
    if (members.length === 0) continue;
    const groupRows = recencyOrder(members, byId).map((id) => sessionRow(id, byId[id], current, pending));
    groups.push({ workspaceId: bucket.workspaceId, label: bucket.label, rows: groupRows });
    rows.push(...groupRows);
  }
  if (rows.length === 0) return emptyView();
  return {
    groups,
    rows,
    initialIndex: initialIndex(rows, current),
    notice: ""
  };
}
function openRecentSession(services, sessionId) {
  if (typeof sessionId !== "string" || sessionId === "") return false;
  const uiWorkspace = services.uiWorkspace;
  const openSession = uiWorkspace == null ? void 0 : uiWorkspace.openSession;
  if (uiWorkspace !== null && uiWorkspace !== void 0 && typeof openSession === "function") {
    try {
      openSession.call(uiWorkspace, sessionId);
      return true;
    } catch {
    }
  }
  const sessions = services.sessions;
  const open = sessions == null ? void 0 : sessions.open;
  if (sessions === null || sessions === void 0 || typeof open !== "function") return false;
  try {
    open.call(sessions, sessionId);
    return true;
  } catch {
    return false;
  }
}
function emptyView() {
  return { groups: [], rows: [], initialIndex: 0, notice: EMPTY_NOTICE };
}
function initialIndex(rows, current) {
  if (current === void 0 || current === "") return 0;
  const index = rows.findIndex((row) => row.sessionId === current);
  return index < 0 ? 0 : index;
}
function sessionRow(id, summary, current, pending) {
  const label = titleOf(summary, id);
  const cwd = typeof (summary == null ? void 0 : summary.cwd) === "string" ? summary.cwd.trim() : "";
  return {
    sessionId: id,
    label,
    detail: cwd === label ? "" : cwd,
    current: id === current,
    running: (summary == null ? void 0 : summary.running) === true,
    completed: (summary == null ? void 0 : summary.completed) === true,
    pending: pending.has(id)
  };
}
function titleOf(summary, id) {
  const display = typeof (summary == null ? void 0 : summary.displayTitle) === "string" ? summary.displayTitle.trim() : "";
  if (display !== "") return display;
  const title = typeof (summary == null ? void 0 : summary.title) === "string" ? summary.title.trim() : "";
  return title !== "" ? title : id;
}
function workspaceLabel2(item) {
  const title = typeof item.title === "string" ? item.title.trim() : "";
  if (title !== "") return title;
  const path = typeof item.path === "string" ? item.path : "";
  return pathBasename(path);
}
function pendingSessionIds(services) {
  var _a, _b;
  const uiSession = services.uiSession;
  let map;
  try {
    map = (_b = (_a = uiSession == null ? void 0 : uiSession.pendingInteractions) == null ? void 0 : _a.getSnapshot) == null ? void 0 : _b.call(_a);
  } catch {
    map = void 0;
  }
  if (map === void 0 || map === null) {
    try {
      map = uiSession == null ? void 0 : uiSession.pendingSnapshot;
    } catch {
      map = void 0;
    }
  }
  if (map === void 0 || map === null) return /* @__PURE__ */ new Set();
  const ids = /* @__PURE__ */ new Set();
  for (const [id, interaction] of map) {
    if (interaction === null || interaction === void 0) continue;
    if (typeof id === "string" && id !== "") ids.add(id);
  }
  return ids;
}

// src/sidebar-tabs.ts
var RIGHTBAR_SLOT = "rightbar.session";
var FILES_KIND = "files";
var FILES_PAGE_ADDRESS = "sidebar://files";
var TERMINAL_KIND = "terminal";
var TERMINAL_PAGE_PREFIX = "sidebar://terminal";
function cycleRightSidebarTab(services, delta) {
  const sidebarRight = services.sidebarRight;
  if (sidebarRight === null || sidebarRight === void 0) return false;
  if (typeof sidebarRight.focus !== "function") return false;
  const axis = currentPaneTabs(services);
  if (axis === void 0 || axis.ids.length <= 1) return false;
  const step = delta < 0 ? -1 : 1;
  const index = axis.active < 0 ? 0 : (axis.active + step + axis.ids.length) % axis.ids.length;
  const target = axis.ids[index];
  if (target === void 0 || target === axis.ids[axis.active]) return false;
  try {
    sidebarRight.focus(target);
    return true;
  } catch {
    return false;
  }
}
function revealRightSidebarFiles(services) {
  const sidebarRight = services.sidebarRight;
  if (sidebarRight === null || sidebarRight === void 0) return false;
  if (typeof sidebarRight.openTab !== "function") return false;
  try {
    sidebarRight.openTab(FILES_KIND);
  } catch {
    return false;
  }
  promoteFilesTab(services);
  return true;
}
function promoteFilesTab(services) {
  var _a, _b;
  const resolved = rightbarStore(services);
  if (resolved === void 0) return;
  const sessionId = currentSessionId2(services);
  if (sessionId === void 0) return;
  const actions = resolved.instance.actions;
  const placeTab = actions == null ? void 0 : actions.placeTab;
  if (actions === void 0 || typeof placeTab !== "function") return;
  const layout = (_b = (_a = resolved.snapshot.bySession) == null ? void 0 : _a[sessionId]) == null ? void 0 : _b.layout;
  if (layout === void 0) return;
  const target = filesTabIn(layout);
  if (target === void 0 || target.index === 0) return;
  try {
    placeTab.call(actions, sessionId, target.tabId, target.paneId, 0);
  } catch {
  }
}
function filesTabIn(layout) {
  var _a, _b;
  for (const paneId of paneOrder(layout)) {
    const pane = paneOf(layout, paneId);
    if (pane === void 0 || pane.host !== "dock") continue;
    const tabs = (_a = pane.tabs) != null ? _a : [];
    for (let index = 0; index < tabs.length; index += 1) {
      const tabId = tabs[index];
      if (typeof tabId !== "string" || tabId === "") continue;
      const record = (_b = layout.tabs) == null ? void 0 : _b[tabId];
      if (record === void 0 || record === null) continue;
      if (record.kind === FILES_KIND || record.contentId === FILES_PAGE_ADDRESS) {
        return { paneId, tabId, index };
      }
    }
  }
  return void 0;
}
function paneOrder(layout) {
  var _a;
  const order = [];
  const active = layout.activePaneId;
  if (typeof active === "string" && active !== "") order.push(active);
  for (const paneId of Object.keys((_a = layout.nodes) != null ? _a : {})) {
    if (paneId !== active) order.push(paneId);
  }
  return order;
}
function revealRightSidebarTerminal(services) {
  const sidebarRight = services.sidebarRight;
  if (sidebarRight === null || sidebarRight === void 0) return false;
  const layout = currentLayout(services);
  if (layout !== void 0) {
    const held = terminalTabIn(layout);
    if (held !== void 0) {
      if (typeof sidebarRight.focus !== "function") return false;
      const alreadyVisible = held.current && layout.expanded !== false;
      try {
        sidebarRight.focus(held.tabId);
      } catch {
        return false;
      }
      expandColumn(sidebarRight, layout);
      if (alreadyVisible) focusTerminalScreen(held.paneId);
      return true;
    }
  }
  if (typeof sidebarRight.openTab !== "function") return false;
  try {
    sidebarRight.openTab(TERMINAL_KIND);
  } catch {
    return false;
  }
  return true;
}
function focusTerminalScreen(paneId) {
  if (typeof document === "undefined") return false;
  const pane = paneElement(paneId);
  if (pane === void 0) return false;
  const query = pane.querySelector;
  if (typeof query !== "function") return false;
  let screen;
  try {
    screen = query.call(pane, "textarea.xterm-helper-textarea");
  } catch {
    return false;
  }
  if (typeof screen !== "object" || screen === null) return false;
  const focus = screen.focus;
  if (typeof focus !== "function") return false;
  try {
    ;
    focus.call(screen, { preventScroll: true });
    return true;
  } catch {
    return false;
  }
}
function paneElement(paneId) {
  const queryAll = document.querySelectorAll;
  if (typeof queryAll !== "function") return void 0;
  let panes;
  try {
    panes = queryAll.call(document, "[data-dockkit-pane]");
  } catch {
    return void 0;
  }
  for (let index = 0; index < panes.length; index += 1) {
    const pane = panes[index];
    if (pane === void 0 || pane === null) continue;
    const attribute = pane.getAttribute;
    if (typeof attribute === "function" && attribute.call(pane, "data-dockkit-pane") === paneId) return pane;
  }
  return void 0;
}
function expandColumn(sidebarRight, layout) {
  if (layout.expanded !== false) return;
  const toggle = sidebarRight.toggleExpanded;
  if (typeof toggle !== "function") return;
  try {
    toggle.call(sidebarRight);
  } catch {
  }
}
function terminalTabIn(layout) {
  var _a;
  for (const paneId of paneOrder(layout)) {
    const pane = paneOf(layout, paneId);
    if (pane === void 0 || pane.host !== "dock") continue;
    const activeTabId = pane.activeTabId;
    let first;
    for (const tabId of (_a = pane.tabs) != null ? _a : []) {
      if (typeof tabId !== "string" || tabId === "") continue;
      if (!isTerminalTab(layout, tabId)) continue;
      if (tabId === activeTabId) return { paneId, tabId, current: true };
      if (first === void 0) first = tabId;
    }
    if (first !== void 0) return { paneId, tabId: first, current: false };
  }
  return void 0;
}
function isTerminalTab(layout, tabId) {
  var _a;
  const record = (_a = layout.tabs) == null ? void 0 : _a[tabId];
  if (record === void 0 || record === null) return false;
  if (record.kind === TERMINAL_KIND) return true;
  const contentId = record.contentId;
  return typeof contentId === "string" && (contentId === TERMINAL_PAGE_PREFIX || contentId.startsWith(`${TERMINAL_PAGE_PREFIX}/`));
}
function currentPaneTabs(services) {
  var _a, _b, _c;
  const layout = currentLayout(services);
  if (layout === void 0) return void 0;
  const pane = paneOf(layout, layout.activePaneId);
  if (pane === void 0) return void 0;
  const ids = [];
  for (const tabId of (_a = pane.tabs) != null ? _a : []) {
    if (typeof tabId !== "string" || tabId === "") continue;
    const id = (_c = (_b = layout.tabs) == null ? void 0 : _b[tabId]) == null ? void 0 : _c.id;
    ids.push(typeof id === "string" && id !== "" ? id : tabId);
  }
  if (ids.length === 0) return void 0;
  const activeTabId = pane.activeTabId;
  return {
    ids,
    active: typeof activeTabId === "string" ? ids.indexOf(activeTabId) : -1
  };
}
function currentLayout(services) {
  var _a, _b;
  const resolved = rightbarStore(services);
  if (resolved === void 0) return void 0;
  const sessionId = currentSessionId2(services);
  if (sessionId === void 0) return void 0;
  return (_b = (_a = resolved.snapshot.bySession) == null ? void 0 : _a[sessionId]) == null ? void 0 : _b.layout;
}
function currentSessionId2(services) {
  var _a, _b, _c, _d;
  const current = (_d = (_c = (_b = (_a = services.sessions) == null ? void 0 : _a.list) == null ? void 0 : _b.getSnapshot) == null ? void 0 : _c.call(_b)) == null ? void 0 : _d.current;
  return current === void 0 || current === "" ? void 0 : current;
}
function rightbarStore(services) {
  const slots = services.slots;
  const uiSession = services.uiSession;
  if (slots === null || slots === void 0 || uiSession === null || uiSession === void 0) return void 0;
  if (typeof slots.entries !== "function" || typeof slots.resolveStore !== "function") return void 0;
  const sessionId = currentSessionId2(services);
  if (sessionId === void 0) return void 0;
  const binding = resolveBinding2(uiSession, sessionId);
  if (binding === void 0) return void 0;
  for (const entry of entriesOf3(slots)) {
    const handle = entry == null ? void 0 : entry.store;
    if (handle === void 0 || handle === null) continue;
    let instance;
    try {
      instance = slots.resolveStore(handle, binding);
    } catch {
      continue;
    }
    const resolved = asRightbarStore(instance);
    if (resolved !== void 0) return resolved;
  }
  return void 0;
}
function entriesOf3(slots) {
  var _a;
  try {
    const entries = (_a = slots.entries) == null ? void 0 : _a.call(slots, RIGHTBAR_SLOT);
    return Array.isArray(entries) ? entries : [];
  } catch {
    return [];
  }
}
function resolveBinding2(uiSession, sessionId) {
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
function asRightbarStore(instance) {
  if (typeof instance !== "object" || instance === null) return void 0;
  const getSnapshot = instance.getSnapshot;
  if (typeof getSnapshot !== "function") return void 0;
  let snapshot;
  try {
    snapshot = getSnapshot.call(instance);
  } catch {
    return void 0;
  }
  if (typeof snapshot !== "object" || snapshot === null) return void 0;
  const bySession = snapshot.bySession;
  if (typeof bySession !== "object" || bySession === null || Array.isArray(bySession)) return void 0;
  return {
    instance,
    snapshot
  };
}
function paneOf(layout, paneId) {
  var _a;
  if (typeof paneId !== "string" || paneId === "") return void 0;
  const node = (_a = layout.nodes) == null ? void 0 : _a[paneId];
  if (node === void 0 || node === null) return void 0;
  if (node.kind !== "pane") return void 0;
  return node;
}

// src/client.ts
var name = "dsh-kbd-hotkeys";
var inject = ["sessions", "uiSession", "layout", "sidebarRight", "workspaces", "slots", "conversation", "uiWorkspace", "modelDirectories"];
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
      case "sidebarRight.toggle":
        return toggleRightSidebar(services);
      case "sidebarRight.tabPrev":
        return cycleRightSidebarTab(services, -1);
      case "sidebarRight.tabNext":
        return cycleRightSidebarTab(services, 1);
      case "sidebarRight.files":
        return revealRightSidebarFiles(services);
      case "sidebarRight.terminal":
        return revealRightSidebarTerminal(services);
      case "composer.focus":
        return focusComposer(services);
      case "session.new":
        return startNewSession(services);
      case "workspace.pick":
        overlays.toggleWorkspacePicker();
        return true;
      case "session.recent":
        overlays.toggleRecentPicker();
        return true;
      case "model.pick":
        overlays.toggleModelPicker();
        return true;
      case "model.effortNext":
        return cycleEffort(services).ok;
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
    sidebarRight: getService(ctx, "sidebarRight"),
    workspaces: getService(ctx, "workspaces"),
    slots: getService(ctx, "slots"),
    conversation: getService(ctx, "conversation"),
    uiWorkspace: getService(ctx, "uiWorkspace"),
    modelDirectories: getService(ctx, "modelDirectories")
  };
  const config = loadConfig();
  const actionByCombo = comboActionMap(config.bindings);
  const overlays = createOverlays({
    getConfig: () => config,
    // 工作区浮窗:数据每次打开时现取(宿主顺序),确认走 uiWorkspace.openWorkspace
    listWorkspaces: () => workspaceRows(services),
    selectWorkspace: (workspaceId) => {
      switchWorkspace(services, workspaceId);
    },
    // 近期对话浮窗:数据每次打开时现取(sessions.list + workspaces.list,按工作区分组),
    // 确认走公开的 uiWorkspace.openSession(sessionId)——与侧栏点会话行同一条服务调用
    // (缺失时回退同一份服务实例上的 sessions.open)。
    listRecentSessions: () => recentSessionsView(services),
    selectRecentSession: (sessionId) => {
      openRecentSession(services, sessionId);
    },
    // 模型浮窗:列表每次打开时现取当前会话的模型目录(与 `/model` 弹层、
    // composer 模型座位同一份状态);确认走同一个 directory.select。
    listModels: () => modelPickerView(services),
    selectModel: (selection) => {
      selectModel(services, selection);
    },
    cycleEffort: () => cycleEffort(services)
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
    if (actionId === "model.effortNext" && state === "editing" && !isComposerTarget(services, event.target)) return;
    if (actionId === "composer.focus" && state === "editing" && isComposerTarget(services, event.target)) {
      swallow(event);
      return;
    }
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
