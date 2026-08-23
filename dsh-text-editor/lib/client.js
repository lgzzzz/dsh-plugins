window.__ModuleLoader__.load({ id: "dsh-text-editor", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
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
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client.ts
var client_exports = {};
__export(client_exports, {
  apply: () => apply,
  inject: () => inject,
  name: () => name
});
module.exports = __toCommonJS(client_exports);

// src/api.ts
var TEXT_EDITOR_SERVICE = "dsh-text-editor";

// src/css.ts
var CSS = [
  '.dsh-te-root{display:flex;flex-direction:column;flex:1;min-height:0;background:var(--dsw-alias-bg-base,#1e1e1e);color:var(--dsw-alias-label-primary,#e6e6e6);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace;font-size:13px;line-height:1.5;}',
  ".dsh-te-empty{justify-content:center;align-items:center;}",
  ".dsh-te-toolbar{display:flex;align-items:center;gap:8px;padding:6px 10px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.25));background:var(--dsw-alias-bg-layer-1,#252526);flex:none;}",
  ".dsh-te-path{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:0 1 auto;min-width:0;max-width:60%;}",
  ".dsh-te-status{color:var(--dsw-alias-label-secondary,#9d9d9d);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:40%;}",
  ".dsh-te-status-error{color:var(--dsw-alias-state-error-primary,#f48771);}",
  ".dsh-te-save{border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.35));background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.15));color:var(--dsw-alias-label-primary,#e6e6e6);font-size:12px;line-height:1;cursor:pointer;padding:5px 12px;border-radius:6px;flex:none;}",
  ".dsh-te-save:hover{background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.3));}",
  ".dsh-te-save:disabled{opacity:.5;cursor:default;}",
  ".dsh-te-save-dirty{color:#dcdcaa;border-color:rgba(220,220,170,.6);}",
  ".dsh-te-save-dirty:hover{background:rgba(220,220,170,.25);}",
  ".dsh-te-tab{display:inline-flex;align-items:center;gap:6px;}",
  ".dsh-te-tab-label{white-space:nowrap;}",
  ".dsh-te-tab-label.dsh-te-tab-dirty{color:#dcdcaa;}",
  ".dsh-te-diff-tab-label{white-space:nowrap;}",
  ".dsh-te-tab-close{display:inline-grid;place-items:center;width:16px;height:16px;border-radius:4px;font-size:13px;line-height:1;color:var(--dsw-alias-label-secondary,#9d9d9d);cursor:pointer;user-select:none;}",
  ".dsh-te-tab-close:hover{background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.25));color:var(--dsw-alias-label-primary,#fff);}",
  ".dsh-te-diff-nav{border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.35));background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.15));color:var(--dsw-alias-label-primary,#e6e6e6);font-size:12px;line-height:1;cursor:pointer;padding:5px 12px;border-radius:6px;}",
  ".dsh-te-diff-nav:hover{background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.3));}",
  ".dsh-te-diff-nav:disabled{opacity:.5;cursor:default;}",
  ".dsh-te-diff-counter{color:var(--dsw-alias-label-secondary,#9d9d9d);font-size:12px;white-space:nowrap;}",
  ".dsh-te-body{flex:1;min-height:0;overflow:hidden;display:flex;flex-direction:column;position:relative;}",
  ".dsh-te-monaco{flex:1;min-height:0;position:relative;}",
  ".dsh-te-monaco-host{position:absolute;inset:0;}",
  ".dsh-te-note{padding:12px 16px;color:var(--dsw-alias-label-secondary,#9d9d9d);}"
].join("\n");

// src/controller.ts
var React2 = __toESM(require("react"), 1);

// src/path.ts
function basename(path) {
  const at = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return at === -1 ? path : path.slice(at + 1);
}
var EXT_LANG = {
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  yml: "yaml",
  yaml: "yaml",
  md: "markdown",
  markdown: "markdown",
  css: "css",
  scss: "scss",
  less: "less",
  html: "html",
  htm: "html",
  py: "python",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  hpp: "cpp",
  java: "java",
  go: "go",
  rs: "rust",
  rb: "ruby",
  php: "php",
  sql: "sql",
  xml: "xml",
  svg: "xml",
  toml: "ini",
  ini: "ini",
  conf: "ini",
  diff: "diff",
  patch: "diff",
  txt: "plaintext",
  log: "plaintext"
};
function languageFor(path) {
  var _a, _b, _c;
  const base = (_b = ((_a = path.split("/").pop()) != null ? _a : path).split("\\").pop()) != null ? _b : "";
  const lower = base.toLowerCase();
  if (lower === "dockerfile" || lower === "makefile") return lower;
  const dot = lower.lastIndexOf(".");
  if (dot === -1) return "plaintext";
  return (_c = EXT_LANG[lower.slice(dot + 1)]) != null ? _c : "plaintext";
}

// src/state.ts
var MAX_EDITOR_TABS = 5;
function hashKey(path) {
  let h1 = 5381;
  let h2 = 52711;
  for (let i = 0; i < path.length; i++) {
    const c = path.charCodeAt(i);
    h1 = (h1 << 5) + h1 + c >>> 0;
    h2 = (h2 << 5) + h2 + c + 101 >>> 0;
  }
  return h1.toString(36) + h2.toString(36);
}
var activeSessionId = void 0;
var filesBySession = /* @__PURE__ */ new Map();
var activeIndexBySession = /* @__PURE__ */ new Map();
var recencyBySession = /* @__PURE__ */ new Map();
var diffBySession = /* @__PURE__ */ new Map();
var listeners = /* @__PURE__ */ new Set();
function emit() {
  for (const fn of [...listeners]) fn();
}
function subscribe(fn) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
function getActiveSessionId() {
  return activeSessionId;
}
function setActiveSessionId(id) {
  if (id === activeSessionId) return;
  activeSessionId = id;
  emit();
}
function filesOf(sessionId) {
  var _a;
  if (sessionId === void 0) return [];
  return (_a = filesBySession.get(sessionId)) != null ? _a : [];
}
function getActiveFiles() {
  return filesOf(activeSessionId);
}
function getFileAt(index) {
  const files = getActiveFiles();
  return index >= 0 && index < files.length ? files[index] : null;
}
function getActiveIndex() {
  const files = getActiveFiles();
  if (files.length === 0) return -1;
  const stored = activeSessionId !== void 0 ? activeIndexBySession.get(activeSessionId) : void 0;
  if (stored === void 0 || stored < 0 || stored >= files.length) return 0;
  return stored;
}
function getFileIndexByKey(sessionId, key) {
  const files = filesOf(sessionId);
  return files.findIndex((f) => f.key === key);
}
function getFileByKey(sessionId, key) {
  const index = getFileIndexByKey(sessionId, key);
  return index === -1 ? null : filesOf(sessionId)[index];
}
function touchRecency(sessionId, key) {
  let rec = recencyBySession.get(sessionId);
  if (rec === void 0) {
    rec = [];
    recencyBySession.set(sessionId, rec);
  }
  const at = rec.indexOf(key);
  if (at !== -1) rec.splice(at, 1);
  rec.unshift(key);
}
function noteActiveFile(sessionId, key) {
  const index = getFileIndexByKey(sessionId, key);
  if (index === -1) return;
  activeIndexBySession.set(sessionId, index);
  touchRecency(sessionId, key);
  emit();
}
function openFileInSession(sessionId, path, cwd, fileSessionId) {
  var _a;
  const key = hashKey(path);
  let files = filesBySession.get(sessionId);
  if (files === void 0) {
    files = [];
    filesBySession.set(sessionId, files);
  }
  const existing = files.findIndex((f) => f.key === key);
  if (existing !== -1) {
    activeIndexBySession.set(sessionId, existing);
    touchRecency(sessionId, key);
    emit();
    return { ok: true, key, index: existing, alreadyOpen: true, evictedIndex: null, reason: null };
  }
  let evictedIndex = null;
  if (files.length >= MAX_EDITOR_TABS) {
    const rec = (_a = recencyBySession.get(sessionId)) != null ? _a : [];
    const candidates = files.map((f, i) => ({ f, i })).filter(({ f }) => !f.dirty);
    if (candidates.length === 0) {
      emit();
      return { ok: false, key, index: -1, alreadyOpen: false, evictedIndex: null, reason: "limit" };
    }
    candidates.sort((a, b) => {
      const ra = rec.indexOf(a.f.key);
      const rb = rec.indexOf(b.f.key);
      const sa = ra === -1 ? Number.MAX_SAFE_INTEGER : ra;
      const sb = rb === -1 ? Number.MAX_SAFE_INTEGER : rb;
      return sb - sa;
    });
    evictedIndex = candidates[0].i;
    files.splice(evictedIndex, 1);
    const activeIdx = activeIndexBySession.get(sessionId);
    if (activeIdx !== void 0) {
      if (activeIdx === evictedIndex) activeIndexBySession.delete(sessionId);
      else if (activeIdx > evictedIndex) activeIndexBySession.set(sessionId, activeIdx - 1);
    }
  }
  const newIndex = files.length;
  files.push({
    key,
    path,
    label: basename(path),
    content: "",
    loading: true,
    saving: false,
    dirty: false,
    binary: false,
    truncated: false,
    error: null,
    notice: null,
    cwd,
    sessionId: fileSessionId != null ? fileSessionId : sessionId
  });
  activeIndexBySession.set(sessionId, newIndex);
  touchRecency(sessionId, key);
  emit();
  return { ok: true, key, index: newIndex, alreadyOpen: false, evictedIndex, reason: null };
}
function closeFileInSession(sessionId, index) {
  const files = filesBySession.get(sessionId);
  if (files === void 0 || index < 0 || index >= files.length) return false;
  const wasActive = activeIndexBySession.get(sessionId) === index;
  files.splice(index, 1);
  const activeIdx = activeIndexBySession.get(sessionId);
  if (activeIdx !== void 0) {
    if (activeIdx === index) activeIndexBySession.delete(sessionId);
    else if (activeIdx > index) activeIndexBySession.set(sessionId, activeIdx - 1);
  }
  emit();
  return wasActive;
}
function updateFileAt(sessionId, index, patch) {
  const files = filesOf(sessionId);
  if (index < 0 || index >= files.length) return;
  files[index] = { ...files[index], ...patch };
  emit();
}
function updateFileByKey(sessionId, key, patch) {
  if (sessionId === void 0) return;
  const index = getFileIndexByKey(sessionId, key);
  if (index === -1) return;
  updateFileAt(sessionId, index, patch);
}
function commitFileContent(sessionId, key, content) {
  const index = getFileIndexByKey(sessionId, key);
  if (index === -1) return;
  const files = filesOf(sessionId);
  const file = files[index];
  const dirty = content !== file.content;
  files[index] = { ...file, content, dirty };
  emit();
}
function getDiffState() {
  var _a;
  if (activeSessionId === void 0) return null;
  return (_a = diffBySession.get(activeSessionId)) != null ? _a : null;
}
function setDiffStateForSession(sessionId, next) {
  diffBySession.set(sessionId, next);
  emit();
}
function clearDiff(sessionId) {
  if (diffBySession.delete(sessionId)) emit();
}

// src/routes.ts
var READ_ROUTE = "/dsh-text-editor/read";
var WRITE_ROUTE = "/dsh-text-editor/write";
var MONACO_BASE = "/dsh-text-editor/monaco";

// src/monaco.ts
var monacoPromise = null;
var activeMonaco = null;
var activeEditor = null;
var activeDiffEditor = null;
var activeFileKey = null;
function getActiveMonaco() {
  return activeMonaco;
}
function setActiveMonaco(monaco) {
  activeMonaco = monaco;
}
function getActiveEditor() {
  return activeEditor;
}
function setActiveEditor(editor) {
  activeEditor = editor;
}
function getActiveDiffEditor() {
  return activeDiffEditor;
}
function setActiveDiffEditor(editor) {
  activeDiffEditor = editor;
}
function getActiveFileKey() {
  return activeFileKey;
}
function setActiveFileKey(key) {
  activeFileKey = key;
}
function getMonacoWindow() {
  return window;
}
function ensureMonaco() {
  if (monacoPromise !== null) return monacoPromise;
  monacoPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `${MONACO_BASE}/loader.js`;
    script.onload = () => {
      const amd = getMonacoWindow().require;
      if (amd === void 0 || typeof amd.config !== "function") {
        reject(new Error("Monaco AMD loader missing"));
        return;
      }
      amd.config({ paths: { vs: MONACO_BASE } });
      getMonacoWindow().MonacoEnvironment = {
        getWorkerUrl: () => `${MONACO_BASE}/base/worker/workerMain.js`
      };
      amd(["vs/editor/editor.main"], () => {
        const monaco = getMonacoWindow().monaco;
        if (monaco === void 0) reject(new Error("Monaco editor missing"));
        else resolve(monaco);
      });
    };
    script.onerror = () => reject(new Error("Monaco loader failed to load"));
    document.head.appendChild(script);
  });
  return monacoPromise;
}
function currentTheme() {
  return document.body.hasAttribute("data-ds-dark-theme") ? "vs-dark" : "vs";
}

