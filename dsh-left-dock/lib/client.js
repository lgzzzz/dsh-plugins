window.__ModuleLoader__.load({ id: "dsh-left-dock", factory: (require) => {
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

// src/css.ts
var CSS = String.raw`
.dsh-ld-root {
  --dsh-ld-strip: 40px;
  display: flex;
  flex-direction: row;
  height: 100%;
  min-width: 0;
  box-sizing: border-box;
  overflow: hidden;
  background: var(--dsw-specific-sidebar-fill);
  color: var(--dsw-alias-label-primary);
  font-size: 14px;
  --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2);
  --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2);
}
.dsh-ld-root[data-state="collapsed"] { --dsh-ld-strip: 56px; }

/* 活动栏：始终可见的两枚按钮（会话 / 文件）。 */
.dsh-ld-strip {
  flex: none;
  width: var(--dsh-ld-strip);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 8px 0 8px;
  box-sizing: border-box;
  border-right: 1px solid var(--dsw-alias-border-l3);
}
.dsh-ld-root[data-state="collapsed"] .dsh-ld-strip {
  border-right: none;
  padding-top: 10px;
}

.dsh-ld-btn {
  position: relative;
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}
.dsh-ld-btn:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.dsh-ld-btn:focus-visible { outline: 2px solid var(--dsw-alias-label-primary); outline-offset: -2px; }
.dsh-ld-btn[data-active="true"] {
  background: var(--dsw-alias-interactive-bg-active);
  color: var(--dsw-alias-label-primary);
}
.dsh-ld-btn[data-active="true"]::before {
  content: '';
  position: absolute;
  left: -5px;
  top: 50%;
  width: 2px;
  height: 18px;
  border-radius: 1px;
  transform: translateY(-50%);
  background: var(--dsw-alias-label-primary);
}
.dsh-ld-root[data-state="collapsed"] .dsh-ld-btn {
  width: 36px;
  height: 36px;
  color: var(--dsw-alias-label-primary);
}

/* 面板容器：活动栏右侧，两个面板都挂载、只显示当前那一个。
   两个都保持挂载（而不是切换时卸载）是为了让会话浏览器保留自己的状态
   ——搜索词、分组展开、滚动位置——与上游「收起时也一直挂着」的做法一致。 */
.dsh-ld-panel {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.dsh-ld-slotPane {
  flex: 1;
  min-height: 0;
  display: none;
  flex-direction: column;
  overflow: hidden;
}
.dsh-ld-slotPane[data-active="true"] { display: flex; }

/* ── 会话面板（新会话 + panellist 行 + 会话浏览器 + 页脚） ───────────────── */
.dsh-ld-session {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 6px 12px;
  box-sizing: border-box;
}
.dsh-ld-brand {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 36px;
  padding: 0 4px;
  margin-bottom: 8px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  overflow: hidden;
}
.dsh-ld-brand:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-ld-brandMark {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.dsh-ld-brandName {
  display: inline-flex;
  align-items: center;
  min-width: 0;
  height: 24px;
  font-size: 16px;
  font-weight: 600;
  line-height: 24px;
  letter-spacing: 0.04em;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.dsh-ld-new {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 38px;
  padding: 8px 16px;
  margin: 0 2px 8px;
  box-sizing: border-box;
  border: 0.5px solid var(--dsw-alias-border-l3);
  border-radius: 12px;
  background: var(--dsw-alias-button-elevated-fill);
  color: var(--dsw-alias-label-primary);
  font-size: 14px;
  font-weight: 500;
  line-height: 22px;
  cursor: pointer;
  overflow: hidden;
}
.dsh-ld-new:hover { background: var(--dsw-alias-button-floating-hover); }
.dsh-ld-new:focus-visible { outline: 2px solid var(--dsw-alias-label-primary); outline-offset: -2px; }
.dsh-ld-panels {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 8px;
}
.dsh-ld-panelRow {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 36px;
  padding: 7px 8px;
  box-sizing: border-box;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  line-height: 22px;
  text-align: left;
  cursor: pointer;
}
.dsh-ld-panelRow:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-ld-panelRow[data-active="true"] {
  background: var(--dsw-alias-interactive-bg-active);
  color: var(--dsw-alias-label-primary);
  font-weight: 500;
}
.dsh-ld-panelGlyph {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.dsh-ld-panelTitle {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 会话浏览器区域：与上游同一套负边距，让内嵌滚动条贴到栏边。 */
.dsh-ld-region {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  margin-left: -4px;
  margin-right: -12px;
  padding-left: 4px;
  overflow: hidden;
}
.dsh-ld-foot {
  flex: none;
  display: flex;
  flex-direction: column;
}
.dsh-ld-footActions,
.dsh-ld-settings {
  flex: none;
  min-width: 0;
  width: 100%;
}
.dsh-ld-footActions { display: flex; }

/* ── 文件面板 ──────────────────────────────────────────────────────────── */
.dsh-ld-files {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.dsh-ld-filesHead {
  flex: none;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 12px 12px 6px;
}
.dsh-ld-path {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary);
}
.dsh-ld-pathInner {
  display: block;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.dsh-ld-pathName { color: var(--dsw-alias-label-primary); font-weight: 600; }
.dsh-ld-tool {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}
.dsh-ld-tool:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.dsh-ld-tree {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 2px 6px 12px;
  box-sizing: border-box;
}
.dsh-ld-level {
  margin: 0;
  padding: 0;
  list-style: none;
}
.dsh-ld-item { margin: 0; }
.dsh-ld-row {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-height: 26px;
  padding: 2px 6px;
  box-sizing: border-box;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
  line-height: 20px;
  text-align: left;
  cursor: pointer;
  overflow: hidden;
}
.dsh-ld-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-ld-row:focus-visible { outline: 2px solid var(--dsw-alias-label-primary); outline-offset: -2px; }
.dsh-ld-row[data-kind="other"] {
  color: var(--dsw-alias-label-secondary);
  cursor: default;
}
.dsh-ld-row[data-kind="other"]:hover { background: transparent; }
.dsh-ld-glyph {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  color: var(--dsw-alias-label-secondary);
}
.dsh-ld-name {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.dsh-ld-note {
  padding: 4px 12px;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary);
}
.dsh-ld-status {
  flex: 1;
  display: flex;
  align-items: flex-start;
  padding: 4px 16px;
}
.dsh-ld-statusLine {
  margin: 0;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary);
}
`;

// src/dock.ts
var import_react3 = require("react");

// src/files.ts
var import_react2 = require("react");

// src/icons.ts
var import_react = require("react");
function strokeIcon(children, size) {
  return (0, import_react.createElement)(
    "svg",
    {
      width: size,
      height: size,
      viewBox: "0 0 16 16",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.4,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      "aria-hidden": "true",
      focusable: "false"
    },
    children
  );
}
function IconChat({ size = 16 }) {
  return strokeIcon(
    [
      (0, import_react.createElement)("path", { key: "b", d: "M2.75 3.75h10.5v7.5H8.1l-3.35 2.6v-2.6H2.75z" }),
      (0, import_react.createElement)("path", { key: "l1", d: "M5.4 6.6h5.2" }),
      (0, import_react.createElement)("path", { key: "l2", d: "M5.4 8.9h3.2" })
    ],
    size
  );
}
function IconFolder({ size = 16 }) {
  return strokeIcon(
    (0, import_react.createElement)("path", { d: "M2.4 4h4.1l1.25 1.6h5.85v6.9H2.4z" }),
    size
  );
}
function IconPlus({ size = 16 }) {
  return strokeIcon(
    [(0, import_react.createElement)("path", { key: "v", d: "M8 3.4v9.2" }), (0, import_react.createElement)("path", { key: "h", d: "M3.4 8h9.2" })],
    size
  );
}
function IconRefresh({ size = 16 }) {
  return strokeIcon(
    [
      (0, import_react.createElement)("path", { key: "a", d: "M13 8a5 5 0 1 1-1.45-3.52" }),
      (0, import_react.createElement)("path", { key: "b", d: "M13.1 2.7v3.2H9.9" })
    ],
    size
  );
}
function IconChevron({ size = 12, open = false }) {
  return strokeIcon(
    (0, import_react.createElement)("path", { d: open ? "M4.4 6.4 8 10l3.6-3.6" : "M6.4 4.4 10 8l-3.6 3.6" }),
    size
  );
}
function IconDir({ size = 16 }) {
  return strokeIcon(
    (0, import_react.createElement)("path", { d: "M2.4 4h4.1l1.25 1.6h5.85v6.9H2.4z" }),
    size
  );
}
function IconFile({ size = 16 }) {
  return strokeIcon(
    [
      (0, import_react.createElement)("path", { key: "body", d: "M4.2 2.4h4.6l3 3v8.2H4.2z" }),
      (0, import_react.createElement)("path", { key: "fold", d: "M8.8 2.4v3h3" })
    ],
    size
  );
}

// src/files.ts
var byName = new Intl.Collator(void 0, { numeric: true, sensitivity: "base" });
function orderEntries(entries) {
  return [...entries].sort((left, right) => {
    const group = Number(right.type === "directory") - Number(left.type === "directory");
    return group !== 0 ? group : byName.compare(left.name, right.name);
  });
}
function childPath(parent, name2) {
  return `${parent.replace(/[/\\]+$/, "")}/${name2}`;
}
function failureLine(t, failure) {
  var _a;
  switch (failure.code) {
    case "workspace-file/not-found":
      return t("files.error.notFound");
    case "workspace-file/outside-workspace":
      return t("files.error.outsideWorkspace");
    case "workspace-file/not-directory":
      return t("files.error.notDirectory");
    default:
      return t("files.error.unavailable", { message: (_a = failure.message) != null ? _a : "" });
  }
}
function splitPath(path) {
  const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return cut < 0 ? { directory: "", name: path } : { directory: path.slice(0, cut + 1), name: path.slice(cut + 1) };
}
function note(text, kind, key) {
  return (0, import_react2.createElement)("li", { key, className: "dsh-ld-note", "data-dsh-ld-note": kind }, text);
}
function FilesPanel({ sessionId, root, serviceReady, t, listDirectory, openFile }) {
  const ready = sessionId !== void 0 && root !== "" && serviceReady;
  const [levels, setLevels] = (0, import_react2.useState)({});
  const [expanded, setExpanded] = (0, import_react2.useState)(() => root === "" ? [] : [root]);
  const [revision, setRevision] = (0, import_react2.useState)(0);
  const [notice, setNotice] = (0, import_react2.useState)(null);
  const controller = (0, import_react2.useRef)(null);
  (0, import_react2.useEffect)(() => {
    if (!ready) return void 0;
    const active = new AbortController();
    controller.current = active;
    setLevels({});
    setExpanded([root]);
    setRevision((value) => value + 1);
    return () => {
      active.abort();
      if (controller.current === active) controller.current = null;
    };
  }, [ready, root, sessionId]);
  const load = (0, import_react2.useCallback)((path) => {
    const active = controller.current;
    if (active === null || active.signal.aborted || sessionId === void 0) return;
    setLevels((previous) => ({ ...previous, [path]: { kind: "loading" } }));
    const settle = (state) => {
      if (active.signal.aborted) return;
      setLevels((previous) => ({ ...previous, [path]: state }));
    };
    void listDirectory(sessionId, path, active.signal).then(
      (result) => {
        var _a, _b;
        settle(result.ok ? { kind: "ready", listing: (_a = result.value) != null ? _a : {} } : { kind: "failed", failure: (_b = result.error) != null ? _b : {} });
      },
      (error) => {
        settle({ kind: "failed", failure: { message: error instanceof Error ? error.message : String(error) } });
      }
    );
  }, [listDirectory, sessionId]);
  (0, import_react2.useEffect)(() => {
    if (!ready) return;
    for (const path of expanded) {
      if (levels[path] === void 0) load(path);
    }
  }, [ready, expanded, levels, load, revision]);
  const toggleDir = (0, import_react2.useCallback)((path) => {
    setExpanded((previous) => previous.includes(path) ? previous.filter((item) => item !== path) : [...previous, path]);
  }, []);
  const reload = (0, import_react2.useCallback)(() => {
    setLevels({});
    setNotice(null);
    setRevision((value) => value + 1);
  }, []);
  const open = (0, import_react2.useCallback)((path) => {
    setNotice(openFile(path) ? null : t("files.openFailed"));
  }, [openFile, t]);
  if (!ready) {
    const noWorkspace = sessionId === void 0 || root === "";
    return (0, import_react2.createElement)(
      "div",
      { className: "dsh-ld-files", "data-dsh-ld-files": noWorkspace ? "empty" : "no-service" },
      (0, import_react2.createElement)(
        "div",
        { className: "dsh-ld-status" },
        (0, import_react2.createElement)("p", { className: "dsh-ld-statusLine" }, noWorkspace ? t("files.noWorkspace") : t("files.noService"))
      )
    );
  }
  const renderLevel = (path, depth) => {
    var _a, _b;
    const level = levels[path];
    if (level === void 0 || level.kind === "loading") return [note(t("files.loading"), "loading", `${path}::loading`)];
    if (level.kind === "failed") {
      return [(0, import_react2.createElement)("li", {
        key: `${path}::failed`,
        className: "dsh-ld-note",
        "data-dsh-ld-note": "failed",
        "data-dsh-ld-code": (_a = level.failure.code) != null ? _a : ""
      }, failureLine(t, level.failure))];
    }
    const entries = orderEntries((_b = level.listing.entries) != null ? _b : []);
    const rows = [];
    if (entries.length === 0) rows.push(note(t("files.empty"), "empty", `${path}::empty`));
    for (const entry of entries) {
      const child = childPath(path, entry.name);
      const indent = { paddingLeft: `${6 + depth * 14}px` };
      if (entry.type === "directory") {
        const open2 = expanded.includes(child);
        rows.push((0, import_react2.createElement)(
          "li",
          { key: child, className: "dsh-ld-item" },
          (0, import_react2.createElement)(
            "button",
            {
              type: "button",
              className: "dsh-ld-row",
              style: indent,
              "data-dsh-ld-entry": "directory",
              "data-dsh-ld-path": child,
              "aria-expanded": open2,
              onClick: () => {
                toggleDir(child);
              }
            },
            (0, import_react2.createElement)("span", { className: "dsh-ld-glyph" }, (0, import_react2.createElement)(IconChevron, { size: 12, open: open2 })),
            (0, import_react2.createElement)("span", { className: "dsh-ld-glyph" }, (0, import_react2.createElement)(IconDir, { size: 15 })),
            (0, import_react2.createElement)("span", { className: "dsh-ld-name" }, entry.name)
          )
        ));
        if (open2) rows.push(...renderLevel(child, depth + 1));
        continue;
      }
      if (entry.type === "file") {
        rows.push((0, import_react2.createElement)(
          "li",
          { key: child, className: "dsh-ld-item" },
          (0, import_react2.createElement)(
            "button",
            {
              type: "button",
              className: "dsh-ld-row",
              style: indent,
              title: child,
              "data-dsh-ld-entry": "file",
              "data-dsh-ld-path": child,
              onClick: () => {
                open(child);
              }
            },
            (0, import_react2.createElement)("span", { className: "dsh-ld-glyph" }),
            (0, import_react2.createElement)("span", { className: "dsh-ld-glyph" }, (0, import_react2.createElement)(IconFile, { size: 15 })),
            (0, import_react2.createElement)("span", { className: "dsh-ld-name" }, entry.name)
          )
        ));
        continue;
      }
      rows.push((0, import_react2.createElement)(
        "li",
        { key: child, className: "dsh-ld-item" },
        (0, import_react2.createElement)(
          "span",
          {
            className: "dsh-ld-row",
            style: indent,
            "data-dsh-ld-entry": "other",
            "data-dsh-ld-path": child,
            "aria-disabled": "true",
            title: t("files.other")
          },
          (0, import_react2.createElement)("span", { className: "dsh-ld-glyph" }),
          (0, import_react2.createElement)("span", { className: "dsh-ld-name" }, entry.name)
        )
      ));
    }
    if (level.listing.truncated === true) rows.push(note(t("files.truncated"), "truncated", `${path}::truncated`));
    return rows;
  };
  const { directory, name: name2 } = splitPath(root);
  return (0, import_react2.createElement)(
    "div",
    { className: "dsh-ld-files", "data-dsh-ld-files": "tree", "data-dsh-ld-root": root },
    (0, import_react2.createElement)(
      "div",
      { className: "dsh-ld-filesHead" },
      (0, import_react2.createElement)(
        "div",
        { className: "dsh-ld-path", title: root, "data-dsh-ld-path": root },
        (0, import_react2.createElement)(
          "span",
          { className: "dsh-ld-pathInner" },
          directory === "" ? null : (0, import_react2.createElement)("span", { className: "dsh-ld-pathDir" }, directory),
          (0, import_react2.createElement)("span", { className: "dsh-ld-pathName" }, name2)
        )
      ),
      (0, import_react2.createElement)("button", {
        type: "button",
        className: "dsh-ld-tool",
        title: t("files.reload"),
        "aria-label": t("files.reload"),
        "data-dsh-ld-reload": "",
        onClick: reload
      }, (0, import_react2.createElement)(IconRefresh, { size: 14 }))
    ),
    notice === null ? null : (0, import_react2.createElement)("div", { className: "dsh-ld-note", "data-dsh-ld-note": "notice" }, notice),
    (0, import_react2.createElement)(
      "div",
      { className: "dsh-ld-tree" },
      (0, import_react2.createElement)("ul", { className: "dsh-ld-level" }, renderLevel(root, 0))
    )
  );
}

// src/layout-store.ts
var SIDEBAR_MIN = 264;
var SIDEBAR_MAX = 420;
function clampTrackWidth(px) {
  if (!Number.isFinite(px)) return SIDEBAR_MIN;
  return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(px)));
}
function rootLayoutActions(slots) {
  var _a;
  if (typeof slots.entries !== "function" || typeof slots.resolveStore !== "function") return void 0;
  let entries;
  try {
    entries = (_a = slots.entries("root")) != null ? _a : [];
  } catch {
    return void 0;
  }
  for (const entry of entries) {
    const handle = entry == null ? void 0 : entry.store;
    if (handle === void 0 || handle === null) continue;
    let instance;
    try {
      instance = slots.resolveStore(handle, void 0);
    } catch {
      continue;
    }
    const actions = instance == null ? void 0 : instance.actions;
    if (actions === void 0 || actions === null) continue;
    if (typeof actions.setSidebar === "function") return actions;
  }
  return void 0;
}

// src/persist.ts
var DEFAULT_STATE = {
  mode: "session",
  open: true,
  sessionWidth: 300,
  filesWidth: 360
};
var STORAGE_KEY = "dsh.left-dock.v1";
function readWidth(raw, fallback) {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < SIDEBAR_MIN) return fallback;
  return clampTrackWidth(raw);
}
function loadState() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null || raw === "") return { ...DEFAULT_STATE };
    const parsed = JSON.parse(raw);
    return {
      mode: parsed["mode"] === "files" ? "files" : "session",
      open: parsed["open"] !== false,
      sessionWidth: readWidth(parsed["sessionWidth"], DEFAULT_STATE.sessionWidth),
      filesWidth: readWidth(parsed["filesWidth"], DEFAULT_STATE.filesWidth)
    };
  } catch {
    return { ...DEFAULT_STATE };
  }
}
function saveState(state) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
  }
}

