# AGENTS.md — DSH 本地插件工作区

本仓库是 DSH（DeepSeek Harness）Web 的本地持久化插件集合：每个插件目录都是一个独立、
自包含的本地 npm 包，经本机 web Profile 的 `link:` 依赖挂载进正在运行的应用。动态 Cordis
定义只存在于进程内存、重启即失效，需要长期保留的行为因此固化为仓库内的本地包。

本文档只记录**跨插件的共性约定**（仓库布局、包结构与挂载、变更生效机制、构建与验证、
共性坑与排查）；单个插件的功能、实现依据与已知限制见其目录内 `README.md`。

## 强制规范

1. **插件交付后，代理不得自行加载插件。** 加载属于用户操作，不属于代码交付范围：不得
   修改 `~/.dsh/profiles/web/package.json`（`dependencies` / `dsh.profile.bundles`）、
   不得执行 `dsh plugin add` 或 `pnpm install`、不得重启 App / `dsh web`。代理只交付
   代码、构建产物与加载说明，由用户执行加载。
2. **新增或重构插件一律使用 TypeScript，并提供构建与类型检查命令。** 浏览器半部以
   TypeScript 写在 `src/`（入口 `src/client.ts`），`package.json` 必须提供 `build`
   脚本（产出 `lib/client.js`）与 `typecheck` 脚本；宿主半部以 TypeScript 写在
   `index.ts`（Node 22 Type Stripping 直接加载，无需编译），同样必须能通过 `typecheck`。
   `lib/*.js` 是构建产物，不得手改。现有两个纯 JavaScript 插件
   （`dsh-fullwidth-chat`、`dsh-new-session`）保持现状，不要求迁移。

## 仓库布局与版本控制

- 仓库根**不是「一个插件」**：没有集合包、也没有根 `cordis.patch.yml`，不提供集合
  安装 / 卸载脚本。每个插件在 Profile 中是独立的 `link:` 依赖，经其自身的
  `cordis.patch.yml` 独立挂载。
- 版本控制采用**黑名单**：根 `.gitignore` 只忽略系统 / 编辑器文件（`.DS_Store`、
  `.idea/`）、包管理器缓存（`.pnpm-store/`、`.npm-cache/`、`node_modules/`）与
  TypeScript 增量缓存（`*.tsbuildinfo`）。新增插件目录默认即受版本控制，无需额外配置。
- 构建产物默认**入仓**以保证离线可加载：当前所有插件的 `lib/*.js` 都已入仓；目前没有任何插件存在不入仓的构建产物。
- 各插件目录内可另有 `.gitignore`（如 `dsh-git-guard`、`dsh-fork-inbox-guard` 忽略
  `node_modules/`、`.npm-cache/`、`*.log`）。

## 插件清单

仓库内含 **9 个插件目录**，本机 web Profile 已全部挂载（`dependencies` 9 条 `link:`、
`dsh.profile.bundles` 11 项，与仓库目录一一对应、无多余项；`node_modules` 下 9 条
Junction 目标均有效）。核对命令见「挂载与激活（Web Profile）」。

| 目录 | 形态 | 宿主半部 | 浏览器半部 | 说明 |
| --- | --- | --- | --- | --- |
| `dsh-code-card-fonts` | Client only（TS；宿主占位） | `index.ts`：空宿主 | `src/client.ts` + `src/css.ts` → esbuild → `lib/client.js` | 卡片标题 / 摘要行 / 展开内容 / 代码块 / 内联代码 / Markdown 表格单元格字号补丁（统一 14px）与卡片间距 `calc(14px * 0.5)` = 7px；**不覆盖**内容字号轴 `--dsh-content-font-size`，设置里的「字号大小」仍可调 |
| `dsh-directory-picker-browse` | Patch only（无代码） | — | — | `cordis.patch.yml` 覆盖层：`disabled` 停用上游 `directory-picker`（auto 目录选择器）与 `ui-deliverables`（产物行），`insert` 挂载 browse 变体的宿主 / 浏览器两个 in-box 包 |
| `dsh-fork-inbox-guard` | Host only（TS） | `index.ts`：监听 `agent/created`，折叠继承前缀 `events[0, inheritedEventCount)` 的 `agent/inbox/spliced`，与当前 pending 求交后 `inbox.remove()` | — | 分叉子会话丢弃「继承自源会话、仍 pending」的输入；有 runtime owner 的子代理显式跳过，普通 / 非 seeded 会话不动作 |
| `dsh-fullwidth-chat` | Client only（纯 JS；宿主占位） | `lib/index.js`：空宿主（仅供组合行解析、供 client-modules 扫描） | `lib/client.js`：注入样式 | 对话列全宽展示 |
| `dsh-git-guard` | Host only（TS） | `index.ts`：钩挂 `tools/pre-execute`；另经 `ctx.systemPrompt.section()` 注入约束区段（区段文本按会话权限动态求值） | — | **所有敏感 git 操作一律 `ask`（需用户授权），本插件不产生 `deny`**：`git commit`、非 force `git push`，以及 force push 与 rebase / merge / cherry-pick / reset --hard / revert / am / filter-branch / filter-repo 等破坏性历史改写，统统改为向用户索取授权；约束同时以系统提示词告知模型。**当前权限为完全权限（`danger-full-access`）时整体退出**：不拦截、不索取授权、区段文本为空串；判定取自 `ctx.sandboxPolicy.resolve({ session })`（会话为 `exec.agent.session`），服务缺席 / 无 `resolve` / 抛错一律按非完全权限处理（失败关闭）。注意 `ask` 的落地效果还取决于 approval 策略：`approval=never` 而沙箱**非**完全权限时（典型：子代理会话）宿主确定性拒绝该授权请求，效果等同不放行——那是宿主裁决，不是插件的 deny |
| `dsh-kbd-hotkeys` | Client only（TS；宿主占位） | `index.ts`：空宿主 | `src/`（client.ts + config.ts + actions.ts + question-drafts.ts + session-order.ts + sidebar-order.ts + sidebar-tabs.ts + workspace-switcher.ts + recent-sessions.ts + model-picker.ts + overlay.ts + types.ts）→ esbuild → `lib/client.js` | 全局快捷键，三态分发（`card` 卡片态 / `editing` 输入态 / `browse` 浏览态）：审批与问答键盘化、活跃会话跳转、左右栏开关、右栏标签切换、右栏当前标签关闭（`sidebarRight.close`）、右栏文件浏览器定位、右栏终端定位（聚焦标签并把 DOM 焦点移进 xterm）、新建会话（等同 `/new`）、工作区浮窗、近期对话浮窗（最近交互 10 个、按工作区分组、初始光标落在当前会话、↑↓ 选择、Enter 打开）、模型浮窗、思考强度循环、聚焦输入框、⌘/ 速查表。逐动作触发路径见下文专节 |
| `dsh-new-session` | Host + Client（纯 JS） | `lib/index.js`：注册 `/new` 命令（`inject: ['commands']`） | `lib/client.js`：`uiWorkspace.startSession` + 抑制命令生命周期行 | `/new` 新建并跳转空白会话 |
| `dsh-rightbar-tab-width` | Client only（TS；宿主占位） | `index.ts`：空宿主 | `src/client.ts` + `src/css.ts` → esbuild → `lib/client.js` | 右栏 tab 胶囊定宽：`[data-dockkit-tab][role="tab"]`（两个属性选择器 = (0,2,0)，压过 dockkit 的 `._tab_*` 单类名）上写 `box-sizing:border-box; min-width:100px; max-width:100px`，把上游随文字在 100px–190px 浮动的外宽钉成恒定 100px（= 上游胶囊自身地板：80px 内容盒 + 左右各 10px 内边距）。**耦合**：dockkit 的 `ey()` 把 pane 内第一个 `[data-dockkit-tab]` 的计算后 `min-width` 当作「一枚胶囊的宽度预算」，进入尺度可行性判定 `row: pane.width/2 - extra >= 固定chrome + chip`（决定「分栏」按钮是否渲染、以及把 tab 拖到格子左右边缘是否允许分栏）。取值 100 与兜底常量 `SPLIT_MINIMUMS.chip` 同值 ⇒ 分栏判定与上游默认逐字相同；若改常量，所需右栏最小宽度会整体移动 2×Δpx（阈值在 `pane.width` 上、系数 2），右栏用 `hideSplitWhenBlocked: true`，判定不过时按钮不渲染。只命中停靠 chip，浮窗标题（`[data-dockkit-float-title]`）不受影响；详见其 README |

