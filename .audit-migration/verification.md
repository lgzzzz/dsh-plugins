# 对抗式复核报告（task-4）

独立复核员：verifier。基线：本机全局 DSH = `0.1.7-alpha.1`（`$G` =
`/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/`，277 个包）；对照 = `0.1.6-alpha.2`
（`/tmp/dsh-audit/{old,old2,oldx}` 共 44 包，逐个核验 `package.json` 版本 = `0.1.6-alpha.2`；缺口用
`npm pack @deepseek-ai/<pkg>@0.1.6-alpha.2` 补齐）。

复核方法：**不引用 task-1/2/3 的行号**，全部自行 `grep`/`diff`/`npm pack`/重建取证。本文所有 `文件:行` 均为本次
复核重新定位所得。工作方式：只读工作区；唯一写入 = 本文件；`dsh-code-card-fonts` 的未提交改动保持原样
（复核后 `git status --porcelain` 仍为 `M README.md / M lib/client.js / M src/css.ts / ?? .audit-migration/`，
`lib/client.js` sha256 = `965fb9c74edb572ac18362fac88051443eb8e16179bbf3bc8bed5fad9714ecab`，与复核前一致）。

---

## 1. 冲突裁决：`sessions.list.getSnapshot().subagentsByParent` 在 0.1.7 被删除

### 1.1 判定

**task-3 正确，task-1 错误。** `subagentsByParent` 在 `0.1.6-alpha.2 → 0.1.7-alpha.1` 之间被删除，
`dsh-kbd-hotkeys` 的 Esc「停止当前会话」动作因此**真实退化**（插件 README/快捷键表承诺的「含运行中子代理」
不再成立）。

### 1.2 双侧证据（类型面 + 运行时面，均自行取证）

**插件消费侧（工作区）**
- `dsh-kbd-hotkeys/src/actions.ts:353`：`const catalog = snapshot.subagentsByParent?.[id]`（位于
  `stopCurrentSessionTree`，`:341-363`；`:354-359` 依赖 `catalog.entries` 递归直系子代理）。
- `dsh-kbd-hotkeys/src/types.ts:256-260`：`SessionListSnapshotLike` 显式声明
  `subagentsByParent?: Readonly<Record<string, SubagentCatalogLike | undefined>>`（**插件自己就写了这个名字**，
  一次 `grep -rn subagentsByParent <plugin>` 即可命中）。
- 可达路径：`src/config.ts:49`（`session.stop`，label「停止当前会话(无审批卡片时;**含运行中子代理**)」）、
  `src/config.ts:94`（`'session.stop': 'escape'`）、`src/client.ts:86-89`（分发调用 `stopCurrentSessionTree(services)`）。

**0.1.7-alpha.1（新）不存在**
- `$G` 全域（277 包）`grep -rn "subagentsByParent"` → **0 命中**。
- 运行时载荷（决定性证据）：`$G/dsh-api-session-controller/lib/client.js:3500-3505`
  `this.list.set({ ids, byId, phase, projectionsBySession })` —— 快照里没有 `subagentsByParent`
  ⇒ 插件读到的是 `undefined`，`?.` 使遍历**静默不展开**。
- 类型面：`$G/dsh-api-session-controller/lib/types/client/sessions/service.d.ts:43-51`
  `SessionListState = { ids; byId; phase; projectionsBySession }`（无 `subagentsByParent` / `jobsBySession`）。
- 同族删除：`setSubagentCatalogOpen` / `refreshSubagents` 见 `oldx .../contract/sessions.d.ts:96,102`；
  新版同位置 `:96` 已变为 `refreshProjections(sessionId)`。

**0.1.6-alpha.2（旧）存在**
- `/tmp/dsh-audit/oldx/dsh-api-session-controller/lib/types/client/sessions/service.d.ts:50`
  `subagentsByParent: Readonly<Record<SessionId, SubagentCatalogSnapshot>>;`（`:56` 同级 `jobsBySession`）。
- `/tmp/dsh-audit/oldx/dsh-api-session-controller/lib/client.js:3411-3417`
  `this.list.set({ ids, byId, phase, subagentsByParent, jobsBySession })`。

### 1.3 影响判定（行为是否真的退化）

- 退化为真。`stopCurrentSessionTree` 的展开完全依赖该字段；0.1.7 下 `catalog` 恒 `undefined`，`entries` 恒
  `undefined`，`visit()` 只处理 `current` 一层。
- 场景差异：`cancelIfRunning(current)`（`actions.ts:366-383`）仍能取消**当前会话自身**的回合；但当主会话空闲、
  只有子代理在跑时（插件 label 明确承诺覆盖的场景），`cancelled` 保持空集、`stopCurrentSessionTree` 返回
  `false`，**Esc 对该子代理树无效**。
- 是否存在宿主级级联兜底：`$G/dsh-api-session-controller/lib/client.js:1759` 中非寻址会话的 `cancel()` 只调
  `remote.session.cancel({ sessionId: this.sessionId })`；客户端包内**未见**向子会话级联的证据。宿主侧是否另有
  级联**未确证**，故结论保守表述为：**本插件原本提供的「含运行中子代理」保证已失效**（不再由本插件保证）。
- 迁移可行（供 Lead 引用）：新版 `SessionSummary.parentId?: SessionId`
  （`$G/dsh-api-session-controller/lib/types/client/sessions/service.d.ts:23`）+ `byId`（`:47`）足以重建父→子树；
  或改用 `origin === 'subagent'`（`:25`）做过滤。旧字段 `subagentsByParent` 无同义保留项。

### 1.4 task-1 为什么漏检 —— 决定「changelog 是否可信」的结论

**漏检机制（不是数据缺失，而是交叉核对缺失）**
1. task-1 **已经发现**该删除：其 `upstream.md:235`（§4.2）逐字写了
   「`sessions.setSubagentCatalogOpen` / `refreshSubagents` 删除、`refreshProjections` 新增；
   `SessionListState.jobsBySession` / `subagentsByParent` 删除、`projectionsBySession` 新增」。
2. 但 task-1 在 `upstream.md:210`（§3 映射表）把 `dsh-kbd-hotkeys` 标为「**无关（未使用这些成员）**」——
   与被审计插件自己的 `src/types.ts:259` 直接矛盾。
