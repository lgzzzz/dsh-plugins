# 上游变更综合：0.1.6-alpha.2 → 0.1.7-alpha.1

> 共享任务 task-1（owner: `upstream-changelog`）交付物。
> 只做分析，未修改任何插件文件 / Profile / 任何 git 引用。

## 0. 方法与证据基线

### 0.1 版本核验（本次审计的区间边界）

| 事实 | 证据 |
| --- | --- |
| 本机全局安装 = 0.1.7-alpha.1 | `/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/package.json` → `version: 0.1.7-alpha.1`（`node -e` 读取），bundled scope 共 277 个 `@deepseek-ai/*` 包 |
| 对比树 old = 0.1.6-alpha.2 | `/tmp/dsh-audit/old/dsh-client-ui-chat/package.json` → `0.1.6-alpha.2`（逐包核验 4 个包） |
| 对比树 new = 0.1.7-alpha.1 | `/tmp/dsh-audit/new/dsh-client-ui-chat/package.json` → `0.1.7-alpha.1` |
| 迁移区间 | release note `dsh-v0.1.7-alpha.1.md:143` 给出 `compare/dsh-v0.1.6-alpha.2...dsh-v0.1.7-alpha.1` |

### 0.2 证据路径约定

- **release note**：`/tmp/dsh-audit/releases/dsh-v0.1.7-alpha.1.md`（下称「RN:行号」，取中文段，行号即该文件行号）。
- **对照树**：`/tmp/dsh-audit/old/<pkg>`（0.1.6-alpha.2）与 `/tmp/dsh-audit/new/<pkg>`（0.1.7-alpha.1），本报告写作 `old/<pkg>/…`、`new/<pkg>/…`。
- **本机安装**：`<dsh>/node_modules/@deepseek-ai/<pkg>`，本报告写作 `$DSH/<pkg>/…`，其中 `$DSH = /opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai`。用于 old/new 树未收录的包（settings、attachment、session-format、api-workspace-files、app-boot、cordis 等）。

### 0.3 本次为补齐对照而新增的 old 侧样本（不是我方产物，仅在 /tmp）

Lead 给的对照树最初只有 28 个包，缺少本地插件依赖的若干包。本次用 npm（可写缓存 `/tmp/dsh-audit/npm-cache`）拉取 0.1.6-alpha.2 对应 tarball 解到 `/tmp/dsh-audit/old2/`：

`dsh-client-ui-dockkit`、`dsh-api-session-controller`、`dsh-client-ui-model-selection`、`dsh-api-workspace-controller`、`dsh-client-ui-tool`、`dsh-settings`、`dsh-attachment`、`dsh-session-log-export`、`dsh-api-workspace-files`、`dsh-fs`、`dsh-package-manifest`、`dsh-host-plugin-inventory`、`dsh-tools`、`dsh-system-prompt`、`cordis@4.0.2`；另 `new2/` 放 `cordis@4.0.3` 与 `dsh-client-ui-dockkit@0.1.7-alpha.1`（该包在全局安装里**没有**独立目录，只能从 npm 取）。

每个解包目录都用 `package.json.version` 核验过确为 `0.1.6-alpha.2` / `0.1.7-alpha.1`。

### 0.4 复核状态约定

- **已确证**：给出 `文件:行`。
- **未确证**：写明「未确证」并说明缺哪份对照，不猜测。
- 工作区存在**他人未提交的在途改动**（`git status`：`dsh-code-card-fonts/{README.md,lib/client.js,src/css.ts}` 已 M）。本报告的插件侧判定一律以 **HEAD 提交态 + 上游 0.1.7 产物**为依据；§4.1 会指出该在途改动正是本报告独立识别的必修项。

---

## 1. Release note 逐条筛选（面向插件作者）

RN 全文 143 行（中文段 3–71，英文段 73–141，`:143` 为 Full Changelog 链接）。下表筛出与「本地客户端/宿主插件作者」有关的条目，并给出代码落点。已过滤掉纯功能/纯修复且与插件面无交集的条目（模型页、Team 工具、语音转写、Agent 模式文案等，见 §4.3）。

### 1.1 「插件需适配 / 需迁移 / 旧接口 / 旧配置」类（RN 显式点名）

| # | RN 行 | 条目（中文原文摘要） | 代码侧真实变化 | 落点证据 |
| --- | --- | --- | --- | --- |
| A1 | 60 | 「仅保存在自定义事件中的附件不再自动读取或导出，**插件需适配**」 | 导出器由「任意事件的 `data.content` / `data.message.content` / `data.inserted` 递归扫描」改为「按 `event.type` 白名单只扫声明的一等字段」；未知/自定义事件 `default: return` | `$DSH/dsh-session-log-export/lib/index.js:165-199`（`switch (row.type)`，`:199 default: return`）；`:138` 由「descending into nested tool results」改为「direct attachment blocks from one declared V4 content array」。旧行为对照：`old2/dsh-session-log-export/lib/index.js:135-160`。README 佐证 `$DSH/dsh-session-log-export/README.md:62` |
| A2 | 61 | 「官方 DeepSeek 适配器仅用 Messages API…**旧配置需删除 protocol**」 | DeepSeek provider 配置面变更 | 本地 9 插件均不注册 provider/设置命名空间（§0.4、§3），**与本仓库无关** |
| A3 | 66 | 「工作区文件读取统一为 **readBytes**，**插件需迁移旧接口**」 | `WorkspaceFiles.readAll(scope,path,signal)` 与 `readRelated(scope,path,relativePath,signal)` **删除**；`readBytes(scope,path,options,signal)` 吸收两者（`options.range` / `options.baseFile`），返回值由 base64 改为经二进制 Remote 的原生 `Uint8Array` | 旧：`old2/dsh-api-workspace-files/lib/types/index.d.ts:100`（readAll）、`:109`（readRelated）；新：`$DSH/dsh-api-workspace-files/lib/types/index.d.ts:91`（唯一 readBytes）。README：`old2/dsh-api-workspace-files/README.zh.md:34-36,65` vs `$DSH/dsh-api-workspace-files/README.zh.md:34,40,65` |
| A4 | 68 | 「Agent 预设改由插件组合包声明和安装…**旧目录预设需迁移**」 | agent-preset 插件族 | 本地无 agent-preset 插件 → **与本仓库无关** |
| A5 | 69 | 「设置改由当前 Profile 的插件配置保存…**旧 settings.yaml 仅尝试导入一次，自定义设置插件需适配**」 | `ctx.settings` 由 `SettingsProvider`（命名空间注册 + `SettingsScope.get/watch/update/replace` + `applies:'live'|'restart'`）整体替换为 `SettingsForms`（Profile 每个 Loader 条目一个表单，`describe/update/replace/mutate/configure`，`applies` 仅 `'live'`） | 旧：`old2/dsh-settings/lib/types/index.d.ts:84-110`（SettingsScope）、`:157`（SettingsProvider）、`:216`（register）、`:236-282`。新：`$DSH/dsh-settings/lib/types/index.d.ts:62`（SettingsForms）、`:80 configure`、`:102 update`、`:108 replace`、`:114 mutate`。一次性导入：`$DSH/dsh-settings/lib/index.js:339`（`loader.await()` 后调 `importLegacyDocument`）、`:346-368`（先 `rename` 成 `settings.yaml.imported` 再逐 section 导入） |
| A6 | 62 | 「插件可通过 **locale 数据结构**声明多语言标题和描述，通过 **package.json 声明图标**」 | 新增 `LocalizedText` / `PluginLocalizedMeta`；`package.json.icon`；locale 字典文件 `<pkg>/locale/<lang>.json` 内 `{ meta: { title, description } }` | 类型：`$DSH/dsh-package-manifest/lib/types/types.d.ts:15`（icon）、`:39`（LocalizedText）、`:44-52`（PluginLocalizedMeta）。读取器：`$DSH/dsh-app-boot/lib/index.js:1750 readPluginMeta`、`:1753`（`${specifier}/locale/en.json`）、`:1706 dictionariesOf`、`:1726 localizedText`、`:1641 iconOf` |
| A7 | 64 | 「组合包支持按顺序加载多个 patch 文件，保留原有单文件写法。**插件可声明无需重载的配置字段**，仅修改这类字段时可保留运行中的实例」 | `dsh.bundle.patch` 由 `string` 放宽为 `string \| string[]`；volatile 配置由 cordis 4.0.3 引入 | patch：`$DSH/dsh-package-manifest/lib/types/types.d.ts:68`（`patch: string \| string[]`）；加载器 `$DSH/dsh-app-boot/lib/index.js:300-303`（`typeof bundle.patch === "string" ? [bundle.patch] : bundle.patch`，README doc `:276`）。volatile：`new2/cordis/README.md:103-105`（`Volatile<T>` / `.get()` / `loader/volatile-update`）、`new2/cordis/lib/types/index.d.ts:16`（导出 `Volatile, VolatileSnapshot`） |
| A8 | 70 | 「内置浏览器在 Web 默认关闭，在 Electron 中默认启用」 | web-app 组合补丁给 `ui-sidebar-browser` 行加条件禁用 | `new/dsh-web-app/cordis.patch.yml:252-255`（`disabled: !!js "ctx.get('profileContext')?.name !== 'desktop'"`；注释「Web profiles opt in; Desktop retains…」）；旧：`old/dsh-web-app/cordis.patch.yml` 无该行 |

