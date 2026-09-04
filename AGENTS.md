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
   无需编译），但须提供 `typecheck` 脚本。例外：`dsh-change-summary` 的宿主半部位于
   `src/index.ts`，经 `tsc` 编译为 `lib/index.js` 后加载（非 Type Stripping 直载），
   改动其宿主源码须重新 `npm run build`。现有纯 JavaScript 插件（`dsh-fullwidth-chat`、
   `dsh-new-session`）为历史遗留，维持现状；新增或重构插件
   一律适用本条规范。

## 仓库概述

本仓库为 DSH（DeepSeek Harness）Web 的本地持久化插件集合。动态 Cordis 定义仅存在于
进程内存、重启即失效，因此将需长期保留的插件固化为仓库内的本地 npm 包，经 Web
Profile 的 `link:` 依赖挂载至运行中的应用。当前 7 个插件（含 `dsh-change-summary`）
均已挂载；`dsh-kbd-nav-focus` 已从仓库移除（提交 6499dd9），仅存于历史。

- 版本控制采用黑名单：`.gitignore` 默认放行全部内容，仅忽略系统/编辑器文件
  （`.DS_Store`、`.idea/`）、包管理器缓存（`.pnpm-store/`、`.npm-cache/`、
  `node_modules/`）、TypeScript 增量缓存（`*.tsbuildinfo`）与特定构建产物
  （`dsh-change-summary/lib/`）。
  新增插件目录默认即受版本控制，无需额外配置；若其 `lib/` 为不入仓的构建产物，
  需在 `.gitignore` 单独追加忽略项。
- 优先查阅各插件的 `README.md` 获取加载与构建信息，本文档仅描述共性约定。

## 插件清单

| 目录 | 形态 | 宿主半部 | 浏览器半部 | 构建 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `dsh-text-editor` | Host + Client（TS） | `index.ts`（Type Stripping）+ `host/`，三条路由 | `src/` → esbuild → `lib/client.js` | `npm run typecheck && npm run build && npm run check` | Monaco 应用内编辑器；提供 `openFile`/`showDiff` 能力 |
| `dsh-change-summary` | Host + Client（TS） | `src/index.ts`（经 tsc 编译为 `lib/index.js` 加载，非直载），`/diff` + `/exists` 路由 | `src/client/` → tsc×2 + tsdown → `lib/` | `npm run build / typecheck / verify` | 回合结束汇总改动文件与 git 差异。`lib/` 不入仓（重装前须先构建） |
| `dsh-git-guard` | Host only（TS） | `index.ts`，钩挂 `tools/pre-execute` | — | `npm run typecheck`；`node test.mjs` | 拦截 `git push`（deny）/ `git commit`（ask） |
| `dsh-new-session` | Host + Client（纯 JS） | `lib/index.js`：注册 `/new` 命令 | `lib/client.js`：`uiWorkspace.startSession` + Esc 停止 | 无 | `/new` 新建会话命令 |
| `dsh-fullwidth-chat` | Client only（纯 JS） | `lib/index.js`（空宿主） | `lib/client.js`：注入样式 | 无 | 对话列全宽展示 |
| `dsh-code-card-fonts` | Client only（TS） | `index.ts`（空宿主） | `src/` → esbuild → `lib/client.js` | `npm run typecheck && npm run build && npm run check` | 卡片标题/摘要行/展开内容与代码块字号补丁 |
| `dsh-directory-picker-browse` | Patch only | 无 | 无 | 无 | `cordis.patch.yml` 覆盖层：停用 auto 目录选择器与产物行，挂载 browse 变体 |
| `dsh-kbd-hotkeys` | Host + Client（TS） | `index.ts`（空宿主） | `src/`（client.ts + config/actions/overlay/types）→ esbuild → `lib/client.js` | `npm run typecheck && npm run build && npm run check` | 全局快捷键（三态分发）：审批/问答键盘化、会话切换、对话滚动、复制、⌘K 命令面板与 ⌘/ 速查表；设计文档 `docs/dsh-hotkeys-proposal.md`（尚未挂载，加载见其 README） |

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
- 宿主半部依赖宿主服务时，在该行声明 `inject`，例如：
  - `dsh-text-editor`：`inject: [webServer, fs]`
  - `dsh-change-summary`：`inject: [webServer, sessions]`
- 依赖注入：TS 宿主半部不在代码中静态 `export inject`，宿主服务改由挂载行 `inject`
  声明（见上两例）；浏览器半部则按需 `export const inject = [...]`（由模块加载器
  读取注入，如 `dsh-text-editor`：`['slots','sessions']`、`dsh-change-summary`：
  `['slots','locale','uiConversation','dsh-text-editor','sessions']`），不消费服务的
  客户端（纯样式补丁 `dsh-code-card-fonts`）无需声明。遗留纯 JS 宿主
  （`dsh-new-session` 的 `lib/index.js`）维持现状：仍在代码中
  `export inject = ['commands']`。

宿主半部：以 TypeScript 编写 `index.ts`（可拆分多文件，如 `dsh-text-editor` 的
`host/`），由 Node 22 Type Stripping 直接加载，无需编译；相对导入须携带 `.ts`
扩展名；仅允许可擦除语法（不使用 enum、命名空间、参数属性），`tsconfig.json` 以
`erasableSyntaxOnly` 强制约束。最小示例：`dsh-git-guard`（单文件）。例外：
`dsh-change-summary` 的宿主半部位于 `src/`（`index.ts` + `git.ts`），经 `tsc`
编译为 `lib/index.js` 后加载（其 `lib/` 不入仓，加载细节见「挂载与激活」说明）。
遗留的纯 JavaScript 宿主（`dsh-fullwidth-chat`、`dsh-new-session`
的 `lib/index.js`）维持现状，不要求迁移。

