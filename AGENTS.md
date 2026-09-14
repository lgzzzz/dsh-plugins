# AGENTS.md — DSH 本地插件工作区

仓库内每个插件均为独立、自包含的本地 npm 包。本文档仅记录跨插件的共性约定
（包结构、挂载与激活、变更生效机制、构建与验证、注意事项）；各插件的功能说明
见其 `README.md`。

## 强制规范

1. **插件持久化完成后，代理不得自行加载插件。** 加载属于用户操作，不属于代码交付
   范围：不得修改 `~/.dsh/profiles/web/package.json`（`dependencies` /
   `dsh.profile.bundles`）、不得执行 `pnpm install`、不得重启 App / dsh web。
2. **新持久化插件必须使用 TypeScript，并提供构建命令。** 浏览器半部以 TypeScript
   源码（`src/`，入口 `src/client.ts`）编写，`package.json` 须提供 `build` 脚本
   （产出 `lib/client.js`）与 `typecheck` 脚本；`lib/*.js` 为构建产物，不得作为手写
   源文件。宿主半部为 TypeScript 源码 `index.ts`（由 Node 22 Type Stripping 直接加载，
   无需编译），但须提供 `typecheck` 脚本。现有纯 JavaScript 插件（`dsh-fullwidth-chat`、
   `dsh-new-session`）为历史遗留，维持现状；新增或重构插件
   一律适用本条规范。

## 仓库概述

本仓库为 DSH（DeepSeek Harness）Web 的本地持久化插件集合。动态 Cordis 定义仅存在于
进程内存、重启即失效，因此将需长期保留的插件固化为仓库内的本地 npm 包，经 Web
Profile 的 `link:` 依赖挂载至运行中的应用。仓库内含 9 个插件目录（见下节插件清单），
web Profile 已全部挂载；`dsh-rightbar-split-open` 本次按用户要求从仓库移除，Profile 里
残留的挂载行需由用户执行
`dsh plugin --profile web remove dsh-rightbar-split-open` 摘除（摘除后仓库与 Profile 一致）。
`dsh-change-summary`、`dsh-kbd-nav-focus`（提交 6499dd9）、`dsh-no-right-sidebar`、
`dsh-left-dock` 已从仓库移除，仅存于
git 历史（`dsh-fork-inbox-guard` 曾于 29ddb9e 引入、2d0f985 移除，本次按其根因分析
重写后重新纳入仓库）；`dsh-rightbar-files-guard` 亦已移除（该目录当时未纳入版本控制，
git 历史中没有它）；`dsh-rightbar-split-open`（右栏「树 | 文件」分栏打开）曾于 e3f6153
移除、随后按 `~/.dsh/sessions` 会话记录逐字恢复并于 0681490 首次纳入版本控制，本次按
用户要求再次移除 —— 移除时工作树内含约 1758 行未提交改动（`src/*.ts`、`test-split-open.mjs`、
`README.md` 等），这些未提交内容随目录一并丢弃，git 中只保留提交 0681490 的版本
（`git show 0681490:<路径>` 可取回）；`dsh-rightbar-files-float`
（右栏文件浏览器浮窗开关）此前按用户要求移除，其源码同样从未纳入版本控制，
Profile 里的挂载行已由用户摘除 —— 它是**独立于本仓库**的浮窗开关，删除它不影响
`dsh-kbd-hotkeys` 的动作表；本次按用户要求把 ⌘/Ctrl+Alt+\ 加回 `dsh-kbd-hotkeys`
（`sidebarRight.files`：定位右栏文件浏览器页，**不存在则创建**、已存在则聚焦并置顶）。
仓库根不提供集合
安装 / 卸载脚本：每个插件由用户逐个执行
`dsh plugin --profile web add link:<目录>`（详见仓库根 README「安装」）。

- 版本控制采用黑名单：`.gitignore` 默认放行全部内容，仅忽略系统/编辑器文件
  （`.DS_Store`、`.idea/`）、包管理器缓存（`.pnpm-store/`、`.npm-cache/`、
  `node_modules/`）与 TypeScript 增量缓存（`*.tsbuildinfo`）。
  新增插件目录默认即受版本控制，无需额外配置；若其 `lib/` 为不入仓的构建产物，
  需在 `.gitignore` 单独追加忽略项（当前所有插件的 `lib/*.js` 均入仓）。
- 优先查阅各插件的 `README.md` 获取加载与构建信息，本文档仅描述共性约定。

## 插件清单

