# 交互 / 宿主类插件迁移审计：0.1.6-alpha.2 → 0.1.7-alpha.1

审计对象（5 个）：

| 插件 | 形态 | 本次判定 |
| --- | --- | --- |
| `dsh-kbd-hotkeys` | Client only（TS） | **需要迁移**（2 处：Esc 子代理树枚举字段被删；侧栏顺序复刻面与上游新置顶/归档/filter 语义脱节） |
| `dsh-desktop-notify` | Client only（TS；react external） | **不受影响** |
| `dsh-sidebar-default-collapsed` | Client only（TS） | **不受影响** |
| `dsh-directory-picker-browse` | Patch only | **不受影响** |
| `dsh-git-guard` | Host only（TS） | **不受影响** |

只做分析：本报告未修改任何插件文件、未执行 git 操作、未改动 `~/.dsh`、未加载/重启插件、未运行 build/typecheck。

---

## 0. 证据来源与路径简写

本报告统一使用下列简写（绝对路径）：

- `NEW/<pkg>` = `/tmp/dsh-audit/new/<pkg>`（0.1.7-alpha.1 对照树）
- `OLD/<pkg>` = `/tmp/dsh-audit/old/<pkg>`（0.1.6-alpha.2 对照树）
- `G/<pkg>` = `/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/<pkg>`（本机全局 0.1.7-alpha.1 安装，`G/dsh/package.json` 的 `version` 实测为 `0.1.7-alpha.1`）
- `OLDX/<pkg>` = `/tmp/dsh-audit/old-extract/<pkg>`（**本次审计新拉取的 0.1.6-alpha.2 tarball**）

对照树 `/tmp/dsh-audit/{old,new}` 只含 28 个 client-ui 包，**不含** `dsh-api-session-controller`、`dsh-api-workspace-controller`、`dsh-client-ui-model-selection`、`dsh-subagent`、`dsh-tools`、`dsh-system-prompt`、`dsh-agent`、`dsh-client-ui-sidebar-terminal`。这些包的新侧证据取自 `G/`（0.1.7-alpha.1），旧侧证据取自本次从 npm 拉取的 `OLDX/`（`npm pack @deepseek-ai/<pkg>@0.1.6-alpha.2`，网络可用）。凡旧侧缺失者均在表中显式标注「未确证」。

判定口径：

- **需要迁移**：0.1.7-alpha.1 中新产物**不再命中**、或语义在迁移区间内真实变化，插件当前实现会在新版本上退化/行为错误。
- **需复核风险**：契约仍命中，但上游实现语义变化使某条实现路径变脆，或插件依赖的是上游**未声明**的私有成员（两版本一致，非迁移引入）。
- **不受影响**：契约在 0.1.7-alpha.1 中原样命中（或仅新增可选字段）。

---

## 1. 三个横向核查项（任务额外要求）

### 1.1 「设置改由当前 Profile 的插件配置保存，旧 settings.yaml 仅尝试导入一次」对这些插件的影响

**结论：5 个插件全部不受影响——它们都不读、不写 settings。**

- 逐个 grep 5 个插件目录的 `*.ts` / `*.mjs` / `*.yml` / `*.json` / `*.md`，除 `dsh-desktop-notify/README.md:66` 提到 Chrome 站点通知设置外，**没有任何 `settings` / `settings.yaml` / `installSection` 命中**。
- 所有 5 个插件的 `cordis.patch.yml` 挂载行都只有 `id` + `name`（无 `config`），不声明设置命名空间：`dsh-kbd-hotkeys/cordis.patch.yml:4-6`、`dsh-desktop-notify/cordis.patch.yml:4-6`、`dsh-sidebar-default-collapsed/cordis.patch.yml:4-6`、`dsh-git-guard/cordis.patch.yml:4-6`、`dsh-directory-picker-browse/cordis.patch.yml:4-12`。
- 需要适配的是**自定义设置插件**：对照证据 `dsh-permission-presets` 从 `settings.installSection(...)` + `PERMISSION_SETTINGS_NAMESPACE = 'permission'` 改为 `ctx.settings.configure(...)` + `config.defaultPreset.get()`
  （旧：`OLD/dsh-permission-presets/lib/index.js:71-72,190-205`；新：`NEW/dsh-permission-presets/lib/index.js:167-182`）。
- 本仓库 5 个插件里没有这种形态的插件（唯一的设置持久化是 `dsh-kbd-hotkeys` 的 `localStorage["dsh-kbd-hotkeys:v1"]` 与 `dsh-desktop-notify` 的 `localStorage["dsh.desktop-notify.enabled"]`，均不走上游设置面）。

### 1.2 「组合包支持按顺序加载多个 patch 文件」是否要求改写 `cordis.patch.yml` 结构

**结论：不需要。单文件写法被显式保留；数组是可选增强。**

- 契约证据：`G/dsh-package-manifest/lib/types/types.d.ts:66-69` ——
  `export interface DshBundleManifest { /** One patch file path, or an ordered list applied in sequence, each relative to the declaring package root. */ patch: string | string[] }`
- 上游自己改用了数组形式：`OLD/dsh-web-app/package.json` 的 `dsh.bundle.patch = "./cordis.patch.yml"` → `NEW/dsh-web-app/package.json` 的 `dsh.bundle.patch = ["./cordis.patch.yml","./presets/standard.patch.yml","./presets/ptc.patch.yml","./presets/minimal.patch.yml","./presets/cordis.patch.yml"]`。
- release note 原文：「插件组合包支持按顺序加载多个 patch 文件，**保留原有单文件写法**」（`/tmp/dsh-audit/releases/dsh-v0.1.7-alpha.1.md:64`）。
- 本仓库 5 个插件全部使用 `"patch": "./cordis.patch.yml"` 字符串形式，**无需改动**。

### 1.3 「插件可通过 package.json 声明图标与多语言标题」是否可选增强

**结论：可选增强，非迁移项；现有 manifest 字段全部仍然合法。**

- 新增字段均为可选：`G/dsh-package-manifest/lib/types/types.d.ts:12-15`（顶层 `icon?: string`）、`:43-53`（`PluginLocalizedMeta { title?, description?, icon?, error? }`）。
- `DshClientManifest`（`G/dsh-package-manifest/lib/types/types.d.ts:76-89`）仍是 `platform`（必填）+ `inject?` / `immediately?` / `external?`（可选）——5 个插件声明的 `dsh.client.platform: "web"` + `immediately: true` 依旧合法，且是发现插件所必需。
- 发现链路未变：`NEW/dsh-client-modules/lib/index.js:63-73`（校验 `dsh.client` 形状）、`:713-719`（`platform !== 'web'` 跳过；声明了 `dsh.client` 却无 `exports["./client"]` 才报错）。
- 展示侧新增可选元数据：`NEW/dsh-plugin-manager/lib/types/types.d.ts` 新增 `meta?: PluginLocalizedMeta`（diff: `+ meta?: PluginLocalizedMeta;`）。
- 若要启用，需要为每个插件加 `package.json.dsh` 之外的顶层 `icon` 与导出 locale 数据；**不改也能正常加载与展示**（回退到技术名）。本报告不建议纳入本次迁移。

---

## 2. `dsh-kbd-hotkeys`

### 2.1 依赖契约清单

判定列中「不受影响」= 新产物原样命中且旧产物对照一致。