3. 方法缺口：task-1 的逐插件符号表（`upstream.md:264-282`）只到**服务/方法层级**（例如
   `sessions.list.getSnapshot()` → 「未变」），**从未下钻到 `getSnapshot()` 返回值的字段形状**。
   被删符号恰好都在下一层（`snapshot.subagentsByParent`），所以「已删符号集合 × 插件源码」这个笛卡尔积
   从未被计算。同样的缺口也可以解释 task-1 对 `uiSession.pendingInteractions`（见 §5-⑨）的表述失准。
4. 不是「没数据」：`grep -rn subagentsByParent dsh-kbd-hotkeys/src` 一次即可命中 `types.ts:259`。

**changelog 可信度结论（可直接引用）**
- 0.1.7 release notes **完全没有**披露这处客户端 API 形状变更：对
  `/tmp/dsh-audit/releases/dsh-v0.1.7-alpha.1.md` 的精确检索 `subagentsByParent` / `jobsBySession` /
  `SessionListState` / `projectionsBySession` / `refreshSubagents` / `setSubagentCatalogOpen` / `sessions.list`
  **全部 0 命中**（同文件里 `插件需` 仅命中附件、readBytes、预设、settings.yaml 四项）。
- 因此：**release notes 是必要但不充分的来源**。本区间存在「只在 `.d.ts`/产物里静默删除、RN 一字不提」的
  破坏性变更；检测它必须靠「逐插件消费符号 × 新旧产物」的差分（task-4 的方法），不能靠读 RN 或只做
  服务级符号表。task-1 的失败是**分诊/覆盖失败**，而不是「拿了错版本」。

---

## 2. 系统性符号消失扫描（最高价值项）

### 2.1 方法与覆盖（含假阴性甄别）

1. 从 9 个插件的 `src/**`、`index.ts`、`cordis.patch.yml`、`lib/*.js` 机械抽取消费面：
   服务名、方法名、快照字段名、slot 名、patch 行 id / disabled 目标包名、`data-*` 锚点、CSS token。抽取命令见 §6。
2. 每个符号在 `$G` **全域 277 包**内定位提供者（不预设包名；这正是 task-1 漏 `dsh-api-session-controller`、
   task-2 漏 `dsh-client-ui-tool` 的坑）。
3. 与 0.1.6-alpha.2 对照：对「提供者包」逐个做 **`.d.ts` 成员集合差分**（`old|old2|oldx`，44 包，版本已核验）
   + 关键项**运行时载荷 diff**（`client.js`）；不在对照树里的提供者用 `npm pack @...@0.1.6-alpha.2` 补齐
   （本轮补了 `dsh-client-ui-sidebar-terminal`、`dsh-client-ui-approval`）。
4. **覆盖局限（必须随结论一起引用）**：对照树只覆盖 277 包中的 44 包（其余 234 包无 0.1.6 侧样本）。但
   **所有被插件消费的符号，其提供者都落在这 44 包内**（逐个核对：`api-session-controller`/`api-workspace-controller`/
   `client-ui-{session,layout,sidebar-right,slots,conversation,workspace,model-selection,chat,tool,deliverables,
   sidebar-documentpreview,primitives,renderer,sidebar,theme,user-questions,sidebar-files,sidebar-browser}`/
   `sandbox-policy`/`system-prompt`/`tools`/`web-app`/`web-frontend`/`host-directory-picker-browse`/
   `client-ui-directory-picker-browse`/`client-store`/`client-modules`/`client-hmr`），故「旧有新无」结论对该消费面
   是**穷尽**的；对未被任何插件消费的面（234 包）本轮**未做旧侧对照**，不作为「无变更」的断言。
5. **另一个假阴性来源（新发现，task-1/2/3 均未提）**：`@deepseek-ai/dsh-client-ui-dockkit` **不是 `$G` 的顶层包**
   （`find $G -maxdepth 2 -iname '*dockkit*'` 无结果）——它被内联进 `dsh-web-frontend/dist/assets/index-*.js`
   并经 `window.__DSH_BOOT__.staticModules` 播种。**只在 `$G` 全域 grep 会把它误判为「符号不存在」**。
   `dsh-rightbar-tab-width` 的两个契约都落在这个包上，本轮改用 `/tmp/dsh-audit/{old2,new2}/dsh-client-ui-dockkit`
   （版本已核验 0.1.6-alpha.2 / 0.1.7-alpha.1）取证。同类风险还有：dockkit 之外的 seed 模块
   （`react`、`react/jsx-runtime`、`react-dom`、`@deepseek-ai/cordis`、`dsh-client-store`、
   `dsh-client-ui-slots`、`dsh-client-ui-primitives`）也不作为 `$G` 顶层包独立存在。

### 2.2 「旧有新无」（迁移区间内静默删除，按插件影响排序）