### 1.2 改变客户端 UI 结构 / cordis 服务面 / Profile 组合的条目

| # | RN 行 | 条目 | 真实变化 | 落点证据 |
| --- | --- | --- | --- | --- |
| B1 | 7 | 「连续思考与工具调用合并为可折叠过程组…新增「工作过程展示」「性能与用量」「开发者工具」设置」 | 新增 `ChatGroupSeat` 过程组容器；chat node 槽契约换血；`TranscriptViewMode` 持久设置 → 实时 `ChatPresentationPolicy` | 见 §2.1 |
| B2 | 16 | 「统一界面图标、状态标记、菜单和滚动条的视觉样式」 | 图标组件换代（`IconChevron*_14` → `*_Regular`、新增 `TextShimmer`/`SegmentedControl`/`SegmentedTabs`/`PathLabel`）；`--dsh-scrollbar-width` 由 **8px → 5px**；diff 审阅 CSS module 由 `ReviewTab_*` 拆到 `FileDiff_*` | 滚动条：`old/dsh-client-ui-theme/lib/client.js` 含 `--dsh-scrollbar-width:8px` vs `new/dsh-client-ui-theme/lib/client.js` 含 `:5px`；`new/dsh-client-ui-primitives/lib/markdown/MarkdownText.module.css:210` 的 `padding-bottom: var(--dsh-scrollbar-width, 5px)`（旧为 `8px`）。图标：`new/dsh-client-ui-primitives/lib/index.js` 导出表新增 `TextShimmer, SegmentedControl, SegmentedTabs, SettingsForm…`（`dsh-client-ui-primitives` 文件列表出现 `TextShimmer.module.css` / `SegmentedControl.module.css` / `SegmentedTabs.module.css` / `settings-form/`） |
| B3 | 13/14/55 | 「文件改动审阅默认左右分栏 + 代码高亮 + 同步滚动」「卡片悬停单栏差异」「修复分栏回弹/背景/长路径」 | 变更审阅 tab 重做为 `FileDiff` 组件；`data-diff-line`、22px 行高基线保留；新增 `data-diff-side` / `data-diff-code` / `data-diff-hunk-header` / `data-diff-note` / `data-changes-hover-preview` | `new/dsh-client-ui-deliverables/lib/client.js`：`data-changes-review` 仍在（ReviewTab 根，`:1825`）、`data-diff-line` 仍在 ×3（`:906`/`:959`/`:981`，`FileDiff_module_css_default.sideLine`）、22px 基线仍在（CSS chunk `IP6KhG_line` / `IP6KhG_splitLine` / `IP6KhG_sideLine`，`:620`；旧侧对应 `ReviewTab_*`，22px 见 `old/dsh-client-ui-deliverables/lib/client.js:1244` CSS chunk）。新增类型文件 `new/dsh-client-ui-deliverables/lib/types/client/FileDiff.d.ts`、`file-actions.d.ts` |
| B4 | 5/6/24 | 「侧边栏会话置顶、归档、筛选、撤销归档」「运行中会话归档确认」「会话列表分批展开」 | workspace 客户端模型新增 pin 集合与筛选；`WorkspaceViewState` 增可选 `archivedFilter`，actions 增 `pinSessionOrder`/`setArchivedFilter`；新增 `rows/AnimatedRows`、`session-actions/`、`pin-order.d.ts` | `new/dsh-client-ui-workspace/lib/types/client/stores.d.ts`（`sessionOrderByAccount` 保留；新增 `archivedFilter?`、`pinSessionOrder`、`setArchivedFilter`）；`old2/dsh-api-workspace-controller/lib/types/client/model.d.ts:10-12` vs `$DSH/…/model.d.ts:10 + pinnedSessionIds`；`ui-workspace/lib/types/client/navigation.d.ts` 的 `UiWorkspace` 新增 `pinSession/unpinSession`，`archiveSession(sessionId, {stopActivity?})` |
| B5 | 25 | 「输入栏空间不足时自动将模型名称收为图标」 | `conversation.input.model` 槽文档化两个新 CSS 变量 `--dsh-composer-model-text-display` / `--dsh-composer-model-icon-display`；新增 `conversation.input.activity` 槽 | `new/dsh-client-ui-conversation/lib/types/client/contract/slots.d.ts:240`（`conversation.input.activity`）、`:266-273`（model 槽的新 CSS 变量说明） |
| B6 | 12/26/27/37 | 文件预览回合后自动更新 + 本地变更响应；Excel/CSV/TSV 只读预览；PDF/Office/图片统一缩放；Markdown 预览本地图片 | documentpreview 新增 `client.excel.js`、`zoom/`、`path-images`、`resource-group`；新增 `data-document-zoom-*`、`data-excel-preview` 等属性；`data-textpreview-body` / `data-document-markdown` 保留 | `new/dsh-client-ui-sidebar-documentpreview/lib/client.excel.js` 存在（旧无）；`data-textpreview-body` 计数 old=2 / new=2，`data-document-markdown` old=1 / new=1（`old|new/dsh-client-ui-sidebar-documentpreview/lib/client.js`） |
| B7 | 34 | 「无法读取的可选插件包不再直接中止 Profile 加载，并在插件管理页保留错误信息和禁用/移除操作」 | Profile 组合层逐 bundle `try/catch`：失败写 stderr 后跳过，manifest 不变 | `$DSH/dsh-app-boot/lib/index.js:723-741`（`for (const packageName of bundles) try { … } catch { process.stderr.write(…skipping profile bundle…); }`，doc `:713`） |
| B8 | 39 | 「修复会话重新打开时，插件投影缓存中部分特殊 JSON 字段丢失」 | 投影缓存读校验保留所有 own JSON key，含 `__proto__` / `constructor` | `$DSH/dsh-session-projection-cache/README.md:65`：`Domain read validation preserves every own JSON key in checkpoint values, including __proto__ and constructor inside opaque metadata.` |
| B9 | 40 | 「修复源码启动时受模块运行时解析行为影响导致的初始化失败，并**支持 link 到本地开发中的插件**」 | 新增 `linkedProfileRoots()`：Profile `node_modules` 下指向 profiles 树之外的符号链接（即本仓库的 `link:` 依赖）纳入运行时解析 | `$DSH/dsh-app-boot/lib/index.js:419 linkedProfileRoots`、`:530`（`linkedRoots` 进入 `createRuntimeResolution` 冻结结果）、`:417-418` 文档 |
| B10 | 52 | 「修复多个带检查工具的 Agent 预设共存时，重复注册导致预设加载失败」 | Host inspect provider 改为进程级注册一次 | `new/dsh-web-app/cordis.patch.yml` 新增 `- id: cordis-inspect-providers / name: '@deepseek-ai/dsh-tool-cordis/host'`（注释「the registry rejects a duplicate id」） |
| B11 | 31/101 | 「修复 Web 部署在反向代理子路径下无法访问」 | 组合/SSE/导出等 URL 由绝对路径改为**文档相对** | `new/dsh-client-modules/lib/types/client/manifest.d.ts:51-53,71-73,95-98`（`url` 注释新增 "It is relative to the document"）；`new/dsh-client-hmr/lib/types/events.d.ts:39-42` 新增 `EVENTS_ROUTE`；`$DSH/dsh-session-log-export/lib/index.js:478-486` 新增 `SESSION_LOG_EXPORT_PATH` + 文档相对形式 |
| B12 | 7 | 「开发者工具默认开启，关闭时仍显示第三方会话标签页」 | `ui-sidebar-browser` 在 Web 默认禁用（同 A8）；侧栏/右栏出现 `session-views` 保留式挂载（见 B1/§2.1 的右栏部分） | `new/dsh-client-ui-sidebar-right/lib/types/client/session-views.d.ts`、`session-view.d.ts` 新增；`shell/RightbarRoot.d.ts` 由「仅当前会话渲染」改为「保留多个 Session 子树并隐藏非前台」 |
| B13 | 65 | 新增 `--dump-config-schema` | 导出 Cordis 配置与 patch 的 JSON Schema（含 patch 结构校验） | `$DSH/dsh-app-boot/lib/index.js:2480-2600`（`definitions.patch`、`x-cordis.patchSchema`、`--dump-config-schema` 文档 `:2539`） |