| # | 契约（插件消费面） | 新产物是否命中 | 证据（新产物 文件:行） | 旧产物对照（文件:行） | 判定 |
| --- | --- | --- | --- | --- | --- |
| 1 | `uiSession.current.getSnapshot().key`（当前会话） | 命中 | `NEW/dsh-client-ui-session/lib/client.js:167`（`this.current = createBindingSource(this.absent.value)`）；`NEW/dsh-client-ui-session/lib/types/client/index.d.ts:131`（`private readonly current;`） | `OLD/.../lib/client.js:167`、`index.d.ts:131`（两者逐字节相同） | 不受影响（`current` 是 TS `private` 字段，运行时属性存在；两版本一致） |
| 2 | `uiSession.sessionStatus.getSnapshot()` / `.subscribe()` → `Map<id,{running,pendingInteraction,completionUnread}>` | 命中 | `NEW/dsh-client-ui-session/lib/client.js:148-155`；`NEW/.../index.d.ts:29-38,142` | `OLD/.../lib/client.js:148-155`（相同）；`OLD/.../index.d.ts` 与新版**逐字节相同**（diff 空） | 不受影响 |
| 3 | `uiSession.bindingSource({sessionId, binding})` → `getSnapshot()` → `{key, ctx, …}` | 命中 | `NEW/dsh-client-ui-session/lib/client.js:203-209`；`NEW/.../index.d.ts:156` | `OLD/.../lib/client.js:203-209`；`index.d.ts:156` | 不受影响 |
| 4 | `uiSession.pendingInteractions.getSnapshot()` | **未命中（两版本都未命中）** | `grep -rn pendingInteractions NEW/ OLD/ G/` → **0 命中**；`NEW/.../lib/client.js` 只暴露私有字段 `pendingSnapshot`（`:139,310-311,346,352`） | 旧侧同样 0 命中；`OLD/.../lib/client.js:139,310-311,347,353` | **需复核风险（既有，非迁移引入）**：主路径是死代码，实际靠私有 `pendingSnapshot` 回退（见 2.3） |
| 5 | `uiSession.pendingSnapshot`（私有 `Map<sid, PendingInteraction>`，回退面） | 命中 | `NEW/dsh-client-ui-session/lib/client.js:139,310-311`（`pendingSnapshot = new Map()` / `this.pendingSnapshot = projected`）、`:346,352` | `OLD/.../lib/client.js:139,310-311,347,353` | 不受影响 |
| 6 | `sessions.list.getSnapshot()` 的 `ids` / `byId` / `phase`，行字段 `displayTitle`/`title`/`cwd`/`running`/`retainedBy.mainView`/`blank`/`updatedAt`/`origin` | 命中 | `G/dsh-api-session-controller/lib/types/client/sessions/service.d.ts:43-52`（`ids` :45、`byId` :47、`phase` :49）；行字段 `:20-40`；`retainedBy` 形状 `:37-41` | `OLDX/.../service.d.ts:42-57`（`ids`/`byId`/`phase` 同形；`SessionRetainInfo` `:37-41` 逐字节相同） | 不受影响 |
| 7 | **`sessions.list.getSnapshot().subagentsByParent[parentId].entries[{kind,id}]`**（Esc 递归取消直系子代理） | **未命中（字段在 0.1.7 被删除）** | 新 `SessionListState = { ids, byId, phase, projectionsBySession }`：`G/.../service.d.ts:43-52`；`subagentsByParent` / `jobsBySession` 全域 0 命中（`grep -rn subagentsByParent NEW/ OLD/ G/` → 仅旧侧命中）；`refreshSubagents` → `refreshProjections`（见 2.4） | **旧侧确实存在**：`OLDX/dsh-api-session-controller/lib/types/client/sessions/service.d.ts:50`（`subagentsByParent: Readonly<Record<SessionId, SubagentCatalogSnapshot>>`）、`:42-57`；`OLDX/.../manager.d.ts:38`；产出代码 `OLDX/.../lib/client.js:2807`（`subagentsByParent: Object.fromEntries(this.catalogs)`） | **需要迁移** |
| 8 | `sessions.binding(id)` → `{session, ctx}` | 命中 | `G/.../service.d.ts:76-84`（`SessionBinding {sessionId, session, eventSource, ctx}`）、`:238` | `OLDX/.../service.d.ts` 同位置；两版本 `sessions/service.d.ts` 的**代码行 diff 只有** `import`、`SessionListState` 两字段、`refreshSubagents`→`refreshProjections` 三处 | 不受影响 |
| 9 | `sessions.subagentAddress(id)` | 命中 | `G/.../service.d.ts:118` | `OLDX/.../service.d.ts:118` | 不受影响 |
| 10 | `sessions.binding(id).session.getSnapshot()` → `{running, subagent:{address:{mode:'one-shot'\|'continuable'\|'unknown'}}}` 与 `session.cancel()` | 命中 | `G/.../contract/snapshot.d.ts:58-66`（`running` :61、`subagent.address` :62-66）；`G/.../contract/session.d.ts:107`（`cancel()`）；`mode` 联合 `G/dsh-subagent/lib/types/control-types.d.ts:64-73` | `OLDX/.../contract/session.d.ts` 与新版**代码行 diff 仅注释**；`snapshot.d.ts` 同形 | 不受影响 |
| 11 | `layout.toggleSidebar()` | 命中 | `NEW/dsh-client-ui-layout/lib/types/client/service.d.ts:37,66`；`NEW/.../stores.d.ts` 的 `LayoutActions.toggleSidebar` :55 | `OLD/dsh-client-ui-layout/lib/types/client/service.d.ts` 与新版**逐字节相同**；`stores.d.ts` 逐字节相同 | 不受影响（新版只改了 AppFrame 视觉：`NEW/.../lib/client.js` 的 `data-animating`/`shell.leading`） |
| 12 | `sidebarRight.toggleExpanded()` / `isExpanded()` / `active()` / `focus(tabId)` / `close(tabId)` / `openTab(kind, options?)` | 命中 | `NEW/dsh-client-ui-sidebar-right/lib/types/client/service.d.ts:117`（close）、`:122`（active）、`:127`（isExpanded）、`:129`（toggleExpanded）、`:134`（focus）、`:112`（openTab） | `OLD/.../service.d.ts:107/112/117/119/124/102`（同名同签名；新版只新增 `mounted` 与 import） | 不受影响 |
| 13 | 右栏会话级 store：`slots.entries('rightbar.session')` 注册项带 `store`；快照 `{bySession[sid].layout{nodes,tabs,activePaneId,rootId,expanded}}`；tab record `{id,kind,contentId}`；`actions.placeTab(sessionId,tabId,paneId,index)` | 命中 | 注册（`store` :8567 + `scope:'session'`）：`NEW/dsh-client-ui-sidebar-right/lib/client.js:8560-8575`；slot 声明 `NEW/.../contract/slots.d.ts:14-24`；store 状态 `NEW/.../stores.d.ts:32-47`；`placeTab` 签名 `NEW/.../stores.d.ts:102`；实例 actions 绑定 `NEW/.../lib/client.js:4987,5145-5147` | `OLD/.../stores.d.ts` 与新版**逐字节相同**（diff 空）；slot 声明 `OLD/.../slots.d.ts:14-21`；注册 `OLD/.../client.js:8325-8346`；`placeTab` `OLD/.../stores.d.ts:102` | 不受影响 |
| 14 | `slots.entries(key)` / `slots.resolveStore(handle, scopeBinding)`（renderer 的 `slots` 服务） | 命中 | `NEW/dsh-client-ui-renderer/lib/client.js:1517`（`entries(key)`）、`:1688`（`resolveStore(handle, scopeBinding)`）、`:1639`（`storeOf`）、`:1323`（`super(ctx, "slots")`） | `OLD/.../client.js:1515`（entries）、`:1686`（resolveStore）、`:1323`（服务名） | 不受影响（签名不变） |
| 15 | 同上链路的 `bindStoreScope`（`resolveStore` 内部被调用） | 命中，但**语义变了** | `NEW/.../lib/client.js:1487-1493`：换代时 `if (current !== void 0) this.releaseStoreScope(binding.key)`（先释放旧代内存实例） | `OLD/.../lib/client.js:1487-1493`：只 `set` 覆盖，无 `releaseStoreScope` | **需复核风险（低）**：当前实现 `src/scope-binding.ts:20` 传的 binding 与渲染端同源同引用 → `current === binding.ctx` 命中早退，行为不变；但若将来缓存 binding 跨代使用，新版会静默销毁旧实例 |
| 16 | slot `conversation.composer`（`kind:'chain'`, `scope:'session'`）+ 注册项 `select({pendingInteraction})` 与 `store` handle | 命中 | slot 声明 `NEW/dsh-client-ui-conversation/lib/types/client/contract/slots.d.ts:190-194`；注册 `NEW/dsh-client-ui-user-questions/lib/client.js:873-883`（`select:` :875、`store:` :877） | `OLD/.../slots.d.ts:183-187`；`OLD/dsh-client-ui-user-questions/lib/client.js:873-883`（逐行相同） | 不受影响 |
| 17 | 问答草稿 store：`create()` 实例 `getSnapshot().{requestKey,progress{index,drafts[{selected,custom,skipped}]}}`；`actions.replace(requestKey,progress)` / `actions.clear(requestKey)` | 命中 | `NEW/dsh-client-ui-user-questions/lib/client.js:170-182`（`init` :172、`replace` :174-177、`clear` :178-181） | `OLD/.../lib/client.js:170-182`（相同） | 不受影响 |
| 18 | `PendingQuestion.answer({answers:[{id,selected,custom?}]})` / `.cancel()`；`questions[].intent?.approve` 与 `options[].label` | 命中 | `NEW/dsh-client-ui-user-questions/lib/client.js:108`（answer）、`:131`（cancel）、`:35-48`（plan-review intent 解析） | `OLD/.../lib/client.js:108/131/35-48`（`diff` 显示这些行**零差异**，其余 diff 全是图标/CSS/`Reflect.get(keyCode)`） | 不受影响 |
| 19 | `PendingApproval`：`kind==='approval'`、`key`、`sessionId`、`toolName`、`reason`、`answer('allowed-once'\|'rejected')` | 命中 | `G/dsh-client-ui-approval/lib/client.js:115-145`（字段 `sessionId` :115、`kind` :121、`key` :123、`toolName` :144、`reason` :145）、`:140`（`this.kind = "approval"`）、`:166`（`answer(outcome)`）、`:271-283`（`registerPendingInteraction`） | 未确证（`dsh-client-ui-approval` 不在对照树；release note 未提及审批载荷变更） | 不受影响（新契约命中；旧侧未对照） |
| 20 | `conversation.input.for(actx)` / `.shell(id)` → `shell.editor.getRootElement()` | 命中 | `NEW/dsh-client-ui-conversation/lib/client.js:14132`（`for(actx)`）、`:14195`（`shell(id)`）、`:13425`（`SessionInputShell`）、`:13432`（`get editor()`）、`:3346`（`conversation` 服务 `this.input = config.input`） | `OLD/.../lib/client.js:13643`（for）、`:13706`（shell）、`:12958`（class）、`:12965`（getter）、`:2917`（服务） | 不受影响 |
| 21 | `uiWorkspace.openSession(target)` / `openWorkspace(id, beforeOpen?)` / `startSession(workspaceId?)` | 命中 | `NEW/dsh-client-ui-workspace/lib/types/client/navigation.d.ts:15`（openSession）、`:24`（openWorkspace）、`:42`（startSession） | `OLD/.../navigation.d.ts:13/20/37`（签名逐字相同） | 不受影响 |
| 22 | `ctx.modelDirectories.directoryFor(id)` → `{store.getSnapshot(), load(), select(selection)}`，状态 `{current,routable,groups,failures,status,error}` | 命中 | `G/dsh-client-ui-model-selection/lib/types/client/service.d.ts:44`（`directoryFor`）；`G/.../directory.d.ts:34-68`（`store` :41、`load()` :60、`select()` :68）；状态 `:13-32` | `OLDX/dsh-client-ui-model-selection/lib/types/client/service.d.ts`、`directory.d.ts` 与新版**逐字节相同**（diff 空） | 不受影响 |
| 23 | slot `sidebar.workspaces`（`single` / `scope:'root'`）注册项带 `store`（侧栏视图 store） | 命中 | slot 声明 `NEW/dsh-client-ui-sidebar/lib/types/client/contract/slots.d.ts:56-60`；注册 `NEW/dsh-client-ui-workspace/lib/client.js:4021-4041`（`store: viewStore` :4038） | `OLD/.../slots.d.ts:56-60`（逐字节相同）；注册 `OLD/dsh-client-ui-workspace/lib/client.js:2941-2950`（`store: createWorkspaceViewStore()` :2947） | 不受影响（`scope` 仍为 `root`，`resolveStore(handle, undefined)` 可用） |
| 24 | 侧栏视图 store 字段 `groupBy` / `orderBy` / `groupExpansion` / `sessionOrderByAccount` | 命中 | `NEW/dsh-client-ui-workspace/lib/client.js:701-710`（`init` 字段 :702-708）、`NEW/.../stores.d.ts:20-25` | `OLD/.../stores.d.ts` diff 仅**新增** `archivedFilter`、`pinSessionOrder`、`setArchivedFilter`（无删除）；persist 键两版本同为 `dsh.workspace.view.v5`（`NEW/.../lib/client.js:709`、`OLD/.../lib/client.js:263`） | 不受影响（但见 2.4 的顺序语义） |
| 25 | `workspaces.list.getSnapshot()` → `{items[{workspaceId,path,title,sessionIds,createdAt,updatedAt}], archivedSessionIds, phase}` | 命中 | `G/dsh-api-workspace-controller/lib/types/client/model.d.ts:9-18`（新增 `pinnedSessionIds` :14）；`G/.../types.d.ts:12-24`（`WorkspaceView`） | `OLDX/.../model.d.ts:9-16`（无 `pinnedSessionIds`，其余同）；`types.d.ts:12-24` 同 | 不受影响（`pinnedSessionIds` 为新增可选面） |
| 26 | `sidebarRight.openTab('files')` 与页地址 `sidebar://files` | 命中 | `NEW/dsh-client-ui-sidebar-files/lib/client.js:14`（`FILES_KIND = "files"`）、`:33`（`kind: FILES_KIND`）；`NEW/dsh-client-ui-sidebar-right/lib/client.js:257`（`pageAddress(kind)` → `` `sidebar://${kind}` ``） | `OLD/dsh-client-ui-sidebar-files/lib/client.js:13,32`（值相同）；`OLD/dsh-client-ui-sidebar-right/lib/client.js` 同 | 不受影响 |
| 27 | 终端页：`kind:'terminal'`、`multiple:true`、contentId 带 UUID（→ 以 `sidebar://terminal` 前缀认页） | 命中 | `G/dsh-client-ui-sidebar-terminal/lib/client.js:396-397`（`kind: "terminal"`、`multiple: true`） | 未确证（`dsh-client-ui-sidebar-terminal` 不在对照树；release note 未提及终端页类型变更） | 不受影响（新契约命中；旧侧未对照） |
| 28 | DOM 选择器 `[data-dockkit-pane="<paneId>"]` 内 `textarea.xterm-helper-textarea` | 命中 | `[data-dockkit-pane]`：`NEW/dsh-web-frontend/dist/assets/index-DU8FBaxM.js`（构建产物中 1 行含该属性，`grep -c` = 1）；`textarea.xterm-helper-textarea`：`G/dsh-client-ui-sidebar-terminal/lib/client.terminal.js`（class 存在，另见 CSS 规则） | `[data-dockkit-pane]`：`OLD/dsh-web-frontend/dist/assets/index-8VXBH-f-.js`（同样命中） | 不受影响（新产物命中；terminal 分块旧侧未对照） |
| 29 | `sidebarRight.close()` 的「独占停靠 guide 不关」语义 | 命中 | `NEW/dsh-client-ui-sidebar-right/lib/types/client/service.d.ts:113-117`（「Close one tab of the mounted session; the sole docked guide remains open.」与旧版逐字相同）；实现 `NEW/.../lib/client.js:6104-6110`（`close(tabId)` → `closeIn(sessionId, tabId)`）、`:6039`（`closeIn`）；`guideIn` 两版本同形（`NEW/.../lib/client.js:5106`） | `OLD/.../service.d.ts:108-112`；`OLD/.../lib/client.js:5112`（`guideIn`） | 不受影响 |