// src/locales.ts
var NS = "leftDock";
var zh = {
  "strip.session": "\u4F1A\u8BDD",
  "strip.files": "\u6587\u4EF6",
  "strip.session.toggle": "\u5C55\u5F00/\u6536\u8D77\u4F1A\u8BDD\u4FA7\u680F",
  "strip.files.toggle": "\u5C55\u5F00/\u6536\u8D77\u6587\u4EF6\u4FA7\u680F",
  "session.new": "\u65B0\u4F1A\u8BDD",
  "brand.localBuild": "\u672C\u5730\u6784\u5EFA",
  "files.reload": "\u91CD\u65B0\u8BFB\u53D6",
  "files.loading": "\u6B63\u5728\u8BFB\u53D6\u2026",
  "files.empty": "\u7A7A\u76EE\u5F55",
  "files.truncated": "\u6761\u76EE\u592A\u591A\uFF0C\u53EA\u663E\u793A\u4E86\u4E00\u90E8\u5206\u3002",
  "files.other": "\u8FD9\u4E0D\u662F\u6587\u4EF6\u6216\u76EE\u5F55\uFF0C\u6CA1\u6CD5\u6253\u5F00\u3002",
  "files.noWorkspace": "\u5F53\u524D\u4F1A\u8BDD\u6CA1\u6709\u5DE5\u4F5C\u533A\u76EE\u5F55\u3002",
  "files.noService": "\u6587\u4EF6\u670D\u52A1\u4E0D\u53EF\u7528\uFF1Aremote.workspaceFiles \u672A\u5C31\u7EEA\u3002",
  "files.openFailed": "\u6587\u672C\u7F16\u8F91\u5668\u4E0D\u53EF\u7528\uFF1Adsh-text-editor \u670D\u52A1\u672A\u5C31\u7EEA\u3002",
  "files.error.notFound": "\u8FD9\u4E2A\u76EE\u5F55\u4E0D\u5728\u4E86\u3002\u53EF\u80FD\u5DF2\u88AB\u79FB\u52A8\u6216\u5220\u9664\u3002",
  "files.error.outsideWorkspace": "\u8FD9\u4E2A\u76EE\u5F55\u5728\u5DE5\u4F5C\u533A\u4E4B\u5916\uFF0C\u4E0D\u4F1A\u8BFB\u53D6\u5B83\u3002",
  "files.error.notDirectory": "\u8FD9\u4E0D\u662F\u4E00\u4E2A\u76EE\u5F55\u3002",
  "files.error.unavailable": "\u8BFB\u53D6\u5931\u8D25\uFF1A{message}"
};
var en = {
  "strip.session": "Sessions",
  "strip.files": "Files",
  "strip.session.toggle": "Toggle the session sidebar",
  "strip.files.toggle": "Toggle the file sidebar",
  "session.new": "New session",
  "brand.localBuild": "Local build",
  "files.reload": "Reload",
  "files.loading": "Reading\u2026",
  "files.empty": "Empty directory",
  "files.truncated": "Too many entries, showing only some of them.",
  "files.other": "Not a file or a directory, so it cannot be opened.",
  "files.noWorkspace": "This session has no workspace directory.",
  "files.noService": "File service unavailable: remote.workspaceFiles is not ready.",
  "files.openFailed": "Text editor unavailable: the dsh-text-editor service is not ready.",
  "files.error.notFound": "That directory is gone. It may have been moved or deleted.",
  "files.error.outsideWorkspace": "That directory is outside the workspace, so it will not be read.",
  "files.error.notDirectory": "That is not a directory.",
  "files.error.unavailable": "Read failed: {message}"
};
function interpolate(template, params) {
  if (params === void 0) return template;
  return template.replace(/\{(\w+)\}/g, (match, name2) => {
    const value = params[name2];
    return value === void 0 ? match : String(value);
  });
}
function fallbackTranslate(key, params) {
  const template = zh[key];
  return interpolate(template === void 0 ? key : template, params);
}
function safeTranslate(candidate) {
  if (typeof candidate !== "function") return fallbackTranslate;
  const fn = candidate;
  return (key, params) => {
    try {
      const text = fn(key, params);
      return typeof text === "string" && text !== "" ? text : fallbackTranslate(key, params);
    } catch {
      return fallbackTranslate(key, params);
    }
  };
}