## 包结构与约定

标准插件结构：

```
<workspace>/<package-name>/
├── package.json      # type=module；exports["."]→宿主入口、["./client"]→浏览器入口
├── index.ts          # 宿主半部（TypeScript，Node 22 Type Stripping 直接加载）
├── src/              # 浏览器半部源码（TypeScript，入口 src/client.ts）
├── scripts/          # 浏览器半部构建脚本（esbuild）
├── lib/client.js     # 浏览器半部构建产物（由 build 脚本生成，禁止手改）
├── cordis.patch.yml  # Web 组合补丁：挂载行（insert / disabled）
└── README.md         # 功能、加载与构建说明
```

`package.json` 关键字段：

- `"type": "module"`；`exports` 分别映射 `"."`（宿主入口）与 `"./client"`（浏览器入口）；
- `dsh.client.platform: "web"` + `dsh.client.immediately: true`：浏览器半部据此注册至
  浏览器 roster；
- `dsh.bundle.patch: "./cordis.patch.yml"`：挂载行随 bundle 层应用；
- 宿主入口也可以是 `main`（如 `dsh-git-guard`、`dsh-fork-inbox-guard` 的
  `"main": "index.ts"`）。

`cordis.patch.yml`：

- 每个插件都必须带 `insert` 挂载行；纯补丁插件还可以直接 `disabled` / `insert` 修改
  组合（见 `dsh-directory-picker-browse`）。
- **宿主入口必须存在且可解析**：即使插件是纯浏览器半部（`dsh-code-card-fonts`、
  `dsh-rightbar-tab-width`、`dsh-kbd-hotkeys`），其 `exports["."]` 指向的
  `index.ts` 也必须是合法加载项（当前为空宿主 `apply() {}`），`dsh-client-modules`
  靠扫描这些 Loader 条目发现声明了 `dsh.client.platform: "web"` 的包。
- 依赖注入：TS 宿主半部不在代码中静态 `export inject`，宿主服务由挂载行 `inject`
  声明；浏览器半部按需 `export const inject = [...]`（由模块加载器读取）。遗留纯 JS
  宿主（`dsh-new-session` 的 `lib/index.js`）仍在代码中
  `export inject = ['commands']`。不消费服务的客户端（`dsh-code-card-fonts`、
  `dsh-rightbar-tab-width`）不声明任何注入。

宿主半部：以 TypeScript 编写 `index.ts`（可拆分多文件），由 Node 22 Type Stripping 直接加载，无需编译；相对导入须携带 `.ts` 扩展名；
仅允许可擦除语法（不使用 enum、命名空间、参数属性），`tsconfig.json` 以
`erasableSyntaxOnly` 强制约束。最小示例：`dsh-git-guard`（单文件）。

浏览器半部：以 TypeScript 编写，`src/` 为源码（入口 `src/client.ts`），`scripts/`
提供构建脚本（统一为 esbuild），产物是经 `window.__ModuleLoader__.load({ id, factory })`
包装的单文件 `lib/client.js`（入仓）。**浏览器运行时不支持 Type Stripping**：
`lib/client.js` 为构建产物、禁止手改，源码变更后必须重新构建——「改了插件看不到效果」
最常见的原因就是漏了这一步。

- external 依赖按各插件实际 import 配置，由 ModuleLoader 的模块表提供、不打包进产物：
  其余插件的浏览器半部不消费 react 等 external（业务模块全部内联）。
- 客户端源码中的 `@deepseek-ai/*` import 均为 type-only，编译时擦除；运行时服务一律
  经 `ctx.get(name)` 取用。
- 两个构建流派（产物等价，按插件现状保持）：
  - `import { buildSync } from 'esbuild'` 的 JS API（`dsh-code-card-fonts`）；
  - **直接执行 esbuild 的平台二进制**（`@esbuild/<platform>-<arch>`，`stdio: 'inherit'`；
    `dsh-rightbar-tab-width`、`dsh-kbd-hotkeys`）——esbuild 的 JS API 以 stdin/stdout
    管道与子进程通信，在受限沙箱下 `spawn` 报 `EPERM`。

## 挂载与激活（Web Profile）

`~/.dsh/profiles/web/package.json` 当前配置：

- `dependencies` 以 `link:<仓库根>/<name>` 指向仓库内各插件，共 **9 条**，与仓库内插件
  目录一一对应；`~/.dsh/profiles/web/node_modules` 下 9 条 Junction 目标均有效
  （另有 `monaco-editor` 一条，指向 Profile 的模块回退目录）；
- `dsh.profile.bundles` 共 **11 项**：`@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-web-app`
  及上述 9 个本地插件（与 `dependencies` 逐项对应，无多余项）；
- `dsh.profile.patchReload: live`：仅热重载 Profile 自身的 `cordis.patch.yml`
  （当前为 `[]`）；bundle 层为常驻挂载，不支持热重载。

核对仓库与 Profile 是否一致：

```powershell
Get-Content "$env:USERPROFILE\.dsh\profiles\web\package.json"                        # dependencies / dsh.profile.bundles
Get-ChildItem "$env:USERPROFILE\.dsh\profiles\web\node_modules" |
  Select-Object Name, LinkType, Target                                               # Junction 是否存在、指向是否有效
```

挂载新插件或重新启用某个插件（`dsh plugin` 是 pnpm 转发器：执行 `pnpm add` 后会自动
核对 `dsh.profile.bundles` —— 声明了 `dsh.bundle` 的依赖自动并入 bundle 列表，无需手动
改 `package.json`）：

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
> `link:` 依赖已存在时重复执行是幂等 no-op；由于 `link:` 实时指向仓库目录，之后修改
> 插件代码无需重装。

## 变更生效机制

1. **浏览器半部（`lib/client.js`）重新构建后自动热加载**：`dsh-client-hmr` 行在 Web 组合
   里**无条件挂载**（`dsh-web-app/cordis.patch.yml` 的 `client-hmr`），其 node 半部每
   500ms stat 轮询每个插件产物的 mtime/size，变化即 `clientModuleHost.rebuilt(id)`
   重新哈希、重发图并沿 `/plugins/events` SSE 广播 `rebuilt` 帧，浏览器半部做 fiber
   替换——**无需重启、无需刷新**（只要页面处于打开状态）。因此「改了插件看不到效果」
   首先要确认 `npm run build` 是否真的跑过、产物是否已落盘。