### 2.2 迁移结论

**需要迁移。** 两条独立理由：

**(A) Esc 的「停止当前会话树」在 0.1.7 退化为只取消当前会话。**

- 插件实现：`dsh-kbd-hotkeys/src/actions.ts:341-363` 的 `stopCurrentSessionTree` 读 `snapshot.subagentsByParent?.[id]?.entries`，遍历 `entry.kind === 'child'` 递归 `visit`。
- 类型声明同形：`dsh-kbd-hotkeys/src/types.ts:246-260`（`SubagentCatalogLike` / `SubagentCatalogEntryLike` / `SessionListSnapshotLike.subagentsByParent`）。
- 该字段在 0.1.6-alpha.2 真实存在（`OLDX/dsh-api-session-controller/lib/types/client/sessions/service.d.ts:50`、`OLDX/.../lib/client.js:2807`），插件的诊断脚本也按它建桩（`dsh-kbd-hotkeys/test-services.mjs:178,2036,2215`）——所以这不是「一直没生效」，而是**迁移区间内被上游删除**。
- 0.1.7 的替代面是投影：`sessions.list.getSnapshot().projectionsBySession[parentId]?.values.subagentCatalog` → `SubagentCatalogEntry[]` = `{id, createdAt} & ({mode:'one-shot',label?} | {mode:'continuable',label} | {mode:'unknown',label?})`
  （声明：`G/dsh-subagent/lib/types/projection-types.d.ts:8-20`，注册进 `SessionProjectionMap` 见 `:63-67`；上游客户端的规范用法：`NEW/dsh-client-ui-workspace/lib/client.js:491` 的 `list.projectionsBySession[parentId]?.values.subagentCatalog?.reduce(...)`）。