// src/dock.ts
var BRAND_MARK = "sidebar.brand.mark";
var BRAND_NAME = "sidebar.brand.name";
var PANELLIST = "sidebar.panellist";
var WORKSPACES = "sidebar.workspaces";
var FOOTER_ACTION = "sidebar.footer.action";
var SETTINGS = "sidebar.settings";
var EMPTY_PANELS = [];
var UNAVAILABLE_LIST = async () => ({
  ok: false,
  error: { code: "dock/no-service", message: "remote.workspaceFiles" }
});
function stripButton(key, label, active, icon, onClick) {
  return (0, import_react3.createElement)("button", {
    key,
    type: "button",
    className: "dsh-ld-btn",
    title: label,
    "aria-label": label,
    "aria-pressed": active,
    "data-dsh-ld-action": key,
    "data-active": active ? "true" : void 0,
    onClick
  }, icon);
}
function LeftDock(props) {
  const t = safeTranslate(props.t);
  const renderSlot = typeof props.renderSlot === "function" ? props.renderSlot : void 0;
  const collapsed = props.collapsed === true;
  const trackWidth = typeof props.width === "number" && Number.isFinite(props.width) ? Math.round(props.width) : 0;
  const sessionsBound = (0, import_react3.useRef)(typeof props.useSessions === "function").current;
  const panelsBound = (0, import_react3.useRef)(typeof props.usePanels === "function").current;
  const fileServiceBound = (0, import_react3.useRef)(typeof props.useFileService === "function").current;
  const booted = (0, import_react3.useRef)(null);
  if (booted.current === null) booted.current = loadState();
  const boot = booted.current;
  const [mode, setMode] = (0, import_react3.useState)(boot.mode);
  const [sessionWidth, setSessionWidth] = (0, import_react3.useState)(boot.sessionWidth);
  const [filesWidth, setFilesWidth] = (0, import_react3.useState)(boot.filesWidth);
  const sessionsHook = sessionsBound ? props.useSessions : void 0;
  const panelsHook = panelsBound ? props.usePanels : void 0;
  const fileServiceHook = fileServiceBound ? props.useFileService : void 0;
  const sessionId = sessionsHook === void 0 ? void 0 : sessionsHook((snapshot) => snapshot.current);
  const cwd = sessionsHook === void 0 ? void 0 : sessionsHook((snapshot) => {
    var _a, _b;
    return sessionId === void 0 ? void 0 : (_b = (_a = snapshot.byId) == null ? void 0 : _a[sessionId]) == null ? void 0 : _b.cwd;
  });
  const panels = panelsHook === void 0 ? EMPTY_PANELS : panelsHook((list) => list);
  const fileServiceReady = fileServiceHook === void 0 ? false : fileServiceHook((ready) => ready);
  const appliedMode = (0, import_react3.useRef)(null);
  (0, import_react3.useEffect)(() => {
    if (collapsed) {
      appliedMode.current = null;
      return;
    }
    if (appliedMode.current === mode) return;
    appliedMode.current = mode;
    if (typeof props.setSidebarWidth !== "function") return;
    props.setSidebarWidth(mode === "files" ? filesWidth : sessionWidth);
  }, [mode, collapsed]);
  const synced = (0, import_react3.useRef)(false);
  (0, import_react3.useEffect)(() => {
    var _a, _b;
    if (synced.current) return;
    synced.current = true;
    if (boot.open && collapsed) (_a = props.toggleSidebar) == null ? void 0 : _a.call(props);
    else if (!boot.open && !collapsed) (_b = props.toggleSidebar) == null ? void 0 : _b.call(props);
  }, []);
  (0, import_react3.useEffect)(() => {
    saveState({ mode, open: !collapsed, sessionWidth, filesWidth });
  }, [mode, collapsed, sessionWidth, filesWidth]);
  const previousMode = (0, import_react3.useRef)(mode);
  const previousCollapsed = (0, import_react3.useRef)(collapsed);
  const previousWidth = (0, import_react3.useRef)(trackWidth);
  (0, import_react3.useEffect)(() => {
    const wasCollapsed = previousCollapsed.current;
    const previousModeValue = previousMode.current;
    const previousWidthValue = previousWidth.current;
    previousCollapsed.current = collapsed;
    previousMode.current = mode;
    previousWidth.current = trackWidth;
    if (collapsed || wasCollapsed) return;
    if (previousModeValue !== mode) return;
    if (trackWidth === 0 || trackWidth === previousWidthValue) return;
    if (mode === "files") setFilesWidth(trackWidth);
    else setSessionWidth(trackWidth);
  }, [trackWidth, mode, collapsed]);
  const revealSession = () => {
    var _a, _b;
    if (mode === "session") {
      (_a = props.toggleSidebar) == null ? void 0 : _a.call(props);
      return;
    }
    setMode("session");
    if (collapsed) (_b = props.toggleSidebar) == null ? void 0 : _b.call(props);
  };
  const revealFiles = () => {
    var _a, _b;
    if (mode === "files") {
      (_a = props.toggleSidebar) == null ? void 0 : _a.call(props);
      return;
    }
    setMode("files");
    if (collapsed) (_b = props.toggleSidebar) == null ? void 0 : _b.call(props);
  };
  const sessionPanel = renderSlot === void 0 ? null : (0, import_react3.createElement)(
    "div",
    { className: "dsh-ld-session", "data-dsh-ld-panel": "session" },
    (0, import_react3.createElement)(
      "button",
      {
        type: "button",
        className: "dsh-ld-brand",
        title: t("session.new"),
        "data-dsh-ld-brand": "",
        onClick: () => {
          var _a;
          (_a = props.startSession) == null ? void 0 : _a.call(props);
        }
      },
      (0, import_react3.createElement)("span", { className: "dsh-ld-brandMark" }, renderSlot(BRAND_MARK, { size: 24 })),
      (0, import_react3.createElement)(
        "span",
        { className: "dsh-ld-brandName" },
        renderSlot(BRAND_NAME, {}, { fallback: (0, import_react3.createElement)("span", null, t("brand.localBuild")) })
      )
    ),
    (0, import_react3.createElement)("button", {
      type: "button",
      className: "dsh-ld-new",
      "data-dsh-ld-new": "",
      onClick: () => {
        var _a;
        (_a = props.startSession) == null ? void 0 : _a.call(props);
      }
    }, (0, import_react3.createElement)(IconPlus, { size: 14 }), (0, import_react3.createElement)("span", null, t("session.new"))),
    panels.length === 0 ? null : (0, import_react3.createElement)("nav", { className: "dsh-ld-panels" }, panels.map((panel) => (0, import_react3.createElement)(
      "button",
      {
        key: panel.id,
        type: "button",
        className: "dsh-ld-panelRow",
        "data-dsh-ld-panel-row": panel.id,
        onClick: () => {
          var _a;
          (_a = props.selectPanel) == null ? void 0 : _a.call(props, panel.id);
        }
      },
      (0, import_react3.createElement)("span", { className: "dsh-ld-panelGlyph" }, renderSlot(PANELLIST, { size: 16, active: false }, { only: panel.id })),
      (0, import_react3.createElement)("span", { className: "dsh-ld-panelTitle" }, panel.label)
    ))),
    (0, import_react3.createElement)(
      "div",
      { className: "dsh-ld-region", "data-dsh-ld-region": "" },
      renderSlot(WORKSPACES, {
        wide: true,
        expandSidebar: () => {
          var _a;
          if (collapsed) (_a = props.toggleSidebar) == null ? void 0 : _a.call(props);
        }
      })
    ),
    (0, import_react3.createElement)(
      "div",
      { className: "dsh-ld-foot" },
      (0, import_react3.createElement)("div", { className: "dsh-ld-footActions" }, renderSlot(FOOTER_ACTION, { wide: true })),
      (0, import_react3.createElement)("div", { className: "dsh-ld-settings" }, renderSlot(SETTINGS, { wide: true }))
    )
  );
  const listDirectory = typeof props.listDirectory === "function" ? props.listDirectory : UNAVAILABLE_LIST;
  const filesPanel = (0, import_react3.createElement)(FilesPanel, {
    sessionId,
    root: cwd != null ? cwd : "",
    serviceReady: fileServiceReady,
    t,
    listDirectory,
    openFile: (path) => {
      var _a;
      return ((_a = props.openFile) == null ? void 0 : _a.call(props, path, cwd != null ? cwd : "", sessionId)) === true;
    }
  });
  const pane = (key, content) => (0, import_react3.createElement)("div", {
    key,
    className: "dsh-ld-slotPane",
    "data-dsh-ld-pane": key,
    "data-active": mode === key ? "true" : void 0
  }, content);
  return (0, import_react3.createElement)(
    "div",
    {
      className: "dsh-ld-root",
      "data-dsh-left-dock": collapsed ? "collapsed" : mode,
      "data-state": collapsed ? "collapsed" : mode
    },
    (0, import_react3.createElement)(
      "nav",
      { className: "dsh-ld-strip", "aria-label": t("strip.session") },
      stripButton("session", t("strip.session.toggle"), !collapsed && mode === "session", (0, import_react3.createElement)(IconChat, { size: 18 }), revealSession),
      stripButton("files", t("strip.files.toggle"), !collapsed && mode === "files", (0, import_react3.createElement)(IconFolder, { size: 18 }), revealFiles)
    ),
    collapsed ? null : (0, import_react3.createElement)(
      "div",
      { className: "dsh-ld-panel" },
      pane("session", sessionPanel),
      pane("files", filesPanel)
    )
  );
}