2. **宿主半部（`index.ts` / `host/*` / 组合变更）仍需重启 App**：宿主行由 Loader 常驻
   挂载，`dsh.profile.patchReload: live` 只热重载 Profile 自身的 `cordis.patch.yml`；
   bundle 层（含各插件的 `cordis.patch.yml`）不支持热重载。若代理自身运行于 dsh web
   进程内，重启会终止当前会话，应先交付说明、再由用户触发。
3. 状态验证（读取宿主**当前公告**的插件图与产物字节；`/plugins/events` 为公开 SSE
   端点，单个 `/plugins/<name>/client.js` 不在公告组合内会 404）：

```bash
curl -s -N --max-time 3 http://127.0.0.1:3080/plugins/events | head -c 2000   # 首帧含 graph(各行 id/rev/url)
# 再按公告 url 取字节：curl -s "http://127.0.0.1:3080/plugins/??<id>/client.js&rev=<rev>" | wc -c
```

## 构建与验证

| 插件 | 命令 | 说明 |
| --- | --- | --- |
| `dsh-code-card-fonts` | `npm run typecheck && npm run build && npm run check` | esbuild（JS API）→ `lib/client.js`（入仓）；`check` 对产物与宿主执行 `node --check` |
| `dsh-directory-picker-browse` | 无 | 纯补丁插件，无源码与产物 |
| `dsh-fork-inbox-guard` | `npm run typecheck`；`node test.mjs` | `test.mjs` 用真实 `@deepseek-ai/dsh-session` 构造 seeded 子会话，验证前缀折叠、移除幂等、子代理 balanced 前缀零改动、异常不外逸 |
| `dsh-fullwidth-chat` | 无 | 纯 JS 插件，`lib/*.js` 即源码 |
| `dsh-git-guard` | `npm run typecheck`；`node test.mjs` | `test.mjs` 以 Type Stripping 运行时验证 ask / 放行各分支（**全部敏感操作断言为 `ask`，并回归断言不再产生 `deny`**；含工具名解耦、引号与包装词、破坏性操作回归），以及完全权限放行、权限逐会话生效、只取用 `sandboxPolicy`、服务缺席 / 无 `resolve` / 抛错的失败关闭、提示词区段的动态求值 |
| `dsh-kbd-hotkeys` | `npm run typecheck && npm run build && npm run check`；`node test-services.mjs`；`node test-dispatch.mjs` | esbuild（平台二进制）→ `lib/client.js`（入仓）；`check` 对产物与宿主执行 `node --check`。两个诊断脚本是纯 Node + 最小 DOM 桩，无需浏览器（覆盖范围见其 README「构建」） |
| `dsh-new-session` | 无 | 纯 JS 插件，`lib/*.js` 即源码 |
| `dsh-rightbar-tab-width` | `npm run typecheck && npm run build && npm run check` | esbuild（平台二进制）→ `lib/client.js`（入仓）；`check` 对产物与宿主执行 `node --check` |

`node_modules` 可能被清理；安装 typescript 等依赖时若默认 npm 缓存不可用，应指定可写
缓存目录（`npm_config_cache=<writable-dir>`）或使用仓库根的 `.pnpm-store`。

## 类型解析约定

- `@deepseek-ai/*` 为预发布包，不经 registry 安装；插件的 `node_modules/@deepseek-ai`
  是指向全局 dsh 包内置 bundled scope 的 junction / 符号链接
  （`<npm root>/@deepseek-ai/dsh/node_modules/@deepseek-ai`，含 `lib/types` 声明）。
  重装或迁移全局 dsh 包后须重建该 junction（示例命令见 `dsh-fork-inbox-guard/README.md`）。
- 部分类型包（`dsh-client-ui-slots`、`dsh-client-ui-primitives`）不在内置 bundle 中，
  故启用 `skipLibCheck`，并在源码中自行声明结构切片类型（模板：
  `dsh-kbd-hotkeys/src/types.ts`，仅覆盖实际消费的
  字段，以上游 `lib` 源码为准）。
- 宿主 TypeScript 中 `import type` 在 Type Stripping 下被擦除，运行时无 cordis 依赖；
  `devDependencies` 仅供语言服务器与类型检查使用。

## 上游源码定位

- DSH 实现 checkout：位于全局 npm 安装目录下的 `@deepseek-ai/dsh`
  （可用 `npm root -g` 或 `npm ls -g @deepseek-ai/dsh` 定位）。
- 内置 UI / 服务包：`<dsh>/node_modules/@deepseek-ai/dsh-client-ui-*` 等——通过其
  `lib/client.js` 核实 DOM 结构与服务接口。编写选择器或接口前须以源码为准，不得凭
  经验臆断。

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

## `dsh-kbd-hotkeys` 动作触发路径（服务 / DOM）

动作**全部走服务触发**（不触碰 DOM）；DOM 只有三处：`document` 上的 `keydown`
捕获监听（全部快捷键的入口）、`editing` 态的事件目标判定（`isEditableTarget`），
以及插件自建自管的浮层（`overlay.ts`：⌘/ 速查表、⌘/Ctrl+K 工作区浮窗、
⌘/Ctrl+I 近期对话浮窗与 ⌘/Ctrl+M 模型浮窗，不消费上游服务）。浮层打开时按键进入**模态分发**
（浮层未处理的按键一律吞掉）。
另有**元素级调用**，只对上游服务 / store 已经指明的**那一个**元素操作：`composer.focus`
与 `model.effortNext` 用的是**服务链路给出的** composer 宿主元素（`shell.editor.getRootElement()`；
无选择器查询 / DOM 遍历 / 事件合成）——`composer.focus` 在 `editing` 态用它的
`contains` 判「焦点是否**不在** composer 内」（不在才执行聚焦并调
`focus({preventScroll:true})`；焦点已在 composer 内时不重复聚焦，但该组合键仍被吞掉、
不放行给浏览器）；`model.effortNext` 在 `editing` 态用同一个
`contains` 判「焦点是否**在** composer 内」（在才接管）——两者判定方向相反，
共用 `isComposerTarget`（见下表两行）。
`sidebarRight.terminal`（⌘/Ctrl+L）另有一处**有界选择器查询**（全插件唯一一处）：终端
锁定为所在面板的当前标签后，按 store 给出的 `paneId` 找 `[data-dockkit-pane="<paneId>"]`
并把焦点移进其中的 `textarea.xterm-helper-textarea`（失败即少这一步，标签聚焦与吞键不受
影响）——用于修「终端本来就显示着、上游 TerminalBody 的 `[visible, state.writable]`
自动聚焦 effect 不会重跑」的场景（详见下表该行与其 README）。
逐项源码依据见该插件 `README.md`「实现要点」与 `src/sidebar-tabs.ts` 头部注释。