- 注意：新列表里**没有 `kind` 字段**（`kind==='child'` 判定失效），子代理身份改由「它就在 `subagentCatalog` 里」表达，一次性/可续跑改由 `mode` 表达。
- 另一个上游信号佐证子代理枚举整体改道：`OLD/dsh-client-ui-workspace/lib/types/client/subagent-lineage.d.ts:19`（`indexSubagentDescendants`，基于 `SessionSummary.parentId`/`origin`）在 0.1.7 被**删除**，由投影取代（`NEW/dsh-client-ui-workspace/lib/client.js:491`）。

**(B) 侧栏顺序/可见性复刻面与上游新的置顶、归档、归档筛选语义脱节。**

插件自述「复刻上游侧栏顺序」（`dsh-kbd-hotkeys/src/sidebar-order.ts:1`、`src/session-order.ts:4`），但 0.1.7 改了这套语义：

| 上游函数 | 0.1.6-alpha.2 | 0.1.7-alpha.1 |
| --- | --- | --- |
| `sessionVisible` | `(session, current, archived)`，归档恒不可见 | `(session, current, archived, archivedFilter)`，`archivedFilter ∈ 'default'\|'show'\|'only'`（`NEW/dsh-client-ui-workspace/lib/client.js:563-575,398-404`） |
| `reconcileManualOrder` | `(memberIds, savedOrder, summaries)` | 增 `rowState`；**置顶行前置**、归档行沉底、fork 行紧随其源（`NEW/.../lib/client.js:340-384`；签名 `NEW/.../tree.d.ts:116` vs `OLD/.../tree.d.ts:108`） |
| `deriveGroups` | `(list, workspaces, archivedSessionIds, statuses, view)` | `(list, workspaces, rowState, statuses, view)`，组内先 blank、再 pinned、再其余（`sectionMembers`，`NEW/.../lib/client.js:411-425,525-550`；签名 `tree.d.ts:154` vs `OLD:131`） |
| `deriveFlat` | `(list, sessionIds, statuses)` | `(list, sessionIds, rowState, statuses)`（`NEW/.../lib/client.js:580-591`） |
| flat 成员集 | 由调用方派生 | 新 `sessionMemberIds(list) = visibleSessionIds(list, [], 'show')`，**含归档**（`NEW/.../lib/client.js:553-561`） |
| 新增 | — | `pinSessionOrder` / `pinOrderAccounts` / `setArchivedFilter`（`NEW/.../lib/client.js:738-748,778-782`） |

影响面：`⌘/Ctrl+Alt+↑/↓`（活跃会话循环）沿 `sidebarOrderedSessionIds` 走，`⌘/Ctrl+I` 近期对话浮窗与 `⌘/Ctrl+K` 工作区浮窗的可见性/分组也共用同一判据（`src/sidebar-order.ts:27-75`、`src/recent-sessions.ts:39-42`、`src/workspace-switcher.ts:72-83`）。**在用户未置顶、未归档、filter 为默认时行为与 0.1.6 一致**；一旦使用 0.1.7 新增的置顶/归档/筛选，按键落点会与屏幕上的侧栏顺序不一致。

### 2.3 需要改什么（具体到文件与符号，不实施）

1. `src/types.ts:246-260`
   - 删除 `SubagentCatalogLike` / `SubagentCatalogEntryLike`；
   - `SessionListSnapshotLike.subagentsByParent?` 替换为
     `projectionsBySession?: Readonly<Record<string, { values?: { subagentCatalog?: readonly { id?: string; mode?: string }[] } } | undefined>>`。
2. `src/actions.ts:341-383`（`stopCurrentSessionTree` / `visit`）
   - 子代理枚举改为 `snapshot.projectionsBySession?.[id]?.values?.subagentCatalog`；
   - 元素类型改为 `{id, mode}`：去掉 `entry.kind !== 'child'` 过滤（该列表本身就是直系子代理），one-shot 跳过改读 `entry.mode === 'one-shot'`（`binding.session.getSnapshot().subagent.address.mode` 仍可作冗余判据，`G/dsh-subagent/lib/types/control-types.d.ts:64-73` 保证 `mode` 仍在）；
   - 投影未加载（`values.subagentCatalog` 缺席）时行为退化为「只取消当前会话」，与 0.1.7 客户端能力一致；README 第 16 行与「已知限制」需同步。不建议为此引入 `sessions.refreshProjections(parentId)`（新接口返回 Promise，会把 Esc 的同步吞键改成异步，违反该插件的同步分发模型）。
3. `src/session-order.ts:5-23`
   - `sessionRowVisible` / `sessionVisible` 增 `archivedFilter: 'default'|'show'|'only'` 形参，按 `NEW/dsh-client-ui-workspace/lib/client.js:398-404` 分支；`sessionRowVisible` 当前签名只接受 `ReadonlySet`，需要一并改造调用点（`src/sidebar-order.ts:41`、`src/recent-sessions.ts:42`、`src/workspace-switcher.ts:79`）。
4. `src/sidebar-order.ts:139-154`（`reconcileOrder`）
   - 对齐上游 `reconcileManualOrder(memberIds, savedOrder, summaries, rowState?)` 的四段结构 `[pins, saved-order, ordinary(recency), archives]` + fork 紧随其源（`NEW/.../lib/client.js:340-384`）。