### 1.3 RN 中确认为「与本仓库无关」的条目（原因）

| RN 行 | 条目 | 无关原因 |
| --- | --- | --- |
| 9, 17, 18, 19, 20, 21, 22, 23, 32, 33, 35, 36, 38, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 53, 54, 71 | 默认工作区、紧凑卡片、长对话加载、Team 目标/看板、后台任务面板、Agent 模式说明、模型页、Messages 协议修复、新会话复用、插件安装弹窗/镜像源、自定义 provider 地址、压缩预算、`[object Object]`、Files API 报错、Windows 沙箱、空白会话、失败原因、计划审阅、设置滚动、pi-ai 阻塞、取消记录、Bash 权限说明、预设重复注册、Native addon、macOS 打开菜单、语音转写 | 既不改变客户端 DOM/选择器、不改变本地插件消费的 cordis 服务动词、也不改变 Profile patch/组合 schema；本地 9 插件均在 §3 逐项核对了实际消费面 |

---

## 2. 特别核实：RN 点名的 8 条

### 2.1 过程组折叠（ChatGroupSeat / 连续思考与工具调用合并）— **确证，影响 dsh-code-card-fonts**

**新增（0.1.7 才有）**：

- `data-step-process`（组根）、`data-step-process-body`（可滚动组体）、`data-step-process-content`（成员容器）、`data-step-process-chevron` / `-icon`：`new/dsh-client-ui-chat/lib/client.js:2031`（组根 `data-step-process: true`）、`:2048`（`data-step-process-body: true`）、`:2055`（`data-step-process-content: true`）。
  **旧树 0 次**：`grep -c data-step-process old/dsh-client-ui-chat/lib/client.js` → `0`。
- 组件：`new/dsh-client-ui-chat/lib/client.js:1958`（`const ChatGroupSeat = memo(function ChatGroupSeat(...))`）、`:2018-2019`（组体 className 取 `ChatGroupSeat_module_css_default.body` / `.expandedBody`）；类型 `new/dsh-client-ui-chat/lib/types/client/chat/ChatGroupSeat.d.ts:1-12`。
- 业务数据契约（新文件）：`new/dsh-client-ui-chat/lib/types/client/contract/process-groups.d.ts:1-22`（`ProcessActivity` / `ProcessActivitySummary` / `ProcessGroupData`，并 `declare module … conversation/client { interface ConversationGroupDataMap { chat: ProcessGroupData } }`）。
- 通用分组框架（新文件，供插件注册分组定义）：`new/dsh-client-ui-conversation/lib/types/client/contract/groups.d.ts:1-115`、`conversation/group-registry.d.ts:8-28`、`conversation/group-store.d.ts:6-27`。

**对 dsh-code-card-fonts 的实质影响（本报告独立识别，HEAD 态仍需修）**：

新的组体元素**自身声明** `--dsh-chat-flow-gap`，按「最近声明者继承」压过插件写在 `body` 上的 7px：

- `new/dsh-client-ui-chat/lib/client.js:1822`（CSS chunk `.O_Ebla_body{--dsh-chat-flow-gap:8px;…}` 与 `.O_Ebla_expandedBody{--dsh-chat-flow-gap:16px;…}`）、`:2048` 的同一个 `div` 同时带 `className: classes.join(" ")`（含 `body` / `expandedBody`）与 `data-step-process-body`。
- 成员间距规则 `.O_Ebla_content>:not([hidden]):not(:empty)~…{margin-top:var(--dsh-chat-flow-gap,8px)}`（同 CSS chunk）。
- 插件 HEAD 态 `dsh-code-card-fonts/src/css.ts:8-10` 只在 `body` 上声明 `--dsh-chat-flow-gap`；对组内成员失效。
- 修正方向与在途改动：工作区已有未提交改动 `dsh-code-card-fonts/src/css.ts` 新增 `body [data-step-process-body] { --dsh-chat-flow-gap: calc(14px * 0.5) }`（`git diff`），特异性 (0,1,1) > `.O_Ebla_body` (0,1,0)，判定成立。**该在途改动与本报告结论一致，但需由负责可视化的成员收口并由 Lead 复核。**

**其余选择器核验为仍然有效**（避免误判为「全量失效」）：

| 插件选择器 | 0.1.7 证据 | 判定 |
| --- | --- | --- |
| `[data-chat-flow-kind]` | 成员行仍带该属性（`new/dsh-client-ui-chat/lib/client.js:1716 "data-chat-flow-kind": routedNode.kind`）；出现次数 old=13 / new=14 | 有效（新增的第 14 处是组头） |
| `[data-disclosure-row]` + `> span:nth-child(2)` | `DisclosureRow` 结构不变：row 内第 1 个是 `leading`（`button` 或 `span`），第 2 个是标题；0.1.7 仅把标题由裸 `span` 换成 `TextShimmer`，而 `TextShimmer` 渲染的仍是 `<span>`（`$DSH/dsh-client-ui-primitives/lib/index.js` 的 `TextShimmer` 实现 `return jsx("span", {className: clsx(css$1.root, className)…`） | 有效 |
| `[data-turn-process]` / `[data-chat-flow-kind="compaction"]` / `button[aria-expanded="true"] + div` | 属性集合逐项一致：old = `data-turn-process` ×1、`-answer` ×2、`-hidden` ×1、`-inline` ×2、`-member` ×1、`-messages` ×1、`-subagents` ×1、`-tool-calls` ×1；new 完全相同 | 有效 |
| `[data-open]:not([data-turn-process])`、`[data-markdown-variant="compact"]` | 两者 old/new 均存在（`data-open` 5/5；`data-markdown-variant` 在 primitives，old/new 均 1 处） | 有效 |
| `[data-tool]`、`[data-sample]` | `old/dsh-client-ui-tool/lib/client.js` 与 `new/dsh-client-ui-tool/lib/client.js` 均含 `data-tool` ×5、`data-sample` ×1（Bash 卡片根 `"data-sample": "bash"`）；子元素顺序 old/new 一致（`leading` / `visuallyHidden` / `title` / …） | 有效（**不是** 0.1.7 新增，前期若把它当 delta 是误报） |
| 代码字体 token `--dsw-font-markdown-code-block(-small)` | `old|new/dsh-client-ui-theme/lib/client.js` 值完全相同：`11px/19px`、`11px/16px` | 有效 |
| `[data-chat-flow-kind] table th/td`、`pre code`、`:not(pre) > code` | primitives `lib/markdown/MarkdownText.module.css:163`（`.markdown :not(pre) > code`）old/new 逐字相同 | 有效 |

> 结论：**dsh-code-card-fonts 只有「过程组 gap 变量」一项必修**，其余锚点在 0.1.7 全部存活。

### 2.2 设置改由 Profile 插件配置保存（旧 settings.yaml 只导入一次）— **确证，与本地 9 插件无关**