| 动作 | 键位（默认） | 触发路径 | 服务接口 / DOM 选择器 |
| --- | --- | --- | --- |
| `approval.allow` / `approval.reject` | `Enter` / `Esc`（固定单键，当前会话有待审批卡片时） | **服务** | `uiSession.pendingInteractions` → `PendingApproval.answer('allowed-once' \| 'rejected')`；固定单键不经 `bindings`，组合键形式的审批键位不生效 |
| `question.option` / `question.submit`（计划评审） | `1`–`3` / `Enter` | **服务** | 同上 → `PendingQuestion.answer({answers})`；`3` = `cancel()`；确认/拒绝标签取自 `questions[0].intent.approve` |
| `question.option` / `question.submit`（通用问答） | `1`–`9` / `Enter` | **服务** | 同上 → 卡片自身的 slot 草稿 store（`slots.entries('conversation.composer')` 注册项 + `uiSession.resolve(sessionId)` + `slots.resolveStore`）写入 `{index, drafts}`：数字键只改选中态（**不翻题**）；Enter 保留上游 `continueFlow` 推进（当前题已作答且非末题 → 翻到下一题），末题仅在**全部题目完成后**结算 `answer({answers:[{id,selected,custom?}]})`（未完成即 no-op，不跳回未完成题）；卡片实时高亮，与鼠标点选共用同一状态 |
| `question.prev` / `question.next`（通用问答） | `←` / `→` | **服务** | 同一草稿 store 写入 `{index ± 1, drafts}`（草稿原样保留）；对齐上游 pager `nav.prev`/`nav.next` 的 disabled 语义，首题/末题越界 no-op 且不吞键 |
| `card` 态判定（数字键 / `←` `→` / `Enter` 门闸） | — | **服务** | 当前会话是否命中 `uiSession.pendingInteractions` 快照 |
| `sidebar.toggle` / `sidebarRight.toggle` | ⌘/Ctrl+B / ⌘/Ctrl+O | **服务** | 左栏 `layout.toggleSidebar()`；右栏 `sidebarRight.toggleExpanded()`（与右栏头部折叠按钮同一入口；帧轨道由右侧 seat 自行同步 `layout.openRightbar`/`closeRightbar`）。两者均 `browse` + `editing`：左栏沿用跨应用肌肉记忆 `B`，右栏取 `O`（Open panel），同属**单修饰键**这一档 |
| `sidebarRight.tabPrev` / `sidebarRight.tabNext` | ⌘/Ctrl+Alt+←/→ | **服务** | 标签顺序读右栏自己的会话级 slot store：`slots.entries('rightbar.session')` 注册项上的 store handle → `uiSession.resolve(sessionId)` 作用域绑定 → `slots.resolveStore` → `getSnapshot().bySession[sessionId].layout`，取 `layout.nodes[layout.activePaneId]`（**当前面板**）的 `tabs` / `activeTabId`；切换调公开的 `sidebarRight.focus(tabId)`（与标签 chip 点击同一入口）。**只在当前面板内循环**，单标签 / 该会话尚无面板 / 任一环不可用一律 no-op 不吞键（**无降级**）；**任意态**（含 `card`——问答卡片只占**裸** `←`/`→`，与 `mod+alt` 组合键不冲突） |
| `sidebarRight.closeTab` | ⌘/Ctrl+.（`mod+.`；`code` 命中 `Period`，与布局无关） | **服务** | 关闭右栏**当前面板**的**当前标签**：现场与标签切换同源（会话级 store 的 `bySession[sessionId].layout`，`activePaneId` 面板的 `activeTabId`，且须真在该面板 `tabs` 里）；关闭调公开的 `sidebarRight.close(tabId)`（与标签 chip 的关闭按钮 / 标签菜单「关闭」同一入口，上游自带 `registerCloseHandler` 钩子并拒关「**独占停靠**的 guide」）。插件**不复制**上游可行性判定，而是调完**回读同一份活实例**：标签已从 `layout.tabs` 消失才算处理（吞键），仍在（上游拒关 / 服务面在别的会话）即 no-op **不吞键**；回读失败按「仍在」处理。无 `close` 面 / 取数任一环不可用 / 无当前标签 / `close` 抛错一律 no-op 不吞键（**无降级**）；**任意态**（含 `card`——卡片只占裸键） |
| `sidebarRight.files` | ⌘/Ctrl+`\` | **服务** | 定位右栏文件浏览器页：公开的 `sidebarRight.openTab('files')`（`kind` 来自常驻挂载的 `@deepseek-ai/dsh-client-ui-sidebar-files`）——页类型按**目标面板**（`activeDockPaneId`）去重，该面板已有文件浏览器页就只聚焦、**没有就创建**（上游 `openContent` 恒先 `planSetExpanded(true)` ⇒ 同一步展开右栏）；随后经同一份会话级 slot store 的**活实例** `actions.placeTab(sessionId, tabId, paneId, 0)`（与**标签拖拽**同一入口，**不用** `replaceTab`——那会关掉被顶掉的 tab）把它置于标签栏首位，**已在首位则零提交**。只认停靠面板（浮窗 / 别的分屏面板里的同页不搬）。**任意态**（`card` / `editing` / `browse`）；`openTab` 抛错（无挂载会话面 / `files` 类型未注册）或置顶任一取数环不可用一律 **no-op 不吞键**，且**只跳过置顶**、绝不回退 DOM |
| `sidebarRight.terminal` | ⌘/Ctrl+L（`mod+l`；`comboOf` 同时吸收 ctrlKey/metaKey，mac 上 ⌃L 与 ⌘L 均可） | **服务 + 一处有界选择器查询（元素级聚焦）** | 定位右栏终端页：terminal 是 `multiple: true` 的页类型（`@deepseek-ai/dsh-client-ui-sidebar-terminal` 注册 `kind: 'terminal'`），上游 `placeTab` 给**每次**打开都铸带 UUID 的 `contentId`（`sidebar://terminal/<uuid>`），`planOpenContent` **不按 (kind, contentId) 去重** ⇒ 直接 `openTab('terminal')` 会每按一次多开一个终端。故**认页由插件自己做**（与 `sidebarRight.files` 同一条取数链路：`slots.entries('rightbar.session')` → `uiSession.resolve(sessionId)` → `slots.resolveStore` → `bySession[sessionId].layout`；判 `record.kind === 'terminal'` 或 `sidebar://terminal[/…]` 地址；当前面板优先、再扫其余**停靠**面板，浮窗不参与；面板内优先当前激活的那个）。**已有 → 只调 `sidebarRight.focus(tabId)`**（与标签 chip 点击同一入口；`focus` 不动展开态，故 `layout.expanded === false` 时再补一步公开的 `toggleExpanded()`，`expanded` 读不到则不动），**不重排、不置顶**（终端可能开着多个，热键不替用户决定顺序）；随后若该终端**已经是所在面板的当前标签、且右栏此刻已展开**（判据在 `toggleExpanded` 之前取），再补一次元素级聚焦 `focusTerminalScreen(paneId)`——上游 `focus` 只聚焦标签，终端内容的 DOM 焦点由 TerminalBody 的 `[visible, state.writable]` effect 完成，而「终端本来就显示着」时它不会重跑，焦点会留在原处（典型：对话输入框）：按 store 的 `paneId` 找 `[data-dockkit-pane="<paneId>"]` → `textarea.xterm-helper-textarea` → `focus({preventScroll:true})`（不遍历标签 / 不搜索全文档 / 不合成事件；找不到即少这一步）；**没有 → `openTab('terminal')` 新建**（上游 `openContent` 恒先 `planSetExpanded(true)` ⇒ 同一步展开右栏；新终端由上游 `visible` 翻转时的自动聚焦接管，插件不代劳）。**任意态**；`openTab` 抛错（无挂载会话面 / `terminal` 类型未注册）、`focus` 抛错、已有终端而 `focus` 面缺失 → 一律 no-op **不吞键**且**不退化成再开一个**；只有 slots / 作用域绑定整条链路不可用时无从判重，才退化为按 `openTab('terminal')` 新建 |
| `composer.focus` | ⌘/Ctrl+J（`mod+j`；J = Jump「焦点跳转」；`comboOf` 同时吸收 ctrlKey/metaKey，mac 上 ⌃J 与 ⌘J 均可） | **服务取元素 + 一次 `contains` 门闸 + 一次 `focus()`** | `sessions.list` 快照 `current` → `sessions.binding(id).ctx` → `conversation.input.for(actx)`（`for` 缺席回退 `InputHub.shell(id)`，同一 `SessionInputShell`）→ `shell.editor.getRootElement()` → `focus({preventScroll:true})`。**`browse` 态恒可用；`editing` 态另有元素级门闸**——`contains(event.target)` 为真（焦点已在 composer 内，动作无事可做）时不重复聚焦、但组合键**仍被吞掉**（旧键位 `I` 在此放行是为保住 contenteditable 的「斜体」默认键；`J` 无等价默认行为，放行只会触发 Win/Linux 浏览器的 `Ctrl+J` = 下载页），为假（焦点在右栏终端 xterm 的 helper textarea / Monaco 的 inputarea textarea / 设置面板输入框等**非 composer** 的可编辑元素里）时执行聚焦并跳回输入框；`card` 态不接管。上游无可触发的聚焦服务面（`commandUi.bindComposerFocus` 只 bind 不 trigger，全仓无人调用；`editor.focus()` 非 DOM 聚焦原语），任一环缺失即 no-op 不吞键、不回退 DOM 查询 |
| `session.prev` / `session.next` | ⌘/Ctrl+Alt+↑/↓ | **服务** | `sessions.list` 快照 + `slots.entries('sidebar.workspaces')` 注册项上的侧栏视图 store（顺序）+ `sessions.open(id)` |
| `session.recent` | ⌘/Ctrl+I | **服务 + 插件自身浮层** | 浮窗（`overlay.ts`，纯 DOM）内：列表 = `sessions.list` 快照的会话行 + `workspaces.list` 快照的分组，**全局最多 10 行**、按工作区分组（组序 = 宿主顺序、组内 = `updatedAt` 降序的最近更新序、空白 / 归档 / 子代理会话不列出、无归属会话落末尾无标题组；取数见 `recent-sessions.ts` 与 `session-order.ts`，**不新增服务注入**）；每行 = `displayTitle` + 状态标记（待回应 / 运行中 / 完成）+ `当前` 标记 + `cwd` 次行；`↑`/`↓` 在整份列表上**跨组**移动高亮（clamp 不循环，**不打开会话**），`Enter` / 行内 `mousedown` 才调公开的 `uiWorkspace.openSession(sessionId)`（与侧栏点会话行 / 搜索结果行同一条上游调用：`sessions.open` **加** `layout.selectPanel(null)`；`uiWorkspace` 缺席 / 无该方法时回退 `sessions.open`，两者都以**方法**形式调用——摘下来会丢 `this` 抛错）；`Esc` 或同组合键关闭，同层内 `⌘/` 互切速查表。**任意态**；`sessions` 缺席 / 快照缺 `ids` → 空态浮窗（Enter 不消费），`open` 缺失或抛错 → 确认 no-op、浮窗照关，`workspaces` 缺席 / 缺 `items` → 全部落入无标题组（仍可用），**不回退 DOM** |
| `session.new` | ⌘/Ctrl+N | **服务** | 公开的 `uiWorkspace.startSession()`（无参）——与侧栏「新建会话」按钮、`dsh-new-session` 浏览器半部收到 `command/executed('new')` 后的调用**逐字相同**，故等同 `/new`：继承当前 / 最近的工作区，创建或复用其空白会话并打开。不触碰 composer 草稿。**任意态**；`uiWorkspace` 缺席 / 无 `startSession` / 抛错（无挂载会话面）一律 no-op 不吞键，**不回退 DOM 点侧栏按钮**。注意浏览器把 ⌘/Ctrl+N 当「新建窗口」保留键（多数浏览器不把该键派发给页面），键位可经 localStorage 覆盖 |
| `workspace.pick` | ⌘/Ctrl+K | **服务 + 插件自身浮层** | 浮窗（`overlay.ts`，纯 DOM）内：列表 = `workspaces.list.getSnapshot().items` 的**宿主顺序**（与侧栏工作区分组同源；`title` → 路径末段 → 原路径 作主标签，`当前` = 当前会话在该工作区 `sessionIds` 名下）；`↑`/`↓` 只移动高亮（clamp 不循环，**不触发导航**），`Enter` / 行内 `mousedown` 才调公开的 `uiWorkspace.openWorkspace(workspaceId)`（`dsh-client-ui-workspace` 的 `UiWorkspace` 服务：复用该工作区已挂载的空白会话，没有就 `sessions.create({workspaceId})` 新建再打开——与侧栏分组「＋」同一条「连接工作区」路径）；`Esc` 或同组合键关闭，同层内 `⌘/` 互切速查表。**任意态**；`workspaces` 缺席/无 `items` → 空态浮窗，`uiWorkspace` 缺席或 `openWorkspace` 抛错 → 确认 no-op，**不回退 DOM 点击侧栏分组** |
| `model.pick` | ⌘/Ctrl+M | **服务 + 插件自身浮层** | 浮窗（`overlay.ts`，纯 DOM）内：目录 = `ctx.modelDirectories.directoryFor(当前会话)`——与 `/model` 弹层、composer 模型座位是**同一份** per-session 实例；列表 = `load()` 后读 `store.getSnapshot()` 的 `groups` **按宿主顺序展开**（提供方分组标题 + 组内顺序都不重排，失败提供方折成底部小字不占行），每行完整选择复刻上游弹层 `selectionOf`（`reasoningEffort` = 当前选择落在该模型时的 `current.reasoningEffort`，否则 `model.reasoning.defaultEffort`，无则省略）；`↑`/`↓` 只移动高亮（clamp 不循环），`Enter` / 行内 `mousedown` 才调 `directory.select(selection)`（与两个上游入口同一条 `session.selectModel` 提交路径），浮窗内 `⇧Tab` 就地循环强度（只更新顶部「当前」行）。列表异步取、渲染带序号守卫（过期结果丢弃）。**任意态**；`modelDirectories` 缺席 / 无当前会话 / 被寻址的子代理会话（`sessions.subagentAddress(id) !== undefined`）/ `directoryFor` 抛错 → 空态浮窗，`load()` 拒绝 → 空态 + 失败小字，`select()` 拒绝 → 浮窗照关（错误落在共享 store 上），**不回退 DOM 点 composer 模型标签** |
| `model.effortNext` | `⇧Tab` | **服务（+ 一次 `contains` 门闸）** | 同一目录实例上循环 `reasoningEffort`：候选档复刻上游座位 `effortChoices`（`[Default（仅当模型无 defaultEffort 时）] + reasoning.efforts`），当前档 = `current.reasoningEffort ?? reasoning.defaultEffort`（不在候选里时从首项开始），`select` 只改强度、provider/model 沿用。**`browse` / `editing`**；`editing` 态另有元素级门闸——对服务链路取来的 composer 宿主元素调 `contains(event.target)`（`isComposerTarget`，与 `composer.focus` 同一条取元素链路），焦点在设置面板输入框 / Monaco 隐藏 textarea 等别处可编辑元素时不接管（`⇧Tab` 在别处仍是反向移动焦点 / 反向缩进）。模型无推理元数据 / 只有一档 / 目录不可用 / 取元素环缺失 → **no-op 不吞键**；`card` 态不接管（归卡片） |
| `session.stop` | `Esc`（仅当前会话无待审批卡片时） | **服务** | `sessions.binding(id).session.cancel()`（含直系子代理） |
| `help.toggle` | ⌘/Ctrl+/ | 插件自身浮层 | 纯 DOM 浮层（不消费上游服务） |

