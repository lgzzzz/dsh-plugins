# AGENTS.md — DSH 本地插件工作区

本仓库是 DSH（DeepSeek Harness）Web 的本地持久化插件集合：每个插件目录都是一个独立、
自包含的本地 npm 包，经本机 web Profile 的 `link:` 依赖挂载进正在运行的应用。动态
Cordis 定义只存在于进程内存、重启即失效，需要长期保留的行为因此固化为仓库内的本地包。

本文档只记录**跨插件共性约定**；单个插件的功能、实现依据与已知限制见其目录内 `README.md`。

## 强制规范

1. **插件交付后，代理不得自行加载插件。** 不修改 `~/.dsh/profiles/web/package.json`
   （`dependencies` / `dsh.profile.bundles`）、不执行 `dsh plugin add` / `pnpm install`、
   不重启 App / `dsh web`。代理只交付代码、构建产物与加载说明，加载由用户执行。
2. **新增或重构插件一律使用 TypeScript，并提供构建与类型检查。** 浏览器半部写在
   `src/`（入口 `src/client.ts`），`package.json` 提供 `build`（产出 `lib/client.js`）
   与 `typecheck`；宿主半部写在 `index.ts`（Node 22 Type Stripping 直载，无需编译），
   同样能通过 `typecheck`。`lib/*.js` 是构建产物，不得手改。现有纯 JS 插件
   `dsh-fullwidth-chat` 保持现状。

## 仓库布局与版本控制

- 仓库根**不是「一个插件」**：没有集合包、没有根 `cordis.patch.yml`、不提供集合
  安装 / 卸载脚本。每个插件在 Profile 中是独立的 `link:` 依赖，经其自身的
  `cordis.patch.yml` 独立挂载。
- 版本控制采用**黑名单**：根 `.gitignore` 只忽略系统 / 编辑器文件（`.DS_Store`、
  `.idea/`）、包管理器缓存（`.pnpm-store/`、`.npm-cache/`、`node_modules/`）与
  TypeScript 增量缓存（`*.tsbuildinfo`）。新增插件目录默认即受版本控制。
- 构建产物默认**入仓**（当前所有 `lib/*.js`）；目前没有任何插件存在不入仓的构建产物。
- 各插件目录内可另有 `.gitignore`。

## 插件清单

仓库含 **10 个插件目录**。每个插件在 web Profile 中对应 **1 条 `link:` 依赖**与
**1 项 `dsh.profile.bundles`**（bundles 另含 2 个上游 bundle：`@deepseek-ai/dsh-base`、
`@deepseek-ai/dsh-web-app`）。

| 目录 | 形态 | 说明 |
| --- | --- | --- |
| `dsh-code-card-fonts` | Client only（TS；宿主占位） | 卡片标题 / 摘要行 / 展开内容 / 代码块 / 内联代码 / Markdown 表格单元格统一 14px，卡片间距 7px；**不覆盖**内容字号轴 `--dsh-content-font-size`，设置里的「字号大小」仍可调 |
| `dsh-desktop-notify` | Client only（TS；宿主占位；**唯一声明 external**） | 桌面通知：设置 →「通用」的开关行（`settings.general.item`）做授权 + 开关；订阅 `ctx.uiSession.sessionStatus`，页面不在前台时对顶层会话的「回合结束」（`running` true→false）与「等你处理」（`pendingInteraction` 出现 / 换 key）发系统通知；`react` 作 external（平台 seed 词），自声明 `src/react.d.ts` 切片 |
| `dsh-directory-picker-browse` | Patch only（无代码） | `disabled` 停用上游 `directory-picker`，`insert` 挂载 browse 变体；**不触碰** `ui-deliverables`（上游 turn-tail 产物面） |
| `dsh-fullwidth-chat` | Client only（纯 JS；宿主占位） | 对话列全宽展示 |
| `dsh-git-guard` | Host only（TS） | 敏感 git 操作一律 `ask`（需用户授权），不产生 `deny`；**完全权限（`danger-full-access`）下整体退出** |
| `dsh-header-action-order` | Client only（TS；宿主占位） | 会话标题栏图标顺序：改写 `conversation.session.header.actions` 各活注册项的 `options.order`（上游渲染端每帧按它排序，slot 无 reorder API），把 schedule / job-list 挪到最后；顺序是 `src/order.ts` 顶部常量，`slots.subscribe` 上重放，未列出 id 排在其后 |
| `dsh-kbd-hotkeys` | Client only（TS；宿主占位） | 全局快捷键，三态分发（`card` / `editing` / `browse`）；动作全部走服务面，唯一例外是终端定位的一处有界选择器查询 |
| `dsh-rightbar-fonts` | Client only（TS；宿主占位） | 右栏文件 / 文本 / 代码 / Markdown 预览与右栏「变更审阅」diff 跟随字号轴 `--dsh-content-font-size`（默认 14px，行高 22px + 增量）：上游这两处吃**固定 11px** 代码 token `--dsw-font-markdown-code-block`，插件只在容器内重指该 token，**不覆盖**字号轴 |
| `dsh-rightbar-tab-width` | Client only（TS；宿主占位） | 右栏 tab 胶囊定宽 100px（= 上游地板值，分栏判定与上游默认一致） |
| `dsh-sidebar-default-collapsed` | Client only（TS；宿主占位） | 左栏默认关闭：每次页面加载读活布局 store 后一次性 `layout.toggleSidebar()`（只写宽窗分支；窄窗上游本就收起）；判定标记在 `window` 上，跨 client-hmr 重建不重复插手 |