| # | 符号 | 类别 | 消费方 | 0.1.6-alpha.2 证据 | 0.1.7-alpha.1 证据 | 独立判定 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `SessionListState.subagentsByParent` | 快照字段 | **dsh-kbd-hotkeys**（actions.ts:353） | `oldx .../sessions/service.d.ts:50`；运行时 `oldx client.js:3411-3417` | 全域 0 命中；运行时 `$G .../client.js:3500-3505` 不含 | **破坏性，需迁移**（见 §1） |
| 2 | `SessionListState.jobsBySession` | 快照字段 | 无（9 插件全部 grep 0） | `oldx .../service.d.ts:56`；`oldx client.js:3411-3417` | 全域 0 命中 | 无影响 |
| 3 | `setSubagentCatalogOpen` / `refreshSubagents` | 服务方法 | 无 | `oldx .../contract/sessions.d.ts:96,102` | 新版同位置为 `refreshProjections`（`:96`） | 无影响 |
| 4 | `chat` 内部 props `compactTranscript` / `historyIncomplete` / `runMs` | React 内部属性（**非 DOM 锚点**） | 无 | `old chat client.js` 命中（props 形参） | 0 命中 | 无影响（code-card-fonts 依赖的是 `data-turn-process-answer`，仍在） |
| 5 | `ui-sidebar-browser`：`document`/`setDocument`/`clearDocument`/`browserFrame`/`src`/`toggleSandbox`/`loadFailed`/`reportLoaded` 等 | 包内成员 | 无 | `old .../sidebar-browser` d.ts | `dts-diff gone=10` | 无影响（浏览器行默认关闭，插件不硬编码 browser kind） |
| 6 | `dsh-client-ui-workspace`：`origin` / `parentId` / `count` / `runningCount` / `onArchive` 等 | 包内行类型/组件 props | 无（kbd-hotkeys 的 `origin` 取自 `api-session-controller` 的 `SessionSummary`，非此包） | `old workspace d.ts` | `dts-diff gone=7` | 无影响 |
| 7 | `dsh-host-plugin-inventory.trust` | 包内成员 | 无 | `old host-plugin-inventory` | 0 命中 | 无影响 |
| 8 | `systemPrompt.TOOL_CORDIS` 常量 | 导出常量 | 无（git-guard 只用 `section`/`getSectionOrder`） | `old2 index.d.ts` | 0 命中 | 无影响 |
| 9 | `ui-sidebar-documentpreview`：`showMore`/`sourceVersion`/`describeFailure`/`dismissNotice` | 包内成员 | 无（rightbar-fonts 用的是 `data-*` 锚点） | `old documentpreview` | `dts-diff gone=4` | 无影响 |
| 10 | `api-workspace-files.readAll` / `readRelated` | 服务方法 | 无 | `old2` | 0 命中 | 无影响（与 RN「readBytes 统一」同源） |
| 11 | `dsh-settings.register/setSource/watch/validate/installSection/get` | 包内成员 | 无（git-guard 不消费 settings） | `old2 settings` | `dts-diff gone=7` | 无影响 |

**结论：9 个插件里，全区间内被静默删除且被真实消费的上游符号只有 1 个 ——
`subagentsByParent`（`dsh-kbd-hotkeys`）。** 其余删除项对本地仓库均无影响。

### 2.3 「同名但签名/语义变了」

| 符号 | 变化 | 双侧证据 | 消费方 | 判定 |
| --- | --- | --- | --- | --- |
| `sessions.list.getSnapshot()` | **方法名与调用形式不变，返回类型形状变了**（`SessionListState` 字段整体替换） | 旧 `oldx service.d.ts:42-56` vs 新 `$G service.d.ts:43-51`；运行时旧 `oldx client.js:3411-3417` vs 新 `$G client.js:3500-3505` | `dsh-kbd-hotkeys`、`dsh-desktop-notify` | **破坏性（=§2.2 #1）**；这是最危险的一类：只做「方法是否存在」的核对会判「未变」 |
| `sessions.subagentAddress(id)` | 文档语义放宽：旧「@returns the retained address, when present」→ 新「a retained **or loaded-catalog** address, without retaining…」 | 旧 `oldx .../contract/sessions.d.ts:88` vs 新 `$G .../contract/sessions.d.ts:88` | `dsh-kbd-hotkeys`（model-picker.ts `subagentAddressOf(...) !== undefined` 作「是子代理→不出模型浮窗」判据） | **语义确变；对插件意图方向为「更正确」**（命中集合变大 = 更多子代理被正确排除），未找到有害用例；**不列为必修**。task-1 的「需复核」成立，但我的独立判定是「无退化」 |
| `SessionSummary` | 纯新增 `parentId?`；`displayTitle/title/cwd/origin/running/retainedBy/blank/updatedAt` 全部保留 | 新 `$G service.d.ts:16-41`（`:23 parentId`、`:25 origin?: 'subagent'`） | kbd-hotkeys、desktop-notify | 未变（新增项可作 #1 的迁移手段） |
| `uiSession` 服务整体 | `.d.ts` **逐字节相同**；唯一实现差异 `isMain()`（新 `client.js:340`）= 旧内联 `(row.retainedBy.mainView ?? 0) > 0`，等价 | `diff -u old/.../ui-session/lib/types/client/index.d.ts new/...` 无输出 | kbd-hotkeys、desktop-notify | 未变（task-1 此条判断正确） |
| `dsh-client-ui-approval` | 仅视觉：`dot` span → `StateDot` 组件、新增 `aria-busy`；`registerPendingInteraction` 与 `answer("rejected")`/`answer("allowed-once")` 逐行相同 | 旧 pack 包 `client.js:86,93,236-283` vs 新 `$G .../client.js:236-283` | kbd-hotkeys 审批动作 | 未变 |
| `DisclosureRow` | 新增可选 `running` prop + `React.memo` 包装；DOM 锚点不变 | 旧 `old primitives/lib/index.js:1686,1689` vs 新 `:3023,3026`（`data-open`/`data-disclosure-row` 同序） | code-card-fonts | 未变 |
| `dsh-client-ui-workspace` 视图 store | 新增 `pinnedSessionIds`；`sessionOrderByAccount`/`groupExpansion`/`orderBy` 保留；持久化键 `dsh.workspace.view.v5` 不变 | 新 `$G workspace client.js:706,716`；旧 `old workspace client.js:261,270`；persist 键新旧均 `dsh.workspace.view.v5` | kbd-hotkeys（侧栏排序轴） | 未变 |

### 2.4 「新有旧无」（新增面 / 潜在覆盖缺口）

只列与本地插件有关者（其余新增面与 9 插件无关，不逐条展开）：