键位分两档：**单修饰键 `⌘/Ctrl+字母` 给全局动作**（左栏 `B`、右栏 `O`、工作区 `K`、
近期对话 `I`、模型 `M`、新建会话 `N`、焦点跳转 `J`、文件浏览器 `\`、终端 `L`、
关右栏标签 `.`、速查表 `/`），
**`mod+alt` 给导航**
（`←`/`→` 右栏标签、`↑`/`↓` 活跃会话）。
侧栏开关的分配：**左栏 = ⌘/Ctrl+B**、**右栏 = ⌘/Ctrl+O**。
理由两条：① `⌘/Ctrl+B` 开关侧栏是跨应用肌肉记忆（VS Code / Slack / 各类编辑器），
把已被训练过的反射留给最基础的左栏（导航主面板，对应上游不带限定词的
`sidebar` / `sidebarCol` → `layout.toggleSidebar()`）；② 右栏取 `O`（**Open panel**，
开合右栏面板；上游叫 `rightbar`——`rightbarShown` / `rightbarTrack`），与左栏的 `B`
**同档不同键**（都是「`mod+字母`」的等长组合，没有谁要多按一个修饰键的层级差）。
两个动作 id 各自独立可经 localStorage 覆盖，互换只改 `src/config.ts` 两行
`DEFAULT_BINDINGS`。

**右栏标签切换 = ⌘/Ctrl+Alt+←/→**：这一对留在 `mod+alt` 档（也是右栏唯一还用 `alt`
的动作），因为方向键在该档已成体系——`←`/`→` 是**右栏内**的标签轴，⌘/Ctrl+Alt+↑/↓ 是
**左栏里**的活跃会话轴，左右配对。标签**循环**（末个 → 回到第一个），只有一个标签时
no-op 且不吞键；两个动作 id（`sidebarRight.tabPrev` / `sidebarRight.tabNext`）同样各自
独立可覆盖。

**关闭右栏当前标签 = ⌘/Ctrl+.**：与右栏开关 / 文件浏览器定位 / 终端定位同属单修饰键
这一档（句点 = 「取消 / 关闭」的联想；`comboOf` 的 `code` 表把 `Period` 归一成 `.`，
与布局产出什么字符无关）。语义 = 关掉**当前面板的当前标签**：现场取数与标签切换**同源**
（会话级 store 的 `bySession[sessionId].layout` → `activePaneId` 面板的 `activeTabId`，
且须真在该面板 `tabs` 里），关闭调公开的 `sidebarRight.close(tabId)`——与标签 chip 的
关闭按钮、标签菜单「关闭」**同一入口**，上游会先跑该页类型注册的关闭钩子
（`registerCloseHandler`）并拒关「**独占停靠**的 guide」（关掉它右栏会整体收起）。
插件**不复制**上游的可行性判定，而是**关完回读同一份活实例**：该标签已从 `layout.tabs`
消失才算处理（吞键），仍在（上游拒关 / `close` 作用到了别的会话）即 no-op **不吞键**；
回读失败（`getSnapshot` 缺失 / 抛错）按「仍在」处理。上游 store 动作是同步提交
（`defineStore` → `setState`），因此回读看到的就是这次调用的结果。动作 id
`sidebarRight.closeTab` 独立可覆盖；任意态（含 `card`——卡片只占裸键）。

**右栏文件浏览器定位 = ⌘/Ctrl+\\**：与右栏开关同属单修饰键这一档，反斜杠在主键区右端、
不与 `mod+alt` 档的方向键抢位，且按 `event.code` 的物理键位 `Backslash` 命中（与布局
产出什么字符无关）；语义是「**定位**」而非「开关」——
`sidebarRight.openTab('files')` 按**目标面板**去重（该面板已有文件浏览器页只聚焦，
**没有就创建**），同一步展开右栏，再经同一份会话级 store 的
`actions.placeTab(sessionId, tabId, paneId, 0)`（与**标签拖拽**同一入口，**不用**
`replaceTab`，避免关掉被顶掉的 tab）置顶；动作 id `sidebarRight.files` 独立可覆盖。

**右栏终端定位 = ⌘/Ctrl+L**：与右栏开关 / 文件浏览器定位同属单修饰键这一档（`L` 取
「Termina**L**」联想；`comboOf` 同时吸收 ctrlKey/metaKey，mac 上 ⌃L 与 ⌘L 都能触发）。
与文件浏览器那一步的关键差异是**上游不认这种「页」**：`terminal` 是 `multiple: true` 的页类型
（`@deepseek-ai/dsh-client-ui-sidebar-terminal` 注册 `kind: 'terminal'`），上游 `placeTab`
给**每次** `openTab` 都铸一个带随机 UUID 的 `contentId`（`sidebar://terminal/<uuid>`），
`planOpenContent` 因此**不按 (kind, contentId) 去重**（这也是上游 `pageKind` 对 `multiple`
页返回 `undefined` 的原因）——直接调 `openTab('terminal')` 会每按一次多开一个终端。
所以「认页」由插件自己读会话级 store 的布局完成（与文件浏览器同一条取数链路；判
`record.kind === 'terminal'` 或 `sidebar://terminal[/…]` 地址；当前面板优先、再扫其余
**停靠**面板，浮窗不参与；面板内优先当前激活的那个）：**已有 → 只调公开的
`sidebarRight.focus(tabId)`**（`focus` 只改激活标签、**不动**展开态，故
`layout.expanded === false` 时补一步公开的 `toggleExpanded()`；`expanded` 读不到则不动），
**不重排、不置顶**（终端可能同时开着多个，热键不替用户决定顺序）；该终端若**本来就是
所在面板的当前标签、且右栏此刻已展开**（判据在补 `toggleExpanded()` 之前取），再补一次**元素级聚焦** `focusTerminalScreen(paneId)`——上游
`focus` 只聚焦「标签」，终端内容的 DOM 焦点由 TerminalBody 的
`[visible, state.writable]` effect 完成，而「终端本来就显示着」时该依赖不变、effect
不重跑，焦点仍留在原处（典型：对话输入框）。取元素是**有界**的：按 store 给出的
`paneId` 找 `[data-dockkit-pane="<paneId>"]`，再取其中的
`textarea.xterm-helper-textarea` 调 `focus({ preventScroll: true })`（dockkit 把面板
节点 id 原样写进属性；面板里同一时刻只渲染激活标签的 body；不遍历标签、不搜索全文档、
不合成事件、不点击）；找不到 / 抛错只是少这一步，标签聚焦与吞键不受影响。这是本插件
**唯一一处选择器查询**（见上文「动作触发路径」的元素级说明）。**没有 → 调公开的
`openTab('terminal')` 新建**（上游 `openContent` 恒先 `planSetExpanded(true)`，故这一条
自身就展开右栏；新终端由上游 `visible` 翻转时的自动聚焦接管，插件不代劳）。动作 id
`sidebarRight.terminal` 独立可覆盖。已知限制：`⌘/Ctrl+L` 是
浏览器「聚焦地址栏」的保留键，终端里 `Ctrl+L` 原本也是 shell 的清屏，都会被本插件抢走；
另：若 slots / 会话作用域绑定整条链路不可用则无从判重，会退化为每次按键新建一个终端
（与直接调上游 `openTab` 的行为一致），而「已有终端但 `focus` 面缺失 / 抛错」只 no-op、
绝不重复开终端。