5. `src/sidebar-order.ts:27-75`（`sidebarOrderedSessionIds`）
   - 组内套用 `sectionMembers` 语义（blank → pinned → 其余，`NEW/.../lib/client.js:411-425`）；
   - flat 轴成员集改由 `list.ids` 全量成员按 `archivedFilter` 过滤（对齐 `sessionMemberIds`，`NEW/.../lib/client.js:553-561`），而不是先按「归档恒不可见」裁剪。
6. `src/types.ts:168-176`（`WorkspaceViewStateLike`）
   - 增补 `archivedFilter?: string`，与 `NEW/dsh-client-ui-workspace/lib/types/client/stores.d.ts:22-27` 对齐；调用点从视图 store 快照读取后透传。
7. `src/recent-sessions.ts:39-42`、`src/workspace-switcher.ts:72-83`
   - 可见性判据同 3；`owningGroupKey` 复刻面无需改（上游实现逐字未变：`NEW/dsh-client-ui-workspace/lib/client.js` 的 `owningGroupKey` 与 `OLD/.../lib/client.js` 相同）。
8. 回归建议（不实施）：改完后重跑 `node test-services.mjs` / `node test-dispatch.mjs`，并把两者的 `subagentsByParent` 桩改成 `projectionsBySession`（`test-services.mjs:178,2036,2215`）。

### 2.4 需复核风险（非阻塞，但升级后应确认）

- **`uiSession.pendingInteractions` 是不存在的成员**：`src/actions.ts:24`、`src/recent-sessions.ts:200` 把它当首选路径。`grep -rn pendingInteractions` 在 `NEW/`、`OLD/`、`G/` 全域 **0 命中**；两版本运行时只有私有 `pendingSnapshot`。即插件「card 态判定 / 审批应答」实际一直走回退路径。**这是既有事实，不是 0.1.7 引入的**，但 `README.md:59` 的措辞（「`uiSession.pendingInteractions.getSnapshot()`（私有字段 `pendingSnapshot` 仅作兼容回退）」）与实情相反，建议本次一并修正文档（或直接删掉死路径）。
- **`bindStoreScope` 换代语义变严**：`NEW/dsh-client-ui-renderer/lib/client.js:1487-1490` 在 scope key 的 `ctx` 换代时先 `releaseStoreScope(key)`。插件的 `slots.resolveStore` 链路（`src/question-drafts.ts:38`、`src/sidebar-tabs.ts:348`）传的是 `src/scope-binding.ts:20` 从 `uiSession.bindingSource` 取到的绑定，与渲染端同源同引用 → 命中 `current === binding.ctx` 早退，行为不变。仅作观察项记录。

---

## 3. `dsh-desktop-notify`

### 3.1 依赖契约清单

| # | 契约 | 新产物是否命中 | 证据（新产物） | 旧产物对照 | 判定 |
| --- | --- | --- | --- | --- | --- |
| 1 | 浏览器半部 `export const inject = ['sessions','uiSession','slots']`（`src/client.ts:15`）由模块加载器读取 | 命中 | `NEW/dsh-client-modules/lib/client.js` 与旧版**逐字节相同**（diff 空）→ `__ModuleLoader__` 表契约未变；`NEW/dsh-client-modules/lib/index.js:63-73,713-719`（`dsh.client` 形状与 `./client` bundle 解析） | `OLD/dsh-client-modules/lib/client.js` 同；`OLD/.../lib/index.js` 同 | 不受影响 |
| 2 | `ctx.get('slots')` → `slots.inject(key, cb)` + `slots.register({name,id,order}, component)` | 命中 | `NEW/dsh-client-ui-renderer/lib/client.js:1323`（服务名）、`:1343`（`inject(key, callback)` 实现）；`NEW/dsh-client-ui-renderer/lib/types/client/registry.d.ts:85`（`register: SlotCore['register']`）、`:111`（`inject(key, callback)`）；`NEW/dsh-client-ui-slots/lib/types/index.d.ts:789-804`（`register` 两个重载） | `NEW` 与 `OLD` 的 `dsh-client-ui-slots/lib/types/index.d.ts` **逐字节相同**（diff 空）；`registry.d.ts` 仅注释不同；`renderer/lib/client.js` diff 只有 `bindStoreScope` 与注释 | 不受影响 |
| 3 | slot `conversation.session.header.actions`（`kind:'list'`, `scope:'session'`） | 命中 | `NEW/dsh-client-ui-conversation/lib/types/client/contract/slots.d.ts:154-158` | `OLD/.../slots.d.ts:141-145`（逐字节相同；注意旧版另有 `conversation.session.header.leading`，新版已删除——**本插件不使用**） | 不受影响 |
| 4 | `uiSession.sessionStatus`：`getSnapshot()` + `subscribe()`，行 `{running, pendingInteraction, completionUnread}` | 命中 | `NEW/dsh-client-ui-session/lib/client.js:148-155`；`NEW/.../index.d.ts:29-38,142`；`HostObservable<T> = ObservableSnapshot<T>`（`NEW/dsh-client-ui-slots/lib/types/renderer.d.ts:33`） | `OLD/.../lib/client.js:148-155`；`OLD/.../index.d.ts` 与新版逐字节相同 | 不受影响 |
| 5 | 待处理交互载荷 `kind`/`key`/`sessionId`/`toolName`/`reason`（approval）、`questions[].question/header/detail`（question / plan-review） | 命中 | approval：`G/dsh-client-ui-approval/lib/client.js:115-145,140,166`；question/plan-review：`G/dsh-client-ui-user-questions/lib/client.js:62-87`（`this.kind = planReviewOf(...) === void 0 ? "question" : "plan-review"` :87） | approval 未确证（不在对照树）；question 侧旧侧同形（`OLD/dsh-client-ui-user-questions/lib/client.js:108,131,35-48` 与新版零差异） | 不受影响 |
| 6 | `sessions.list.getSnapshot().byId[id]` 的 `displayTitle`/`title`/`origin`/`running` | 命中 | `G/dsh-api-session-controller/lib/types/client/sessions/service.d.ts:20-40`（`displayTitle` :22、`title` :21、`origin` :27、`running` :29） | `OLDX/.../service.d.ts:42-57`（`byId` 行同形） | 不受影响 |
| 7 | `react` 作为 external → 由 `window.__DSH_BOOT__.staticModules` 的 seed 提供同一实例 | 命中 | `NEW/dsh-web-frontend/dist/assets/index-DU8FBaxM.js:126` 的 `staticModules` 字面量含 `react` / `react/jsx-runtime` / `react-dom` / `react-dom/client` / `@deepseek-ai/cordis` / `dsh-client-store` / `dsh-client-ui-slots` / `dsh-client-ui-primitives` / `dsh-client-ui-dockkit` | `OLD/dsh-web-frontend/dist/assets/index-8VXBH-f-.js:126` 的列出项**完全一致** | 不受影响 |
| 8 | 通知开关持久化只用 `localStorage`（`dsh.desktop-notify.enabled`），不走上游设置 | 命中（不依赖上游） | `dsh-desktop-notify/src/notify-store.ts`（`ENABLED_STORAGE_KEY`）、`src/notify-env.ts`（`win.localStorage`） | 无上游契约 | 不受影响 |
| 9 | `uiSession` 的 `sessionStatus` 差分语义（`running true→false`、`pendingInteraction.key` 变化） | 命中，但上游 `reconcileStatus` 实现有微调 | `NEW/dsh-client-ui-session/lib/client.js:325-334`（改为遍历 `list.ids`，`completionUnread` 清理改走 `isMain(id)`） | `OLD/.../lib/client.js:325-334`（遍历 `Object.keys(list.byId)`，检查 `row.retainedBy.mainView`） | 不受影响：本插件只对顶层会话（`origin !== 'subagent'`，`src/notify-policy.ts:98`）的 `running` 与 `pendingInteraction.key` 做差分；`completionUnread` 明确不发通知（`src/types.ts:37-38`）。新版迭代范围变窄只影响「在 byId 但不在 ids」的子代理回退行，而这类行本就被跳过 |