| 新增符号/面 | 位置 | 与哪个插件相关 | 独立判定 |
| --- | --- | --- | --- |
| `SessionListState.projectionsBySession` + `refreshProjections()` | `$G api-session-controller/lib/types/client/sessions/service.d.ts:51`、`contract/sessions.d.ts:96` | 无插件消费 | 无影响（是 #1 被删字段的替代面，但不是同义替代） |
| `ToolDetails` 组件 + `detailsCardModel()` + `details`/`expandedSummary` 模型 | `$G dsh-client-ui-tool/lib/client.js:1313`（组件）、`:3441`（模型）、`:1541`（渲染分支）；新文件 `details-card-model.d.ts` | **code-card-fonts**（字体覆盖缺口，见 §4.2） | **新面未覆盖**（非迁移回归） |
| `todo-history` 会话视图 + `tool-todo-history` 目标 | `$G dsh-client-ui-tool/lib/client.js:3805`（view）、`:3826-3829`（register） | code-card-fonts | 同上 |
| `turn-trigger` 节点类型 + `TurnTriggerNodeView` | `$G dsh-client-ui-chat/lib/client.js:6289`（注册 `key: "turn-trigger"`）、`:6206-6262`、`:6169`（CSS） | **code-card-fonts**（字体覆盖缺口，见 §4.3） | **新面未覆盖**（非迁移回归） |
| `data-step-process-body` / `data-step-process-content` / `ChatGroupSeat` 过程组容器 | `$G dsh-client-ui-chat/lib/client.js:2031,2048,2055`；CSS `:1822` | code-card-fonts（**已由未提交改动覆盖**，见 §4.1） | 新增面，已被正确处理 |
| `dsh-client-ui-directory-picker-native`、`ui-settings-shell/agent-loop/subagent/web-search`、`dsh-api-job-controller` 等新行 | `$G dsh-web-app/cordis.patch.yml`（diff） | 无插件消费 | 无影响 |
| `ui-jobs` 行位置移动 + 注释变化 | `$G dsh-web-app/cordis.patch.yml` diff | 无插件消费 | 无影响 |

### 2.5 逐插件「消费符号存活」总表（全部自行 grep/diff）

| 消费面 | 符号 | 0.1.7 存活证据 | 判定 |
| --- | --- | --- | --- |
| 服务名（11 个） | `sessions` `uiSession` `layout` `sidebarRight` `workspaces` `slots` `conversation` `uiWorkspace` `modelDirectories` `sandboxPolicy` `systemPrompt` | 全域字面量定位：`uiSession` 7 文件、`modelDirectories` 1 文件（`dsh-client-ui-model-selection/lib/client.js`）… 全部命中 | 存活 |
| `sessions.*` | `list.getSnapshot` `binding` `subagentAddress` `retainInfo` | 新 `contract/sessions.d.ts:153 binding`、`:68 retainInfo`、`:90 subagentAddress` | 存活（`getSnapshot` 形状变更见 §2.3） |
| `session` 面 | `getSnapshot().running` / `.subagent.address.mode` / `cancel()` | `dts-diff gone` 不含 `running`/`subagent`； 新 `client.js:1759` | 存活 |
| `uiSession.*` | `sessionStatus`(getSnapshot/subscribe) `current.getSnapshot().key` `bindingSource` `pendingSnapshot` | 新 `ui-session client.js:148-155`（`{getSnapshot, subscribe}` 同形）；d.ts **逐字节相同** | 存活 |
| `uiSession.pendingInteractions` | 公开成员 | **新 0 命中 / 旧 0 命中**（大小写不敏感才命中 `publishPendingInteractions` 私有方法） | **非迁移项**：该「公开面」从未存在，插件实际走 `pendingSnapshot` 回退（`actions.ts:26`），该回退未变。task-1 的表把它当服务成员，属表述失准（见 §5-⑨） |
| `layout.toggleSidebar` | — | 新 `ui-layout client.js:439`（view<1024 走 narrowExpanded，否则 sidebar 0↔280；`:13 SIDEBAR_AUTO_COLLAPSE=1024`）；d.ts 逐字节相同 | 存活 |
| `sidebarRight.*` | `toggleExpanded` `isExpanded` `active` `focus` `close` `openTab` | 新 d.ts `:112 openTab`/`:127 isExpanded`/`:129 toggleExpanded`/`:122 active`/`:117 close`/`:134 focus` | 存活 |
| `workspaces.list` | `items` `archivedSessionIds` `phase` | `dts-diff gone=0`，新增 `pinnedSessionIds` | 存活 |
| `slots.*` | `entries` `inject` `register` `resolveStore` | `dts-diff gone=0`（old/new 仅 package.json 版本差异） | 存活 |
| `conversation.input` | `for` `shell` → `editor.getRootElement()` | old/new `input/hub.d.ts` **逐字节相同** | 存活 |
| `uiWorkspace.*` | `openSession` `openWorkspace` `startSession` | 新 `navigation.d.ts` 全在（接口新增 `pinSession`/`unpinSession`） | 存活 |
| `modelDirectories.directoryFor` + store 形状 | — | `old2 vs new` `model-selection/lib/types/client/service.d.ts` **逐字节相同** | 存活 |
| `sandboxPolicy.resolve` | — | 新/旧 `index.d.ts:88` 同签名 `resolve(request?): SandboxExecutionPolicy` | 存活 |
| `systemPrompt` | `section()` `getSectionOrder('TEAM_POLICY')` | 新 `index.d.ts:239 section`、`:245 getSectionOrder`、`:117 TEAM_POLICY: 600` | 存活 |
| `tools/pre-execute` | waterfall 钩子 | 新/旧 `dsh-tools/lib/types/index.d.ts:47` 同签名 | 存活 |
| slot 名 | `conversation.composer` `conversation.session.header.actions` `rightbar.session` `sidebar.workspaces` `root` | 逐个全域命中（`root` 由 `ui-layout client.js:611 name:"root"` 注册，`:636 store`） | 存活 |
| patch 面 | `directory-picker` 行 id、`@deepseek-ai/dsh-host-directory-picker-browse`、`@deepseek-ai/dsh-client-ui-directory-picker-browse` | 新 `dsh-web-app/cordis.patch.yml:94-95`（id 与 name 同旧）；两包 0.1.7-alpha.1 均存在 | 存活 |
| DOM 锚点（22 个 `data-*`） | 见 §2.6 | 全部在 0.1.7 全域命中；新增的 `data-step-process-body`/`data-turn-trigger` 见 §4 | 存活 |
| CSS token（25 个） | `--dsw-*` / `--dsh-*` / `--ds-font-family-code` | 逐个在 0.1.7 命中定义（含 `--dsh-content-font-size` 内联于 body / chat 消费点） | 存活 |

### 2.6 DOM 锚点存活明细（新 / 旧全域文件数）

`data-changes-review 1/1`、`data-chat-flow-kind 1/1`、`data-conversation-content 1/1`、`data-diff-line 1/1`、
`data-disclosure-row 3/2`、`data-dockkit-pane 1/1`、`data-dockkit-tab 1/2`、`data-document-markdown 1/1`、
`data-markdown-variant 2/1`、`data-open 4/2`、`data-sample 1/2`、`data-state 12/8`、
`data-step-process-body 1/0`、`data-textpreview-body 1/1`、`data-textpreview-page 1/1`、`data-tool 4/3`、
`data-turn-process 1/1`、`data-turn-process-answer 1/1`、`data-width-handle 1/1`、`data-turn-trigger 1/0`。
（旧侧为部分对照树，文件数仅作参考；关键锚点逐个在新侧定位到提供者，见各插件小节。）