**工作区浮窗 = ⌘/Ctrl+K**：属单修饰键这一档（`K` = Work-space 联想），语义是
「列表 → 选中 → 切换」——↑/↓ **只移动高亮**（不触发导航，
避免连按就连开多个空白会话），Enter / 点击行才调 `uiWorkspace.openWorkspace(workspaceId)`
（连接工作区：复用该工作区的空白会话、没有就新建一个再打开，与侧栏分组「＋」同一条
路径）；Esc 或同组合键关闭，浮窗内 `⌘/` 与速查表互切；列表取自 `workspaces.list` 快照的
**宿主顺序**（与侧栏分组顺序同源），初始高亮 = 当前会话所属工作区。动作 id
`workspace.pick` 独立可覆盖。

**近期对话浮窗 = ⌘/Ctrl+I**：与工作区浮窗同在单修饰键这一档（`I` = Input / 会话联想；
`⌘/Ctrl+I` 曾是「聚焦输入框」的旧键位，现由 `⌘/Ctrl+J` 承担），语义是
「列表 → 选中 → **打开会话**」——↑/↓ 在**整份列表上跨工作区分组**连续移动高亮
（越界 clamp、不循环，**不打开会话**，避免连按就连开一串），Enter / 点击行才调公开的
`uiWorkspace.openSession(sessionId)`（与侧栏点会话行、搜索结果行**同一条**上游调用：
`openSession` = `sessions.open(sessionId)` **加** `layout.selectPanel(null)`，故有全局主面板
占着主区时也会切回对话视图）；`uiWorkspace` 缺席 / 无 `openSession` 时回退
`sessions.open(sessionId)`。两个动词都必须以**方法**形式调用——它们是上游类实例的
原型方法（`sessions.open` 内部读 `this.manager`），摘下来（`const open = …; open(id)`）
会丢 `this` 抛错并让 Enter 静默变成 no-op。Esc 或同组合键关闭，浮窗内 `⌘/` 与速查表互切。
列表规则（`src/recent-sessions.ts`，
每次打开现取，**不新增服务注入**——复用 `sessions` / `workspaces` / `uiSession` /
`uiWorkspace`）：
① **分组** = `workspaces.list` 快照的**宿主顺序**（与侧栏工作区分组同源），无归属会话
落在末尾的**无标题组**，`workspaces` 缺席 / 快照缺 `items` 时全部会话落入该组（仍是可用
列表，不假装没有会话）；② **组内顺序** = **最近更新在前**（`updatedAt` 降序、id 升序
决胜，来源是 `src/session-order.ts` 的 `compareRecency`，即 `orderBy === 'updated'` 的
默认轴；侧栏切到 `manual` 手动排序时本浮窗仍按最近更新排）；③ **可见性** =
`session-order.ts` 的 `sessionVisible`，逐字复刻上游 `sessionVisible` 的行规则
（排除 `origin === 'subagent'`、归档行、非当前空白行）**再加一条本插件的产品选择**
（`keepBlank = false`）：连**当前**空白会话也一并裁掉——空白会话是「新会话」的占位行、
不是对话（侧栏顺序不传 `keepBlank`，仍按上游语义保留当前空白行，故两个动作互不影响）；
④ **行** = 会话 `displayTitle`（上游投影：durable 标题 → 目录末段 → 会话 id，恒非空；
缺失时回退 `title` / 会话 id）+ 状态标记（**待回应** → **运行中** → **完成**，三选一）
+ `当前` 标记，次行 = 会话 `cwd`（与主标签相同时省略）；⑤ **条数上限 = 最近交互的
10 个（全局口径）**：全部可见会话先按最近更新取前 10 个、**再**按工作区分组渲染，故列表
恒不超过 10 行、某个工作区可能整组不出现（不留空标题）；当前会话另有**强制纳入**——它不在
前 10 名时顶掉第 10 名，保证「初始光标落在当前会话」有落点；配套地，该面板带
`dsh-kbd-panel--recent` 修饰类、`max-height` 由 `64vh` 抬到 `calc(88vh - 24px)`，让 10 行 +
组标题 + 页眉/页脚整屏可见（面板高度仍是内容尺寸；超过视口可用高度才内部滚动）；⑥ **初始高亮** = 当前会话所在行
（当前是空白会话 / 无 `current` / 当前会话被过滤掉时落在首行）。**无降级**：`sessions`
缺席 / 快照缺 `ids` → 空态浮窗（Enter 不消费，由模态吞掉）；`open` 缺失或抛错（未知 id）
→ 确认时 no-op、浮窗照关；**不回退 DOM**。动作 id `session.recent` 独立可覆盖。
已知限制：`Ctrl+I` 是 contenteditable 里浏览器默认的「斜体」键，会被本插件
`preventDefault` 抢走（需要斜体请用编辑器自带的格式入口，或用 localStorage 改绑）。

