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
Profile 的 `link:` 依赖挂载至运行中的应用。仓库内含 7 个插件目录（见下节插件清单），
web Profile 当前已全部挂载。`dsh-change-summary`、`dsh-kbd-nav-focus`（提交 6499dd9）、
`dsh-fork-inbox-guard`、`dsh-no-right-sidebar` 已从仓库移除，仅存于
git 历史。仓库根不提供集合
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
| `dsh-git-guard` | Host only（TS） | `index.ts`，钩挂 `tools/pre-execute` | — | `npm run typecheck`；`node test.mjs` | 拦截 `git push`（deny）/ `git commit`（ask） |
| `dsh-new-session` | Host + Client（纯 JS） | `lib/index.js`：注册 `/new` 命令 | `lib/client.js`：`uiWorkspace.startSession` + 抑制命令生命周期行 | 无 | `/new` 新建会话命令 |
| `dsh-fullwidth-chat` | Client only（纯 JS） | `lib/index.js`（空宿主） | `lib/client.js`：注入样式 | 无 | 对话列全宽展示 |
| `dsh-code-card-fonts` | Client only（TS） | `index.ts`（空宿主） | `src/` → esbuild → `lib/client.js` | `npm run typecheck && npm run build && npm run check` | 卡片标题/摘要行/展开内容与代码块字号补丁 |
| `dsh-directory-picker-browse` | Patch only | 无 | 无 | 无 | `cordis.patch.yml` 覆盖层：停用 auto 目录选择器与产物行，挂载 browse 变体 |
| `dsh-kbd-hotkeys` | Host + Client（TS） | `index.ts`（空宿主） | `src/`（client.ts + config/actions/question-drafts/sidebar-order/overlay/types）→ esbuild → `lib/client.js` | `npm run typecheck && npm run build && npm run check` | 全局快捷键（三态分发：`card` 卡片态 / `editing` 输入态 / `browse` 浏览态）：审批/问答键盘化（审批卡片 Enter 同意 / Esc 拒绝，固定单键、不受焦点影响；通用问答直接读写卡片自身的 slot 草稿 store，卡片实时高亮；`1`–`9` 只选不翻题、`←`/`→` 切题、Enter 非末题推进）、活跃会话切换（按侧栏可见顺序，来源不可读则 no-op、无降级）、会话视图标签切换、Esc 停止当前会话交互树（无审批卡片时）、侧栏开关与 ⌘/ 速查表；功能与键位见其 README，设计文档 `docs/dsh-hotkeys-proposal.md` |
| `dsh-text-editor` | Host + Client（TS） | `index.ts` + `host/*.ts`（注册 read/write/monaco 路由；挂载行 `inject: [webServer, fs]`） | `src/client.ts` → esbuild → `lib/client.js`（入仓） | `npm run typecheck && npm run build && npm run check` | 应用内 Monaco 文本编辑器能力提供者：经 `ctx.provide('dsh-text-editor')` 暴露 `openFile`（文件 tab，可编辑保存）与 `showDiff`（差异 tab，手动推进）；构建依赖 `monaco-editor`（Monaco 复制到不入仓的 `vendor/monaco/`）；暂无 README |

### `dsh-kbd-hotkeys` 动作触发路径（服务 / DOM）

上游存在可用服务面的动作**全部改为服务触发**（不触碰 DOM）；无服务面的动作维持 DOM
点击。逐项源码依据见该插件 `README.md`「实现要点」与 `src/actions.ts` 头部注释。