---

## 3. 6 个「不受影响」判定的独立抽验（每插件 ≥2 条载荷性契约）

全部自行重新 grep，未引用他人行号。**结论：6/6 无反例。**

| 插件 | 抽验的载荷性契约 | 独立证据（0.1.7 / 对照） | 判定 |
| --- | --- | --- | --- |
| `dsh-desktop-notify` | ① 按钮 slot = `conversation.session.header.actions` 仍被上游注册；② `uiSession.sessionStatus` 仍是 `{getSnapshot, subscribe}` 且快照为 `Map<id,{running,pendingInteraction,completionUnread}>`；③ `react` 仍是平台 seed | ① `$G dsh-client-ui-conversation/lib/client.js` + `dsh-client-ui-jobs/lib/client.js` 等 11 文件命中该 slot；② `$G dsh-client-ui-session/lib/client.js:148-155` 逐字给出 `getSnapshot: () => this.statusSnapshot` / `subscribe`，`:340-352 publishStatus` 构造该 Map；d.ts 与旧**逐字节相同**；③ `$G dsh-web-frontend/dist/assets/index-DU8FBaxM.js` 的 `staticModules` 仍含 `react`/`react/jsx-runtime`/`react-dom`（旧侧同） | **不受影响**（无退化） |
| `dsh-sidebar-default-collapsed` | ① `slots.entries('root')` 的注册项带 `store` handle 且 `resolveStore(handle, undefined)` 可解；② 快照存在 `layoutInfo.{sidebar, viewportWidth}`，`toggleSidebar()` 的宽窗分支为 `sidebar 0↔280`、窄窗用 `viewportWidth < 1024` | ① `$G dsh-client-ui-layout/lib/client.js:611 name:"root"`、`:636 store`（`ctx.reflect.provide("layout", layout)` 同段）；② `$G .../client.js:439-441`（`viewportWidth < 1024 ? narrowExpanded 翻转 : sidebar = sidebar===0 ? 280 : 0`）、`:13 SIDEBAR_AUTO_COLLAPSE = 1024`、`:43 sidebar` 初始化、`:416 sidebar: 280`；`service.d.ts` old/new **逐字节相同** | **不受影响** |
| `dsh-directory-picker-browse` | ① `disabled` 目标行 id `directory-picker` 仍在 web bundle 中且指向 auto 宿主；② insert 的两个包在 0.1.7 可解析，且 auto 宿主恰好挂载 native/browse 二者之一（故禁掉 auto ⇒ 不会残留 native） | ① `$G dsh-web-app/cordis.patch.yml:94-95`（`- id: directory-picker` / `name: '@deepseek-ai/dsh-host-directory-picker-auto'`，与 `old` 同位置同行）；② `$G dsh-host-directory-picker-auto/lib/index.js:96-97,107-108`（native→browse 二选一）；`dsh-host-directory-picker-browse` / `dsh-client-ui-directory-picker-browse` `package.json` 均 `0.1.7-alpha.1`；`directory-picker` 是组合里唯一相关行（无独立 native UI 行）。`ui-deliverables` 行仍在（`:309-310`），与插件注释一致 | **不受影响** |
| `dsh-git-guard` | ① `tools/pre-execute` waterfall 事件签名不变；② `sandboxPolicy.resolve({session}).mode` 签名不变；③ `systemPrompt.section()` + `getSectionOrder('TEAM_POLICY')` 存活 | ① 新/旧 `$G dsh-tools/lib/types/index.d.ts:47` 同签名（旧 `old2:39`）；② 新/旧 `$G dsh-sandbox-policy/lib/types/index.d.ts:88` 同签名；③ 新 `$G dsh-system-prompt/lib/types/index.d.ts:239 section`、`:245 getSectionOrder`、`:117 TEAM_POLICY: 600`（旧 `old2:117/246`）；被删的仅 `TOOL_CORDIS` 常量 | **不受影响**（`.d.ts` 面无变化） |
| `dsh-rightbar-tab-width` | ① `[data-dockkit-tab][role="tab"]` 仍是**同一元素**；② 上游胶囊地板仍为 `SPLIT_MINIMUMS.chip = 100`，且分栏预算仍读「首个 `[data-dockkit-tab]` 的计算后 min-width」 | ① `new2 dockkit index.js:2583 role:"tab"` 与 `:2587 "data-dockkit-tab": tabId` 同对象（旧 `old2:2592` 同）；② `new2:1243 chip: 100`、`:2052 chipMinimum(root)` 读 `getComputedStyle(chip).minWidth`（旧 `old2:1243/2052` 同行） | **不受影响**（注意 dockkit 不在 `$G` 顶层，见 §2.1-5） |
| `dsh-fullwidth-chat` | ① `[data-slot="main.conversation"]` 与 `[data-conversation-content]` 两个锚点仍存在且同属一条链路；② 被覆盖的 `.wSkVaW_body` 仍在该节点自身声明 `--dsh-chat-content-width`（元素自身声明胜继承的前提不变）；③ `[data-width-handle]` 仍在 | ① `$G dsh-client-ui-renderer/lib/client.js:1100 "data-slot": slotKey`（SlotOutlet）；`$G dsh-client-ui-conversation/lib/client.js:16142 "data-conversation-content": ""`、`:16162 renderSlot("main.conversation", {})`；② `$G conversation client.js` 的 `.wSkVaW_body{--dsh-chat-content-width: var(--dsh-chat-user-width, clamp(...)); …}` 与旧侧**逐字相同**；③ `:15767 "data-width-handle": props.side` | **不受影响** |

---

## 4. `dsh-code-card-fonts` 复核

### 4.1 过程组内间距修复（未提交改动）——**成立且已正确落盘**