## 包结构与约定

```text
<workspace>/<package-name>/
├── package.json      # type=module；exports["."]→宿主入口、["./client"]→浏览器入口
├── index.ts          # 宿主半部（TypeScript，Node 22 Type Stripping 直接加载）
├── src/              # 浏览器半部源码（TypeScript，入口 src/client.ts）
├── scripts/          # 浏览器半部构建脚本（esbuild）
├── lib/client.js     # 浏览器半部构建产物（build 生成，禁止手改）
├── cordis.patch.yml  # Web 组合补丁：挂载行（insert / disabled）
└── README.md         # 功能、加载与构建说明
```

`package.json` 关键字段：

- `"type": "module"`；`exports` 分别映射 `"."`（宿主）与 `"./client"`（浏览器）；
- `dsh.client.platform: "web"` + `dsh.client.immediately: true`：据此注册进浏览器 roster；
- `dsh.bundle.patch: "./cordis.patch.yml"`：挂载行随 bundle 层应用；
- 宿主入口也可以是 `main`（如 `dsh-git-guard` 的 `"main": "index.ts"`）。

`cordis.patch.yml`：

- 每个插件都必须带 `insert` 挂载行；纯补丁插件可直接 `disabled` / `insert` 修改组合
  （见 `dsh-directory-picker-browse`）。
- 宿主半部依赖宿主服务时在该行声明 `inject`；当前没有插件需要（各挂载行均无 `inject`）。
- **宿主入口必须存在且可解析**：即使插件是纯浏览器半部（`dsh-code-card-fonts`、
  `dsh-rightbar-fonts`、`dsh-rightbar-tab-width`、`dsh-kbd-hotkeys`、
  `dsh-sidebar-default-collapsed`、`dsh-desktop-notify`、`dsh-header-action-order`），其
  `exports["."]` 指向的 `index.ts` 也必须是合法加载项（当前为空宿主 `apply() {}`）
  ——`dsh-client-modules` 靠扫描这些 Loader 条目发现声明了 `dsh.client.platform: "web"` 的包。
- 依赖注入：TS 宿主半部不在代码中静态 `export inject`，宿主服务由挂载行 `inject`
  声明；浏览器半部按需 `export const inject = [...]`（由模块加载器读取）。

宿主半部：TypeScript 写在 `index.ts`（需要时可拆成多文件），由 Node 22 Type Stripping
直接加载；相对导入须携带 `.ts` 扩展名；仅允许可擦除语法（不使用 enum、命名空间、参数
属性），由 `tsconfig.json` 的 `erasableSyntaxOnly` 强制。

浏览器半部：TypeScript 写在 `src/`，`scripts/` 用 esbuild 打包成经
`window.__ModuleLoader__.load({ id, factory })` 包装的单文件 `lib/client.js`（入仓）。
**浏览器运行时不支持 Type Stripping**：源码变更后必须重新构建，否则改动不生效。

- external 依赖按插件实际 import 配置（当前仅 `dsh-desktop-notify` 声明 `react`
  external：它是上游 ModuleLoader 的平台 seed 词，`window.__DSH_BOOT__` 引导的
  `staticModules` 含 `react` / `react/jsx-runtime`，故 `require('react')` 由工厂的
  `require` 命中宿主同一份实例，无需 Profile 侧声明 `dsh.client.external`）；
  `@deepseek-ai/*` 的客户端 import 均为 type-only，运行时服务一律经 `ctx.get(name)` 取用。