| 目录 | 形态 | 宿主半部 | 浏览器半部 | 构建 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `dsh-fork-inbox-guard` | Host only（TS） | `index.ts`：监听 `agent/created`，折叠继承前缀 `events[0, inheritedEventCount)` 的 `agent/inbox/spliced`，与当前 pending 求交后 `inbox.remove()` | — | `npm run typecheck`；`node test.mjs` | 分叉子会话丢弃「继承自源会话、仍 pending」的输入；子代理（有 runtime owner）显式跳过，普通/非 seeded 会话不动作 |
| `dsh-git-guard` | Host only（TS） | `index.ts`，钩挂 `tools/pre-execute` | — | `npm run typecheck`；`node test.mjs` | 拦截 `git push`（deny）/ `git commit`（ask） |
| `dsh-new-session` | Host + Client（纯 JS） | `lib/index.js`：注册 `/new` 命令 | `lib/client.js`：`uiWorkspace.startSession` + 抑制命令生命周期行 | 无 | `/new` 新建会话命令 |
| `dsh-fullwidth-chat` | Client only（纯 JS） | `lib/index.js`（空宿主） | `lib/client.js`：注入样式 | 无 | 对话列全宽展示 |
| `dsh-code-card-fonts` | Client only（TS） | `index.ts`（空宿主） | `src/` → esbuild → `lib/client.js` | `npm run typecheck && npm run build && npm run check` | 卡片标题/摘要行/展开内容与代码块字号补丁 |
| `dsh-rightbar-tab-width` | Client only（TS） | `index.ts`（空宿主） | `src/`（client.ts + css.ts）→ esbuild → `lib/client.js`（入仓） | `npm run typecheck && npm run build && npm run check` | 右栏 tab 胶囊定宽补丁：`[data-dockkit-tab][role="tab"]`（两个属性选择器 = (0,2,0)，压过 dockkit 的 `._tab_*` 单类名）上写 `box-sizing:border-box; min-width:100px; max-width:100px`，把上游随文字在 100px–190px 浮动的外宽钉成恒定 100px（= 上游胶囊自身地板：80px 内容盒 + 左右各 10px 内边距）。**耦合**：dockkit 的 `ey()` 把 pane 内第一个 `[data-dockkit-tab]` 的计算后 `min-width` 当作「一枚胶囊的宽度预算」（border-box 分支直接返回该值；空 pane 或 `min-width<=0` 才回落到 `SPLIT_MINIMUMS.chip = 100`），进入尺度可行性判定 `row: pane.width/2 - extra >= 固定chrome + chip`（`canSplitPane`），决定「分栏」按钮是否渲染、以及把 tab 拖到格子左右边缘是否允许分栏。取值 100 与兜底常量同值 ⇒ 分栏判定与上游默认逐字相同、无偏移；若改常量，所需右栏最小宽度会整体移动 2×Δpx（阈值在 `pane.width` 上、系数 2）。右栏用 `hideSplitWhenBlocked: true`，判定不过时按钮不渲染（不是禁用）。只命中停靠 chip，浮窗标题（`[data-dockkit-float-title]`）不受影响；见其 README |
| `dsh-directory-picker-browse` | Patch only | 无 | 无 | 无 | `cordis.patch.yml` 覆盖层：停用 auto 目录选择器与产物行，挂载 browse 变体 |
| `dsh-kbd-hotkeys` | Host + Client（TS） | `index.ts`（空宿主） | `src/`（client.ts + config/actions/model-picker/question-drafts/sidebar-order/sidebar-tabs/workspace-switcher/overlay/types）→ esbuild → `lib/client.js` | `npm run typecheck && npm run build && npm run check` | 全局快捷键（三态分发：`card` 卡片态 / `editing` 输入态 / `browse` 浏览态）：审批/问答键盘化（审批卡片 Enter 同意 / Esc 拒绝，固定单键、不受焦点影响；通用问答直接读写卡片自身的 slot 草稿 store，卡片实时高亮；`1`–`9` 只选不翻题、`←`/`→` 切题、Enter 非末题推进）、活跃会话切换（按侧栏可见顺序，来源不可读则 no-op、无降级）、Esc 停止当前会话交互树（无审批卡片时）、左右栏开关（左栏 ⌘/Ctrl+B → `layout.toggleSidebar()`；右栏 ⌘/Ctrl+Alt+B → `sidebarRight.toggleExpanded()`）、右栏当前面板标签切换（⌘/Ctrl+Alt+←/→ → 读右栏会话级 slot store 的 `layout.activePaneId` 面板标签顺序 + `sidebarRight.focus(tabId)`，循环、单标签不吞键）、右栏文件浏览器定位（⌘/Ctrl+Alt+\ → `sidebarRight.openTab('files')`：该面板没有文件浏览器页就**创建**、已有就聚焦，同一步展开右栏；再经同一份会话级 store 的 `actions.placeTab(…, 0)` 把它置于标签栏首位）、工作区浮窗（⌘/Ctrl+Alt+K → 浮窗内 ↑↓ 选、Enter 调 `uiWorkspace.openWorkspace(workspaceId)` 连接/切换工作区）、模型浮窗（⌘/Ctrl+Alt+M → 浮窗内 ↑↓ 选、Enter 调**上游同一份** per-session 模型目录 `ctx.modelDirectories.directoryFor(sessionId).select(...)`——即 `/model` 弹层与 composer 模型座位用的那一份）、思考强度循环（⇧Tab → 同一目录上按上游 `effortChoices` 的候选档循环 `reasoningEffort`；`editing` 态另需焦点落在 composer 内）、聚焦输入框（⌘/Ctrl+I → `conversation.input` 取 composer 的 editor 宿主元素后 `focus()`；上游无可触发聚焦服务面）与 ⌘/ 速查表；功能与键位见其 README |

### `dsh-kbd-hotkeys` 动作触发路径（服务 / DOM）

动作**全部走服务触发**（不触碰 DOM）；DOM 只有三处：`document` 上的 `keydown`
捕获监听（全部快捷键的入口）、`editing` 态的事件目标判定（`isEditableTarget`），
以及插件自建自管的浮层（`overlay.ts`：⌘/ 速查表、⌘/Ctrl+Alt+K 工作区浮窗与
⌘/Ctrl+Alt+M 模型浮窗，不消费上游服务）。浮层打开时按键进入**模态分发**
（浮层未处理的按键一律吞掉）。
另有**两次元素级调用**，都只对**服务链路给出的** composer 宿主元素操作
（无选择器查询 / DOM 遍历 / 事件合成）：`composer.focus` 对它调
`focus({preventScroll:true})`；`model.effortNext` 在 `editing` 态用它的
`contains` 判「焦点是否落在 composer 内」（见下表该行）。
逐项源码依据见该插件 `README.md`「实现要点」与 `src/actions.ts` 头部注释。