- 一次性导入：`$DSH/dsh-settings/lib/index.js:339`（`ctx.root.loader.await().then(() => this.importLegacyDocument())`）→ `:346-368`：`settings.yaml` 先 `rename` 为 `settings.yaml.imported`（「a partial import never repeats」），再逐 section 走 `this.update(ns, values)`；section → entry id 的映射表见 `:303-308`（`LEGACY_SECTION_ENTRIES`，含 `ui-developer-tools→ui-settings`、`ui-onboarding→ui-settings-general`）。
- 服务面整体替换：
  - 旧：`old2/dsh-settings/lib/types/index.d.ts:157`（`abstract class SettingsProvider`）、`:216 register(ns, schema, options): SettingsScope<T>`、`:84-110`（`SettingsScope.get/watch/update/replace`）、`SettingsApplies = 'live' | 'restart'`。
  - 新：`$DSH/dsh-settings/lib/types/index.d.ts:62 class SettingsForms`、`:80 configure(presentation, owner?)`、`:102 update(ns, patch, expectedRevision?)`、`:108 replace`、`:114 mutate`；`applies: 'live'`（`types.d.ts` 中 `'restart'` 已删除）。
- 本地核验：`grep -rniE "settings" dsh-*/src dsh-*/index.ts dsh-*/cordis.patch.yml` 命中只有 `dsh-desktop-notify/src/notify-action.ts:4` 的一句注释（「无 locale 命名空间，故不注册 locale」）。**无任何本地插件注册 settings 命名空间或调用 `ctx.settings.*`。**

### 2.3 附件仅存自定义事件 — **确证，与本地 9 插件无关**

- 新实现按 `event.type` 白名单：`$DSH/dsh-session-log-export/lib/index.js:165 collectEventAttachmentRefs`、`:172-199`（`user/message`、`tool/ptc-dispatch`、`system/message`、`developer/message`、`tool/result`、`team/message/queued`、`agent/inbox/spliced`、`compaction/summary`、`assistant/message`、`assistant/attempt`；`:199 default: return`）。
- 旧实现无类型过滤：`old2/dsh-session-log-export/lib/index.js:135-160`（对任意事件读 `carrier.content`、`carrier.message.content`、`carrier.inserted`，并递归 `block.content`）。
- `dsh-attachment` 包本身**只有 package.json 变了版本**（`diff -rq old2/dsh-attachment $DSH/dsh-attachment` 仅 package.json 差异），即变更点在「谁是附件来源」的判定，不在附件存储。
- 本地核验：9 插件无任何 `attachment` 引用（`grep -rniE "attachment"` 无命中）。

### 2.4 Session 日志 V4 — **确证，与本地 9 插件无关**

- 新增迁移包 `dsh-session-format-v3-to-v4`（全局安装中存在，`$DSH/dsh-session-format-v3-to-v4/`；另有 `dsh-session-format-catalog`）。
- 与插件有关的机制（README `$DSH/dsh-session-format-v3-to-v4/README.md`）：
  - `### Extension data`：`Unknown V3 content tags become plugin:<original-type>`；「An existing prefix on a content tag is prefixed again, keeping distinct old names distinct. Arguments, replay state, and plugin content fields are not traversed. These names do not load or execute plugins.」
  - `### Developer changes and deferred schemas`：`developer/message` 需正 turn/step 坐标、role `developer`、非空 message id、数组 content、producer 拥有的 source metadata；`tool-addition`/`tool-removal` 需非空 `toolName`；带 additions 的事件必须有 `headerSeq` 并精确绑定到某个已知 `request/header`；「Unknown ignorable developer payloads are deferred until the reader knows that event type.」
- RN 行 59：「Session 日志升级为 V4，新增面向开发者的批量迁移工具，并兼容部分 V3 会话缺少轮次结束记录的情况。」
- 本地核验：9 插件不读原始 session 事件/JSONL（`grep -rniE "session-format|jsonl|projection"` 无命中；`dsh-kbd-hotkeys` 只消费 `sessions.list` / `uiSession` 客户端 store）。**只有当插件自己往 Session 里写自定义 content tag 时 `plugin:` 前缀规则才适用；本仓库没有这类插件。**

### 2.5 工作区文件读取统一 readBytes — **确证，与本地 9 插件无关**

- 旧 `readAll` / `readRelated`（见 A3 证据行）→ 新 `readBytes(scope, path, { range?, baseFile? }, signal)`。
- 旧 README 明确写「base64 编码」（`old2/dsh-api-workspace-files/README.zh.md:34`），新 README 写「以 `Uint8Array` 返回…可通过二进制 Remote 返回原始字节」（`$DSH/dsh-api-workspace-files/README.zh.md:34,97`）。
- 消费端迁移样例：`old/dsh-client-ui-sidebar-documentpreview/README.zh.md:50`（`remote.workspaceFiles.readAll(sessionId, path, signal)` + `rpc.ts` base64 解码）、`:53`（`readRelated`）→ `new/dsh-client-ui-sidebar-documentpreview/README.zh.md:55`（`remote.workspaceFiles.readBytes(sessionId, path, {}, signal)`，二进制 Remote 直返 `Uint8Array`）、`:58`（`readBytes` + `baseFile` 取代 `readRelated`）。
- 本地核验：9 插件无 `readBytes`/`readAll`/`readRelated`/`workspaceFiles` 引用；`dsh-git-guard` 是 host-only 且只挂 `tools/pre-execute`（不读文件）。

### 2.6 插件 locale / package.json 图标 — **确证；本地插件「可选采用」，其中 locale 需补 exports**

- 读取器：`$DSH/dsh-app-boot/lib/index.js:1750 readPluginMeta(specifier, parentURL)`；英文入口固定为 `${specifier}/locale/en.json`（`:1753`），同目录其它 `<lang>.json` 经 `dictionariesOf`（`:1706`）收集，字段为 `parsed.meta.title` / `parsed.meta.description`；`icon` 从 package.json 读（`:1641 iconOf`，约束 SVG/PNG/JPEG/WebP、≤256 KiB、realpath 后仍在 manifest 目录）。
- 解析走 Node 模块解析器（`:1665 resolvePluginResource`），`ERR_PACKAGE_PATH_NOT_EXPORTED` 等被当作「资源不存在」静默返回 undefined（`:1672-1681 missingResource/optionalResourcePath`）→ **locale/图标必须被 `exports` 放行**。
- 本地现状：
  - 9 个插件**全部已导出 `"./package.json"`**（例：`dsh-code-card-fonts/package.json` 的 `exports`），因此**声明图标无需改任何代码**，只需在包根放图标文件并加 `icon` 字段。
  - **没有任何插件导出 `./locale/*`** → 若要声明多语言标题/描述，需要额外加 `"./locale/*": "./locale/*"`（或逐文件条目）。属**新增能力，非迁移阻塞**。

### 2.7 组合包多个 patch 文件 + 无需重载的配置字段 — **确证；本地 9 插件仍可用单文件写法**

- 多 patch：`$DSH/dsh-package-manifest/lib/types/types.d.ts:68` `patch: string | string[]`；加载顺序由 `$DSH/dsh-app-boot/lib/index.js:300-303 bundlePatchFiles` 保序展开（`typeof bundle.patch === "string" ? [bundle.patch] : bundle.patch`），`loadProfileDirectory` 按 `patchPaths.flatMap(loadOverlayPatches)` 顺序入层（`:721-734`）。上游自身示范：`new/dsh-web-app/package.json` 的 `dsh.bundle.patch` 已是 5 项数组（`./cordis.patch.yml` + `presets/*.patch.yml`），目录 `new/dsh-web-app/presets/` 随之新增；旧为单字符串。
- **向后兼容确认**：`old/dsh-web-app/package.json` 的 `"patch": "./cordis.patch.yml"` 写法在 0.1.7 仍被 `bundlePatchFiles` 接受。本地 9 个插件的 `dsh.bundle.patch` 全部是单文件字符串（`grep -h '"patch"' dsh-*/package.json` → 9 处 `"./cordis.patch.yml"`），**无需改动**。
- volatile 配置字段：cordis `^4.0.2 → ^4.0.3`。`new2/cordis/README.md:103-105`：「Schemas may return `Volatile<T>` references, whose values are read through `.get()`. … Loader commits volatile-only changes into the running references without restarting and notifies the owning fiber through `loader/volatile-update`. Direct `fiber.update()` retains its existing update waterfall and default restart.」
  同版本 `Fiber.update` 返回类型收紧：`void | Promise<void>` → `void`（`new2/cordis/lib/types/fiber.d.ts:199`）。`internal/update` 事件的 `next` 由 `() => void | Promise<void>` 收紧为 `() => void`（`new2/cordis/lib/types/events.d.ts:230`）。