- 变更内容：`src/css.ts:12-20` 新增 `body [data-step-process-body] { --dsh-chat-flow-gap: calc(14px * 0.5); }`。
- 上游新面：`$G dsh-client-ui-chat/lib/client.js:2031`（组根 `data-step-process`）、`:2048`
  （成员容器 `data-step-process-body`，`className: classes.join(" ")` = `O_Ebla_body` / `O_Ebla_expandedBody`）、
  `:2055`（`data-step-process-content`）。旧版 `data-step-process-body` **0 命中**。
- 声明冲突与特异性（逐项核实）：
  - 上游 `.O_Ebla_body{--dsh-chat-flow-gap:8px; …}` 与 `.O_Ebla_expandedBody{--dsh-chat-flow-gap:16px; …}`
    均见 CSS blob `$G dsh-client-ui-chat/lib/client.js:1822`，特异性 **(0,1,0)**；
  - 插件 `body [data-step-process-body]` = `body`(0,0,1) + 属性(0,1,0) = **(0,1,1) > (0,1,0)** ⇒ 胜出，
    与 `!important`/注入顺序无关；
  - 两条上游规则打在**同一元素**（`data-step-process-body` 与该 div 的 class 同源），故一条规则覆盖
    「收起/滚动 8px」与「展开 16px」两态；
  - 组内成员间距消费点 `.O_Ebla_content > :not([hidden]):not(:empty) ~ … { margin-top: var(--dsh-chat-flow-gap, 8px) }`
    （同 `:1822`）取的是 `data-step-process-body` 的继承值 ⇒ 被重指后为 7px；自定义属性「元素自身声明胜继承」，
    所以 `body` 上原有的 7px 确实到不了成员卡片 —— **改动的因果解释正确**；
  - 元素级例外 `.EvIC1a_flowItem[data-turn-process-answer]{--dsh-chat-flow-gap:8px}`（另一条 CSS blob
    `$G dsh-client-ui-chat/lib/client.js:1582`）仍是元素自身声明，不受影响 —— **与 README 声明一致**。
- 列级相邻卡（过程组 ↔ 回答/消息）仍走 `body` 声明，未被破坏。
- 未发现同一元素上的行内 `style` 设置该变量（`$G client.js:2025-2060` 的 render 无 `style` 属性）。

### 4.2 `ToolDetails` 紧凑详情卡 —— **覆盖缺口成立，但 task-2 的「旧走 ioCard / 迁移遗漏」论证不成立**

**task-2 主张的复核结果：**
- 「0.1.7 新增」→ **成立**：`$G dsh-client-ui-tool/lib/client.js:1177`（CSS 根 `.DXqwVW_root{… font:var(--dsw-font-xs-13) …}`，
  内部 `_caption/_statusText/_badge/_subtitle{font-size:12px}`、`_prose/_code{font-size:13px}`）、`:1313 function ToolDetails`、
  `:1541` 渲染分支、`:3441 detailsCardModel`、`:3550` 调用点；`dsh-client-ui-tool` 的 `ToolDetails` 计数
  **新 30 / 旧 0**；新文件 `lib/types/client/tool/models/details-card-model.d.ts` 在旧包**不存在**。
- 「旧版对应物是 `.ioCard`，旧走 ioCard 故旧为 14px」→ **不成立**，两点反证：
  1. **`.ioCard` 在 0.1.7 仍然存在且仍在渲染**：新 `$G tool client.js:1373/1556`（ToolRow：`detailsBody !== null ? ToolDetails : (… ioCard …)`）、
     `:1980/2088`（BashRow）。它是 `detailsBody === null` 时的**回退分支**，插件对它所在的 `[data-tool]`/`[data-sample]`
     重指的 token 仍然生效 ⇒ **旧路径没有被替换、也没有退化**。
  2. **旧版根本没有 `details` 模型/分支**：旧 `dsh-client-ui-tool/lib/client.js` 中 `detailsBody` **0 命中**、
     `ToolDetails` **0 命中**；`details` 只出现在一句无关注释里。新版 ToolDetails 的数据来自**全新**的
     `details-card-model` + `todo-history` 视图（`$G .../client.js:3805 todoHistoryView`、`:3826-3829 registerTodoHistory`），
     渲染的是「跨回合 todo 历史」这一**新内容**。旧版同一工具调用走的是 `todo-toolview`（新 `:4015-4022` 仍在），
     不是 ioCard 的展开体。
- **独立判定**：`ToolDetails` 属 **0.1.7 新增面未覆盖**（与 `turn-trigger` 同类），**不属「迁移遗漏 / 旧形态曾被覆盖」**。
  它是否算「需要迁移」是取舍问题（插件 README 声明的作用域含「卡片展开内容统一 14px」，而 ToolDetails 位于
  `[data-tool]` 根之内、且在展开体的 `bodyWrap` 里）：若按「维持声明的视觉不变量」衡量应补，但它是**新增功能面**，
  不是本次升级造成的回归。
- 作用域细节核实（供 Lead 引用）：ToolDetails 根 `.DXqwVW_root` 自带 `font:` 简写 ⇒ 插件既有
  `[data-chat-flow-kind] [data-open]:not([data-turn-process]) > :not([data-disclosure-row])`（`src/css.ts:71`）
  最多命中其**父级** `bodyWrap`（`$G tool client.js:1496`），继承被元素自身 `font` 覆盖 ⇒ **既有规则确实命不中**；
  `[data-tool]` 上的 token 重指也无效（ToolDetails 不吃 `--dsw-font-markdown-code-block-small`）。
  ToolDetails 只有条件属性 `data-inspect`/`data-caption`（见同一 CSS 串 `$G .../client.js:1177`），
  无可无条件锚定的稳定属性 —— 与 task-2 的定性一致。
- `data-tool` 仍在 ToolRow 根：`$G tool client.js:1619 "data-tool": toolName`（旧 `:1289` 同）。

### 4.3 `turn-trigger` 节点卡 —— **覆盖缺口成立，「旧为 TurnTailNodeView」的反证不成立**

- 「0.1.7 新增」→ **成立**：`$G dsh-client-ui-chat/lib/client.js:6206-6262 TurnTriggerNodeView`（`section[data-turn-trigger]`，
  `data-turn-trigger` 在 `:6215`）、`:6169` CSS（`.oz9t_a_title{font:var(--dsw-font-xs-13)}`、
  `_time/_explanation/_content{font:var(--dsw-font-xxs-12)}`）、`:6289 key: "turn-trigger"` 注册。
  旧 `chat client.js` 中 `turn-trigger` **0 命中**。