### 3.2 迁移结论

**不受影响。** 全部 9 条契约在 0.1.7-alpha.1 原样命中。

理由小结：

- 唯一的服务面来源 `uiSession.sessionStatus` 的类型声明在两版本间**逐字节相同**，运行时实现只动了 `reconcileStatus` 的迭代范围与 `completionUnread` 清理路径，与本插件的差分判据无交集。
- slot `conversation.session.header.actions` 不变；`slots` 服务与 `SlotCore.register/inject` 的类型文件两版本逐字节相同。
- `react` external 依赖的 `staticModules` seed 逐项相同。
- 本插件不涉及附件（release note 的「仅存在于自定义事件的附件不再自动读取」）、不涉及 Session 日志 V3/V4、不涉及 Team 看板、不涉及 Remote 二进制/`readBytes`、不读写设置。

**无需改动。** 可选的、非迁移性质的增强：0.1.7 起可在 `package.json` 声明 `icon` 并用导出 locale 声明多语言标题（见 1.3），本插件的按钮目前是硬编码中文（`src/notify-action.ts:32-37` 的 `hintOf`），可按需采纳，不属于迁移项。

---

## 4. `dsh-sidebar-default-collapsed`

### 4.1 依赖契约清单

| # | 契约 | 新产物是否命中 | 证据（新产物） | 旧产物对照 | 判定 |
| --- | --- | --- | --- | --- | --- |
| 1 | `layout` 服务 + `toggleSidebar()` | 命中 | `NEW/dsh-client-ui-layout/lib/types/client/service.d.ts:37,66`；`NEW/.../stores.d.ts:55`（`toggleSidebar: (draft: LayoutState) => void`）；服务提供处 `NEW/.../lib/client.js:609`（`ctx.reflect.provide("layout", layout)`） | `OLD/dsh-client-ui-layout/lib/types/client/service.d.ts` 与 `stores.d.ts` 均**逐字节相同** | 不受影响 |
| 2 | `slots.entries('root')` 注册项带 `store`（布局 store 座） | 命中 | `NEW/dsh-client-ui-layout/lib/client.js:610-636`（`name: "root"` :611，`store` :635，`children` 为 `sidebar/main/rightbar/shell.overlay/shell.leading`） | `OLD/.../lib/client.js:543-565`（`name: "root"` :544，`store` :564，`children` 四项——新版新增 `shell.leading`，`store` 不变） | 不受影响 |
| 3 | `slots.resolveStore(handle, undefined)`（root 作用域） | 命中 | `NEW/dsh-client-ui-renderer/lib/client.js:1688-1699`（`record.scope === "root"` → `handle.create()`）；`_register` 时 `_acquire(store, spec.scope)`（`:1587-1590`） | `OLD/.../lib/client.js:1686-1697`、`:1585-1588`（逐字相同） | 不受影响（`bindStoreScope` 的换代语义变更对 root 作用域不适用） |
| 4 | 快照形状 `{ layoutInfo: { sidebar: number, viewportWidth: number } }` | 命中 | `NEW/dsh-client-ui-layout/lib/types/client/stores.d.ts:18-21`（`LayoutInfo.sidebar` :19、`viewportWidth` :21） | `OLD/.../stores.d.ts` 逐字节相同（diff 空） | 不受影响 |
| 5 | 上游窄窗断点 `SIDEBAR_AUTO_COLLAPSE = 1024`（`src/boot-collapse.ts:8`） | 命中 | `NEW/dsh-client-ui-layout/lib/client.js:13`（`const SIDEBAR_AUTO_COLLAPSE = 1024`）、`:254` | `OLD/.../lib/client.js:13,235`（相同值） | 不受影响 |
| 6 | `toggleSidebar` 的宽窗分支（把 `sidebar` 置 0） | 命中 | `NEW/dsh-client-ui-layout/lib/client.js:438-440`（`viewportWidth < 1024` → 翻 `narrowExpanded`，否则 `d.layoutInfo.sidebar = d.layoutInfo.sidebar === 0 ? 280 : 0`） | `OLD/.../lib/client.js:372-373`（同逻辑；`< 1024` 硬编码值相同） | 不受影响 |
| 7 | 左栏无持久化（插件假定初值硬编码、无 config） | 命中 | `NEW/.../stores.d.ts:1-14`（注释「Transient layout preferences」）；`createLayoutStore` 的 `defineStore` **无 `persist` 键**（`NEW/.../lib/client.js:411-425`，全文件 `grep -c persist` = 0），`sidebar` 初值 280（`:416`） | `OLD/.../stores.d.ts` 同；`OLD/.../lib/client.js` 同 | 不受影响 |
| 8 | root 注册不带 `scope`（store 作用域由 slot key 的声明决定为 `root`） | 命中 | `NEW/dsh-client-ui-layout/lib/client.js:610-636`；作用域来源 `_register` 的 `this._core.specDynamic(options.name).scope`（`NEW/dsh-client-ui-renderer/lib/client.js:1588`） | 同上，`OLD/dsh-client-ui-renderer/lib/client.js:1586`（逐字相同） | 不受影响 |

### 4.2 迁移结论

**不受影响。** 全链路（`slots.entries('root')` → 带 `store` 的注册项 → `resolveStore(handle, undefined)` → `getSnapshot().layoutInfo` → `layout.toggleSidebar()`）在 0.1.7-alpha.1 原样成立。

0.1.7 对本插件相关包的真实变化只有视觉/外壳层，均不改契约：

- `dsh-client-ui-layout`：AppFrame 新增 `data-animating` 过渡门控、`shell.leading` seat、`data-panel-conversation` 标记（`NEW/.../lib/client.js` 的 `ConversationMarker` / `leadingSeat`）——`service.d.ts` 与 `stores.d.ts` 两版本逐字节相同。
- 侧栏宽度仍未持久化，`toggleSidebar` 的 1024 断点与宽/窄分支写法未变。

**无需改动。**

---

## 5. `dsh-directory-picker-browse`

纯补丁插件（无 `index.ts` / `src/` / `lib/`），本插件只有 3 个文件。

### 5.1 依赖契约清单（patch 组合目标）

| # | 契约 | 新产物是否命中 | 证据（新产物） | 旧产物对照 | 判定 |
| --- | --- | --- | --- | --- | --- |
| 1 | `disabled: true` 的目标行 id = `directory-picker`，其 name = `@deepseek-ai/dsh-host-directory-picker-auto` | 命中 | `NEW/dsh-web-app/cordis.patch.yml:94-95`（`- id: directory-picker` / `name: '@deepseek-ai/dsh-host-directory-picker-auto'`） | `OLD/dsh-web-app/cordis.patch.yml:94-95`（**逐字节相同**） | 不受影响 |
| 2 | `insert` 行 id `directory-picker-browse`，name `@deepseek-ai/dsh-host-directory-picker-browse` | 命中 | 包仍存在且 name 未变：`NEW/dsh-host-directory-picker-browse/package.json`（`"name": "@deepseek-ai/dsh-host-directory-picker-browse"`）；`main` 仍为 `lib/index.js`，`exports["."]` 未变 | `OLD/dsh-host-directory-picker-browse/package.json`（name 相同；仅 `version` 与 `dependencies`/`peerDependencies` 版本号升级：`dsh-host-directory-picker` `^0.1.6-alpha.2`→`^0.1.7-alpha.1`、`cordis` `^4.0.2`→`^4.0.3`） | 不受影响 |
| 3 | `insert` 行 id `directory-picker-browse-ui`，name `@deepseek-ai/dsh-client-ui-directory-picker-browse` | 命中 | `NEW/dsh-client-ui-directory-picker-browse/package.json`（name 未变；`dsh.client.inject = ['@deepseek-ai/dsh-api-remotes','@deepseek-ai/dsh-client-ui-renderer','@deepseek-ai/dsh-client-ui-workspace','@deepseek-ai/dsh-client-locale']`，`dsh.client.platform = "web"`；`exports["./client"]` 未变） | `OLD/.../package.json`（`dsh` 与 `exports` **完全相同**；仅 version 与 `peerDependencies` 版本号升级 `^4.0.2`→`^4.0.3`） | 不受影响 |
| 4 | 上游是否给出「在 overlay 中挂 -native / -browse 以固定交互」的等价做法 | 命中 | `NEW/dsh-web-app/cordis.patch.yml:91-93`：`# Resolve bind host, SSH launch, and display once at boot, then mount the matching dual-face directory picker. Mount -native or -browse directly in an overlay to pin the interaction.` | `OLD/dsh-web-app/cordis.patch.yml:91-93` 同段注释（逐字相同） | 不受影响 |
| 5 | 行 id 全局唯一性与 `disabled` 覆盖语义（`disabled` 只针对 id，不依赖被覆盖行的 name） | 命中 | `NEW/dsh-web-app/cordis.patch.yml:1-4` 文件头注释：`# Applied after dsh-base's insert; rows here override base rows by id` | `OLD/dsh-web-app/cordis.patch.yml:1-4`（文件头注释未变） | 不受影响 |
| 6 | `dsh.bundle.patch` 声明形式 | 命中 | `G/dsh-package-manifest/lib/types/types.d.ts:66-69`（`string \| string[]`）；本插件用字符串 `"./cordis.patch.yml"` | 同（单文件写法保留） | 不受影响（见 1.2） |