- `@types/react` 不在 dsh 内置 bundle 里：需要 react 的插件与 `dsh-client-ui-slots`
  等类型包同理，在源码里自声明结构切片（模板：`dsh-desktop-notify/src/react.d.ts`）。
- 两种构建流派（产物等价）：esbuild JS API（`dsh-code-card-fonts`）；
  直接执行平台二进制（`dsh-rightbar-fonts`、`dsh-rightbar-tab-width`、`dsh-kbd-hotkeys`、
  `dsh-sidebar-default-collapsed`、`dsh-desktop-notify`、`dsh-header-action-order`）——JS API 以 stdin/stdout 管道与子进程通信，受限
  沙箱下 `spawn` 报 `EPERM`。

## 挂载与激活（Web Profile）

`~/.dsh/profiles/web/package.json`：

- `dependencies` 以 `link:<仓库根>/<name>` 指向仓库内各插件，与插件目录一一对应；
- `dsh.profile.bundles` = 2 个上游 bundle + 每个本地插件一项；
- `dsh.profile.patchReload: live`：仅热重载 Profile 自身的 `cordis.patch.yml`；bundle
  层为常驻挂载，不支持热重载。

核对仓库与 Profile 是否一致：

```powershell
Get-Content "$env:USERPROFILE\.dsh\profiles\web\package.json"       # dependencies / dsh.profile.bundles
Get-ChildItem "$env:USERPROFILE\.dsh\profiles\web\node_modules" |
  Select-Object Name, LinkType, Target                             # Junction 是否存在、指向是否有效
```

挂载（用户操作；`dsh plugin` 是 pnpm 转发器，执行 `pnpm add` 后自动把声明了
`dsh.bundle` 的依赖并入 `dsh.profile.bundles`，无需手改清单）：

```sh
cd <仓库根>/<name> && dsh plugin --profile web add link:.   # 或在任意目录用绝对路径
# 重启 App 生效
```

卸载：`dsh plugin --profile web remove <name>`（同样由用户执行）。

> `link:` 依赖已存在时重复执行是幂等 no-op；`link:` 实时指向仓库目录，之后修改插件代码
> 无需重装。
>
> **从仓库删除插件目录时，Profile 侧的 `link:` 依赖与 bundle 项不会自动消失**：残留的
> `link:` 指向已不存在的目录，下次启动会解析失败。须先由用户执行
> `dsh plugin --profile web remove <name>` 再重启 App。

## 变更生效机制

1. **浏览器半部（`lib/client.js`）重新构建后自动热加载**：`dsh-client-hmr` 行在 Web
   组合里无条件挂载，其 node 半部每 500ms stat 轮询每个插件产物的 mtime/size，变化即
   重新哈希、重发图并沿 `/plugins/events` SSE 广播 `rebuilt` 帧，浏览器半部做 fiber
   替换——**无需重启、无需刷新**（只要页面处于打开状态）。因此「改了插件看不到效果」
   首先要确认 `npm run build` 是否真的跑过、产物是否已落盘。
2. **宿主半部（`index.ts` / `host/*` / 组合变更）仍需重启 App**：宿主行由 Loader 常驻
   挂载，`patchReload: live` 只覆盖 Profile 自身的 `cordis.patch.yml`；bundle 层（含各
   插件的 `cordis.patch.yml`）不支持热重载。若代理自身运行于 dsh web 进程内，重启会终止
   当前会话，应先交付说明、再由用户触发。
3. 状态验证（读取宿主**当前公告**的插件图；单个 `/plugins/<name>/client.js` 不在公告
   组合内会 404）：

```bash
curl -s -N --max-time 3 http://127.0.0.1:3080/plugins/events | head -c 2000   # 首帧含 graph(各行 id/rev/url)
```

## 构建与验证