- **反证**：`TurnTailNodeView` 在 0.1.7 **仍然存在**（新 9 命中 / 旧 9 命中），`turn-trigger` 是**新增的节点 kind**，
  不是 `TurnTailNodeView` 的改名。故 task-2「旧为 TurnTailNodeView」的对应关系不成立。
- **作用域判定**：`turn-trigger` 节点确实落在 `[data-chat-flow-kind]` 之内 —— 每个聊天流条目由
  `$G chat client.js:1716 "data-chat-flow-kind": routedNode.kind` 的 `div.flowItem` 包裹，故
  `[data-chat-flow-kind="turn-trigger"]` 存在。但插件既有选择器**都命不中**它：`<section data-turn-trigger>` 无
  `data-open`；header `<button aria-expanded>` 无 `data-disclosure-row`；body 无 `data-open`
  （`$G chat client.js:6213-6258` 的实际子序）。因此它是**真实覆盖缺口**，且没有现成的 `data-open`/`data-disclosure-row`
  锚点，需按新增规则处理。
- **独立判定**：**0.1.7 新增面未覆盖**，不是迁移回归。

### 4.4 未提交改动与**产物一致性**（在 /tmp 副本重建，未触碰工作区）

- 未提交文件：`src/css.ts`（+10 行）、`README.md`（+21/-3）、`lib/client.js`（+10 行）；`git diff` 与
  `src/css.ts:12-20` 的规则一致。
- 重建方法（遵守「不在工作区内 build」）：
  `cp -R /Users/lz/dsh-plugins/dsh-code-card-fonts/. /tmp/dsh-audit/verify/ccf/`（含 `node_modules`）→
  在副本里 `rm lib/client.js && npm run build`。
- 结果：**esbuild 可用**（未遇 EPERM），输出 `built /private/tmp/dsh-audit/verify/ccf/lib/client.js(esbuild 打包,6669 字节)`。
- 比对：
  - 副本新产物 sha256 = `965fb9c74edb572ac18362fac88051443eb8e16179bbf3bc8bed5fad9714ecab`
  - 工作区未提交产物 sha256 = `965fb9c74edb572ac18362fac88051443eb8e16179bbf3bc8bed5fad9714ecab`
  - `diff` **无输出 ⇒ 逐字节相同**；`data-step-process-body` 在工作区产物中出现 2 次（1 处注释 + 1 处选择器）。
- **判定：未提交的 `lib/client.js` 与 `src/` 完全一致，产物一致性成立，无需返工。** 工作区文件未被本次复核改动。

---

## 5. 不一致清单（与 task-1 / task-2 / task-3 的逐条分歧与独立判定）

| # | 他方主张（出处） | 我的独立判定 | 证据 |
| --- | --- | --- | --- |
| ① | **task-1** `upstream.md:210`：`subagentsByParent` 删除对 `dsh-kbd-hotkeys`「无关（未使用这些成员）」；`upstream.md:317`（§7）「唯一必修项是 code-card-fonts」 | **推翻**。kbd-hotkeys 必修：`stopCurrentSessionTree` 的子树递归在 0.1.7 恒不展开，插件自述的「含运行中子代理」失效。最终报告应至少有 **2 个必修项** | §1.2/§1.3；插件 `actions.ts:353`、`types.ts:259`、`config.ts:49` |
| ② | 同上，漏检归因 | **归因结论**：task-1 已在 §4.2（`:235`）列出去除项，但 §3 映射未做「已删符号 × 插件源码」交叉核对，其 §6.1 符号表只到方法级（`getSnapshot()` 记「未变」），未下钻返回类型字段。**属方法/覆盖缺口，非数据缺口** | §1.4；`upstream.md:210,235,264-282,317` |
| ③ | **changelog 可信度**（隐含：RN + diff 足够） | **RN 不足**：0.1.7 RN 对 `subagentsByParent`/`jobsBySession`/`SessionListState`/`projectionsBySession` 等**0 命中**，却删了字段。RN 只能作线索；必须做逐插件符号×产物差分 | §1.4；`/tmp/dsh-audit/releases/dsh-v0.1.7-alpha.1.md` |
| ④ | **task-2** `plugins-visual.md:50`：`ToolDetails`「旧路径为 `.ioCard`（old tool:1381-1406）」，「迁移遗漏（旧形态曾被覆盖）」 | **部分推翻**。缺口成立，但定性错误：`.ioCard` **在 0.1.7 仍存在并仍被插件覆盖**（新 `:1373/1556/1980/2088`），它是 `detailsBody === null` 的回退分支；旧包**没有 `details`/`detailsBody`/`ToolDetails`**，ToolDetails 的模型（`details-card-model` + `todo-history` 视图）是新面。应改判为「**0.1.7 新增面未覆盖**」 | §4.2；新 `tool client.js:1177/1313/1541/3441/3805`；旧 `tool client.js` `ToolDetails`/`detailsBody` = 0 |
| ⑤ | **task-2** `plugins-visual.md:51`：`turn-trigger`「旧为 `TurnTailNodeView`（old:3647）」，「需要迁移（未做）」 | **部分推翻**。缺口成立、需新增规则，但 `TurnTailNodeView` **0.1.7 仍在**（新 9 / 旧 9 命中），`turn-trigger` 是**新增 kind**（新 `:6289`），不存在「旧为 TurnTail」的替代关系。应改判为「**0.1.7 新增面未覆盖**」 | §4.3 |
| ⑥ | **task-2** `plugins-visual.md:21/55-62`：未提交改动「已正确 build 进 `lib/client.js`」 | **支持**（独立重建验证）：副本重建产物与工作区未提交产物逐字节相同 | §4.4 |
| ⑦ | **task-2** 的两项「需要迁移」是否应进入最终必修清单 | **建议**：与 `--dsh-chat-flow-gap`（真回归）分开列；`ToolDetails`/`turn-trigger` 属「新增功能面的视觉不变量缺口」，是否补取决于产品取舍，**不应与 kbd-hotkeys 的静默行为退化同级** | §4.2/§4.3 |
| ⑧ | **task-3** `plugins-interaction.md`（冲突方）：kbd-hotkeys 需迁移，理由含 `subagentsByParent` 被删 | **支持（核心结论正确）** | §1.2/§1.3 |
| ⑨ | **task-1** `upstream.md:271`：把 `uiSession.pendingInteractions` 与 `current/sessionStatus/bindingSource` 并列为「未变」的服务面成员 | **表述失准（非迁移项）**：上游 `uiSession` 从来没有公开的 `pendingInteractions`（新/旧全域 0 命中），插件实际依赖私有 `pendingSnapshot` 回退（`actions.ts:26`），该回退未变 ⇒ **无退化**；但该行正是「只看服务成员名、不看取值形状/回退链」的同类失误样本 | §2.5；`$G ui-session/lib/client.js:310`、`lib/types/client/index.d.ts:136` |
| ⑩ | **task-1** `upstream.md:251`（V1）：`sessions.subagentAddress` 语义放宽「需人工复核」 | **同意确有语义变化**（`oldx`/新 `contract/sessions.d.ts:88` 注释对比），但**独立判定为无退化**：变化方向是命中集合变大，对插件「是子代理就不出模型浮窗」的意图更正确，未找到有害用例 | §2.3 |
| ⑪ | 三方均未提：`dsh-client-ui-dockkit` 不在 `$G` 顶层 | **新增发现**：dockkit 被内联进 `dsh-web-frontend/dist` 并走 `staticModules` 播种。**只 grep `$G` 会假阴性**；`dsh-rightbar-tab-width` 的两个契约都在这个包里。已在 `new2/old2` 上取证 | §2.1-5、§3 |
| ⑫ | **task-1** `upstream.md:272`：「`sessions.list.getSnapshot()` … 未变」 | **推翻**：方法名未变，**返回类型形状变了**（删 2 字段、加 1 字段）。这是本次漏检的直接技术原因 | §2.3；新/旧 `service.d.ts:43-51` vs `:42-56` |

