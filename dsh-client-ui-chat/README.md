# dsh-client-ui-chat

内置 Chat 会话目标（`@deepseek-ai/dsh-client-ui-chat`）的**本地副本**：浏览器半部逐字复制自
DSH checkout 的 `packages/client/ui-chat/src/`，可自由改动，改完用它替换官方实现。

## 替换是怎么生效的

上游实现由 `packages/bundle/web-app/cordis.patch.yml` 里这一行挂载：

```yaml
- id: ui-chat
  name: '@deepseek-ai/dsh-client-ui-chat'
```

浏览器侧的模块 id、`window.__DSH_BOOT__` 图行 id、以及其它插件 `dsh.client.inject` 里指向
ui-chat 的那条包名边（`ui-plan` / `ui-attachment` / `ui-subagent` / `ui-workflow-run` /
`ui-deliverables` / `ui-goal` …）**全部以包名为键**。因此本副本保留同一个 `name`，只换实现。
链路是两层，各自解决一件事：

1. **选实现**靠 Profile 的 `link:` 依赖。`name` 没变，profile 作用域的 `node_modules` 里那条
   符号链接先于 runtime resolution 拦截层被 Node 命中，于是这个包名指向本目录。
2. **组合里只留一条行**靠本插件的 `cordis.patch.yml`：它 `insert` 一行 **entry id 与上游相同**
   的挂载行。`applyEntryPatches` 只是把这一行 push 进列表（不去重），真正收敛的是 Loader ——
   `EntryGroup.update` 用 `Object.fromEntries(config.map(o => [o.id, o]))` 按 id 建表，
   **重复 id 取最后一个**，随后 `create()` 复用同一个 `tree.store[id]` 并用新 options 顶掉旧
   entry（[vendor/loader/src/config/group.ts:23-37](/Users/lz/IdeaProjects/deepseek-harness/vendor/loader/src/config/group.ts)）。
   所以这一行就是**替换**上游行，既不需要 `disabled: true`，也不会把同一个包挂两次。

   > 换个写法（`disabled: true` 停用上游行 + 用另一个 entry id 插本行）也能用，但那两条行都会
   > 挺过 id 收敛 ⇒ 同一个包挂两次、宿主半部 `apply()` 跑两遍。**「同 id 插入」才是挂一次。**

   代价：`dsh --profile web --dump-config` 打印的是收敛**前**的列表（与 boot 共用同一个
   `applyEntryPatches` 调用），所以会看到两行内容完全相同的 `ui-chat`；Loader 实际只建一个。

顺带一条硬约束：非 `insert` 的补丁**改不动 `name`** —— `applyEntryPatches` 把 `name` 当断言，
不匹配就 `warn('patch: name mismatch …')` 并跳过（[vendor/include/src/index.ts:112-116](/Users/lz/IdeaProjects/deepseek-harness/vendor/include/src/index.ts)）。
所以「就地改一行的 name 指向本目录」这条路不存在，要加行只能 `insert`。

## 目录结构

```text
dsh-client-ui-chat/
├── package.json          # exports["."] → 宿主入口 index.ts；exports["./client"] → lib/client.js
├── index.ts              # 宿主半部（Node Type Stripping 直载）
├── tsconfig.json         # 浏览器半部类型检查面
├── tsconfig.host.json    # 宿主半部类型检查面（erasableSyntaxOnly）
├── src/
│   ├── chat-settings.ts  # 宿主与浏览器共享的设置契约
│   ├── css-modules.d.ts
│   └── client/           # 浏览器半部（109 个文件，约 1.5 万行，逐字复制）
├── scripts/build-client.mjs
├── lib/client.js         # 浏览器半部构建产物（入仓，禁止手改）
├── cordis.patch.yml
└── test-boot.mjs
```

与上游 `packages/client/ui-chat/src/` 的唯一差异：上游的 `src/index.ts` 移到本包根目录成为
宿主入口 `index.ts`，只改了 4 处 `./chat-settings.ts` 的相对路径。其余文件逐字相同，可以直接
`diff -r` 比对：

```sh
diff -rq <checkout>/packages/client/ui-chat/src \
         <仓库根>/dsh-client-ui-chat/src     # 只应报告 "Only in …/src: index.ts"
```

## 定制

改 `src/` 下任意文件 → `npm run build`。浏览器半部是 `lib/client.js` 单文件产物，
**浏览器不跑 Type Stripping**：不构建就不生效。构建后 `dsh-client-hmr` 在 500ms 内
stat 到产物变化并热替换 fiber，**无需重启、无需刷新**（页面保持打开即可）。

宿主半部（`index.ts`）与组合（`cordis.patch.yml`）是常驻挂载，改动需重启 App 生效。

构建脚本 `scripts/build-client.mjs` 做三件事：

1. esbuild 把整个浏览器半部打成一个 CJS 文件，外部依赖**只有模块表基线**
   （`react` / `react-dom` / `cordis` / `client-store` / `ui-slots` / `ui-primitives` / `ui-dockkit`
   —— 与内置 ui-chat 的 `lib/client.js` 实际 `require` 的名字一致）；其余（含
   `@tanstack/react-virtual`、`@deepseek-ai/schemastery` 与若干 wire 层）全部内联。
2. 把 18 份 CSS Modules 编译成一张样式表，按上游同一契约在工厂执行时插入
   `style[data-plugin][data-plugin-css]` —— `data-plugin` 供 client-hmr 重建时回收，
   `data-plugin-css` 保证同一文档重复执行只插一次。
3. 闸门：产物里任何不在模块表基线内的 `require`、或任何动态 `import()`，直接构建失败。