**模型浮窗 = ⌘/Ctrl+M**：与工作区浮窗同在单修饰键这一档（`M` = Model 联想），语义与
工作区浮窗同形（列表 → 选中 → 提交），而**取数与提交
都与两个上游入口同源**——`ctx.modelDirectories` 的 per-session 目录实例正是 `/model`
弹层与 composer 模型座位共用的那一份，所以浮窗里切换后 composer 的模型标签同步变化，
反之亦然。

**聚焦输入框 = ⌘/Ctrl+J**：属单修饰键这一档（`J` = Jump「焦点跳转」，取代旧的
`⌘/Ctrl+I`），因此 `mod+alt` 档只剩方向键轴（右栏标签 `←`/`→`、活跃会话 `↑`/`↓`）。
该动作**只放行 `browse` 与「焦点不在 composer 内的 `editing`」**：「焦点在可编辑元素里」
不等于「焦点在 composer 里」——右侧栏终端（xterm 的隐藏 `.xterm-helper-textarea`）与
Monaco（`.inputarea` textarea）都是真实 `<textarea>`，同样落入 `editing`，而那里的意图
恰恰是跳回输入框。故 `editing` 态加一道**元素级门闸**（`isComposerTarget`，与 `⇧Tab`
同一取元素链路、判定方向相反）：焦点**不在** composer 内时执行聚焦；焦点已在 composer 内
时不重复聚焦，但组合键**仍被吞掉**（旧键位 `I` 的放行是为保住斜体默认键，`J` 无等价
默认行为，放行只会触发 Win/Linux 浏览器的下载页）。代价是终端里的 `⌃J`（= 0x0A，
LF；readline 的 newline，与 `Enter` 同义）不再送给 PTY（裸 `Enter` 仍可）。取元素仍是
服务链路（`conversation.input.for` → `shell.editor.getRootElement()`
→ `focus({preventScroll:true})`，`for` 缺席回退 `InputHub.shell(id)`），无降级。
动作 id `composer.focus` 独立可覆盖；旧键位 `⌘/Ctrl+I` 已改由近期对话浮窗占用，
改绑回它需先把 `session.recent` 挪走。

**思考强度循环 = ⇧Tab**：上游把强度档收在「模型菜单 → Effort」二级面板里、**没有默认
键位**，而「在模型上按 Tab 循环档位」是既有习惯；候选档与当前档都逐字复刻上游 composer
座位的 `effortChoices` / `effectiveEffort`。它只放行 `browse` / `editing`，且 `editing`
态多一道**元素级门闸**（`contains` 焦点是否在 composer 内）——⇧Tab 是文本编辑的核心键
（反向移动焦点 / Monaco 反向缩进），不能全局抢。两个动作 id（`model.pick` /
`model.effortNext`）各自独立可覆盖。