浏览器半部：以 TypeScript 编写，`src/` 为源码（入口 `src/client.ts`），`scripts/`
提供构建脚本（esbuild / tsc / tsdown 均可，参照现有插件），产物为经
`window.__ModuleLoader__.load({...})` 包装的 `lib/client.js`。可参照的工程模板：

- `dsh-text-editor`：`src/` → esbuild 单文件 → `lib/client.js`（入仓）。
- `dsh-change-summary`：`src/` → tsc×2 + tsdown → `lib/`（不入仓，`.gitignore` 排除）。
- 遗留纯 JavaScript 浏览器半部（`dsh-fullwidth-chat`、
  `dsh-new-session` 的 `lib/client.js`）维持现状，不要求迁移。
- 浏览器运行时不支持 Type Stripping：`lib/client.js` 为构建产物、禁止手改；源码变更
  后必须重新构建，未重新构建是插件改动未生效的最常见原因。产物通常入仓
  （`dsh-change-summary` 除外），以保证离线可加载。
- bundle 的 external 依赖按各插件实际 import 配置（由框架注入、不打包进产物）：
  `dsh-text-editor` 仅 `react`（`package.json` 的 `dsh.client.external`）；
  `dsh-change-summary` 为 `react` + `react/jsx-runtime`（tsdown `neverBundle`）；
  `dsh-code-card-fonts` 无 external（不消费 react）。客户端源码中的
  `@deepseek-ai/*` import 均为 type-only、编译时擦除；业务模块全部内联。

## 挂载与激活（Web Profile）

`~/.dsh/profiles/web/package.json` 当前配置：

- `dependencies` 以 `link:<仓库根>/<name>` 指向仓库内各插件（当前 7 个：
  change-summary / code-card-fonts / directory-picker-browse / fullwidth-chat /
  git-guard / new-session / text-editor）；
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

说明：`dsh-change-summary` 已挂载进 Profile 的 `dependencies` / `bundles`
（`inject: [webServer, sessions]`）。其 `lib/` 不入仓，重装 / 迁移全局环境后须先在
插件目录内 `npm install && npm run build` 生成 `lib/index.js` 与 `lib/client.js`，
否则该插件加载失败。

## 变更生效机制

1. 插件代码变更后需重启 App 生效。若代理自身运行于 dsh web 进程内，重启将
   终止当前会话，应先交付说明，再由用户触发重启（或使用脱离当前会话的
   延迟重启方式）。
2. 例外情形：`dsh-text-editor` 的浏览器 bundle 由 `/plugins/dsh-text-editor/client.js`
   路由实时读取磁盘——仅修改其 `src/` 并执行 `npm run build` 后，强制刷新页面
   （Cmd/Ctrl+Shift+R）即生效；其宿主部分（`index.ts` / `host/*.ts`）变更仍需重启。
3. 状态验证（确认服务在监听、插件路由可访问）：

```bash
curl -s -o /dev/null -w "%{http_code} %{size_download}B\n" \
  http://127.0.0.1:3080/plugins/<name>/client.js
```

## 构建与验证

| 插件 | 命令 | 说明 |
| --- | --- | --- |
| `dsh-text-editor` | `npm run typecheck && npm run build && npm run check` | esbuild → `lib/client.js`；`check` 对产物执行 `node --check` 并校验宿主语法 |
| `dsh-change-summary` | `npm run build / typecheck / verify` | tsc（host + client）+ tsdown；`verify` 为离线冒烟测试 |
| `dsh-git-guard` | `npm run typecheck`；`node test.mjs` | `test.mjs` 以 Type Stripping 运行时验证 deny/ask/放行各分支 |
| `dsh-code-card-fonts` | `npm run typecheck && npm run build && npm run check` | esbuild → `lib/client.js`（入仓）；`check` 对产物与宿主执行 `node --check` |
| `dsh-kbd-hotkeys` | `npm run typecheck && npm run build && npm run check` | esbuild → `lib/client.js`（入仓）；`check` 对产物与宿主执行 `node --check` |
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
  `dsh-change-summary/src/client/`，见其 README「Type resolution」）。
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
   （`erasableSyntaxOnly`）；经 `tsc` 编译加载的宿主（`dsh-change-summary`）不受此限。
5. 浏览器 bundle 仅将框架依赖（react 等）设为 external，业务模块全部内联。
6. 向 `~/.dsh/` 写入文件需 danger-full-access 沙箱授权；系统提示声明
   approval=never 时不得设置 `sandbox_permissions`。
7. 常驻挂载不支持热重载，查看效果须重启 App（`dsh-text-editor` 浏览器半部除外）。
8. 交付后自行加载插件（修改 Profile、`pnpm install`、重启 App）违反强制规范第 1 条；
   加载由用户执行，代理仅交付代码与加载说明。
9. 新插件浏览器半部采用手写 JavaScript、未提供 `build` 脚本，违反强制规范第 2 条；
   浏览器不支持 Type Stripping，TypeScript 源码必须经构建产出 `lib/client.js` 才能加载。

## 文档索引

| 路径 | 内容 |
| --- | --- |
| `AGENTS.md`（本文档） | 仓库工程规范总纲：插件清单、挂载与激活、生效机制、共性约定与注意事项 |
| 各插件 `README.md` | 功能说明、加载方式与构建说明（`dsh-text-editor` 与 `dsh-fullwidth-chat` 暂无 README，功能见 `package.json` 的 `description` 与本文档插件清单） |