// src/observable.ts
function createObservable(initial) {
  let value = initial;
  const listeners = /* @__PURE__ */ new Set();
  return {
    getSnapshot: () => value,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set: (next) => {
      if (Object.is(next, value)) return;
      value = next;
      for (const listener of [...listeners]) {
        try {
          listener();
        } catch (error) {
          console.error("[dsh-left-dock] panels subscriber failed:", error);
        }
      }
    },
    dispose: () => {
      listeners.clear();
    }
  };
}

// src/client.ts
var name = "dsh-left-dock";
var inject = ["slots"];
var CHILDREN = {
  "sidebar.brand.mark": { kind: "single", scope: "root" },
  "sidebar.brand.name": { kind: "single", scope: "root" },
  "sidebar.panellist": { kind: "list", scope: "root" },
  "sidebar.workspaces": { kind: "single", scope: "root" },
  "sidebar.settings": { kind: "single", scope: "root" },
  "sidebar.footer.action": { kind: "list", scope: "root" }
};
function labelOf(entry) {
  var _a, _b, _c;
  const raw = (_a = entry == null ? void 0 : entry.options) == null ? void 0 : _a.label;
  if (typeof raw === "string") return raw;
  if (typeof raw === "function") {
    try {
      const value = raw();
      if (typeof value === "string") return value;
    } catch {
    }
  }
  return String((_c = (_b = entry == null ? void 0 : entry.options) == null ? void 0 : _b.id) != null ? _c : "");
}
function resolveWorkspaceList(ctx) {
  let namespace;
  try {
    namespace = ctx.get("remote.workspaceFiles");
  } catch (error) {
    console.error("[dsh-left-dock] ctx.get(remote.workspaceFiles) failed:", error);
    return void 0;
  }
  if (namespace === void 0 || namespace === null) return void 0;
  const list = namespace.list;
  return typeof list === "function" ? list.bind(namespace) : void 0;
}
function bindRemoteList(ctx, assign) {
  if (typeof ctx.inject !== "function") return void 0;
  let fiber;
  try {
    fiber = ctx.inject(["remote", "remote.workspaceFiles"], (scoped) => {
      scoped.effect(() => {
        var _a;
        const namespace = (_a = scoped.remote) == null ? void 0 : _a.workspaceFiles;
        const list = namespace == null ? void 0 : namespace.list;
        assign(typeof list === "function" ? list.bind(namespace) : void 0);
        return () => {
          assign(void 0);
        };
      });
    });
  } catch (error) {
    console.error("[dsh-left-dock] ctx.inject(remote.workspaceFiles) failed:", error);
    return void 0;
  }
  return () => {
    assign(void 0);
    const disposable = fiber;
    if (disposable !== void 0 && disposable !== null && typeof disposable.dispose === "function") {
      disposable.dispose();
    }
  };
}
function apply(ctx) {
  const slots = ctx.get("slots");
  if (slots === void 0 || slots === null) return;
  if (typeof slots.register !== "function" || typeof slots.inject !== "function") return;
  ctx.effect(() => {
    const tag = document.createElement("style");
    tag.dataset.plugin = name;
    tag.textContent = CSS;
    document.head.appendChild(tag);
    const locale = ctx.get("locale");
    const hasLocale = locale !== void 0 && locale !== null && typeof locale.register === "function" && typeof locale.bind === "function";
    let stopDictionary;
    if (hasLocale) {
      try {
        stopDictionary = locale.register(NS, { zh, en });
      } catch (error) {
        console.error("[dsh-left-dock] locale.register failed:", error);
      }
    }
    const panels = createObservable([]);
    const readPanels = () => {
      var _a, _b;
      let entries = [];
      try {
        entries = typeof slots.entriesOfSlot === "function" ? slots.entriesOfSlot("sidebar.panellist") : (_b = (_a = slots.entries) == null ? void 0 : _a.call(slots, "sidebar.panellist")) != null ? _b : [];
      } catch {
        return [];
      }
      return entries.map((entry) => {
        var _a2, _b2, _c;
        return {
          id: String((_b2 = (_a2 = entry == null ? void 0 : entry.options) == null ? void 0 : _a2.id) != null ? _b2 : ""),
          order: typeof ((_c = entry == null ? void 0 : entry.options) == null ? void 0 : _c.order) === "number" ? entry.options.order : 0,
          label: labelOf(entry)
        };
      }).filter((panel) => panel.id !== "").sort((left, right) => left.order - right.order);
    };
    const syncPanels = () => {
      panels.set(readPanels());
    };
    syncPanels();
    let stopPanels;
    if (typeof slots.subscribe === "function") {
      try {
        stopPanels = slots.subscribe("sidebar.panellist", syncPanels);
      } catch (error) {
        console.error("[dsh-left-dock] subscribe(sidebar.panellist) failed:", error);
      }
    }
    const fileService = createObservable(false);
    let boundList;
    const publishFileService = () => {
      fileService.set(boundList !== void 0 || resolveWorkspaceList(ctx) !== void 0);
    };
    const bindList = (list) => {
      boundList = list;
      publishFileService();
    };
    const stopRemote = bindRemoteList(ctx, bindList);
    publishFileService();
    const face = {
      startSession: (workspaceId) => {
        var _a;
        const uiWorkspace = ctx.get("uiWorkspace");
        (_a = uiWorkspace == null ? void 0 : uiWorkspace.startSession) == null ? void 0 : _a.call(uiWorkspace, workspaceId);
      },
      toggleSidebar: () => {
        var _a;
        const layout = ctx.get("layout");
        (_a = layout == null ? void 0 : layout.toggleSidebar) == null ? void 0 : _a.call(layout);
      },
      selectPanel: (panelId) => {
        var _a;
        const layout = ctx.get("layout");
        try {
          (_a = layout == null ? void 0 : layout.selectPanel) == null ? void 0 : _a.call(layout, panelId);
        } catch (error) {
          console.error("[dsh-left-dock] layout.selectPanel failed:", error);
        }
      },
      setSidebarWidth: (px) => {
        var _a;
        const actions = rootLayoutActions(slots);
        (_a = actions == null ? void 0 : actions.setSidebar) == null ? void 0 : _a.call(actions, clampTrackWidth(px));
      },
      listDirectory: async (sessionId, path, signal) => {
        const list = boundList != null ? boundList : resolveWorkspaceList(ctx);
        if (list === void 0) {
          return { ok: false, error: { code: "dock/no-service", message: "remote.workspaceFiles" } };
        }
        return list(sessionId, path, signal);
      },
      openFile: (path, cwd, sessionId) => {
        const editor = ctx.get("dsh-text-editor");
        if (editor === void 0 || editor === null || typeof editor.openFile !== "function") return false;
        try {
          editor.openFile({ path, cwd, sessionId });
          return true;
        } catch (error) {
          console.error("[dsh-left-dock] dsh-text-editor.openFile failed:", error);
          return false;
        }
      },
      hooks: { panels, fileService }
    };
    const options = {
      name: "sidebar",
      children: CHILDREN,
      inject: () => face
    };
    if (hasLocale && stopDictionary !== void 0) options["locale"] = NS;
    const stopRegistration = slots.inject("sidebar", () => slots.register(options, LeftDock));
    return () => {
      stopRegistration();
      stopRemote == null ? void 0 : stopRemote();
      stopPanels == null ? void 0 : stopPanels();
      stopDictionary == null ? void 0 : stopDictionary();
      panels.dispose();
      fileService.dispose();
      tag.remove();
    };
  }, "dsh-left-dock: left dock occupant");
}
return module.exports; } });