| 插件 | 命令 | 说明 |
| --- | --- | --- |
| `dsh-code-card-fonts` | `npm run typecheck && npm run build && npm run check` | esbuild（JS API）→ `lib/client.js`；`check` 对产物与宿主执行 `node --check` |
| `dsh-desktop-notify` | `npm run typecheck && npm run build && npm run check`；`node test-notify.mjs` | esbuild（平台二进制，`--external:react`）→ `lib/client.js`；诊断脚本纯 Node：判定器 / 开关 store / 订阅运行时与发送侧分支，并用 `__ModuleLoader__` 桩载入产物校验装配与「后台回合结束 → 发通知」 |
| `dsh-directory-picker-browse` | 无 | 纯补丁插件，无源码与产物 |
| `dsh-fullwidth-chat` | 无 | 纯 JS 插件，`lib/*.js` 即源码 |
| `dsh-git-guard` | `npm run typecheck`；`node test.mjs` | `test.mjs` 以 Type Stripping 运行时验证 ask / 放行各分支、完全权限放行、权限逐会话生效、服务缺席 / 抛错的失败关闭、提示词区段的动态求值 |
| `dsh-header-action-order` | `npm run typecheck && npm run build && npm run check`；`node test-order.mjs` | esbuild（平台二进制，无 external）→ `lib/client.js`；`test-order.mjs` 纯 Node、无需浏览器：A 直载 `src/order.ts` 校验纯计划（重排 / 幂等 / 未列出项 / 无 id / 重复表项），B 以类方法形态的 slots 桩驱动 `src/client.ts` 的 `apply`（渲染序、后到注册重放、冻结写入单条放弃、`entries` 抛错不炸），C 用 `__ModuleLoader__` 桩载入产物校验装配 |
| `dsh-kbd-hotkeys` | `npm run typecheck && npm run build && npm run check`；`node test-services.mjs`；`node test-order.mjs`；`node test-dispatch.mjs` | esbuild（平台二进制）→ `lib/client.js`；三个诊断脚本均为纯 Node、无需浏览器：`test-services` 是入口（共享桩件 / 夹具在 `test/harness.mjs`：最小 DOM 桩 + `__ModuleLoader__` 载入产物），用例按被测功能拆在 `test/*.mjs`（审批与问答、左右栏、新建会话、聚焦输入框、右栏标签 / 关闭 / 全屏 / 文件 / 终端 / diff 分栏与自动换行、三个浮窗），由入口按序载入并统一汇总，单个文件也可直跑；`test-dispatch` 同样用最小 DOM 桩 + `__ModuleLoader__` 载入产物；`test-order` 以 Type Stripping 直载 `src/*.ts` 校验 0.1.7 子代理枚举（`origin === 'subagent'` 判据，fork 不递归取消）与侧栏顺序复刻（含缺摘要成员剔除、近期对话浮窗恒不列出归档行） |
| `dsh-rightbar-fonts` | `npm run typecheck && npm run build && npm run check` | esbuild（平台二进制）→ `lib/client.js`；纯样式补丁，无行为测试 |
| `dsh-rightbar-tab-width` | `npm run typecheck && npm run build && npm run check` | esbuild（平台二进制）→ `lib/client.js` |
| `dsh-sidebar-default-collapsed` | `npm run typecheck && npm run build && npm run check`；`node test-boot.mjs` | esbuild（平台二进制）→ `lib/client.js`；`test-boot.mjs` 以 Type Stripping 直载 `src/boot-collapse.ts` 校验全部判定分支，并用 `__ModuleLoader__` 桩载入产物校验包名 / `inject` / `apply` 装配（纯 Node，无需浏览器） |

`node_modules` 可能被清理；安装 typescript 等依赖时若默认 npm 缓存不可用，应指定可写
缓存目录（`npm_config_cache=<writable-dir>`）或使用仓库根的 `.pnpm-store`。

## 类型解析约定

- `@deepseek-ai/*` 为预发布包，不经 registry 安装；插件的 `node_modules/@deepseek-ai`
  是指向全局 dsh 包内置 bundled scope 的 junction / 符号链接
  （`<npm root>/@deepseek-ai/dsh/node_modules/@deepseek-ai`，含 `lib/types` 声明）。
  重装或迁移全局 dsh 包后须重建该 junction。
- `node_modules` 被清理后 `npm install` 会因 npm 的 reify 试图写穿该 junction 而失败
  （`EPERM`）；此时类型检查直接用全局 `tsc --noEmit -p tsconfig.json`，行为测试只需
  Node 运行时、不依赖 `node_modules`。
- 部分类型包（`dsh-client-ui-slots`、`dsh-client-ui-primitives`）不在内置 bundle 中，
  故启用 `skipLibCheck`，并在源码中自行声明结构切片类型（模板：
  `dsh-kbd-hotkeys/src/types.ts`、`dsh-sidebar-default-collapsed/src/types.ts`，仅覆盖
  实际消费的字段，以上游 `lib` 源码为准）。