- 本地核验：9 插件无 `fiber.update` / `Volatile` / loader 事件使用；唯一声明 cordis 依赖的是 `dsh-git-guard/package.json`（`"@deepseek-ai/cordis": "^4.0.2"`，devDependency，仅供 typecheck，`^4.0.2` 语义上容纳 4.0.3）。**无需改动。**

### 2.8 内置浏览器默认关闭 — **确证，与本地 9 插件无关**

- `new/dsh-web-app/cordis.patch.yml:252-255`：
  ```yaml
  # Web profiles opt in; Desktop retains sandboxed HTTP(S) Browser tabs.
  - id: ui-sidebar-browser
    name: '@deepseek-ai/dsh-client-ui-sidebar-browser'
    disabled: !!js "ctx.get('profileContext')?.name !== 'desktop'"
  ```
  旧文件对应位置只有前两行（无 `disabled`）。
- `dsh-client-ui-sidebar-browser` 本体大幅重构（新增 `BrowserPage` / `BrowserPersistence` / `IframeImpl` / `pages` / `electron/` / `view/BrowserPresentation` 等），RN 行 70：「可选择聊天链接在内置浏览器或新标签页打开」。
- 本地核验：唯一可能触及右栏「浏览器 tab」的是 `dsh-kbd-hotkeys` 的右栏 tab 逻辑（`src/sidebar-tabs.ts`），它按 `layout.tabs[pane]` 的 `kind`/`contentId` 动态识别，**没有硬编码 browser kind**（终端 kind 常量见 `dsh-kbd-hotkeys/src/sidebar-tabs.ts:25` `const TERMINAL_KIND = 'terminal'`，识别逻辑见 `:289-298`）；浏览器行缺席只会让该 tab 不出现，不产生错误分支。

---

## 3. 变更 → 受影响插件族 映射表

「必改」= 需改代码/产物；「复核」= 语义或覆盖变化，建议人工确认；「无关」= 已逐项核实不受影响。

| 变更（RN 行 / 编号） | dsh-code-card-fonts | dsh-desktop-notify | dsh-directory-picker-browse | dsh-fullwidth-chat | dsh-git-guard | dsh-kbd-hotkeys | dsh-rightbar-fonts | dsh-rightbar-tab-width | dsh-sidebar-default-collapsed |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 过程组 `ChatGroupSeat` + `data-step-process-body`（B1 / §2.1） | **必改**：`--dsh-chat-flow-gap` 继承被组体截断 | 无关 | 无关 | 无关 | 无关 | 无关（不注册 chat node 槽） | 无关 | 无关 | 无关 |
| chat node 槽契约换血（`groupPart` / `useDisclosure` / `nodeStore` / `usePresentation`；`historyIncomplete`/`compactTranscript` 删除）（B1） | 无关（纯 CSS，不注册槽） | 无关 | 无关 | 无关 | 无关 | 无关 | 无关 | 无关 | 无关 |
| chat node 类型面（`ttftMs`/`tokensPerSecond` 移除、`turnDataSource` 新增）（B1） | 无关 | 无关 | 无关 | 无关 | 无关 | 无关 | 无关 | 无关 | 无关 |
| 会话分组框架 `conversation.groups`（新包级 API）（B1） | 无关 | 无关 | 无关 | 无关 | 无关 | 无关（不注册 View/Group 定义） | 无关 | 无关 | 无关 |
| 图标/滚动条视觉统一；`--dsh-scrollbar-width 8→5`；`TextShimmer` 换标题渲染（B2） | 复核：`DisclosureRow` 标题改由 `TextShimmer` 渲染（仍是 `<span>`，选择器有效） | 无关（自绘按钮，未用 `--dsh-scrollbar-width`） | 无关 | 无关 | 无关 | 复核：overlay 用 alias token，全部仍在 | 无关（未用该 token） | 无关 | 无关 |
| 变更审阅重做为 `FileDiff`，默认左右分栏（B3） | 无关 | 无关 | 无关（刻意不触碰 ui-deliverables） | 无关 | 无关 | 无关 | 复核：`[data-changes-review] [data-diff-line]` 与 22px 基线仍在，规则应继续命中；上游类名换成 `FileDiff_*` 不影响 data 选择器 | 无关 | 无关 |
| 侧栏 pin/archive/筛选；workspace store 增 `archivedFilter`/`pinSessionOrder`/`pinnedSessionIds`（B4） | 无关 | 无关 | 无关 | 无关 | 无关 | 复核：`sidebar-order.ts` 读 `groupBy`/`sessionOrderByAccount` 字段仍在；置顶会改变账号内顺序，插件读 store 自动跟随 | 无关 | 无关 | 无关 |
| 会话列表分批展开（`AnimatedRows`）（B4） | 无关 | 无关 | 无关 | 无关 | 无关 | 无关 | 无关 | 无关 | 无关 |
| 输入栏模型名收为图标 + `conversation.input.activity` 新槽（B5） | 无关 | 无关 | 无关 | 无关 | 无关 | 无关（模型浮窗读 `modelDirectories` store，类型与字段未变） | 无关 | 无关 | 无关 |
| documentpreview：自动刷新 / Excel 新渲染 / 统一缩放 / 本地图片（B6） | 无关 | 无关 | 无关 | 无关 | 无关 | 无关 | 复核：`[data-textpreview-body]`、`[data-document-markdown]` 仍在；**新增 Excel/CSV/TSV 预览走独立 `data-excel-preview`，不在插件现有作用域内**（覆盖缺口，非破坏） | 无关 | 无关 |
| Profile 加载对不可读 bundle 容错（B7） | 无关（对所有插件是收益） | 同左 | 同左 | 同左 | 同左 | 同左 | 同左 | 同左 | 同左 |
| 投影缓存保留 `__proto__`/`constructor`（B8） | 无关 | 无关 | 无关 | 无关 | 无关 | 无关 | 无关 | 无关 | 无关 |
| `link:` 本地插件纳入运行时解析（B9） | 无关（收益） | 同左 | 同左 | 同左 | 同左 | 同左 | 同左 | 同左 | 同左 |
| Host inspect provider 进程级一次注册（B10） | 无关 | 无关 | 无关 | 无关 | 无关 | 无关 | 无关 | 无关 | 无关 |
| 反向代理子路径：URL 文档相对化（B11） | 无关 | 无关 | 无关 | 无关 | 无关 | 无关 | 无关 | 无关 | 无关 |
| 内置浏览器 Web 默认关闭（A8 / §2.8） | 无关 | 无关 | 无关 | 无关 | 无关 | 复核：右栏浏览器 tab 在 Web 消失，插件按 store 动态识别、无硬编码 | 无关 | 无关 | 无关 |
| 右栏 `RightbarRoot` 保留多会话子树；`rightbar.session` owner props 增 `active`/`retainTab`；`ISidebarRight.mounted` 新增（B12） | 无关 | 无关 | 无关 | 无关 | 无关 | 复核：`entries/resolveStore` 三步取数不变；`snapshot.bySession[sessionId].layout` 仍在（`bySession` 出现次数 old/new 均 41） | 无关 | 无关 | 无关 |
| `conversation.session.header.leading` → `conversation.header.leading`（重命名 + scope 变 root）；新增 `conversation.header`（B12） | 无关 | 无关（用的是 `…header.actions`，仍在） | 无关 | 无关 | 无关 | 无关 | 无关 | 无关 | 无关 |
| 设置改为 Profile 插件配置（A5 / §2.2） | 无关 | 无关（自管 localStorage 开关，不注册 settings 命名空间） | 无关 | 无关 | 无关 | 无关 | 无关 | 无关 | 无关 |
| 附件仅自定义事件不再读取/导出（A1 / §2.3） | 无关 | 无关 | 无关 | 无关 | 无关 | 无关 | 无关 | 无关 | 无关 |
| Session 日志 V4（A4 / §2.4） | 无关 | 无关 | 无关 | 无关 | 无关 | 无关 | 无关 | 无关 | 无关 |
| `workspaceFiles.readAll`/`readRelated` → `readBytes`（A3 / §2.5） | 无关 | 无关 | 无关 | 无关 | 无关 | 无关 | 无关 | 无关 | 无关 |
| locale/package.json 图标（A6 / §2.6） | 可选采用（package.json 已导出，icon 免改代码；locale 需补 exports） | 可选采用 | 可选采用 | 可选采用 | 可选采用 | 可选采用 | 可选采用 | 可选采用 | 可选采用 |
| 多 patch 文件 + volatile 配置字段 + cordis 4.0.3（A7 / §2.7） | 无关（单文件写法兼容） | 同左 | 同左 | 同左 | 无关（devDep `^4.0.2` 容纳 4.0.3；不用 `fiber.update`） | 同左 | 同左 | 同左 | 同左 |
| `sessions.subagentAddress` 语义放宽（§5） | 无关 | 无关 | 无关 | 无关 | 无关 | **复核**：`model-picker.ts` 用它判定「是否子代理会话」；命中集合由「已保留」放宽为「已保留或已载入目录」 | 无关 | 无关 | 无关 |
| `sessions.setSubagentCatalogOpen` / `refreshSubagents` 删除；`SessionListState.jobsBySession`/`subagentsByParent` → `projectionsBySession`（§5） | 无关 | 无关 | 无关 | 无关 | 无关 | 无关（未使用这些成员） | 无关 | 无关 | 无关 |
| `dsh-client-ui-directory-picker-browse` 更新（依赖仅升版本） | 无关 | 无关 | 无关（patch 只按 id/包名挂载；`directory-picker` id 与包名 0.1.7 仍在） | 无关 | 无关 | 无关 | 无关 | 无关 | 无关 |