### 5.2 迁移结论

**不受影响。** 三个组合目标的 id 与包名在 0.1.7-alpha.1 中全部原样存在；被 `disabled` 的行仍是 host 侧的 `directory-picker`（`auto` 变体），browse 的宿主/浏览器两个 in-box 包名与导出口未变（只升了版本号与 peer 依赖范围）。上游甚至在注释里明确保留了「在 overlay 中挂 `-browse` 固定交互」的做法。

**无需改动。** 唯一可选的、非必需的变化：把 `dsh.bundle.patch` 改成数组形式（无收益，不推荐）。

---

## 6. `dsh-git-guard`

### 6.1 依赖契约清单

| # | 契约 | 新产物是否命中 | 证据（新产物） | 旧产物对照 | 判定 |
| --- | --- | --- | --- | --- | --- |
| 1 | 宿主服务名 `sandboxPolicy`（`ctx.get('sandboxPolicy')`，`index.ts:96`） | 命中 | `NEW/dsh-sandbox-policy/lib/index.js:111`（`super(ctx, "sandboxPolicy")`）；`NEW/.../lib/types/index.d.ts:30`（`interface Context { sandboxPolicy: SandboxPolicyService }`） | `OLD/dsh-sandbox-policy/lib/index.js:111`；`OLD/.../index.d.ts:30` | 不受影响 |
| 2 | `sandboxPolicy.resolve(request?)` → `{ mode }`，`request = { session? }` | 命中 | `NEW/.../lib/types/index.d.ts:50-55`（`SandboxPolicyRequest { session?: Session; mode?: SandboxMode }`）、`:88`（`resolve(request?: SandboxPolicyRequest): SandboxExecutionPolicy`）；实现 `NEW/.../lib/index.js:141-148`；返回的 `mode` 见 `G/dsh-sandbox/lib/types/index.d.ts:27-29` | `diff -rq OLD/dsh-sandbox-policy/lib NEW/dsh-sandbox-policy/lib` → **无差异**（`lib/` 逐字节相同，仅 `package.json` 版本号不同） | 不受影响 |
| 3 | `mode` 的闭集仍含 `danger-full-access` | 命中 | `NEW/.../lib/types/index.d.ts:57`（`zod` 联合 `"read-only" \| "workspace-write" \| "danger-full-access"`） | 同（`lib/` 逐字节相同） | 不受影响 |
| 4 | 会话覆盖的来源：`resolve` 读 `session` 的 `sandboxMode` 投影 | 命中 | `NEW/.../lib/index.js:144`（`request.mode ?? (session === void 0 ? void 0 : this.overrideOf(session)) ?? this.defaultMode`）、`:154-156`（`overrideOf` → `ctx.sessionProjections.stateOf(session, "sandboxMode")`） | 同（`lib/` 逐字节相同） | 不受影响 |
| 5 | 事件 `tools/pre-execute`（瀑布）签名 `(exec, next) => Promise<PreToolDecision>` | 命中 | `G/dsh-tools/lib/types/index.d.ts:47` | `OLDX/dsh-tools/lib/types/index.d.ts:39`；两文件 `sed` 归一化 diff **只有 1 处新增**（`declare module '@deepseek-ai/dsh-llm'` 的 `MessageSourceMap`），事件与 `PreToolDecision` 零差异 | 不受影响 |
| 6 | `PreToolDecision` 含 `{kind:'ask'; reason?: string}`（本插件只产出 ask） | 命中 | `G/dsh-tools/lib/types/index.d.ts:434-445`（allow :435 / deny :437 / cancel :442 / ask :444-445） | `OLDX/.../index.d.ts:426-437`（逐字相同） | 不受影响 |
| 7 | `exec` 载荷 `{name, arguments, agent}` | 命中 | `G/dsh-tools/lib/types/index.d.ts:206-219`（`ToolExecutionInput.name` :213、`arguments` :217、`agent?` :219）、`:272-277`（`ToolExecution extends ToolExecutionInput`） | `OLDX/.../index.d.ts` 同名同形（两文件 diff 仅上述 1 处） | 不受影响 |
| 8 | `exec.agent?.session`（传给 `sandboxPolicy.resolve({session})`） | 命中 | `G/dsh-agent/lib/types/runtime-types.d.ts:139-146`（`declare module './types.ts' { interface Agent { readonly session: Session; … } }`） | `OLDX/dsh-agent/lib/types/runtime-types.d.ts:139` 同（该 augmentation 块一致） | 不受影响 |
| 9 | `ctx.systemPrompt.section({name,order,text})` + `getSectionOrder(name)` | 命中 | `G/dsh-system-prompt/lib/types/index.d.ts:239`（`section(section: PromptSection): () => void`）、`:245`（`getSectionOrder(name: PromptSectionOrderName): number`）、`:47-60`（`PromptSection`） | `OLDX/dsh-system-prompt/lib/types/index.d.ts`：diff **仅 1 行删除**（`readonly TOOL_CORDIS: 2500;`），`section` / `getSectionOrder` / `PromptSection` 零差异 | 不受影响 |
| 10 | 区段顺序常量 `TEAM_POLICY` 仍存在（`index.ts:479` 用它取 order） | 命中 | `G/dsh-system-prompt/lib/types/index.d.ts:117`（`readonly TEAM_POLICY: 600;`） | `OLDX/.../index.d.ts:117`（值 600 相同） | 不受影响 |
| 11 | 区段文本按会话动态求值：`text: (assembleContext) => …assembleContext.agent?.session` | 命中（运行时有 `agent`） | 声明类型 `AssembleContext` **不含 `agent`**（`G/dsh-system-prompt/lib/types/index.d.ts:37-45` 仅 `scope?`/`signal?`），但运行时由 `assembleContextFor(agent, signal)` 注入：`G/dsh-agent/lib/index.js:291-297`（`return { agent, scope: agent, ...signal… }`），调用点 `G/dsh-agent-loop/lib/index.js:907` | `OLDX/dsh-agent/lib/index.js:258-264`（`assembleContextFor` 逐字相同）；两版本 `AssembleContext` 声明相同（`OLDX/.../index.d.ts:37-45`） | **需复核风险（既有，非迁移引入）**：依赖未声明的运行时段；两版本一致，故迁移不引入回归 |
| 12 | 本插件不产生 `deny`，ask 的 `reason` 恒非空（release note「普通 Bash 调用不再因无须使用的权限说明为空而失败」不适用） | 命中 | `dsh-git-guard/index.ts:375-429`（所有 ask 分支都带非空 `reason`；`decide` 返回 `undefined` 时走 `next()` 而非 `{kind:'ask'}`） | — | 不受影响 |
| 13 | 宿主服务可用性判定为「失败关闭」：服务缺席 / 无 `resolve` / 抛错 → 视为非完全权限（照常 ask） | 命中 | `dsh-git-guard/index.ts:92-110`；`resolve` 抛错路径 `NEW/.../lib/index.js:141-148`（`overrideOf` 在会话无 header 时会抛，插件已 catch） | 同（`lib/` 逐字节相同） | 不受影响 |