- 宿主 TypeScript 中 `import type` 在 Type Stripping 下被擦除，运行时无 cordis 依赖；
  `devDependencies` 仅供语言服务器与类型检查使用。

## 上游源码定位

- DSH 实现 checkout：全局 npm 安装目录下的 `@deepseek-ai/dsh`（`npm root -g` 定位）。
- 内置 UI / 服务包：`<dsh>/node_modules/@deepseek-ai/dsh-client-ui-*` 等，通过其
  `lib/client.js` 核实 DOM 结构与服务接口。编写选择器或接口前须以源码为准。

## 无服务面 UI 状态的取数范式（slot store）

有些 UI 状态上游没有 cordis 服务方法，只存在于某个 slot 注册项挂载的 per-session
store 上。三步取数（本仓库已在用：问答卡片草稿 `dsh-kbd-hotkeys/src/question-drafts.ts`、
侧栏视图顺序 `src/sidebar-order.ts`、右栏标签顺序 `src/sidebar-tabs.ts`）：

1. `slots.entries('<slot 名>')` → 该 slot 的注册项；带 `store` 字段的那一项即目标
   store handle；
2. 会话作用域绑定（0.1.6-alpha.2 起 `uiSession.resolve(sessionId)` 已删除）：先
   `sessions.binding(sessionId)` 取该会话的 SessionBinding，再
   `uiSession.bindingSource({ sessionId, binding })` → `getSnapshot()` 得已物化的绑定
   `{ key, ctx, hooks, keyedHooks, props }`（上游只校验 `reference.binding` 与
   `sessions.binding(sessionId)` 同一，缺席投影的 `key` 为 undefined）；root 作用域
   直接传 `undefined`。模板：`dsh-kbd-hotkeys/src/scope-binding.ts`；
3. `slots.resolveStore(handle, binding)` → 活实例：`getSnapshot()` / `actions` / `subscribe`。

渲染端拿到的 `useStore` / `actions` 来自同一句 `resolveStore(...)`，因此外部写入与鼠标
操作共用同一份内存态。**无降级**：任一环不可用即 no-op，不得回退到 DOM 点击。

## 注意事项与常见问题

1. 本仓库采用黑名单式 `.gitignore`，插件目录默认受版本控制；仅当某插件有**不入仓**的
   构建产物时才需单独追加忽略项（当前没有插件需要）。
2. 浏览器半部未声明所需依赖即 apply → `ctx.get(...)` 返回 `undefined`，导致 Web 启动
   失败 / 面板报 failed to apply loader entry；判空须用 `=== null || === undefined`。
3. Node 宿主 TypeScript 仅使用可擦除语法（`erasableSyntaxOnly`）。
4. 浏览器 bundle 仅把框架依赖（如 `react`）设为 external，业务模块全部内联。
5. 向 `~/.dsh/` 写入文件需 danger-full-access 沙箱授权；系统提示声明 `approval=never`
   时不得设置 `sandbox_permissions`。
6. 插件改动未生效时按序排查：①浏览器半部是否已 `npm run build`（产物 mtime 变化后
   client-hmr 会在 500ms 内热推送）；②宿主半部 / 组合变更是否重启了 App；③产物是否被
   手改覆盖（`lib/client.js` 禁手改）。
7. 交付后自行加载插件（改 Profile、`pnpm install`、重启 App）违反强制规范第 1 条。
8. 新增插件若不提供 `build` / `typecheck`、或浏览器半部为手写 JavaScript，违反强制规范
   第 2 条（浏览器不支持 Type Stripping，必须经构建产出 `lib/client.js`）。
9. **上游服务方法必须以「方法」形式调用**：`ctx.get(...)` 返回类实例，摘下来调用会丢
   `this` 抛错、并被 `catch` 静默吞掉（表现为「快捷键毫无反应」）。需要保存引用时用
   `fn.call(owner, …)`；纯 DOM / 闭包对象（`getSnapshot` 等）不受影响。诊断脚本里的桩
   也要写成读 `this` 的类方法形态，否则回归测不出来。

## 文档索引

| 路径 | 内容 |
| --- | --- |
| `AGENTS.md`（本文档） | 仓库工程规范总纲：插件清单、包结构与挂载、生效机制、构建与验证、取数范式、共性注意事项 |
| `README.md` | 仓库根说明：插件清单、安装 / 卸载 / 新增插件的用户操作 |
| 各插件 `README.md` | 该插件的功能、关键实现依据、已知限制、加载与构建说明 |