---

## 4. 三分类结论

### 4.1 真正影响本地 9 个插件的（必须处理）

| 项 | 插件 | 事实 | 证据 | 建议动作 |
| --- | --- | --- | --- | --- |
| **U1** | `dsh-code-card-fonts` | 0.1.7 新增过程组容器 `ChatGroupSeat`，其组体元素（`data-step-process-body`，同时带 `body`/`expandedBody` 类）**自身声明** `--dsh-chat-flow-gap: 8px / 16px`，压过插件写在 `body` 上的 7px；组内成员间距改由该变量的最近声明者决定 | `new/dsh-client-ui-chat/lib/client.js:1822`（CSS）、`:2048`（同元素 attr）、`:2018-2019`（className）；old 无 `data-step-process`（计数 0）；插件 HEAD `dsh-code-card-fonts/src/css.ts:8-10` | 在 `[data-step-process-body]` 上同元素重指 `--dsh-chat-flow-gap`（工作区已有未提交改动，方向与特异性均正确）→ 构建 `lib/client.js` → Lead 复核 |

### 4.2 只影响「其他类型插件」的（本仓库不需要改，但与插件作者生态有关）

| 变更 | 影响哪类插件 | 证据 |
| --- | --- | --- |
| `ctx.settings` 由命名空间注册制改为 Profile 条目表单制（`applies` 只剩 `'live'`；`settings.yaml` 只导入一次） | 注册 settings 命名空间/自带设置页的**设置类插件** | §2.2 全部行。**上游自身的迁移样例**：`dsh-permission-presets` 删除 `PERMISSION_SETTINGS_NAMESPACE = "permission"`（`old/dsh-permission-presets/lib/types/index.d.ts:65`）并改为 Profile Config + `Volatile`（`new/dsh-permission-presets/lib/types/index.d.ts:1 import type { Volatile } from '@deepseek-ai/cordis'`），`PermissionCatalog` 增 `defaultOptions`/`defaultPreset`（`new/…/types.d.ts:28,30`；`defaultPreset` 的 Config 字段为 `Volatile<string | undefined>`（`:87`）） |
| `WorkspaceFiles.readAll` / `readRelated` 删除，统一 `readBytes`（原生 `Uint8Array` + 二进制 Remote） | 通过 `remote.workspaceFiles` 读文件字节的**文件/预览类客户端插件**，以及 host 侧包装 | A3 / §2.5 行 |
| 自定义事件中的附件不再被自动读取/导出 | 把附件只放进自定义事件 payload 的**插件** | A1 / §2.3 行 |
| Session 日志 V4（未知 V3 content tag → `plugin:<type>`；`developer/message` 严格校验） | 自写 Session content tag / developer history 的**会话格式类/投影类插件** | §2.4 行 |
| `conversation.session.header.leading` → `conversation.header.leading`（scope session→root）；新增 `conversation.header` / `conversation.input.activity` | 占用会话头 leading 座、输入栏活动座的**UI 槽插件** | `old|new/dsh-client-ui-conversation/lib/types/client/contract/slots.d.ts:160`（旧）vs `:167`（新）、`:135`（新 `conversation.header`） |
| chat node 槽契约：`ChatNodeInjected.disclosure`、`ChatNodeOwnerProps.groupPart`、`nodeStore`/`usePresentation` 取代 `historyIncomplete`/`compactTranscript`；`TurnProcessOwnerProps.hasContent` | 注册 `conversation.chat.node` 渲染器的**聊天节点插件** | `new/dsh-client-ui-chat/lib/types/client/contract/slots.d.ts:65-86,115-118,139`；`chat/ChatNodeSeat.d.ts:6,9,20` |
| 会话分组框架（`ConversationGroupDefinition` / `GroupUpdate` / `ConversationGroupedView`） | 注册 Conversation View/Group 定义的插件 | `new/dsh-client-ui-conversation/lib/types/client/contract/groups.d.ts:1-115`、`group-registry.d.ts:8-28` |
| 右栏保留式多会话挂载：`RightbarRoot` 语义变化、`rightbar.session` owner 增 `active`/`retainTab`、`tab.visible` 收窄为「仅前台会话」、tab registry 增 `keepMounted` | 注册 `rightbar.session` / `sidebar.right.pane.tab` 的右栏插件 | `new/dsh-client-ui-sidebar-right/lib/types/client/shell/RightbarRoot.d.ts`、`contract/slots.d.ts:14-20`、`tab-registry.d.ts:85-86` |
| `sessions.setSubagentCatalogOpen` / `refreshSubagents` 删除、`refreshProjections` 新增；`SessionListState.jobsBySession` / `subagentsByParent` 删除、`projectionsBySession` 新增 | 消费会话目录/jobs 镜像的插件 | A3 同款证据路径：`old2/dsh-api-session-controller/lib/types/client/contract/sessions.d.ts:96,102` vs `$DSH/…:96`；`$DSH/…/sessions/service.d.ts` 的 `SessionListState` |
| 投影缓存保留 `__proto__`/`constructor` 类特殊 JSON key | 自定义 session projection 的插件 | B8 行 |
| 多 patch 文件 + volatile 配置字段 | 组合包作者 / 需要免重载配置的宿主插件 | A7 / §2.7 行 |
| locale + package.json 图标（需 `exports` 放行） | 想在插件管理页展示翻译标题/图标的插件 | A6 / §2.6 行 |

### 4.3 与本仓库无关的

- §1.3 全部条目（模型页、Team 工具与看板、后台任务面板、Agent 模式说明、语音转写、Messages 协议修复、Windows 沙箱、pi-ai、Native addon、macOS 打开菜单、压缩预算、各类会话列表/新会话修复等）。
- §4.2 中所有「其他类型插件」项对本地 9 插件**均已逐项核实未命中**：本地插件没有设置命名空间、不读工作区文件、不注册 chat node / conversation view / group / 右栏 tab / 会话头 leading 座、不写 Session 事件、不做 projection。

---

## 5. 未确证 / 需复核清单