| 动作 | 键位（默认） | 触发路径 | 服务接口 / DOM 选择器 |
| --- | --- | --- | --- |
| `approval.allow` / `approval.reject` | `Enter` / `Esc`（固定单键，当前会话有待审批卡片时） | **服务** | `uiSession.pendingInteractions` → `PendingApproval.answer('allowed-once' \| 'rejected')`；旧组合键 ⌘/Ctrl+Alt+Enter、⌘/Ctrl+Alt+Backspace 已移除 |
| `question.option` / `question.submit`（计划评审） | `1`–`3` / `Enter` | **服务** | 同上 → `PendingQuestion.answer({answers})`；`3` = `cancel()`；确认/拒绝标签取自 `questions[0].intent.approve` |
| `question.option` / `question.submit`（通用问答） | `1`–`9` / `Enter` | **服务** | 同上 → 卡片自身的 slot 草稿 store（`slots.entries('conversation.composer')` 注册项 + `uiSession.resolve(sessionId)` + `slots.resolveStore`）写入 `{index, drafts}`：数字键只改选中态（**不翻题**）；Enter 保留上游 `continueFlow` 推进（当前题已作答且非末题 → 翻到下一题），末题仅在**全部题目完成后**结算 `answer({answers:[{id,selected,custom?}]})`（未完成即 no-op，不跳回未完成题）；卡片实时高亮，与鼠标点选共用同一状态 |
| `question.prev` / `question.next`（通用问答） | `←` / `→` | **服务** | 同一草稿 store 写入 `{index ± 1, drafts}`（草稿原样保留）；对齐上游 pager `nav.prev`/`nav.next` 的 disabled 语义，首题/末题越界 no-op 且不吞键 |
| `card` 态判定（数字键 / `←` `→` / `Enter` 门闸） | — | **服务** | 当前会话是否命中 `uiSession.pendingInteractions` 快照 |
| `sidebar.toggle` | ⌘/Ctrl+B | **服务** | `layout.toggleSidebar()`（`browse` + `editing`） |
| `session.prev` / `session.next` | ⌘/Ctrl+Alt+↑/↓ | **服务** | `sessions.list` 快照 + `slots.entries('sidebar.workspaces')` 注册项上的侧栏视图 store（顺序）+ `sessions.open(id)` |
| `session.stop` | `Esc`（仅当前会话无待审批卡片时） | **服务** | `sessions.binding(id).session.cancel()`（含直系子代理） |
| `view.prev` / `view.next` | ⌘/Ctrl+Alt+←/→ | DOM | `[role="tablist"]` 中 `role="tab"` 按钮 `.click()` |
| `help.toggle` | ⌘/Ctrl+/ | 插件自身浮层 | 纯 DOM 浮层（不消费上游服务） |

维持 DOM 的原因（内置包 0.1.5-alpha.1 源码核实）：

- **会话视图标签**：`selectView` / `openView` 是 slot 注入的 React 回调，无跨插件服务面
  （活跃视图存于 ui-conversation 的 per-session slot store，外部不可读）。

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
写入，含数字键不翻题、`←`/`→` 只改题号、首末题不循环、Enter 非末题推进 / 末题未完成不结算）与
`node test-dispatch.mjs`（会话跳转分发：按侧栏顺序，
覆盖分组 / flat / 权威来源不可用时 no-op——**无降级**）。

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
- 宿主半部依赖宿主服务时，在该行声明 `inject`（当前仅 `dsh-text-editor`
  声明 `inject: [webServer, fs]`；其余插件的宿主半部为空宿主或不消费宿主服务）。
- 依赖注入：TS 宿主半部不在代码中静态 `export inject`，宿主服务改由挂载行 `inject`
  声明；浏览器半部则按需 `export const inject = [...]`（由模块加载器读取注入，如
  `dsh-kbd-hotkeys`：`['sessions','uiSession','layout','workspaces','slots']`——`slots`
  用于读侧栏视图 store 的会话顺序与问答卡片草稿 store），不消费服务的
  客户端（纯样式补丁 `dsh-code-card-fonts`）无需声明。遗留纯 JS 宿主
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
  （业务模块全部内联）；`dsh-text-editor` 把 `react` 声明为 external，由
  ModuleLoader 的模块表提供。客户端源码中的 `@deepseek-ai/*` import 均为
  type-only、编译时擦除。

## 挂载与激活（Web Profile）

`~/.dsh/profiles/web/package.json` 当前配置：

- `dependencies` 以 `link:<仓库根>/<name>` 指向仓库内各插件（当前 7 个：
  code-card-fonts / directory-picker-browse / fullwidth-chat / git-guard /
  kbd-hotkeys / new-session / text-editor）；
- `dsh.profile.bundles` 共 9 项：`@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-web-app`
  及上述 7 个本地插件；
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
| `dsh-code-card-fonts` | `npm run typecheck && npm run build && npm run check` | esbuild → `lib/client.js`（入仓）；`check` 对产物与宿主执行 `node --check` |
| `dsh-kbd-hotkeys` | `npm run typecheck && npm run build && npm run check` | esbuild → `lib/client.js`（入仓）；`check` 对产物与宿主执行 `node --check` |
| `dsh-text-editor` | `npm run typecheck && npm run build && npm run check` | esbuild → `lib/client.js`（入仓）；`check` 对产物与宿主执行 `node --check`；构建依赖 `monaco-editor`（复制到不入仓的 `vendor/monaco/`） |
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
| `AGENTS.md`（本文档） | 仓库工程规范总纲：插件清单、挂载与激活、生效机制、共性约定与注意事项 |
| 各插件 `README.md` | 功能说明、加载方式与构建说明（`dsh-fullwidth-chat`、`dsh-text-editor` 暂无 README，功能见其 `package.json` 的 `description` 与本文档插件清单） |