---

## 6. 未确证 / 局限（不得当作结论使用）

1. **宿主侧是否对子会话级联取消**：`session.cancel()` 的宿主实现不在客户端包内；无法排除宿主 `session.cancel`
   自行中断子代理。故 §1.3 的表述限定为「**本插件原本提供的保证失效**」，不宣称「子代理绝对停不下来」。
2. **对照旧侧只覆盖 44/277 包**：未被任何插件消费的 234 包未做 0.1.6 侧对照，因此**不能**据此推断这些包「无变更」。
   被消费面已穷尽核对（§2.1-4）。
3. **`ToolDetails` / `turn-trigger` 的实际渲染频率与是否落在用户可见主路径**：未在浏览器实测（本轮禁止加载/重启插件）。
   结论仅限「元素存在、插件既有选择器命不中、元素自带 12/13px」。
4. **`rightbar-fonts` 对新增 Excel 预览（`client.excel.js`，旧包无此文件）的覆盖**：锚点为 `data-excel-preview` 等，
   与本插件 `[data-textpreview-body]` 是否同容器未确证（属 task-2 的「需复核风险」，本轮未推翻也未确证）；
   该插件不在我的 6 个抽验名单内，仅作记录。
5. **上游 `--dsw-font-sm-13` 被 `dsh-client-ui-tool` 引用但全域无定义**（新 `:1350` 与旧 `:1177` 同）：新旧一致，
   属上游既有现象，与本地插件无关，未进一步追。
6. 本轮未做 git 提交/推送、未改 `~/.dsh`、未加载/重启插件、未在工作区 build。

---

## 7. 可直接被 Lead 引用的结论摘要

1. **冲突裁决**：task-3 正确、task-1 错误。`sessions.list.getSnapshot().subagentsByParent` 在 0.1.7-alpha.1
   被删除（全域 0 命中；运行时 `$G dsh-api-session-controller/lib/client.js:3500-3505` 不再 set 该字段；
   旧版见 `oldx .../client.js:3411-3417`）。`dsh-kbd-hotkeys/src/actions.ts:353` 依赖它 ⇒ Esc「停止当前会话」
   的子树递归静默失效，插件承诺的「含运行中子代理」不再成立。**这是本区间第 2 个必修项。**
2. **changelog 可信度**：0.1.7 release notes 对本变更 **0 披露**。RN 是线索不是闸门；必须用「逐插件消费符号
   × 新旧产物差分」。task-1 已列出该删除却在映射表判「无关」，根因是**未做符号×插件的交叉核对、只到方法级**。
3. **符号消失总览**：`$G` 全域 × 0.1.6-alpha.2 对照后，**被真实消费且被删除的上游符号只有
   `subagentsByParent` 一个**；其余删除项（`jobsBySession`、`setSubagentCatalogOpen`/`refreshSubagents`、
   sidebar-browser 成员、workspace 行字段、settings 成员、`TOOL_CORDIS` 等）均无插件消费。
   语义变更项：`sessions.list.getSnapshot()` **返回类型形状变更**（致命）、`sessions.subagentAddress` 文档放宽
   （无害）。新增面中与插件相关的是 `ToolDetails` 与 `turn-trigger`（均为覆盖缺口，非回归）。
4. **6 插件抽验**：`desktop-notify` / `sidebar-default-collapsed` / `directory-picker-browse` / `git-guard` /
   `rightbar-tab-width` / `fullwidth-chat` 各 ≥2 条载荷性契约**全部成立，无反例**。
5. **code-card-fonts**：`--dsh-chat-flow-gap` 的 `body [data-step-process-body]` 修复**成立**（特异性 0,1,1 > 上游 0,1,0，
   同一元素覆盖两态），且**未提交产物与 `src/` 逐字节一致**（/tmp 副本重建 sha256 相同）。
   但 `ToolDetails`/`turn-trigger` **不是**迁移回归：`ioCard` 与 `TurnTailNodeView` 在新版都仍在，
   两者是 0.1.7 的**新增面**，应独立标注为「新增功能面视觉缺口」。
6. **方法论告警**：`dsh-client-ui-dockkit` 不在 `$G` 顶层（内联进 `dsh-web-frontend/dist` + `staticModules`）。
   只 grep `$G` 会产生「符号不存在」的假阴性；涉及 dockkit / 平台 seed 的插件必须用解包产物取证。