| 项 | 状态 | 说明 |
| --- | --- | --- |
| V1 `sessions.subagentAddress(id)` 语义放宽对 `dsh-kbd-hotkeys` 模型浮窗的影响 | **已确证变化，影响需人工复核** | 旧：`old2/dsh-api-session-controller/lib/types/client/contract/sessions.d.ts:88`「@returns the retained address, when present」；新：`$DSH/dsh-api-session-controller/lib/types/client/contract/sessions.d.ts:88`「@returns a retained or loaded-catalog address, without retaining a new selection or scope」。插件 `dsh-kbd-hotkeys/src/model-picker.ts:26-46` 以 `subagentAddressOf(...) !== undefined` 作为「当前会话是子代理 → 不出模型浮窗」的判据。放宽后**更多子代理会话会被识别**（对插件意图是更正确），但存在「已载入目录的非子代理地址」被误判的理论可能；上游未在 release note 单列该语义变化，未找到反向用例 → 标「需复核」。 |
| V2 RN 行 66「插件需迁移旧接口」中被移除的旧接口清单 | **部分确证** | `readAll`/`readRelated` 的删除已确证（A3）。RN 未穷举「old APIs」；`dsh-fs`/`dsh-fs-local` 是否另有旧接口一并下线，本次未逐符号穷举（本地无消费方，不影响结论）。 |
| V3 RN 行 62「通过 locale 数据结构声明」的确切文件布局 | **已确证到实现，但无官方示例包** | `$DSH/dsh-app-boot/lib/index.js:1706-1723`（`<pkg>/locale/<lang>.json`，`{meta:{title,description}}`，语言 id 做文件名、需与 en.json 同目录）已足以实现；全局安装中未找到带 `locale/` 目录的样例包用于交叉印证。 |
| V4 `--dsh-scrollbar-width 8→5` 是否影响本地插件观感 | **已确证值变化，未见消费方** | token 值变化已确证；`grep -rn "dsh-scrollbar-width" dsh-*` 无命中，故只作为 B2「视觉统一」的客观证据，不影响判定。 |
| V5 dsh-rightbar-fonts 对新增 Excel/CSV/TSV 预览的覆盖 | **已确证缺口** | 新渲染器 `$DSH/…/dsh-client-ui-sidebar-documentpreview/lib/client.excel.js` 使用 `data-excel-preview`，不含 `[data-textpreview-body]`；插件 README 声明的范围是「文件/文本/代码/Markdown 预览与变更审阅 diff」，故属**范围外的覆盖缺口，非回归**。是否扩范围由产品决定。 |
| V6 `dsh-client-ui-dockkit` 在全局安装中无独立目录 | **已解释，非缺陷** | `ls $DSH | grep dock` 为空，但 `@deepseek-ai/dsh-client-ui-dockkit@0.1.7-alpha.1` 在 npm 上存在（unpacked 250849 B），且 `new/dsh-client-ui-sidebar-right/lib/types/client/service.d.ts:3` 仍从它导入类型；`data-dockkit-tab` 只出现在 `dsh-web-frontend/dist` 与 dockkit 自身，说明它经前端 bundle 提供。本次用 npm tarball 做 old/new 对比（`old2/`、`new2/`），结论不依赖该目录是否落盘。 |

---

## 6. 附录：本地插件消费面的逐符号核对（0.1.7 存活证据）

只列「本地插件实际消费」的符号，避免结论空转。全部为 0.1.7 侧存在性核验。

### 6.1 服务面

| 符号 | 消费方 | 0.1.7 证据 | 判定 |
| --- | --- | --- | --- |
| `slots.entries` / `slots.resolveStore` / `slots.register` / `slots.inject` | desktop-notify、kbd-hotkeys、sidebar-default-collapsed | `dsh-client-ui-slots` old/new **仅 package.json 版本差异**（`diff -rq old/dsh-client-ui-slots new/dsh-client-ui-slots`）→ lib 与全部 `.d.ts` 逐字节相同 | 未变 |
| `dsh-client-store`（`SnapshotStore`/`ObservableSnapshot`） | 全部三步取数 | 同上：old/new **仅 package.json 差异** | 未变 |
| `layout.toggleSidebar`、`SIDEBAR_AUTO_COLLAPSE = 1024`、store `sidebar: 280` + `viewportWidth` | sidebar-default-collapsed | `new/dsh-client-ui-layout/lib/client.js` 中 `SIDEBAR_AUTO_COLLAPSE = 1024`、`toggleSidebar`、`viewportWidth`×10、`sidebar: 280` 与 old 一致；`AppFrame.d.ts`/`index.d.ts` 仅新增 `shell.leading` 槽（`new/dsh-client-ui-layout/lib/types/client/AppFrame.d.ts:4`、`index.d.ts:97`（新增 `'shell.leading'` 槽声明）） | 未变（纯新增） |
| `uiSession.current` / `sessionStatus` / `pendingInteractions` / `bindingSource` | desktop-notify、kbd-hotkeys | `old|new/dsh-client-ui-session/lib/types/client/index.d.ts` **逐字节相同**（`diff -u` 无输出）；client.js 唯一语义差异在 `completionUnread` 内部实现（`old:331`）`(row.retainedBy.mainView ?? 0) > 0` → `(new:331) this.isMain(id)`，等价 | 未变 |
| `sessions.binding(id)`、`sessions.list.getSnapshot()`、`sessions.retainInfo` | kbd-hotkeys、desktop-notify | `$DSH/dsh-api-session-controller/lib/types/client/contract/sessions.d.ts:45 list`、`:68 retainInfo`、`:153 binding`；`SessionSummary.displayTitle/title/origin/running` 保留（`$DSH/…/sessions/service.d.ts:19-27`） | 未变 |
| `sessions.subagentAddress` | kbd-hotkeys | 存在但语义放宽 | **见 V1** |
| `uiWorkspace.openSession(target)` / `startSession(id?)` / `openWorkspace(id)` | kbd-hotkeys | `new/dsh-client-ui-workspace/lib/types/client/navigation.d.ts:15 openSession / :24 openWorkspace / :42 startSession`（接口）与 `:125/:126/:128`（类实现）；接口成员清单核对（`UiWorkspace` 内 `openSession`/`openWorkspace`/`startSession` 均在，新增 `pinSession`/`unpinSession`、`archiveSession` 增可选 options） | 未变（纯新增/可选参数） |
| `workspaces.list.getSnapshot()` → `items` / `archivedSessionIds` | kbd-hotkeys | `old2/dsh-api-workspace-controller/lib/types/client/model.d.ts:10,12` 与 `$DSH/…:10,12` 均保留；新增 `pinnedSessionIds`（`:14`） | 未变（纯新增） |
| `sidebarRight.openTab` / `focus` / `toggleExpanded` / `isExpanded` | kbd-hotkeys | `new/dsh-client-ui-sidebar-right/lib/types/client/service.d.ts:112 openTab`、`:134 focus`、`:129 toggleExpanded`、`:127 isExpanded`；`ISidebarRight` 仅新增 `mounted`（`:92`） | 未变（纯新增） |
| `conversation.input.for(actx)` / `.shell(id)` → `editor.getRootElement()` | kbd-hotkeys（⌘/J） | `old|new/dsh-client-ui-conversation/lib/types/client/input/hub.d.ts` **逐字节相同**（`diff -u` 无输出）；`service.d.ts` 仅新增 `isImageMediaType` 导出 | 未变 |
| `modelDirectories.directoryFor(id)` + 目录 store 形状（`current`/`groups`/`models`/`reasoning`） | kbd-hotkeys（⌘/M、⇧Tab） | `diff -rq old2/dsh-client-ui-model-selection $DSH/dsh-client-ui-model-selection` → 仅 `lib/client.js` 与 `package.json` 差异，`lib/types/**` 逐字相同；`client.js` 中 `groups` 11/11、`current` 53/55、`selection` 40/40、`models` 15/15、`reasoning` 15/15 | 形状未变 |
| `ctx.get('sandboxPolicy').resolve({session})` → `{mode}` | git-guard | `dsh-sandbox-policy` old/new **仅 package.json 差异**（lib 与 `.d.ts` 相同）；`new/dsh-sandbox-policy/lib/types/index.d.ts:88 resolve(request?: SandboxPolicyRequest)` | 未变 |
| `ctx.inject(['systemPrompt'])` + `systemPrompt.section()` + `getSectionOrder('TEAM_POLICY')` | git-guard | `old2|$DSH/dsh-system-prompt/lib/types/index.d.ts:239 section(...)`、`:245 getSectionOrder(...)`、`:117 TEAM_POLICY: 600`；两者差异仅删除 `TOOL_CORDIS: 2500` | 未变 |
| `tools/pre-execute` 瀑布 + `PreToolDecision['ask']` | git-guard | `old2|new2/dsh-tools/lib/types/index.d.ts` 的 `PreToolDecision` 联合**逐字节相同**（`allow|deny|cancel|ask`），事件签名相同（旧 `:39`、新 `:47`，行号位移来自新增 `MessageSourceMap` 声明） | 未变 |
| `dsh-authorization` / `dsh-user-approval` | git-guard（间接） | 两者均**只做加法**：authorization 新增 `flow.commit(record)`（`new/dsh-authorization/lib/types/index.d.ts:80`）；user-approval 新增 `'user-approval'` MessageSourceMap 条目（`new/dsh-user-approval/lib/types/index.d.ts:13-15`）。`dsh-permission-presets` 另有实质迁移（见 §4.2），但 git-guard 不依赖它 | 未变（纯新增） |

