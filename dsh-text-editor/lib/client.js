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

// src/state.ts
var fileState = null;
var listeners = /* @__PURE__ */ new Set();
function emit() {
  for (const fn of listeners) fn();
}
function subscribe(fn) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
function getState() {
  return fileState;
}
function setState(next) {
  fileState = next;
  emit();
}
var diffState = null;
var diffListeners = /* @__PURE__ */ new Set();
function emitDiff() {
  for (const fn of diffListeners) fn();
}
function subscribeDiff(fn) {
  diffListeners.add(fn);
  return () => {
    diffListeners.delete(fn);
  };
}
function getDiffState() {
  return diffState;
}
function setDiffState(next) {
  diffState = next;
  emitDiff();
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
function requestSave() {
  if (saveHandler !== null) saveHandler();
}
function requestClose() {
  if (closeHandler !== null) closeHandler();
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
function TabLabel() {
  const state = React.useSyncExternalStore(subscribe, getState);
  const label = state !== null && state.label !== "" ? state.label : "\u6587\u4EF6";
  return React.createElement(
    "span",
    { className: "dsh-te-tab" },
    React.createElement("span", {
      className: "dsh-te-tab-label",
      title: state !== null ? state.path : void 0
    }, label),
    React.createElement("span", {
      role: "button",
      className: "dsh-te-tab-close",
      title: "\u5173\u95ED",
      "aria-label": "\u5173\u95ED\u7F16\u8F91\u5668",
      onClick: (event) => {
        event.stopPropagation();
        requestClose();
      }
    }, "\xD7")
  );
}
function DiffTabLabel() {
  const state = React.useSyncExternalStore(subscribeDiff, getDiffState);
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
function FileView() {
  const state = React.useSyncExternalStore(subscribe, getState);
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
          void requestSave();
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
      ) : React.createElement(MonacoHost, { content: state.content, path: state.path }),
      state.truncated ? React.createElement("div", { className: "dsh-te-note" }, "\u6587\u4EF6\u8F83\u5927\uFF0C\u4EC5\u663E\u793A\u524D 2MB\u3002") : null
    )
  );
}
function MonacoHost({ content, path }) {
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
      changeSub = editor.onDidChangeModelContent(() => {
        if (suppressChangeRef.current) return;
        const s = getState();
        if (s !== null && !s.dirty) setState({ ...s, dirty: true, notice: null });
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
        editor.dispose();
        setActiveEditor(null);
      }
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
      const s = getState();
      if (s !== null && s.dirty) setState({ ...s, dirty: false });
    }
    const monaco = getActiveMonaco();
    if (monaco !== null) {
      const model = editor.getModel();
      if (model !== null && model !== void 0) monaco.editor.setModelLanguage(model, languageFor(path));
    }
  }, [content, path, ready]);
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
  const state = React.useSyncExternalStore(subscribeDiff, getDiffState);
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
        enableSplitViewResizing: true
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
var FILE_TAB_ID = "dsh-text-editor";
var DIFF_TAB_ID = "dsh-text-editor-diff";
var slotsRef = null;
var registeredDisposer = null;
var diffRegisteredDisposer = null;
var loadSeq = 0;
function bind(slots) {
  slotsRef = slots;
  setSaveHandler(() => {
    const state = getState();
    if (state !== null) void saveFile(state);
  });
  setCloseHandler(closeEditor);
  setDiffNextHandler(() => advanceDiff(1));
  setDiffPrevHandler(() => advanceDiff(-1));
  setDiffCloseHandler(closeDiff);
  const onKeyDown = (event) => {
    if (!(event.ctrlKey || event.metaKey)) return;
    if (event.key.toLowerCase() !== "s") return;
    const state = getState();
    if (state === null) return;
    event.preventDefault();
    void saveFile(state);
  };
  window.addEventListener("keydown", onKeyDown, true);
  return () => {
    window.removeEventListener("keydown", onKeyDown, true);
    setSaveHandler(null);
    setCloseHandler(null);
    setDiffNextHandler(null);
    setDiffPrevHandler(null);
    setDiffCloseHandler(null);
    slotsRef = null;
  };
}
function ensureTab() {
  if (registeredDisposer !== null || slotsRef === null || slotsRef === void 0) return;
  registeredDisposer = slotsRef.register({
    name: "conversation.view",
    id: FILE_TAB_ID,
    order: 100,
    // label 返回 React 元素（DSH 的 resolveSlotLabel 运行时不限类型，返回值
    // 直接作为标签按钮的 children）。内容由 TabLabel 组件渲染：显示被打开
    // 文件的 basename（而非固定「文件」），并带 × 关闭按钮。
    label: () => React2.createElement(TabLabel, null)
  }, FileView);
}
function ensureDiffTab() {
  if (diffRegisteredDisposer !== null || slotsRef === null || slotsRef === void 0) return;
  diffRegisteredDisposer = slotsRef.register({
    name: "conversation.view",
    id: DIFF_TAB_ID,
    order: 110,
    // 由 DiffTabLabel 渲染：显示「差异 · n」并带 × 关闭按钮。
    label: () => React2.createElement(DiffTabLabel, null)
  }, DiffView);
}
function openInEditor(path, cwd, sessionId) {
  ensureTab();
  loadFile(path, cwd, sessionId);
  activateTab();
}
function showDiffInTab(request) {
  ensureDiffTab();
  setDiffState({ files: request.files, index: 0, sessionId: request.sessionId });
  activateDiffTab();
}
function advanceDiff(delta) {
  const state = getDiffState();
  if (state === null || state.files.length === 0) return;
  const index = Math.min(Math.max(state.index + delta, 0), state.files.length - 1);
  setDiffState({ ...state, index });
}
function loadFile(path, cwd, sessionId) {
  const seq = ++loadSeq;
  setState({
    path,
    label: basename(path),
    content: "",
    loading: true,
    saving: false,
    binary: false,
    truncated: false,
    error: null,
    notice: null,
    cwd,
    sessionId,
    dirty: false
  });
  const url = `${READ_ROUTE}?path=${encodeURIComponent(path)}` + (cwd ? `&cwd=${encodeURIComponent(cwd)}` : "");
  fetch(url, { credentials: "same-origin", cache: "no-store" }).then((response) => response.json()).then((data) => {
    var _a;
    if (seq !== loadSeq) return;
    if (!data.ok) throw new Error(data.error || "\u8BFB\u53D6\u5931\u8D25");
    setState({
      path: data.path || path,
      label: basename(path),
      content: (_a = data.content) != null ? _a : "",
      loading: false,
      saving: false,
      binary: !!data.binary,
      truncated: !!data.truncated,
      error: null,
      notice: null,
      cwd,
      sessionId,
      dirty: false
    });
  }).catch((error) => {
    if (seq !== loadSeq) return;
    setState({
      path,
      label: basename(path),
      content: "",
      loading: false,
      saving: false,
      binary: false,
      truncated: false,
      error: error instanceof Error ? error.message : String(error),
      notice: null,
      cwd,
      sessionId,
      dirty: false
    });
  });
}
async function saveFile(state) {
  var _a;
  const editor = getActiveEditor();
  if (editor === null) return;
  const content = editor.getValue();
  setState({ ...state, saving: true, error: null, notice: null });
  try {
    const response = await fetch(WRITE_ROUTE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: state.path,
        cwd: state.cwd,
        content,
        sessionId: (_a = state.sessionId) != null ? _a : null
      })
    });
    const data = await response.json();
    if (!data.ok) throw new Error(data.error || "\u4FDD\u5B58\u5931\u8D25");
    const next = getState();
    if (next === null) return;
    setState({ ...next, saving: false, notice: "\u5DF2\u4FDD\u5B58", error: null, dirty: false });
  } catch (error) {
    const next = getState();
    if (next === null) return;
    setState({
      ...next,
      saving: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}
function closeEditor() {
  if (registeredDisposer !== null) {
    registeredDisposer();
    registeredDisposer = null;
  }
  setState(null);
  fallbackToChat();
}
function closeDiff() {
  if (diffRegisteredDisposer !== null) {
    diffRegisteredDisposer();
    diffRegisteredDisposer = null;
  }
  setDiffState(null);
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
function activateTab() {
  let attempts = 0;
  const tryClick = () => {
    const label = document.querySelector(".dsh-te-tab-label");
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
    const unbind = bind(slots);
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