需要浏览器里可读的 sourcemap：`DSH_CHAT_SOURCEMAP=1 npm run build`（额外产出
`lib/client.js.map`，默认不产出以免每次构建都往仓库里加约 1MB）。

## 构建与加载

依赖统一安装在仓库根（`pnpm-workspace.yaml` 的 `nodeLinker: hoisted`，插件目录自身不落
`node_modules`），所以构建只在仓库根装一次：

```sh
cd <仓库根>
pnpm install                                         # 首次，或 package.json 依赖变动后
cd dsh-client-ui-chat
npm run typecheck && npm run build && npm run check && npm test
# 只跑其中一步：npx tsc --noEmit -p tsconfig.json（浏览器面）
#               npx tsc --noEmit -p tsconfig.host.json（宿主面）
```

挂载（**尚未执行**，需要你确认后运行；bundle 层不支持热重载，改完要重启 App）：

```sh
cd <仓库根>/dsh-client-ui-chat
dsh plugin --profile web add link:.                  # Profile 的 node_modules 里建到本目录的符号链接
```

`link:.` 这一步才是「选实现」：包名 `@deepseek-ai/dsh-client-ui-chat` 在 profile 作用域解析到
本目录，上游那条同名行于是挂到本副本上。本副本**没有**并入仓库根整合包
（`package.json` 的 `dsh.bundle.patch` 与 `dependencies` 均未改动），挂载完全靠这条 profile 依赖。

核对挂载结果：

```sh
dsh --profile web --dump-config | grep -A1 "ui-chat"   # 两行同 id 的 ui-chat（收敛前列表），实际只建一个 entry
curl -s -N --max-time 3 http://127.0.0.1:3080/plugins/events | head -c 2000   # 首帧图里应有 @deepseek-ai/dsh-client-ui-chat
```

## 依赖说明

`devDependencies` 里 34 个 `@deepseek-ai/*` 预发布包（`0.1.7-rc.2`，与 DSH checkout 的
release 版本一致）是**开发期**输入：
浏览器半部的跨包 import 全是 `import type`，但类型检查需要它们，少数 wire 层
（`dsh-session/surface`、`dsh-token-meter/client`、`dsh-util-workspace-path` 等）会被内联进产物。
它们按 npm 依赖安装（不是 junction），升级 DSH 时同步升这一组版本。

`@tanstack/react-virtual` 是上游 ui-chat 唯一的内联第三方实现依赖，必须能被 esbuild 解析到。

## 本地修改登记

副本自身与上游的差异**只有下面这些**，同步上游时按此清单重放（`diff -r` 可直接核对）：

| 文件 | 差异 | 原因 |
|---|---|---|
| `src/index.ts` | 不复制；移出为包根 `index.ts`，4 处 `./chat-settings.ts` 改 `./src/chat-settings.ts` | 宿主入口不进浏览器半部；包根入口便于 `exports["."]` 直载 |
| `package.json` | 重新生成：`dsh.client.platform=web`、与上游逐字相同的 `inject` 列表、esbuild 构建脚本、34 个 `@deepseek-ai/*` 开发期依赖 | 本包不是 workspace 内的上游构建产物，改由 `scripts/build-client.mjs` 产出 `lib/client.js` |
| `lib/client.js` | 不再由上游 tsdown 产出，改由 `scripts/build-client.mjs` 打包 | 单文件、离线入仓；require 闸门只留模块表基线 |
| `tsconfig.json` / `tsconfig.host.json` / `scripts/build-client.mjs` / `test-boot.mjs` / `cordis.patch.yml` | 本仓库自有文件，上游没有 | 类型检查面、构建、产物契约测试与挂载行 |

`src/` 下其余 109 个浏览器半部文件与上游**逐字相同**（含 18 份 CSS Modules）。

来源版本：DSH checkout `477b4f4205`（HEAD，`release(dsh): 0.1.7-rc.2`）；`packages/client/ui-chat`
自身最后一次变更是 `787b746b80`，包版本 `0.1.7-rc.2`。

## 已知边界

1. **升级要手工再同步**。升级 DSH 后需重新复制上游 `packages/client/ui-chat/src/` 并重放你的
   定制；本仓库没有自动同步脚本。同步步骤：删掉本目录 `src/`，把上游 `src/` 原样复制进来
   （**不要**复制上游的 `src/index.ts`），按「本地修改登记」表重放包根 `index.ts` 与
   `package.json` 的版本号，再在仓库根 `pnpm install` + `npm run build`。
2. **上游源码用了构造函数参数属性**，属非可擦除语法，因此 `tsconfig.json`（浏览器面）不开
   `erasableSyntaxOnly`；只有宿主面 `tsconfig.host.json` 开。宿主半部因此受
   「仅可擦除语法 + 显式 `import type`」约束，浏览器半部不受。
3. **CSS 类名哈希与上游不同**：esbuild `local-css` 与上游 lightningcss 的哈希算法不一样。
   样式表与使用它的组件同属本产物，自洽；但**不要**在定制里写下上游的 `._xxx_hash` 类名，
   也不要把 CSS Module 类名写进选择器去命中其它插件的元素。
4. **`build` 用 esbuild JS API**，它会 spawn 平台二进制。若在受限沙箱里构建报
   `spawn EPERM`，在普通终端里跑 `npm run build`。
5. 宿主半部只做一件事：向 user-settings 文档注册 Chat 段（`ui-chat` 命名空间）。
   浏览器半部的设置行依赖它，删掉会导致聊天设置项没有后端 schema。
6. 本副本**不参与** `dsh-client-modules` 的跨插件取值检查（那是仓库内
   `packages/client/tsdown.client.ts` 的构建期闸门）。`scripts/build-client.mjs` 里的
   require 闸门是它的等价物，定制时若把另一个插件的值 import 进来会在此失败。