### 6.2 DOM 锚点（本地 CSS 插件）

| 选择器 / 变量 | 插件 | old → new | 判定 |
| --- | --- | --- | --- |
| `body { --dsh-chat-flow-gap }` | code-card-fonts | 变量存在（old/new 均 1 文件命中），但 0.1.7 组体新增更近声明 | **必改（U1）** |
| `[data-step-process-body]`（在途新增） | code-card-fonts | old = 0 次，new = 3 次（`new/dsh-client-ui-chat/lib/client.js:2048` 等） | 新增锚点 |
| `[data-chat-flow-kind]` / `[data-disclosure-row]` / `[data-turn-process*]` / `[data-open]` / `[data-markdown-variant]` / `[data-tool]` / `[data-sample]` | code-card-fonts | 全部 old/new 双存，结构逐项对照见 §2.1 表 | 有效 |
| `[data-textpreview-body]` / `[data-textpreview-page]` / `[data-document-markdown]` | rightbar-fonts | old=2/1/1，new=2/1/1（`old|new/dsh-client-ui-sidebar-documentpreview/lib/client.js`） | 有效 |
| `[data-changes-review]` / `[data-diff-line]` + 22px 基线 | rightbar-fonts | old=1/3（`old/…/client.js:1506`；`:1740`/`:1784`/`:1806`），new=1/3（`new/…/client.js:1825`；`:906`/`:959`/`:981`）；`IP6KhG_line`、`IP6KhG_splitLine`、`IP6KhG_sideLine` 均 `min-height:22px;line-height:22px`（`new/…:620`，旧 `ReviewTab_*` 同值见 `old/…:1244`） | 有效 |
| `[data-dockkit-tab][role="tab"]` | rightbar-tab-width | `old2|new2/dsh-client-ui-dockkit/lib/index.js` 渲染点逐字相同（`role: "tab"` + `"data-dockkit-tab": tabId`）；`.tab{min-width:80px;padding:0 10px}` 未变；`SPLIT_MINIMUMS.chip = 100` 未变；`chipMinimum(root)` 实现逐字相同 | 有效 |
| `[data-dockkit-pane]`（终端聚焦，唯一有界 DOM 查询） | kbd-hotkeys | old：仅 `web-frontend/dist`；new：`new/dsh-client-ui-sidebar-right/lib/client.js` 新增 `[data-dockkit-column="0"][data-dockkit-pane]`（CSS 选择器）与 `[data-dockkit-host=dock]`；dockkit `PaneTree.d.ts` 未变 | 有效 |
| `[data-slot="main.conversation"] [data-conversation-content]` + `--dsh-chat-content-width` | fullwidth-chat | `old|new/dsh-client-ui-conversation/lib/client.js` 中该元素与 `--dsh-chat-content-width:min(calc(100% - 32px), 920px)` 声明逐字相同 | 有效 |
| `--dsw-font-markdown-code-block` / `-small` / `--dsh-content-font-size(-secondary)` / `--ds-font-family-code` | code-card-fonts、rightbar-fonts | 全部 old/new 存在且**定义值逐字相同**（`old|new/dsh-client-ui-theme/lib/client.js`） | 有效 |
| `--dsw-alias-label-secondary` / `--dsw-alias-interactive-bg-hover` / `--dsw-alias-label-dimmed` / `--dsw-alias-brand-primary` / `--dsw-specific-menu` / `--dsw-alias-border-l2` / `--dsw-elevation-prominent` / `--dsw-font-family` | desktop-notify、kbd-hotkeys overlay | 逐个 `grep -c` 计数 old == new | 有效 |
| `[data-plugin-css]`（kbd-hotkeys 自身去重标记） | desktop-notify、kbd-hotkeys | 上游 `data-plugin-css` 计数上升（chat 16→18、documentpreview 8→10），属上游自用，不冲突 | 无冲突 |
| `conversation.session.header.actions` | desktop-notify | old `…/contract/slots.d.ts:142`，new `:155`（`kind: 'list'`、`scope: 'session'`、`owner: ConversationHeaderActionOwnerProps` 均保留） | 有效 |
| `.dsh-desktop-notify-action` 等自有类名 | desktop-notify | 自有 CSS，无上游耦合 | 有效 |

### 6.3 patch / 组合面

| 项 | 证据 | 判定 |
| --- | --- | --- |
| `dsh-directory-picker-browse` 的 `disabled: directory-picker` | `$DSH/dsh-web-app/cordis.patch.yml:94-95`（id/name 与 old 相同） | 有效 |
| 插入的 `@deepseek-ai/dsh-host-directory-picker-browse` / `dsh-client-ui-directory-picker-browse` | 两包在 `$DSH` 中存在且版本 `0.1.7-alpha.1`；old/new package.json 仅版本与依赖号变化，`dsh-host-…` lib 未变 | 有效 |
| 「不触碰 `ui-deliverables`」 | `$DSH/dsh-web-app/cordis.patch.yml:309-310`（`ui-deliverables` 行与 old 相同），且 `data-changes-review`/`data-diff-line` 仍在 | 有效 |
| 9 插件 `dsh.bundle.patch` 单文件写法 | `new/dsh-web-app/package.json` 用数组示范；`$DSH/dsh-app-boot/lib/index.js:300-303` 对 `string` 分支 `[bundle.patch]` | 向后兼容 |
| 9 插件 `exports` 含 `./package.json` | 逐包 `package.json` 核对（以 `dsh-code-card-fonts`、`dsh-fullwidth-chat` 为例） | 图标能力开箱可用；locale 需补 `./locale/*` |
| 宿主入口可解析性要求 | 9 插件均提供 `exports["."]`（`index.ts` / `lib/index.js`） | 未变（`DshClientManifest` 在 `$DSH/dsh-package-manifest/lib/types/types.d.ts:76-89` 与旧一致：`platform`/`inject`/`immediately`/`external`） |

---

## 7. 一句话结论

0.1.6-alpha.2 → 0.1.7-alpha.1 对本地 9 个插件的**唯一必修项**是 `dsh-code-card-fonts` 的 `--dsh-chat-flow-gap`（新增 `ChatGroupSeat` 过程组容器在用更近的声明覆盖 body 值，`new/dsh-client-ui-chat/lib/client.js:1822/2018-2019/2048`）；另有 3 项需人工复核（`dsh-kbd-hotkeys` 的 `subagentAddress` 语义放宽、右栏多会话挂载与内置浏览器默认关闭对其 tab 逻辑的影响、`dsh-rightbar-fonts` 对新 Excel 预览的范围外覆盖），其余 8 个插件的全部消费面（slots/store/uiSession/uiWorkspace/workspace store/sidebarRight/conversation input/modelDirectories/sandboxPolicy/systemPrompt/tools pre-execute 与全部 CSS 锚点）经 old↔new 逐符号对照**均未发生破坏性变化**。RN 中其余「需迁移」条目分别只命中 settings 类、文件读取类、附件/会话格式类、UI 槽类插件，本地仓库没有这类插件。
