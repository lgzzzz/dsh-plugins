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

// src/scope-binding.ts
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
  return asScopeBinding(binding);
}
function asScopeBinding(value) {
  if (typeof value !== "object" || value === null) return void 0;
  const key = value.key;
  return typeof key === "string" && key !== "" ? value : void 0;
}

// src/question-drafts.ts
var COMPOSER_SLOT = "conversation.composer";
function questionDraftStore(services, pending, sessionId) {
  const slots = services.slots;
  if (slots === null || slots === void 0) return void 0;
  if (typeof slots.entries !== "function" || typeof slots.resolveStore !== "function") return void 0;
  const binding = sessionScopeBinding(services, sessionId);
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

// src/session-view.ts
function currentSessionId(services) {
  var _a, _b, _c, _d, _e, _f, _g;
  let key;
  try {
    key = (_d = (_c = (_b = (_a = services.uiSession) == null ? void 0 : _a.current) == null ? void 0 : _b.getSnapshot) == null ? void 0 : _c.call(_b)) == null ? void 0 : _d.key;
  } catch {
    key = void 0;
  }
  if (key !== void 0 && key !== "") return key;
  return mainViewSessionId((_g = (_f = (_e = services.sessions) == null ? void 0 : _e.list) == null ? void 0 : _f.getSnapshot) == null ? void 0 : _g.call(_f));
}
function mainViewSessionId(snapshot) {
  var _a, _b, _c;
  const byId = snapshot == null ? void 0 : snapshot.byId;
  if (byId === void 0 || byId === null) return void 0;
  for (const id of Object.keys(byId)) {
    if (((_c = (_b = (_a = byId[id]) == null ? void 0 : _a.retainedBy) == null ? void 0 : _b.mainView) != null ? _c : 0) > 0) return id;
  }
  return void 0;
}
function completionUnread(services, sessionId) {
  var _a, _b, _c, _d;
  let map;
  try {
    map = (_c = (_b = (_a = services.uiSession) == null ? void 0 : _a.sessionStatus) == null ? void 0 : _b.getSnapshot) == null ? void 0 : _c.call(_b);
  } catch {
    map = void 0;
  }
  if (map === void 0 || map === null || typeof map.get !== "function") return false;
  return ((_d = map.get(sessionId)) == null ? void 0 : _d.completionUnread) === true;
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
  const current = currentSessionId(services);
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
  const current = currentSessionId(services);
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
  if (snapshot.ids === void 0 || snapshot.ids.length === 0 || snapshot.byId === void 0) return false;
  const uiWorkspace = services.uiWorkspace;
  const openSession = uiWorkspace == null ? void 0 : uiWorkspace.openSession;
  if (uiWorkspace === null || uiWorkspace === void 0 || typeof openSession !== "function") return false;
  const axis = sidebarOrderedSessionIds(snapshot, services);
  const total = axis.length;
  if (total === 0) return false;
  const current = currentSessionId(services);
  const anchor = current === void 0 ? -1 : axis.indexOf(current);
  if (anchor < 0) return false;
  const active = activeSessionIds(snapshot, services);
  for (let step = 1; step < total; step += 1) {
    const id = axis[((anchor + delta * step) % total + total) % total];
    if (id === void 0) continue;
    if (!active.has(id)) continue;
    try {
      openSession.call(uiWorkspace, id);
      return true;
    } catch {
      return false;
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
    if (summary.running === true || completionUnread(services, id) || pending !== void 0 && pending.has(id)) {
      active.add(id);
    }
  }
  return active;
}

// src/config.ts
var ACTIONS = [
  // 回合级:服务级应答,单键固定分发,不进 bindings
  { id: "approval.allow", label: "\u5BA1\u6279:\u5141\u8BB8\u4E00\u6B21", group: "\u5BA1\u6279", states: ["card"] },
  { id: "approval.reject", label: "\u5BA1\u6279:\u62D2\u7EDD", group: "\u5BA1\u6279", states: ["card"] },
  { id: "question.option", label: "\u95EE\u9898:\u6309 1\u20139 \u9009\u62E9\u9009\u9879(\u4E0D\u7FFB\u9898)", group: "\u95EE\u7B54\u5361\u7247", states: ["card"] },
  { id: "question.prev", label: "\u95EE\u9898:\u2190 \u4E0A\u4E00\u9898", group: "\u95EE\u7B54\u5361\u7247", states: ["card"] },
  { id: "question.next", label: "\u95EE\u9898:\u2192 \u4E0B\u4E00\u9898", group: "\u95EE\u7B54\u5361\u7247", states: ["card"] },
  { id: "question.submit", label: "\u95EE\u9898:Enter \u4E0B\u4E00\u9898 / \u672B\u9898\u63D0\u4EA4", group: "\u95EE\u7B54\u5361\u7247", states: ["card"] },
  // 左 B(肌肉记忆) / 右 O(Open panel);带修饰键不干扰编辑,故放行 editing
  { id: "sidebar.toggle", label: "\u5F00\u5173\u5DE6\u4FA7\u680F", group: "\u4F1A\u8BDD", states: ["browse", "editing"] },
  { id: "sidebarRight.toggle", label: "\u5F00\u5173\u53F3\u4FA7\u680F", group: "\u4F1A\u8BDD", states: ["browse", "editing"] },
  // mod+alt+←/→:方向键轴归导航;card 裸键归卡片,不冲突
  { id: "sidebarRight.tabPrev", label: "\u53F3\u4FA7\u680F:\u4E0A\u4E00\u4E2A\u6807\u7B7E", group: "\u4F1A\u8BDD", states: ["card", "editing", "browse"] },
  { id: "sidebarRight.tabNext", label: "\u53F3\u4FA7\u680F:\u4E0B\u4E00\u4E2A\u6807\u7B7E", group: "\u4F1A\u8BDD", states: ["card", "editing", "browse"] },
  // 定位文件浏览器(已有则聚焦,无则创建)并置顶
  { id: "sidebarRight.files", label: "\u53F3\u4FA7\u680F:\u5B9A\u4F4D\u6587\u4EF6\u6D4F\u89C8\u5668(\u4E0D\u5B58\u5728\u5219\u521B\u5EFA)\u5E76\u7F6E\u9876", group: "\u4F1A\u8BDD", states: ["card", "editing", "browse"] },
  // 定位终端但不去重、不置顶,故先读 store 认页
  { id: "sidebarRight.terminal", label: "\u53F3\u4FA7\u680F:\u5B9A\u4F4D\u7EC8\u7AEF\u5E76\u805A\u7126(\u4E0D\u5B58\u5728\u5219\u65B0\u5EFA)", group: "\u4F1A\u8BDD", states: ["card", "editing", "browse"] },
  // 关当前标签;上游拒关「独占停靠的 guide」时只 no-op——该键位恒吞,不留给浏览器
  { id: "sidebarRight.closeTab", label: "\u53F3\u4FA7\u680F:\u5173\u95ED\u5F53\u524D\u6807\u7B7E", group: "\u4F1A\u8BDD", states: ["card", "editing", "browse"] },
  // 等同侧栏「新建会话」按钮(uiWorkspace.startSession)
  { id: "session.new", label: "\u65B0\u5EFA\u4F1A\u8BDD\u5E76\u8DF3\u8F6C", group: "\u4F1A\u8BDD", states: ["card", "editing", "browse"] },
  // mod+J 焦点跳回输入框;editing 仅在焦点不在 composer 内时执行
  { id: "composer.focus", label: "\u805A\u7126\u8F93\u5165\u6846", group: "\u4F1A\u8BDD", states: ["browse", "editing"] },
  { id: "session.prev", label: "\u4E0A\u4E00\u4E2A\u6D3B\u8DC3\u4F1A\u8BDD(\u5FAA\u73AF)", group: "\u4F1A\u8BDD", states: ["card", "editing", "browse"] },
  { id: "session.next", label: "\u4E0B\u4E00\u4E2A\u6D3B\u8DC3\u4F1A\u8BDD(\u5FAA\u73AF)", group: "\u4F1A\u8BDD", states: ["card", "editing", "browse"] },
  // mod+K:浮窗内 ↑↓ 只移高亮,Enter 才 openWorkspace
  { id: "workspace.pick", label: "\u5207\u6362\u5DE5\u4F5C\u533A(\u6D6E\u7A97:\u2191\u2193 \u9009\u62E9\u3001Enter \u5207\u6362)", group: "\u4F1A\u8BDD", states: ["card", "editing", "browse"] },
  // mod+M:与上游两个入口共用同一 per-session 目录
  { id: "model.pick", label: "\u5207\u6362\u6A21\u578B(\u6D6E\u7A97:\u2191\u2193 \u9009\u62E9\u3001Enter \u5207\u6362)", group: "\u4F1A\u8BDD", states: ["card", "editing", "browse"] },
  // mod+I:浮窗内 ↑↓ 只移高亮,Enter 才 openSession
  { id: "session.recent", label: "\u8FD1\u671F\u5BF9\u8BDD(\u6D6E\u7A97:\u6309\u5DE5\u4F5C\u533A\u5206\u7EC4\u3001\u2191\u2193 \u9009\u62E9\u3001Enter \u6253\u5F00)", group: "\u4F1A\u8BDD", states: ["card", "editing", "browse"] },
  // ⇧Tab 是编辑核心键,仅 browse / editing,且 editing 需焦点在 composer 内
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
  // 左 = B(跨应用肌肉记忆),右 = O(Open panel)
  "sidebar.toggle": "mod+b",
  "sidebarRight.toggle": "mod+o",
  // 右栏标签轴;边缘循环,单标签不吞键
  "sidebarRight.tabPrev": "mod+alt+arrowleft",
  "sidebarRight.tabNext": "mod+alt+arrowright",
  // 反斜杠走物理键位(code),与布局字符无关
  "sidebarRight.files": "mod+\\",
  // 浏览器保留键(聚焦地址栏)
  "sidebarRight.terminal": "mod+l",
  // 逗号 = 关闭标签;按 code 判定(Comma),不受布局影响;无可关标签也吞键(键位不留给浏览器)
  "sidebarRight.closeTab": "mod+,",
  // 浏览器保留键(新建窗口)
  "session.new": "mod+n",
  // J = Jump;终端里 ⌃J(LF)不再送给 PTY
  "composer.focus": "mod+j",
  "session.prev": "mod+alt+arrowup",
  "session.next": "mod+alt+arrowdown",
  // 浏览器保留键(地址栏搜索)
  "workspace.pick": "mod+k",
  // M = Model
  "model.pick": "mod+m",
  // I = Input/会话;抢了 contenteditable 的斜体默认键
  "session.recent": "mod+i",
  // 免鼠标循环强度;no-op 时不吞键
  "model.effortNext": "shift+tab",
  // 只停运行中的会话树;无运行中会话不吞键
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
  // 近期对话浮窗最多 10 行，抬高上限让整屏可见（须排在 .dsh-kbd-panel 之后）。
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
  // 近期对话行：多一层缩进，用独立类名便于诊断脚本区分。
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
var WORKSPACE_LIMIT = 10;
function workspaceRows(services) {
  var _a, _b, _c, _d, _e, _f;
  const snapshot = readWorkspaceSnapshot(services);
  const items = snapshot == null ? void 0 : snapshot.items;
  if (!Array.isArray(items)) return [];
  const current = currentSessionId(services);
  const byId = (_e = (_d = (_c = (_b = (_a = services.sessions) == null ? void 0 : _a.list) == null ? void 0 : _b.getSnapshot) == null ? void 0 : _c.call(_b)) == null ? void 0 : _d.byId) != null ? _e : {};
  const archived = new Set((_f = snapshot == null ? void 0 : snapshot.archivedSessionIds) != null ? _f : []);
  const entries = [];
  items.forEach((item, index) => {
    if (item === null || item === void 0) return;
    const workspaceId = item.workspaceId;
    if (typeof workspaceId !== "string" || workspaceId === "") return;
    entries.push({ item, workspaceId, activity: workspaceActivity(item, byId, current, archived), index });
  });
  const ordered = entries.sort((a, b) => b.activity - a.activity || a.index - b.index);
  const kept = ordered.slice(0, WORKSPACE_LIMIT);
  const currentWorkspaceId = workspaceIdOfSession(entries, current);
  if (currentWorkspaceId !== void 0 && kept.length === WORKSPACE_LIMIT) {
    if (!kept.some((entry) => entry.workspaceId === currentWorkspaceId)) {
      const forced = ordered.find((entry) => entry.workspaceId === currentWorkspaceId);
      if (forced !== void 0) kept[WORKSPACE_LIMIT - 1] = forced;
    }
  }
  const rows = kept.map((entry) => {
    var _a2, _b2, _c2, _d2;
    return {
      workspaceId: entry.workspaceId,
      label: workspaceLabel(entry.item),
      detail: typeof entry.item.path === "string" ? entry.item.path : "",
      sessionCount: (_b2 = (_a2 = entry.item.sessionIds) == null ? void 0 : _a2.length) != null ? _b2 : 0,
      current: current !== void 0 && current !== "" && ((_d2 = (_c2 = entry.item.sessionIds) == null ? void 0 : _c2.includes(current)) != null ? _d2 : false)
    };
  });
  for (const row of rows) {
    if (row.detail === row.label) row.detail = "";
  }
  return rows;
}
function workspaceActivity(item, byId, current, archived) {
  var _a;
  let latest = Number.NEGATIVE_INFINITY;
  for (const id of (_a = item.sessionIds) != null ? _a : []) {
    const summary = byId[id];
    if (summary === void 0) continue;
    if (!sessionVisible(summary, current, archived, false)) continue;
    const updatedAt = summary.updatedAt;
    if (typeof updatedAt !== "number" || !Number.isFinite(updatedAt)) continue;
    if (updatedAt > latest) latest = updatedAt;
  }
  return latest;
}
function workspaceIdOfSession(entries, current) {
  var _a;
  if (current === void 0 || current === "") return void 0;
  for (const entry of entries) {
    if (((_a = entry.item.sessionIds) == null ? void 0 : _a.includes(current)) === true) return entry.workspaceId;
  }
  return void 0;
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
  const current = currentSessionId(services);
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
    const groupRows = recencyOrder(members, byId).map((id) => sessionRow(id, byId[id], current, pending, services));
    groups.push({ workspaceId: bucket.workspaceId, label: bucket.label, rows: groupRows });
    rows.push(...groupRows);
  }
  if (rows.length === 0) return emptyView();
  return {
    groups,
    rows,
    initialIndex: initialIndex(rows, groups, current, currentWorkspaceKey(workspaceSnapshot, current)),
    notice: ""
  };
}
function openRecentSession(services, sessionId) {
  if (typeof sessionId !== "string" || sessionId === "") return false;
  const uiWorkspace = services.uiWorkspace;
  const openSession = uiWorkspace == null ? void 0 : uiWorkspace.openSession;
  if (uiWorkspace === null || uiWorkspace === void 0 || typeof openSession !== "function") return false;
  try {
    openSession.call(uiWorkspace, sessionId);
    return true;
  } catch {
    return false;
  }
}
function emptyView() {
  return { groups: [], rows: [], initialIndex: 0, notice: EMPTY_NOTICE };
}
function initialIndex(rows, groups, current, currentWorkspace) {
  if (current === void 0 || current === "") return 0;
  const index = rows.findIndex((row) => row.sessionId === current);
  if (index >= 0) return index;
  if (currentWorkspace === void 0) return 0;
  let offset = 0;
  for (const group of groups) {
    if (group.workspaceId === currentWorkspace) return group.rows.length > 0 ? offset : 0;
    offset += group.rows.length;
  }
  return 0;
}
function currentWorkspaceKey(snapshot, current) {
  var _a, _b;
  if (current === void 0 || current === "") return void 0;
  for (const item of (_a = snapshot == null ? void 0 : snapshot.items) != null ? _a : []) {
    if (item === null || item === void 0) continue;
    if (((_b = item.sessionIds) == null ? void 0 : _b.includes(current)) !== true) continue;
    const workspaceId = item.workspaceId;
    if (typeof workspaceId === "string" && workspaceId !== "") return workspaceId;
  }
  return UNGROUPED_KEY2;
}
function sessionRow(id, summary, current, pending, services) {
  const label = titleOf(summary, id);
  const cwd = typeof (summary == null ? void 0 : summary.cwd) === "string" ? summary.cwd.trim() : "";
  return {
    sessionId: id,
    label,
    detail: cwd === label ? "" : cwd,
    current: id === current,
    running: (summary == null ? void 0 : summary.running) === true,
    // 完成未读来自 uiSession.sessionStatus(替代已删除的 summary.completed)
    completed: completionUnread(services, id),
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
function closeRightSidebarTab(services) {
  var _a, _b;
  const sidebarRight = services.sidebarRight;
  if (sidebarRight === null || sidebarRight === void 0) return false;
  if (typeof sidebarRight.close !== "function") return false;
  const resolved = rightbarStore(services);
  if (resolved === void 0) return false;
  const sessionId = currentSessionId(services);
  if (sessionId === void 0) return false;
  const layout = (_b = (_a = resolved.snapshot.bySession) == null ? void 0 : _a[sessionId]) == null ? void 0 : _b.layout;
  if (layout === void 0) return false;
  const tabId = activeTabId(layout);
  if (tabId === void 0) return false;
  try {
    sidebarRight.close(tabId);
  } catch {
    return false;
  }
  return !tabStillOpen(resolved.instance, sessionId, tabId);
}
function activeTabId(layout) {
  var _a;
  const pane = paneOf(layout, layout.activePaneId);
  if (pane === void 0) return void 0;
  const active = pane.activeTabId;
  if (typeof active !== "string" || active === "") return void 0;
  return ((_a = pane.tabs) != null ? _a : []).includes(active) ? active : void 0;
}
function tabStillOpen(instance, sessionId, tabId) {
  var _a, _b, _c;
  const getSnapshot = instance.getSnapshot;
  if (typeof getSnapshot !== "function") return true;
  let snapshot;
  try {
    snapshot = getSnapshot.call(instance);
  } catch {
    return true;
  }
  const layout = (_b = (_a = snapshot == null ? void 0 : snapshot.bySession) == null ? void 0 : _a[sessionId]) == null ? void 0 : _b.layout;
  if (layout === void 0) return false;
  return ((_c = layout.tabs) == null ? void 0 : _c[tabId]) !== void 0;
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
  const sessionId = currentSessionId(services);
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
    const activeTabId2 = pane.activeTabId;
    let first;
    for (const tabId of (_a = pane.tabs) != null ? _a : []) {
      if (typeof tabId !== "string" || tabId === "") continue;
      if (!isTerminalTab(layout, tabId)) continue;
      if (tabId === activeTabId2) return { paneId, tabId, current: true };
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
  const activeTabId2 = pane.activeTabId;
  return {
    ids,
    active: typeof activeTabId2 === "string" ? ids.indexOf(activeTabId2) : -1
  };
}
function currentLayout(services) {
  var _a, _b;
  const resolved = rightbarStore(services);
  if (resolved === void 0) return void 0;
  const sessionId = currentSessionId(services);
  if (sessionId === void 0) return void 0;
  return (_b = (_a = resolved.snapshot.bySession) == null ? void 0 : _a[sessionId]) == null ? void 0 : _b.layout;
}
function rightbarStore(services) {
  const slots = services.slots;
  if (slots === null || slots === void 0) return void 0;
  if (typeof slots.entries !== "function" || typeof slots.resolveStore !== "function") return void 0;
  const sessionId = currentSessionId(services);
  if (sessionId === void 0) return void 0;
  const binding = sessionScopeBinding(services, sessionId);
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
      // 数字键用固定分发,非可执行动作
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
      case "sidebarRight.closeTab":
        return closeRightSidebarTab(services);
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
    // 工作区浮窗:每次打开现取
    listWorkspaces: () => workspaceRows(services),
    selectWorkspace: (workspaceId) => {
      switchWorkspace(services, workspaceId);
    },
    // 近期对话:现取快照;打开只走 uiWorkspace.openSession
    listRecentSessions: () => recentSessionsView(services),
    selectRecentSession: (sessionId) => {
      openRecentSession(services, sessionId);
    },
    // 模型浮窗:与上游弹层共用同一 per-session 目录
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
    if (actionId === "sidebarRight.closeTab") {
      runAction(actionId, services, overlays);
      swallow(event);
      return;
    }
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