取数入口与已知限制：服务路径读 `uiSession.pendingInteractions.getSnapshot()`（公开面；
`pendingSnapshot` 为同源私有字段，仅作兼容回退）；审批为**固定单键** `Enter`（允许）/
`Esc`（拒绝），当前会话有待审批卡片时不受焦点位置影响（审批卡片自身无输入框），
无审批卡片时 `Esc` 继续走 `session.stop`；通用问答的草稿以**卡片自身的 slot store**
为唯一真源（注册项 → `uiSession.resolve(sessionId)` → `slots.resolveStore`），卡片实时
高亮、与鼠标点选可自由混用，**翻题入口是 `←`/`→` 与 `Enter`**（数字键选中后不跳题；
`Enter` 保留非末题推进、末题仅在全部题目完成后结算，未完成即 no-op 且不跳回），焦点在
卡片自定义输入框时数字键 / `←` `→` / `Enter` 不接管（交回卡片，`←` `→` 用于移动光标）
——详见 `dsh-kbd-hotkeys/README.md`「服务化后的已知限制」与 `src/question-drafts.ts`。

验证：`node test-services.mjs`（最小 DOM 桩不提供任何卡片，断言服务路径与草稿 store
写入，含数字键不翻题、`←`/`→` 只改题号、首末题不循环、Enter 非末题推进 / 末题未完成不
结算；左右栏开关（`⌘/Ctrl+B` / `⌘/Ctrl+O`）分别打各自服务、互不串场、自定义键位与无降级；
右栏标签切换、右栏当前标签关闭（`⌘/Ctrl+.`：现场取当前面板当前标签、调 `sidebarRight.close`、
关完回读布局确认消失——上游拒关独占 guide 时 no-op 不吞键）与文件浏览器
定位 / 置顶的取数入口与边界；⌘/Ctrl+L 终端定位（terminal 是 `multiple` 页、上游每次 `openTab`
都铸带 UUID 的 contentId ⇒ 认页靠插件读 store 的布局：已有则只调 `focus`、不重复 `openTab`、
不重排，折叠时补 `toggleExpanded`；没有才 `openTab('terminal')`；各层不可用 / 抛错一律 no-op
不吞键且不退化成再开一个；元素级聚焦注入假面板观察——终端本来就是所在面板当前标签时按
store 的 paneId 聚焦其中的 `textarea.xterm-helper-textarea`、分屏只碰终端所在面板、终端不是
当前标签时不代劳、面板里没有 xterm 或 focus 抛错只是少这一步）；⌘/Ctrl+N 新建会话（必须调 `uiWorkspace.startSession`、三态放行、
服务缺席 / 无 `startSession` / 抛错 no-op 不吞键）；⌘/Ctrl+J 聚焦输入框（J = Jump）的取数链路
（`browse` 恒可用；`editing` 只在焦点**不在** composer 内时执行聚焦——右栏终端 / Monaco 的
隐藏 textarea 属于这一类——焦点已在 composer 内时不重复聚焦但组合键仍被吞掉）；
工作区浮窗与模型浮窗的列表
顺序、高亮 clamp、确认路径与空态；⌘/Ctrl+I 近期对话浮窗（按 workspaces 宿主顺序分组、
组内最近更新在前、blank / 归档 / 子代理不列出、无归属落末尾无标题组、**全局最多 10 行**
（13 个可见会话只渲染 10 行、blank 不占名额、当前会话不在前 10 名时强制纳入并顶掉第 10 名）、
面板高度（近期对话面板带 `dsh-kbd-panel--recent` 修饰类、`max-height` 由 64vh 抬到
`calc(88vh - 24px)`，工作区浮窗不带该修饰类）、
↑↓ 跨组移动高亮
且不打开会话、Enter/点击才打开会话（桩里的 `open` / `openSession` 都写成读 `this` 的
类方法形态：有 `uiWorkspace.openSession` 时优先走它、无该方法或抛错则回退 `sessions.open`；
把方法摘下来调用会丢 `this` 并让这些断言 FAIL）、空态与 `sessions` 缺席 / 缺 ids / `open`
缺失或抛错 / `workspaces` 缺席的各自边界）；`⇧Tab` 的候选档与编辑态门闸）与
`node test-dispatch.mjs`（会话跳转分发：按侧栏顺序，覆盖分组 / flat / 权威来源不可用时
no-op——**无降级**）。

## 注意事项与常见问题

1. 本仓库采用黑名单式 `.gitignore`，插件目录默认受版本控制；仅当某插件 `lib/` 或
   其他目录为不入仓的构建产物时，才需在其 `.gitignore` 单独追加忽略项（当前没有插件需要）。
2. 插件变更未生效时应首先排查：浏览器半部是否已重新构建；宿主半部 / 组合是否已重启。
3. 浏览器半部未声明所需依赖（如 `slots`）即 apply → `ctx.get(...)` 返回 `undefined`，
   导致 Web 启动失败 / HARNESS 面板报 failed to apply loader entry；判空须使用
   `=== null || === undefined` 双重判断。
4. Node 宿主 TypeScript（Type Stripping 直载者）仅使用可擦除语法
   （`erasableSyntaxOnly`）。
5. 浏览器 bundle 仅将框架依赖（如 `react`）设为 external，业务模块全部内联。
6. 向 `~/.dsh/` 写入文件需 danger-full-access 沙箱授权；系统提示声明
   approval=never 时不得设置 `sandbox_permissions`。
7. 插件改动未生效时按此顺序排查：①浏览器半部是否已 `npm run build`（产物 mtime 变化后
   client-hmr 会在 500ms 内热推送，页面无需重启/刷新）；②宿主半部（`index.ts` /
   `host/*`）或组合变更是否重启了 App；③产物是否被手改覆盖（`lib/client.js` 禁手改）。
8. 交付后自行加载插件（修改 Profile、`pnpm install`、重启 App）违反强制规范第 1 条；
   加载由用户执行，代理仅交付代码与加载说明。
9. 新增插件若浏览器半部为手写 JavaScript、未提供 `build` 脚本，即违反强制规范第 2 条；
   浏览器不支持 Type Stripping，TypeScript 源码必须经构建产出 `lib/client.js` 才能加载。
10. **上游服务方法必须以「方法」形式调用，不得把方法摘下来单独调用**：`ctx.get(...)`
   返回的都是类实例（`ClientSessions.open` 内部读 `this.manager`、
   `UiWorkspaceService.openSession` 读 `this.sessions` / `this.ctx.layout` 等），类方法
   体是严格模式——`const open = services.sessions.open; open(id)` 里 `this === undefined`，
   会抛 `TypeError` 并被调用方的 `catch` 静默吞掉，表现为「快捷键毫无反应」。
   需要保存引用时用 `fn.call(owner, …)`（本仓库既有写法：
   `sidebar-tabs.ts` 的 `placeTab.call(actions, …)` / `toggle.call(sidebarRight)`、
   `model-picker.ts` 的 `fn.call(sessions, …)`、`question-drafts.ts` 的
   `replace.call(store.actions, …)`）。纯 DOM / 纯闭包对象（`getSnapshot` 等）不受影响。
   诊断脚本里的桩也要写成读 `this` 的类方法形态，否则回归测不出来。

## 文档索引

| 路径 | 内容 |
| --- | --- |
| `AGENTS.md`（本文档） | 仓库工程规范总纲：插件清单、包结构与挂载、生效机制、构建与验证、slot store 取数范式、`dsh-kbd-hotkeys` 动作路径与共性注意事项 |
| `README.md` | 仓库根说明：插件清单、安装 / 卸载 / 新增插件的用户操作 |
| 各插件 `README.md` | 该插件的功能说明、实现依据、已知限制、加载方式与构建说明（`dsh-fullwidth-chat` 暂无 README，功能见其 `package.json` 的 `description` 与本文档插件清单） |