补充核查（任务点名的另外三个宿主包）：

- `dsh-permission-presets`：类型新增 `defaultOptions` / `defaultPreset`（`NEW/dsh-permission-presets/lib/types/types.d.ts:27-30`），实现从 `settings.installSection` 改为 `ctx.settings.configure` + `config.defaultPreset.get()`（`OLD/.../lib/index.js:71-72,190-205` → `NEW/.../lib/index.js:167-182`）。**这是设置插件的迁移项，与本插件的 `ctx.get('sandboxPolicy')` 判定无交集**：预设最终仍写同一个沙箱模式投影（`resolve` 的 `overrideOf` 读 `sessionProjections.stateOf(session,'sandboxMode')`，`NEW/dsh-sandbox-policy/lib/index.js:154-156`）。
- `dsh-user-approval` / `dsh-authorization`：有改动（`lib/index.js`、`lib/types/index.d.ts` 均 diff），但本插件**只以 `{kind:'ask', reason}` 交回宿主**、不直接调用这两个包的服务或类型（`index.ts` 无相关 import/`ctx.get`），故它们的内部变化不构成契约面。
- 内置浏览器默认关闭、Team 看板只读、Session 日志 V4、附件、Remote 双向流/`readBytes`：本插件均不涉及（无附件处理、无 Session 日志读写、无工作区文件读写、无 Team 交互）。

### 6.2 迁移结论

**不受影响。** 三条关键契约——`ctx.get('sandboxPolicy').resolve({session})?.mode`、`tools/pre-execute` 事件与 `PreToolDecision`、`ctx.systemPrompt.section()` / `getSectionOrder('TEAM_POLICY')`——在 0.1.7-alpha.1 全部原样命中：

- `dsh-sandbox-policy` 的 `lib/` 目录**逐字节相同**（只有 `package.json` 版本号变化），服务名、`resolve` 签名、`SandboxPolicyRequest`/`SandboxExecutionPolicy`、`danger-full-access` 闭集、会话覆盖来源全部未变。
- `dsh-tools` 的类型文件 diff 仅新增一处与 `dsh-llm` 的消息来源声明合并，`tools/pre-execute`、`PreToolDecision`、`ToolExecution` 零差异。
- `dsh-system-prompt` 的类型 diff 仅删除未被本插件使用的 `TOOL_CORDIS` 顺序常量。

**无需改动。**

一处既有脆弱点（**非迁移引入**，可择机加固）：区段文本的动态求值依赖 `assembleContext.agent`，而该字段**不在上游声明的 `AssembleContext` 里**，只在运行时由 `assembleContextFor` 附带。若将来该运行时段被清理，完全权限会话下的区段抑制会静默失效（区段会照常注入）。两版本行为一致，因此不阻塞本次迁移；加固方式是用 `assembleContext.scope`（`AssembleContext.scope?: ScopeKey`，`G/dsh-system-prompt/lib/types/index.d.ts:42`）反查会话，或在 `section` 之外另挂 `systemPrompt/assemble` 瀑布自行判定。

---

## 7. 汇总

| 插件 | 判定 | 一句话理由 | 需改文件（若迁移） |
| --- | --- | --- | --- |
| `dsh-kbd-hotkeys` | **需要迁移** | ① Esc 递归取消子代理读的 `sessions.list.subagentsByParent` 在 0.1.7 被 `projectionsBySession[parentId].values.subagentCatalog` 取代（旧侧确实存在该字段）；② 侧栏顺序/可见性复刻面未跟上新增的置顶、归档、`archivedFilter` 语义，导致 `⌘/Ctrl+Alt+↑↓` 等在启用新特性后与屏幕顺序不一致 | `src/types.ts`、`src/actions.ts`、`src/session-order.ts`、`src/sidebar-order.ts`、`src/recent-sessions.ts`、`src/workspace-switcher.ts` |
| `dsh-desktop-notify` | **不受影响** | `uiSession.sessionStatus` 声明两版本逐字节相同、`conversation.session.header.actions` 与 `slots.register/inject` 未变、`staticModules` 的 react seed 逐项相同；本插件不涉及附件/日志/Team/Remote/设置 | — |
| `dsh-sidebar-default-collapsed` | **不受影响** | `root` 注册仍带 `store`、`resolveStore(handle, undefined)` 的 root 分支未变、`layoutInfo.{sidebar,viewportWidth}` 与 `toggleSidebar` 的 1024 断点/宽分支逐字相同，侧栏仍无持久化 | — |
| `dsh-directory-picker-browse` | **不受影响** | `disabled` 目标行 `directory-picker`（`@deepseek-ai/dsh-host-directory-picker-auto`）与两个 browse 变体包名/导出口在 0.1.7 原样存在，上游注释还鼓励这种 overlay 用法 | — |
| `dsh-git-guard` | **不受影响** | `dsh-sandbox-policy/lib` 逐字节相同（服务名/`resolve`/`danger-full-access` 闭集/会话覆盖来源均未变）、`tools/pre-execute` 与 `PreToolDecision` 类型零差异、`section()`/`getSectionOrder('TEAM_POLICY')` 未变 | — |

---

## 8. 未确证项（明确列出，避免过度结论）

1. `uiSession.pendingInteractions` 是否曾在**任何**历史版本存在：本次只在 0.1.6-alpha.2 与 0.1.7-alpha.1 两个版本全域 grep（含对照树与全局安装），均 0 命中。更早版本未查 → 「一直是死路径」属推断而非确证；但「迁移区间内没变」是确证的。
2. `dsh-client-ui-approval` 的 `PendingApproval` 载荷字段：`dsh-client-ui-approval` 不在 `/tmp/dsh-audit/{old,new}` 对照树，未拉取 0.1.6-alpha.2 版本对照 → 新侧契约命中已核验，旧侧「无差异」未确证。
3. `dsh-client-ui-sidebar-terminal` 的 `kind:'terminal'` / `multiple:true` / `xterm-helper-textarea`：同样不在对照树 → 新侧命中已核验（`G/...`），旧侧未确证。
4. `NEW/dsh-client-ui-workspace/lib/client.js:491` 的 `subagentCatalog` 投影是否在 0.1.6-alpha.2 就已存在（即旧版是否同时存在 `subagentsByParent` 与投影两条路）：只确证旧版**确有** `subagentsByParent`（`OLDX/.../service.d.ts:50`）且 `NEW/OLD` 的 workspace 包在旧版走 `subagent-lineage.ts` 的 `parentId` 派生（`OLD/dsh-client-ui-workspace/lib/types/client/subagent-lineage.d.ts:19`，新版已删）→ 「0.1.7 改道」成立；「投影是否为新引入」未逐版确证。
5. `dsh-user-approval` / `dsh-authorization` 的具体改动内容未逐行阅读：已通过代码检索确认 `dsh-git-guard` 不 import、不 `ctx.get` 这两个包的服务/类型，故其改动不构成契约面（这是「无交集」的确证，不是「无改动」的确证）。