// src/commands.ts
var saveHandler = null;
var closeHandler = null;
var diffNextHandler = null;
var diffPrevHandler = null;
var diffCloseHandler = null;
function setSaveHandler(fn) {
  saveHandler = fn;
}
function setCloseHandler(fn) {
  closeHandler = fn;
}
function setDiffNextHandler(fn) {
  diffNextHandler = fn;
}
function setDiffPrevHandler(fn) {
  diffPrevHandler = fn;
}
function setDiffCloseHandler(fn) {
  diffCloseHandler = fn;
}
function requestSave(key) {
  if (saveHandler !== null) saveHandler(key);
}
function requestClose(key) {
  if (closeHandler !== null) closeHandler(key);
}
function requestDiffNext() {
  if (diffNextHandler !== null) diffNextHandler();
}
function requestDiffPrev() {
  if (diffPrevHandler !== null) diffPrevHandler();
}
function requestDiffClose() {
  if (diffCloseHandler !== null) diffCloseHandler();
}

// src/ui.ts
var React = __toESM(require("react"), 1);
function TabLabel({ sessionId, fileKey }) {
  const state = React.useSyncExternalStore(subscribe, () => getFileByKey(sessionId, fileKey));
  const label = state !== null && state.label !== "" ? state.label : "\u6587\u4EF6";
  return React.createElement(
    "span",
    { className: "dsh-te-tab" },
    React.createElement("span", {
      className: state !== null && state.dirty ? "dsh-te-tab-label dsh-te-tab-dirty" : "dsh-te-tab-label",
      "data-dsh-te-key": fileKey,
      title: state !== null ? state.path : void 0
    }, state !== null && state.dirty ? `${label} \u25CF` : label),
    React.createElement("span", {
      role: "button",
      className: "dsh-te-tab-close",
      title: "\u5173\u95ED",
      "aria-label": "\u5173\u95ED\u7F16\u8F91\u5668",
      onClick: (event) => {
        event.stopPropagation();
        requestClose(fileKey);
      }
    }, "\xD7")
  );
}
function DiffTabLabel() {
  const state = React.useSyncExternalStore(subscribe, getDiffState);
  const count = state !== null ? state.files.length : 0;
  const label = count > 0 ? `\u5DEE\u5F02 \xB7 ${count}` : "\u5DEE\u5F02";
  return React.createElement(
    "span",
    { className: "dsh-te-tab" },
    React.createElement("span", {
      className: "dsh-te-diff-tab-label",
      title: state !== null ? `\u5F53\u524D ${state.index + 1} / ${count}` : void 0
    }, label),
    React.createElement("span", {
      role: "button",
      className: "dsh-te-tab-close",
      title: "\u5173\u95ED",
      "aria-label": "\u5173\u95ED\u5DEE\u5F02\u89C6\u56FE",
      onClick: (event) => {
        event.stopPropagation();
        requestDiffClose();
      }
    }, "\xD7")
  );
}
function FileView({ sessionId, fileKey }) {
  const state = React.useSyncExternalStore(subscribe, () => getFileByKey(sessionId, fileKey));
  React.useEffect(() => {
    noteActiveFile(sessionId, fileKey);
  }, [sessionId, fileKey]);
  if (state === null) {
    return React.createElement(
      "div",
      { className: "dsh-te-root dsh-te-empty" },
      React.createElement("div", { className: "dsh-te-note" }, "\u672A\u6253\u5F00\u6587\u4EF6")
    );
  }
  const statusText = state.loading ? "\u52A0\u8F7D\u4E2D\u2026" : state.saving ? "\u4FDD\u5B58\u4E2D\u2026" : state.error !== null ? state.error : state.notice;
  return React.createElement(
    "div",
    { className: "dsh-te-root" },
    React.createElement(
      "div",
      { className: "dsh-te-toolbar" },
      React.createElement("span", { className: "dsh-te-path", title: state.path }, state.path),
      React.createElement("button", {
        type: "button",
        className: state.dirty ? "dsh-te-save dsh-te-save-dirty" : "dsh-te-save",
        title: "\u4FDD\u5B58 (Ctrl+S)",
        onClick: () => {
          void requestSave(fileKey);
        },
        disabled: state.loading || state.error !== null
      }, state.dirty ? "\u672A\u4FDD\u5B58" : "\u4FDD\u5B58"),
      statusText !== void 0 && statusText !== null && statusText !== "" ? React.createElement("span", {
        className: state.error !== null ? "dsh-te-status dsh-te-status-error" : "dsh-te-status"
      }, statusText) : null,
      state.binary ? React.createElement("span", { className: "dsh-te-status dsh-te-status-error" }, "\u4E8C\u8FDB\u5236\u6587\u4EF6") : null
    ),
    React.createElement(
      "div",
      { className: "dsh-te-body" },
      state.binary || state.error !== null ? React.createElement(
        "div",
        { className: "dsh-te-note" },
        state.binary ? "\u8BE5\u6587\u4EF6\u662F\u4E8C\u8FDB\u5236\u6587\u4EF6\uFF0C\u65E0\u6CD5\u4EE5\u6587\u672C\u65B9\u5F0F\u67E5\u770B\u3002" : `\u65E0\u6CD5\u8BFB\u53D6\u6587\u4EF6\uFF1A${state.error}`
      ) : React.createElement(MonacoHost, { sessionId, fileKey, content: state.content, path: state.path }),
      state.truncated ? React.createElement("div", { className: "dsh-te-note" }, "\u6587\u4EF6\u8F83\u5927\uFF0C\u4EC5\u663E\u793A\u524D 2MB\u3002") : null
    )
  );
}
function MonacoHost({
  sessionId,
  fileKey,
  content,
  path
}) {
  const containerRef = React.useRef(null);
  const [ready, setReady] = React.useState(false);
  const [loadError, setLoadError] = React.useState(null);
  const suppressChangeRef = React.useRef(false);
  React.useEffect(() => {
    let cancelled = false;
    let changeSub = null;
    void ensureMonaco().then((monaco) => {
      if (cancelled || containerRef.current === null) return;
      setActiveMonaco(monaco);
      const editor = monaco.editor.create(containerRef.current, {
        value: content,
        language: languageFor(path),
        theme: currentTheme(),
        automaticLayout: true,
        fontSize: 13,
        lineNumbers: "on",
        minimap: { enabled: false },
        readOnly: false,
        scrollBeyondLastLine: false,
        wordWrap: "off",
        tabSize: 2
      });
      setActiveEditor(editor);
      setActiveFileKey(fileKey);
      changeSub = editor.onDidChangeModelContent(() => {
        if (suppressChangeRef.current) return;
        const s = getFileByKey(sessionId, fileKey);
        if (s !== null && !s.dirty) updateFileByKey(sessionId, fileKey, { dirty: true, notice: null });
      });
      setReady(true);
    }).catch((error) => {
      if (!cancelled) setLoadError(error instanceof Error ? error.message : String(error));
    });
    return () => {
      cancelled = true;
      changeSub == null ? void 0 : changeSub.dispose();
      changeSub = null;
      const editor = getActiveEditor();
      if (editor !== null) {
        commitFileContent(sessionId, fileKey, editor.getValue());
        editor.dispose();
        setActiveEditor(null);
      }
      setActiveFileKey(null);
      setActiveMonaco(null);
    };
  }, []);
  React.useEffect(() => {
    if (!ready) return;
    const editor = getActiveEditor();
    if (editor === null) return;
    if (editor.getValue() !== content) {
      suppressChangeRef.current = true;
      editor.setValue(content);
      suppressChangeRef.current = false;
      const s = getFileByKey(sessionId, fileKey);
      if (s !== null && s.dirty) updateFileByKey(sessionId, fileKey, { dirty: false });
    }
    const monaco = getActiveMonaco();
    if (monaco !== null) {
      const model = editor.getModel();
      if (model !== null && model !== void 0) monaco.editor.setModelLanguage(model, languageFor(path));
    }
  }, [content, path, ready, sessionId, fileKey]);
  if (loadError !== null) {
    return React.createElement(
      "div",
      { className: "dsh-te-note" },
      `Monaco \u52A0\u8F7D\u5931\u8D25\uFF1A${loadError}`
    );
  }
  return React.createElement(
    "div",
    { className: "dsh-te-monaco" },
    React.createElement("div", { ref: containerRef, className: "dsh-te-monaco-host" }),
    !ready ? React.createElement("div", { className: "dsh-te-note" }, "\u52A0\u8F7D Monaco \u7F16\u8F91\u5668\u2026") : null
  );
}
function DiffView() {
  const state = React.useSyncExternalStore(subscribe, getDiffState);
  if (state === null || state.files.length === 0) {
    return React.createElement(
      "div",
      { className: "dsh-te-root dsh-te-empty" },
      React.createElement("div", { className: "dsh-te-note" }, "\u672A\u663E\u793A\u5DEE\u5F02")
    );
  }
  const index = Math.min(Math.max(state.index, 0), state.files.length - 1);
  const file = state.files[index];
  const label = file.label !== void 0 && file.label !== "" ? file.label : file.path !== void 0 && file.path !== "" ? basename(file.path) : `\u6587\u4EF6 ${index + 1}`;
  const hasNext = index < state.files.length - 1;
  const hasPrev = index > 0;
  return React.createElement(
    "div",
    { className: "dsh-te-root" },
    React.createElement(
      "div",
      { className: "dsh-te-toolbar" },
      React.createElement("button", {
        type: "button",
        className: "dsh-te-diff-nav",
        title: "\u4E0A\u4E00\u4E2A\u6587\u4EF6",
        disabled: !hasPrev,
        onClick: () => {
          requestDiffPrev();
        }
      }, "\u4E0A\u4E00\u4E2A"),
      React.createElement("button", {
        type: "button",
        className: "dsh-te-diff-nav",
        title: "\u4E0B\u4E00\u4E2A\u6587\u4EF6",
        disabled: !hasNext,
        onClick: () => {
          requestDiffNext();
        }
      }, "\u4E0B\u4E00\u4E2A"),
      React.createElement("span", { className: "dsh-te-diff-counter" }, `${index + 1} / ${state.files.length}`),
      React.createElement("span", { className: "dsh-te-path", title: label }, label)
    ),
    React.createElement(
      "div",
      { className: "dsh-te-body" },
      file.before === "" && file.after === "" ? React.createElement("div", { className: "dsh-te-note" }, "\u524D\u540E\u5185\u5BB9\u5747\u4E3A\u7A7A\uFF0C\u65E0\u5DEE\u5F02\u53EF\u663E\u793A\u3002") : React.createElement(DiffHost, { file })
    )
  );
}
function DiffHost({ file }) {
  const containerRef = React.useRef(null);
  const [ready, setReady] = React.useState(false);
  const [loadError, setLoadError] = React.useState(null);
  React.useEffect(() => {
    let cancelled = false;
    void ensureMonaco().then((monaco) => {
      if (cancelled || containerRef.current === null) return;
      setActiveMonaco(monaco);
      const editor = monaco.editor.createDiffEditor(containerRef.current, {
        theme: currentTheme(),
        automaticLayout: true,
        fontSize: 13,
        lineNumbers: "on",
        minimap: { enabled: false },
        readOnly: true,
        scrollBeyondLastLine: false,
        renderSideBySide: true,
        enableSplitViewResizing: true,
        // 只隐藏两侧文件的竖直滚动条；横向滚动条保留；diff 位置条（共享 overview ruler）保留。
        scrollbar: { vertical: "hidden" },
        renderOverviewRuler: true
      });
      setActiveDiffEditor(editor);
      setReady(true);
    }).catch((error) => {
      if (!cancelled) setLoadError(error instanceof Error ? error.message : String(error));
    });
    return () => {
      cancelled = true;
      const editor = getActiveDiffEditor();
      if (editor !== null) {
        editor.dispose();
        setActiveDiffEditor(null);
      }
      setActiveMonaco(null);
    };
  }, []);
  React.useEffect(() => {
    var _a, _b;
    if (!ready) return;
    const editor = getActiveDiffEditor();
    if (editor === null) return;
    const monaco = getActiveMonaco();
    if (monaco === null) return;
    const language = languageFor((_b = (_a = file.path) != null ? _a : file.label) != null ? _b : "");
    const original = monaco.editor.createModel(file.before, language);
    const modified = monaco.editor.createModel(file.after, language);
    const previous = editor.getModel();
    editor.setModel({ original, modified });
    if (previous !== null) {
      previous.original.dispose();
      previous.modified.dispose();
    }
  }, [file, ready]);
  if (loadError !== null) {
    return React.createElement(
      "div",
      { className: "dsh-te-note" },
      `Monaco \u52A0\u8F7D\u5931\u8D25\uFF1A${loadError}`
    );
  }
  return React.createElement(
    "div",
    { className: "dsh-te-monaco" },
    React.createElement("div", { ref: containerRef, className: "dsh-te-monaco-host" }),
    !ready ? React.createElement("div", { className: "dsh-te-note" }, "\u52A0\u8F7D Monaco \u5DEE\u5F02\u89C6\u56FE\u2026") : null
  );
}