| 动作 | 键位（默认） | 触发路径 | 服务接口 / DOM 选择器 |
| --- | --- | --- | --- |
| `approval.allow` / `approval.reject` | `Enter` / `Esc`（固定单键，当前会话有待审批卡片时） | **服务** | `uiSession.pendingInteractions` → `PendingApproval.answer('allowed-once' \| 'rejected')`；固定单键不经 `bindings`，组合键形式的审批键位不生效 |
| `question.option` / `question.submit`（计划评审） | `1`–`3` / `Enter` | **服务** | 同上 → `PendingQuestion.answer({answers})`；`3` = `cancel()`；确认/拒绝标签取自 `questions[0].intent.approve` |
| `question.option` / `question.submit`（通用问答） | `1`–`9` / `Enter` | **服务** | 同上 → 卡片自身的 slot 草稿 store（`slots.entries('conversation.composer')` 注册项 + `uiSession.resolve(sessionId)` + `slots.resolveStore`）写入 `{index, drafts}`：数字键只改选中态（**不翻题**）；Enter 保留上游 `continueFlow` 推进（当前题已作答且非末题 → 翻到下一题），末题仅在**全部题目完成后**结算 `answer({answers:[{id,selected,custom?}]})`（未完成即 no-op，不跳回未完成题）；卡片实时高亮，与鼠标点选共用同一状态 |
| `question.prev` / `question.next`（通用问答） | `←` / `→` | **服务** | 同一草稿 store 写入 `{index ± 1, drafts}`（草稿原样保留）；对齐上游 pager `nav.prev`/`nav.next` 的 disabled 语义，首题/末题越界 no-op 且不吞键 |
| `card` 态判定（数字键 / `←` `→` / `Enter` 门闸） | — | **服务** | 当前会话是否命中 `uiSession.pendingInteractions` 快照 |
| `sidebar.toggle` / `sidebarRight.toggle` | ⌘/Ctrl+B / ⌘/Ctrl+Alt+B | **服务** | 左栏 `layout.toggleSidebar()`；右栏 `sidebarRight.toggleExpanded()`（与右栏头部折叠按钮同一入口；帧轨道由右侧 seat 自行同步 `layout.openRightbar`/`closeRightbar`）。两者均 `browse` + `editing`：主键给主面板（左栏），派生键给上下文面板（右栏） |
| `sidebarRight.tabPrev` / `sidebarRight.tabNext` | ⌘/Ctrl+Alt+←/→ | **服务** | 标签顺序读右栏自己的会话级 slot store：`slots.entries('rightbar.session')` 注册项上的 store handle → `uiSession.resolve(sessionId)` 作用域绑定 → `slots.resolveStore` → `getSnapshot().bySession[sessionId].layout`，取 `layout.nodes[layout.activePaneId]`（**当前面板**）的 `tabs` / `activeTabId`；切换调公开的 `sidebarRight.focus(tabId)`（与标签 chip 点击同一入口）。**只在当前面板内循环**，单标签 / 该会话尚无面板 / 任一环不可用一律 no-op 不吞键（**无降级**）；**任意态**（含 `card`——问答卡片只占**裸** `←`/`→`，与 `mod+alt` 组合键不冲突） |
| `sidebarRight.files` | ⌘/Ctrl+Alt+`\` | **服务** | 定位右栏文件浏览器页：公开的 `sidebarRight.openTab('files')`（`kind` 来自常驻挂载的 `@deepseek-ai/dsh-client-ui-sidebar-files`）——页类型按**目标面板**（`activeDockPaneId`）去重，该面板已有文件浏览器页就只聚焦、**没有就创建**（上游 `openContent` 恒先 `planSetExpanded(true)` ⇒ 同一步展开右栏）；随后经同一份会话级 slot store 的**活实例** `actions.placeTab(sessionId, tabId, paneId, 0)`（与**标签拖拽**同一入口，**不用** `replaceTab`——那会关掉被顶掉的 tab）把它置于标签栏首位，**已在首位则零提交**。只认停靠面板（浮窗 / 别的分屏面板里的同页不搬）。**任意态**（`card` / `editing` / `browse`）；`openTab` 抛错（无挂载会话面 / `files` 类型未注册）或置顶任一取数环不可用一律 **no-op 不吞键**，且**只跳过置顶**、绝不回退 DOM |
| `composer.focus` | ⌘/Ctrl+I（`mod+i`；`comboOf` 同时吸收 ctrlKey/metaKey，mac 上 ⌃I 与 ⌘I 均可） | **服务取元素 + 一次 `focus()`** | `sessions.list` 快照 `current` → `sessions.binding(id).ctx` → `conversation.input.for(actx)`（`for` 缺席回退 `InputHub.shell(id)`，同一 `SessionInputShell`）→ `shell.editor.getRootElement()` → `focus({preventScroll:true})`。仅 `browse` 态；上游无可触发的聚焦服务面（`commandUi.bindComposerFocus` 只 bind 不 trigger，全仓无人调用；`editor.focus()` 非 DOM 聚焦原语），任一环缺失即 no-op 不吞键、不回退 DOM 查询 |
| `session.prev` / `session.next` | ⌘/Ctrl+Alt+↑/↓ | **服务** | `sessions.list` 快照 + `slots.entries('sidebar.workspaces')` 注册项上的侧栏视图 store（顺序）+ `sessions.open(id)` |
| `workspace.pick` | ⌘/Ctrl+Alt+K | **服务 + 插件自身浮层** | 浮窗（`overlay.ts`，纯 DOM）内：列表 = `workspaces.list.getSnapshot().items` 的**宿主顺序**（与侧栏工作区分组同源；`title` → 路径末段 → 原路径 作主标签，`当前` = 当前会话在该工作区 `sessionIds` 名下）；`↑`/`↓` 只移动高亮（clamp 不循环，**不触发导航**），`Enter` / 行内 `mousedown` 才调公开的 `uiWorkspace.openWorkspace(workspaceId)`（`dsh-client-ui-workspace` 的 `UiWorkspace` 服务：复用该工作区已挂载的空白会话，没有就 `sessions.create({workspaceId})` 新建再打开——与侧栏分组「＋」同一条「连接工作区」路径）；`Esc` 或同组合键关闭，同层内 `⌘/` 互切速查表。**任意态**；`workspaces` 缺席/无 `items` → 空态浮窗，`uiWorkspace` 缺席或 `openWorkspace` 抛错 → 确认 no-op，**不回退 DOM 点击侧栏分组** |
| `model.pick` | ⌘/Ctrl+Alt+M | **服务 + 插件自身浮层** | 浮窗（`overlay.ts`，纯 DOM）内：目录 = `ctx.modelDirectories.directoryFor(当前会话)`——与 `/model` 弹层、composer 模型座位是**同一份** per-session 实例；列表 = `load()` 后读 `store.getSnapshot()` 的 `groups` **按宿主顺序展开**（提供方分组标题 + 组内顺序都不重排，失败提供方折成底部小字不占行），每行完整选择复刻上游弹层 `selectionOf`（`reasoningEffort` = 当前选择落在该模型时的 `current.reasoningEffort`，否则 `model.reasoning.defaultEffort`，无则省略）；`↑`/`↓` 只移动高亮（clamp 不循环），`Enter` / 行内 `mousedown` 才调 `directory.select(selection)`（与两个上游入口同一条 `session.selectModel` 提交路径），浮窗内 `⇧Tab` 就地循环强度（只更新顶部「当前」行）。列表异步取、渲染带序号守卫（过期结果丢弃）。**任意态**；`modelDirectories` 缺席 / 无当前会话 / 被寻址的子代理会话（`sessions.subagentAddress(id) !== undefined`）/ `directoryFor` 抛错 → 空态浮窗，`load()` 拒绝 → 空态 + 失败小字，`select()` 拒绝 → 浮窗照关（错误落在共享 store 上），**不回退 DOM 点 composer 模型标签** |
| `model.effortNext` | `⇧Tab` | **服务（+ 一次 `contains` 门闸）** | 同一目录实例上循环 `reasoningEffort`：候选档复刻上游座位 `effortChoices`（`[Default（仅当模型无 defaultEffort 时）] + reasoning.efforts`），当前档 = `current.reasoningEffort ?? reasoning.defaultEffort`（不在候选里时从首项开始），`select` 只改强度、provider/model 沿用。**`browse` / `editing`**；`editing` 态另有元素级门闸——对服务链路取来的 composer 宿主元素调 `contains(event.target)`（`isComposerTarget`，与 `composer.focus` 同一条取元素链路），焦点在设置面板输入框 / Monaco 隐藏 textarea 等别处可编辑元素时不接管（`⇧Tab` 在别处仍是反向移动焦点 / 反向缩进）。模型无推理元数据 / 只有一档 / 目录不可用 / 取元素环缺失 → **no-op 不吞键**；`card` 态不接管（归卡片） |
| `session.stop` | `Esc`（仅当前会话无待审批卡片时） | **服务** | `sessions.binding(id).session.cancel()`（含直系子代理） |
| `help.toggle` | ⌘/Ctrl+/ | 插件自身浮层 | 纯 DOM 浮层（不消费上游服务） |

侧栏开关的键位分配：**左栏 = ⌘/Ctrl+B（主键）**、**右栏 = ⌘/Ctrl+Alt+B（派生键）**。
理由三条：① `⌘/Ctrl+B` 开关侧栏是跨应用肌肉记忆（VS Code / Slack / 各类编辑器），
把已被训练过的反射留给最基础的左栏（导航主面板）；② 上游命名同源——
不带限定词的 `sidebar` / `sidebarCol` 就指左栏（`layout.toggleSidebar()`），右栏是派生的
`rightbar`（`rightbarShown` / `rightbarTrack`），主键给「本名」、叠加修饰键给「限定名」；
③ 越常用越省力——更短更好按的 `⌘/Ctrl+B` 给频率更高的左栏，`Alt` 这一档留给上下文面板
（右栏）。两个动作 id 各自独立可经 localStorage 覆盖，互换只改 `src/config.ts` 两行
`DEFAULT_BINDINGS`。**右栏标签切换 = ⌘/Ctrl+Alt+←/→**：与右栏开关同属 `rightbar`
这一档（`mod+alt`），方向键天然表达「上一个 / 下一个」；与 ⌘/Ctrl+Alt+↑/↓ 的活跃会话
跳转同族但不同轴（会话轴在左栏、标签轴在右栏）。标签**循环**（末个 → 回到第一个），
只有一个标签时 no-op 且不吞键；两个动作 id（`sidebarRight.tabPrev` /
`sidebarRight.tabNext`）同样各自独立可覆盖。**右栏文件浏览器定位 = ⌘/Ctrl+Alt+\**：
同属 `rightbar` 这一档（`mod+alt`），反斜杠在主键区右端、不与同档的方向键抢位，
且按 `event.code` 的物理键位 `Backslash` 命中（Win/Linux 上 `Ctrl+Alt` 即 AltGr，
按字符判定会被布局坑掉）；语义是「**定位**」而非「开关」——`sidebarRight.openTab('files')`
按**目标面板**去重（该面板已有文件浏览器页只聚焦，**没有就创建**），同一步展开右栏，
再经同一份会话级 store 的 `actions.placeTab(sessionId, tabId, paneId, 0)`
（与**标签拖拽**同一入口，**不用** `replaceTab`，避免关掉被顶掉的 tab）置顶；
动作 id `sidebarRight.files` 独立可覆盖。**工作区浮窗 = ⌘/Ctrl+Alt+K**：同属
`mod+alt` 这一档（`K` = Work-space 联想，不抢同档的方向键 / `B` / `\`），语义是
「列表 → 选中 → 切换」——↑/↓ **只移动高亮**（不触发导航，避免连按就连开多个空白会话），
Enter / 点击行才调 `uiWorkspace.openWorkspace(workspaceId)`（连接工作区：复用该工作区的
空白会话、没有就新建一个再打开，与侧栏分组「＋」同一条路径）；Esc 或同组合键关闭，
浮窗内 `⌘/` 与速查表互切；列表取自 `workspaces.list` 快照的**宿主顺序**（与侧栏分组
顺序同源），初始高亮 = 当前会话所属工作区。动作 id `workspace.pick` 独立可覆盖。
**模型浮窗 = ⌘/Ctrl+Alt+M**：同属 `mod+alt` 这一档（`M` = Model 联想，不抢同档的
方向键 / `B` / `\` / `K`），语义与工作区浮窗同形（列表 → 选中 → 提交），而**取数与提交
都与两个上游入口同源**——`ctx.modelDirectories` 的 per-session 目录实例正是 `/model`
弹层与 composer 模型座位共用的那一份，所以浮窗里切换后 composer 的模型标签同步变化，
反之亦然。**思考强度循环 = ⇧Tab**：上游把强度档收在「模型菜单 → Effort」二级面板里、
**没有默认键位**，而「在模型上按 Tab 循环档位」是既有习惯；候选档与当前档都逐字复刻
上游 composer 座位的 `effortChoices` / `effectiveEffort`。它只放行 `browse` / `editing`，
且 `editing` 态多一道**元素级门闸**（`contains` 焦点是否在 composer 内）——⇧Tab 是文本
编辑的核心键（反向移动焦点 / Monaco 反向缩进），不能全局抢。两个动作 id
（`model.pick` / `model.effortNext`）各自独立可覆盖。

取数入口与已知限制：服务路径读 `uiSession.pendingInteractions.getSnapshot()`（公开面；
`pendingSnapshot` 为同源私有字段，仅作兼容回退）；审批为**固定单键** `Enter`（允许）/
`Esc`（拒绝），当前会话有待审批卡片时不受焦点位置影响（审批卡片自身无输入框），
无审批卡片时 `Esc` 继续走 `session.stop`；通用问答的草稿以**卡片自身的 slot
store** 为唯一真源（注册项 → `uiSession.resolve(sessionId)` → `slots.resolveStore`），
卡片实时高亮、与鼠标点选可自由混用，**翻题入口是 `←`/`→` 与 `Enter`**（数字键选中后
不跳题；`Enter` 保留非末题推进、末题仅在全部题目完成后结算，未完成即 no-op 且不跳回），
焦点在卡片自定义输入框时
数字键 / `←` `→` / `Enter` 不接管（交回卡片，`←` `→` 用于移动光标）——详见
`dsh-kbd-hotkeys/README.md`「服务化后的已知限制」与 `src/question-drafts.ts`。
验证：`node test-services.mjs`（最小 DOM 桩不提供任何卡片，断言服务路径与草稿 store
写入，含数字键不翻题、`←`/`→` 只改题号、首末题不循环、Enter 非末题推进 / 末题未完成不结算，
以及 ⌘/Ctrl+B / ⌘/Ctrl+Alt+B 分别打左/右栏、互不串场、自定义键位与无降级；另有
⌘/Ctrl+Alt+←/→ 右栏标签切换：标签顺序必须取自 `rightbar.session` 注册项的**会话级
store**（`bySession[sessionId].layout` 的 `activePaneId` 面板）、切换必须调
`sidebarRight.focus`，首末标签循环、单标签 / 无面板 / 任一环不可用一律 no-op 不吞键、
`card` 态仍生效而裸 `←`/`→` 仍归卡片；
以及 ⌘/Ctrl+Alt+\ 定位右栏文件浏览器并置顶：必须调公开的 `sidebarRight.openTab('files')`
（该面板已有该页只聚焦、**没有就创建**）、置顶必须调同一份会话级 store **实例**的
`actions.placeTab(sessionId, tabId, paneId, 0)`（与标签拖拽同一入口）、已在首位不调
`placeTab`、只作用于停靠面板且优先当前面板（浮窗 / 别的分屏面板不搬）、`openTab`
抛错时 no-op 不吞键、置顶取数环不可用只跳过置顶而打开本身照旧吞键；
以及
⌘/Ctrl+I 聚焦输入框：`binding.ctx` 原样传给 `conversation.input.for`、只认 `browse` 态、
`for` 缺席回退 `shell(id)`、任一环缺失/抛错一律 no-op 不吞键；
以及 ⌘/Ctrl+Alt+K 工作区浮窗：列表按宿主顺序渲染（`title` / 路径末段 / `当前` 标记 /
会话数）、初始高亮 = 当前会话所属工作区、`↑`/`↓` 只移动高亮（不触发导航）且越界 clamp、
`Enter` / 行内 mousedown 才调 `uiWorkspace.openWorkspace`、`Esc` 与同组合键关闭、
`⌘/` 换成速查表、空列表与 `workspaces` 缺席为空态、`uiWorkspace` 缺席或抛错时确认
no-op、`card`/`editing` 态仍可用、键位可覆盖；
以及 ⌘/Ctrl+Alt+M 模型浮窗 + ⇧Tab 循环思考强度：目录必须按
`ctx.modelDirectories.directoryFor(当前会话)` 取（与两个上游入口同一份实例）、行按
宿主顺序展开（提供方分组标题 / 当前标记 / 初始高亮）、每行完整选择复刻上游弹层
`selectionOf`（无 `defaultEffort` 时不带 `reasoningEffort`）、Enter 调 `directory.select`；
⇧Tab 的候选档复刻上游座位 `effortChoices`（有 `defaultEffort` 时不含 Default 档）、
当前档 = `current.reasoningEffort ?? defaultEffort`、末档回到首档、浮窗内 ⇧Tab 只更新
「当前」行；模型无推理元数据 / 只有一档 / 服务缺席 / 无当前会话 / 被寻址子代理 /
`directoryFor` 抛错 → no-op 且不吞键；`load()` 拒绝 → 空态 + 失败小字、`select()` 拒绝 →
浮窗照关；`editing` 态另需焦点落在 composer 内（`isComposerTarget` 的 `contains` 门闸），
`card` 态不接管）与
`node test-dispatch.mjs`（会话跳转分发：按侧栏顺序，
覆盖分组 / flat / 权威来源不可用时 no-op——**无降级**）。

## 无服务面 UI 状态的取数范式（slot store）

有些 UI 状态上游**没有** cordis 服务方法，只存在于某个 slot 注册项挂载的 per-session
store 上。这类状态仍然可以零 DOM 读写，范式固定为三步（本仓库的问答卡片草稿
`dsh-kbd-hotkeys/src/question-drafts.ts`、侧栏视图顺序 `src/sidebar-order.ts`
与右栏标签顺序 `src/sidebar-tabs.ts` 已在用；后两者的作用域不同——`sidebar-tabs.ts`
的 handle 是 **session 作用域**（必须传第 2 步的绑定），`sidebar-order.ts` 的是
**root 作用域**（传 `undefined`））：

1. `slots.entries('<slot 名>')` → 该 slot 的注册项；带 `store` 字段的那一项即承载
   目标状态的 store handle（`SlotsService.entries` 与注册项的 `store` 都是公开面）；
2. `uiSession.resolve(sessionId)` → 该会话**已物化的作用域绑定**
   `{ key: sessionId, ctx, hooks, keyedHooks, props }`（`uiSession.resolve` →
   `createMaterializedBinding` → `materialize`，其内部就调了 `slots.bindStoreScope`）；
3. `slots.resolveStore(handle, binding)` → **活实例**：`getSnapshot()` / `actions` /
   `subscribe`。

渲染端组件拿到的 `useStore` / `actions` 也来自同一句
`resolveStore(entry.store, scopeBinding)`（`dsh-client-ui-renderer` 的 `standardKit`），
因此外部写入与鼠标操作共用**同一份内存态**、React 订阅者立即重渲染，不是镜像。
**无降级**：任一环节不可用（注册项未挂载 / 无该 handle / `uiSession.resolve` 返回
`undefined` / `resolveStore` 抛 `store handle is not registered`）即 no-op，
不得回退到 DOM 点击。

## 包结构与约定

标准插件结构：

```
<workspace>/<package-name>/
├── package.json      # type=module；exports["."]→宿主入口、["./client"]→浏览器入口
├── index.ts          # 宿主半部（TypeScript，Node 22 Type Stripping 直接加载）
├── src/              # 浏览器半部源码（TypeScript，入口 src/client.ts）
├── scripts/          # 浏览器半部构建脚本（esbuild / tsc / tsdown）
├── lib/client.js     # 浏览器半部构建产物（由 build 脚本生成，禁止手改）
├── cordis.patch.yml  # Web 组合补丁：挂载行（insert / disabled）
└── README.md         # 功能、加载与构建说明
```

`package.json` 关键字段：

- `"type": "module"`；`exports` 分别映射 `"."`（宿主入口）与 `"./client"`（浏览器入口）；
- `dsh.client.platform: "web"` + `dsh.client.immediately: true`：浏览器半部据此注册至
  浏览器 roster；
- `dsh.bundle.patch: "./cordis.patch.yml"`：挂载行随 bundle 层应用；
- 无 `exports` 时使用 `main`（如 `dsh-git-guard` 的 `"main": "index.ts"`）。

`cordis.patch.yml`：

- 每个插件均须声明挂载行 `- insert: [{id, name}]`；纯补丁插件直接以 `disabled` /
  `insert` 修改组合（参见 `dsh-directory-picker-browse`）。
- 宿主半部依赖宿主服务时，在该行声明 `inject`（当前没有插件需要；各插件的宿主半部均为空宿主或不消费宿主服务）。
- 依赖注入：TS 宿主半部不在代码中静态 `export inject`，宿主服务改由挂载行 `inject`
  声明；浏览器半部则按需 `export const inject = [...]`（由模块加载器读取注入，如
  `dsh-kbd-hotkeys`：`['sessions','uiSession','layout','sidebarRight','workspaces','slots','conversation','uiWorkspace','modelDirectories']`——`slots`
  用于读侧栏视图 store 的会话顺序、问答卡片草稿 store 与右栏标签 store
  （`rightbar.session` 注册项：读标签顺序），`layout` / `sidebarRight` 分别用于
  开关左右栏与（右栏）标签切换，`conversation` 用于 ⌘/Ctrl+I 聚焦输入框
  （取 composer 的 editor 宿主元素）与 ⇧Tab 的编辑态门闸（宿主元素 `contains`），
  `uiWorkspace` 用于 ⌘/Ctrl+Alt+K 工作区浮窗确认时连接/切换工作区
  （`uiWorkspace.openWorkspace`），`modelDirectories` 用于 ⌘/Ctrl+Alt+M 模型浮窗
  与 ⇧Tab 循环思考强度（`dsh-client-ui-model-selection` 的
  `directoryFor(sessionId)`，与 `/model` 弹层、composer 模型座位同一份实例）。
  不消费服务的客户端（纯样式补丁 `dsh-code-card-fonts`）无需声明。遗留纯 JS 宿主
  （`dsh-new-session` 的 `lib/index.js`）维持现状：仍在代码中
  `export inject = ['commands']`。

宿主半部：以 TypeScript 编写 `index.ts`（可拆分多文件），由 Node 22 Type Stripping
直接加载，无需编译；相对导入须携带 `.ts` 扩展名；仅允许可擦除语法（不使用 enum、
命名空间、参数属性），`tsconfig.json` 以 `erasableSyntaxOnly` 强制约束。最小示例：
`dsh-git-guard`（单文件）。遗留的纯 JavaScript 宿主（`dsh-fullwidth-chat`、`dsh-new-session`
的 `lib/index.js`）维持现状，不要求迁移。

浏览器半部：以 TypeScript 编写，`src/` 为源码（入口 `src/client.ts`），`scripts/`
提供构建脚本（esbuild / tsc / tsdown 均可，参照现有插件），产物为经
`window.__ModuleLoader__.load({...})` 包装的 `lib/client.js`。可参照的工程模板：

- `dsh-kbd-hotkeys` / `dsh-code-card-fonts`：`src/` → esbuild 单文件 →
  `lib/client.js`（入仓）。
- 遗留纯 JavaScript 浏览器半部（`dsh-fullwidth-chat`、
  `dsh-new-session` 的 `lib/client.js`）维持现状，不要求迁移。
- 浏览器运行时不支持 Type Stripping：`lib/client.js` 为构建产物、禁止手改；源码变更
  后必须重新构建，未重新构建是插件改动未生效的最常见原因。产物一律入仓，
  以保证离线可加载。
- bundle 的 external 依赖按各插件实际 import 配置（由框架注入、不打包进产物）：
  `dsh-kbd-hotkeys`、`dsh-code-card-fonts` 的浏览器半部不消费 react 等 external
  （业务模块全部内联）。客户端源码中的 `@deepseek-ai/*` import 均为
  type-only、编译时擦除。

## 挂载与激活（Web Profile）

`~/.dsh/profiles/web/package.json` 当前配置：

- `dependencies` 以 `link:<仓库根>/<name>` 指向仓库内各插件（本机当前 10 个：
  code-card-fonts / directory-picker-browse / fork-inbox-guard / fullwidth-chat /
  git-guard / kbd-hotkeys / new-session / rightbar-split-open / rightbar-tab-width /
  text-editor）——其中 `rightbar-split-open` 已从仓库移除，该 `link:` 指向缺失目录，
  需由用户执行 `dsh plugin --profile web remove dsh-rightbar-split-open` 摘除
  （摘除后 9 个，与仓库内插件目录一一对应）；
- `dsh.profile.bundles` 共 12 项：`@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-web-app`
  及上述 10 个本地插件（摘除 `dsh-rightbar-split-open` 后为 11 项 / 9 个本地插件）；
- `dsh.profile.patchReload: live`：仅热重载 Profile 自身的 `cordis.patch.yml`
  （当前为 `[]`）；bundle 层为常驻挂载，不支持热重载。

挂载新插件或启用未挂载插件（`dsh plugin` 是 pnpm 转发器：执行 `pnpm add` 后会
自动核对 `dsh.profile.bundles` —— 声明了 `dsh.bundle` 的依赖自动并入 bundle 列表，
无需手动改 `package.json`）：

```sh
# 方式一：从仓库内插件目录执行（相对 link: 由 pnpm 锚定到当前目录）
cd <仓库根>/<name> && dsh plugin --profile web add link:.
# 方式二：从任意目录用绝对路径
dsh plugin --profile web add link:<仓库根>/<name>
# 重启 App 生效
```

卸载：

```sh
dsh plugin --profile web remove <name>
```

> 上述步骤属于用户操作：依据强制规范第 1 条，代理交付插件后不得自行执行加载步骤
> （`dsh plugin add`、`pnpm install`、重启 App）；应将步骤写入插件 README 并告知用户。

## 变更生效机制

1. **浏览器半部（`lib/client.js`）重新构建后自动热加载**：`dsh-client-hmr` 行在 Web 组合里
   **无条件挂载**（`dsh-web-app/cordis.patch.yml` 的 `client-hmr`），其 node 半部每 500ms
   stat 轮询每个插件产物的 mtime/size，变化即 `clientModuleHost.rebuilt(id)` 重新哈希、
   重发图并沿 `/plugins/events` SSE 广播 `rebuilt` 帧，浏览器半部做 fiber 替换——
   **无需重启、无需刷新**（只要页面处于打开状态）。因此「改了插件看不到效果」首先要
   确认 `npm run build` 是否真的跑过、产物是否已落盘，而不是先怀疑没重启。
2. **宿主半部（`index.ts` / 组合变更）仍需重启 App**：宿主行由 Loader 常驻挂载，
   `dsh.profile.patchReload: live` 只热重载 Profile 自身的 `cordis.patch.yml`。
   若代理自身运行于 dsh web 进程内，重启会终止当前会话，应先交付说明、再由用户触发。
3. 状态验证（读取宿主**当前公告**的插件图与产物字节；`/plugins/events` 为公开 SSE 端点，
   单个 `/plugins/<name>/client.js` 不在公告组合内会 404）：

```bash
curl -s -N --max-time 3 http://127.0.0.1:3080/plugins/events | head -c 2000   # 首帧含 graph(各行 id/rev/url)
# 再按公告 url 取字节：curl -s "http://127.0.0.1:3080/plugins/??<id>/client.js&rev=<rev>" | wc -c
```

## 构建与验证

| 插件 | 命令 | 说明 |
| --- | --- | --- |
| `dsh-git-guard` | `npm run typecheck`；`node test.mjs` | `test.mjs` 以 Type Stripping 运行时验证 deny/ask/放行各分支 |
| `dsh-fork-inbox-guard` | `npm run typecheck`；`node test.mjs` | `test.mjs` 用真实 `@deepseek-ai/dsh-session` 构造 seeded 子会话，验证前缀折叠、移除幂等、子代理 balanced 前缀零改动、异常不外逸 |
| `dsh-code-card-fonts` | `npm run typecheck && npm run build && npm run check` | esbuild → `lib/client.js`（入仓）；`check` 对产物与宿主执行 `node --check` |
| `dsh-rightbar-tab-width` | `npm run typecheck && npm run build && npm run check` | esbuild → `lib/client.js`（入仓）；`check` 对产物与宿主执行 `node --check`。其构建脚本**直接执行 esbuild 的平台二进制**（`@esbuild/<platform>-<arch>`，`stdio: 'inherit'`）而非 `import 'esbuild'` 的 `buildSync`：esbuild 的 JS API 以 stdin/stdout 管道与子进程通信，在受限沙箱下 `spawn` 报 `EPERM`；同组 flag 下产物一致 |
| `dsh-kbd-hotkeys` | `npm run typecheck && npm run build && npm run check`；`node test-services.mjs`；`node test-dispatch.mjs` | esbuild → `lib/client.js`（入仓）；`check` 对产物与宿主执行 `node --check`。其构建脚本与 `dsh-rightbar-tab-width` 同一做法：**直接执行 esbuild 的平台二进制**（`@esbuild/<platform>-<arch>`，`stdio: 'inherit'`）而非 `import 'esbuild'` 的 `buildSync`（后者以 stdin/stdout 管道与子进程通信，受限沙箱下 `spawn` 报 `EPERM`；同组 flag 下产物一致） |
| 纯 JS / patch-only | 无构建步骤 | fullwidth-chat、new-session、directory-picker-browse |

`node_modules` 可能被清理；安装 typescript 等依赖时若默认 npm 缓存不可用，应指定可写
缓存目录（`npm_config_cache=<writable-dir>`）或使用仓库根的 `.pnpm-store`。

## 类型解析约定

- `@deepseek-ai/*` 为预发布包，不经 registry 安装；插件的 `node_modules/@deepseek-ai`
  是指向全局 dsh 包内置 bundled scope 的 junction / 符号链接
  （`<npm root>/@deepseek-ai/dsh/node_modules/@deepseek-ai`，含 `lib/types` 声明）。
  重装或迁移全局 dsh 包后须重建该 junction。
- 部分类型包（`dsh-client-ui-slots`、`dsh-client-ui-primitives`）不在内置 bundle 中，
  故启用 `skipLibCheck`，并在源码中自行声明结构切片类型（模板：
  `dsh-kbd-hotkeys/src/types.ts`，仅覆盖实际消费的字段，以上游 `lib` 源码为准）。
- 宿主 TypeScript 中 `import type` 在 Type Stripping 下被擦除，运行时无 cordis 依赖；
  `devDependencies` 仅供语言服务器与类型检查使用。

## 上游源码定位

- DSH 实现 checkout：位于全局 npm 安装目录下的 `@deepseek-ai/dsh`
  （可用 `npm root -g` 或 `npm ls -g @deepseek-ai/dsh` 定位）。
- 内置 UI / 服务包：`<dsh>/node_modules/@deepseek-ai/dsh-client-ui-*` 等——通过其
  `lib/client.js` 核实 DOM 结构与服务接口。编写选择器或接口前须以源码为准，不得凭
  经验臆断。

## 注意事项与常见问题

1. 本仓库采用黑名单式 `.gitignore`，插件目录默认受版本控制；仅当某插件
   `lib/` 为不入仓的构建产物时，才需在 `.gitignore` 单独追加忽略项。
2. 插件变更未生效时应首先排查：浏览器半部是否已重新构建；宿主半部是否已重启。
3. 浏览器半部未声明所需依赖（如 `slots`）即 apply → `ctx.get(...)` 返回 `undefined`，
   导致 Web 启动失败 / HARNESS 面板报 failed to apply loader entry；判空须使用
   `=== null || === undefined` 双重判断。
4. Node 宿主 TypeScript（Type Stripping 直载者）仅使用可擦除语法
   （`erasableSyntaxOnly`）。
5. 浏览器 bundle 仅将框架依赖（react 等）设为 external，业务模块全部内联。
6. 向 `~/.dsh/` 写入文件需 danger-full-access 沙箱授权；系统提示声明
   approval=never 时不得设置 `sandbox_permissions`。
7. 插件改动未生效时按此顺序排查：①浏览器半部是否已 `npm run build`（产物 mtime 变化后
   client-hmr 会在 500ms 内热推送，页面无需重启/刷新）；②宿主半部（`index.ts`）改动是否
   重启了 App；③产物是否被手改覆盖（`lib/client.js` 禁手改）。
8. 交付后自行加载插件（修改 Profile、`pnpm install`、重启 App）违反强制规范第 1 条；
   加载由用户执行，代理仅交付代码与加载说明。
9. 新插件浏览器半部采用手写 JavaScript、未提供 `build` 脚本，违反强制规范第 2 条；
   浏览器不支持 Type Stripping，TypeScript 源码必须经构建产出 `lib/client.js` 才能加载。

## 文档索引

| 路径 | 内容 |
| --- | --- |
| `AGENTS.md`（本文档） | 仓库工程规范总纲：插件清单、挂载与激活、生效机制、共性约定与注意事项，以及「无服务面 UI 状态的取数范式（slot store）」 |
| 各插件 `README.md` | 功能说明、加载方式与构建说明（`dsh-fullwidth-chat` 暂无 README，功能见其 `package.json` 的 `description` 与本文档插件清单） |