// src/controller.ts
var FILE_TAB_PREFIX = "dsh-text-editor-";
var DIFF_TAB_ID = "dsh-text-editor-diff";
var slotsRef = null;
var fileEntryDisposers = [];
var diffEntryDisposer = null;
var lastSig = "";
var loadSeqByKey = /* @__PURE__ */ new Map();
function bind(slots, sessions) {
  slotsRef = slots;
  setSaveHandler((key) => {
    const sid = getActiveSessionId();
    if (sid === void 0) return;
    void saveFile(sid, key);
  });
  setCloseHandler(closeEditor);
  setDiffNextHandler(() => advanceDiff(1));
  setDiffPrevHandler(() => advanceDiff(-1));
  setDiffCloseHandler(closeDiff);
  const onKeyDown = (event) => {
    if (!(event.ctrlKey || event.metaKey)) return;
    if (event.key.toLowerCase() !== "s") return;
    if (getActiveIndex() < 0) return;
    event.preventDefault();
    const sid = getActiveSessionId();
    if (sid === void 0) return;
    if (getActiveEditor() !== null) void saveFile(sid, void 0);
  };
  window.addEventListener("keydown", onKeyDown, true);
  let unsubSessions;
  if (sessions !== void 0 && sessions.currentProvideInfo !== void 0) {
    const syncActiveSession = () => {
      const snap = sessions.currentProvideInfo.getSnapshot();
      setActiveSessionId(snap === null || snap === void 0 ? void 0 : snap.sessionId);
    };
    unsubSessions = sessions.currentProvideInfo.subscribe(syncActiveSession);
    syncActiveSession();
  }
  const unsubStore = subscribe(() => {
    const sig = registrationSignature();
    if (sig === lastSig) return;
    lastSig = sig;
    reconcile();
  });
  return () => {
    window.removeEventListener("keydown", onKeyDown, true);
    unsubSessions == null ? void 0 : unsubSessions();
    unsubStore();
    setSaveHandler(null);
    setCloseHandler(null);
    setDiffNextHandler(null);
    setDiffPrevHandler(null);
    setDiffCloseHandler(null);
    disposeAllEntries();
    slotsRef = null;
  };
}
function registrationSignature() {
  var _a;
  const sid = (_a = getActiveSessionId()) != null ? _a : "";
  const files = getActiveFiles();
  const diff = getDiffState();
  const fileSig = files.map((f) => f.key).join("|");
  const diffSig = diff !== null && diff.files.length > 0 ? "1" : "0";
  return `${sid}::${fileSig}::${diffSig}`;
}
function disposeAllEntries() {
  for (const d of fileEntryDisposers) d();
  fileEntryDisposers = [];
  if (diffEntryDisposer !== null) {
    diffEntryDisposer();
    diffEntryDisposer = null;
  }
}
function reconcile() {
  if (slotsRef === null || slotsRef === void 0) return;
  disposeAllEntries();
  const sid = getActiveSessionId();
  if (sid === void 0) return;
  const files = getActiveFiles();
  files.forEach((file, index) => {
    const id = FILE_TAB_PREFIX + file.key;
    fileEntryDisposers.push(slotsRef.register({
      name: "conversation.view",
      id,
      order: 100 + index,
      // label/body 都捕获 sid 与 key：标签按文件显示 basename（含脏标记）与 ×。
      label: () => React2.createElement(TabLabel, { sessionId: sid, fileKey: file.key })
    }, () => React2.createElement(FileView, { sessionId: sid, fileKey: file.key })));
  });
  const diff = getDiffState();
  if (diff !== null && diff.files.length > 0) {
    diffEntryDisposer = slotsRef.register({
      name: "conversation.view",
      id: DIFF_TAB_ID,
      order: 200,
      label: () => React2.createElement(DiffTabLabel, null)
    }, () => React2.createElement(DiffView, null));
  }
}
function openInEditor(path, cwd, sessionId) {
  const sid = sessionId != null ? sessionId : getActiveSessionId();
  if (sid === void 0) return;
  const result = openFileInSession(sid, path, cwd, sessionId);
  if (!result.ok) {
    if (result.reason === "limit") {
      const index = getActiveIndex();
      const file = getFileAt(index);
      if (file !== null) {
        updateFileByKey(sid, file.key, {
          notice: `\u6700\u591A\u540C\u65F6\u6253\u5F00 ${MAX_EDITOR_TABS} \u4E2A\u6587\u4EF6\uFF0C\u4E14\u5F53\u524D\u6253\u5F00\u7684\u6587\u4EF6\u5747\u6709\u672A\u4FDD\u5B58\u4FEE\u6539`
        });
      }
    }
    return;
  }
  const isActive = sid === getActiveSessionId();
  if (!result.alreadyOpen) loadFile(sid, result.key);
  if (isActive) activateTab(result.key);
}
function showDiffInTab(request) {
  var _a, _b;
  const sid = (_a = request.sessionId) != null ? _a : getActiveSessionId();
  if (sid === void 0) return;
  const count = request.files.length;
  const initial = count > 0 ? Math.min(Math.max((_b = request.initialIndex) != null ? _b : 0, 0), count - 1) : 0;
  setDiffStateForSession(sid, { files: request.files, index: initial, sessionId: sid });
  if (sid === getActiveSessionId()) activateDiffTab();
}
function advanceDiff(delta) {
  const state = getDiffState();
  if (state === null || state.files.length === 0) return;
  const sid = state.sessionId;
  if (sid === void 0) return;
  const index = Math.min(Math.max(state.index + delta, 0), state.files.length - 1);
  setDiffStateForSession(sid, { ...state, index });
}
function loadFile(sessionId, key) {
  var _a;
  const file = getFileByKey(sessionId, key);
  if (file === null) return;
  const seq = ((_a = loadSeqByKey.get(key)) != null ? _a : 0) + 1;
  loadSeqByKey.set(key, seq);
  const url = `${READ_ROUTE}?path=${encodeURIComponent(file.path)}` + (file.cwd ? `&cwd=${encodeURIComponent(file.cwd)}` : "");
  fetch(url, { credentials: "same-origin", cache: "no-store" }).then((response) => response.json()).then((data) => {
    var _a2;
    if (loadSeqByKey.get(key) !== seq) return;
    if (!data.ok) throw new Error(data.error || "\u8BFB\u53D6\u5931\u8D25");
    updateFileByKey(sessionId, key, {
      path: data.path || file.path,
      label: basename(file.path),
      content: (_a2 = data.content) != null ? _a2 : "",
      loading: false,
      saving: false,
      binary: !!data.binary,
      truncated: !!data.truncated,
      error: null,
      notice: null,
      dirty: false
    });
  }).catch((error) => {
    if (loadSeqByKey.get(key) !== seq) return;
    updateFileByKey(sessionId, key, {
      content: "",
      loading: false,
      saving: false,
      binary: false,
      truncated: false,
      error: error instanceof Error ? error.message : String(error),
      notice: null,
      dirty: false
    });
  });
}
async function saveFile(sessionId, key) {
  var _a, _b;
  if (sessionId === void 0) return;
  const editor = getActiveEditor();
  if (editor === null) return;
  const targetKey = (_a = getActiveFileKey()) != null ? _a : key;
  if (targetKey === void 0) return;
  const file = getFileByKey(sessionId, targetKey);
  if (file === null) return;
  const content = editor.getValue();
  updateFileByKey(sessionId, targetKey, { saving: true, error: null, notice: null });
  try {
    const response = await fetch(WRITE_ROUTE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: file.path,
        cwd: file.cwd,
        content,
        sessionId: (_b = file.sessionId) != null ? _b : null
      })
    });
    const data = await response.json();
    if (!data.ok) throw new Error(data.error || "\u4FDD\u5B58\u5931\u8D25");
    updateFileByKey(sessionId, targetKey, {
      saving: false,
      notice: "\u5DF2\u4FDD\u5B58",
      error: null,
      dirty: false,
      content
    });
  } catch (error) {
    updateFileByKey(sessionId, targetKey, {
      saving: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}
function closeEditor(key) {
  const sid = getActiveSessionId();
  if (sid === void 0) return;
  const files = filesOf(sid);
  let index = -1;
  if (key !== void 0) index = getFileIndexByKey(sid, key);
  else index = getActiveIndex();
  if (index === -1 || index >= files.length) return;
  const wasActive = closeFileInSession(sid, index);
  if (wasActive) fallbackToChat();
}
function closeDiff() {
  const sid = getActiveSessionId();
  if (sid !== void 0) clearDiff(sid);
  fallbackToChat();
}
function fallbackToChat() {
  let attempts = 0;
  const tryClick = () => {
    const tab = document.querySelector('[role="tablist"] [role="tab"][aria-selected="true"]');
    if (tab instanceof HTMLElement) {
      tab.click();
      return;
    }
    if (++attempts < 20) setTimeout(tryClick, 30);
  };
  tryClick();
}
function activateTab(key) {
  let attempts = 0;
  const tryClick = () => {
    const label = document.querySelector(`[data-dsh-te-key="${key}"]`);
    const tab = label instanceof HTMLElement ? label.closest('[role="tab"]') : null;
    if (tab instanceof HTMLElement) {
      tab.click();
      return;
    }
    if (++attempts < 40) setTimeout(tryClick, 25);
  };
  tryClick();
}
function activateDiffTab() {
  let attempts = 0;
  const tryClick = () => {
    const label = document.querySelector(".dsh-te-diff-tab-label");
    const tab = label instanceof HTMLElement ? label.closest('[role="tab"]') : null;
    if (tab instanceof HTMLElement) {
      tab.click();
      return;
    }
    if (++attempts < 40) setTimeout(tryClick, 25);
  };
  tryClick();
}

// src/client.ts
var inject = ["slots"];
var name = "dsh-text-editor";
function apply(ctx) {
  const slots = ctx.get("slots");
  if (slots === null || slots === void 0) return;
  ctx.effect(() => {
    const tag = document.createElement("style");
    tag.dataset.plugin = "dsh-text-editor";
    tag.textContent = CSS;
    document.head.appendChild(tag);
    const sessions = ctx.get("sessions");
    const unbind = bind(slots, sessions);
    const stopProvide = ctx.provide(TEXT_EDITOR_SERVICE, {
      openFile: (request) => {
        var _a;
        return openInEditor(request.path, (_a = request.cwd) != null ? _a : "", request.sessionId);
      },
      showDiff: (request) => showDiffInTab(request)
    });
    return () => {
      stopProvide();
      unbind();
      tag.remove();
    };
  });
}
return module.exports; } });
