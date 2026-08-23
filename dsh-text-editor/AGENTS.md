# AGENTS.md — dsh-text-editor

面向后续 AI 代理（以及接手维护者）的工程说明。目标：让任何新会话不读完整源码也能安全改动、构建、调试这个插件。README.md 讲「是什么」，本文件讲「怎么改、注意什么、常见坑」。

## 项目是什么（30 秒版）

DSH Web GUI 里的**应用内文本编辑器基础能力提供方**（Monaco，VSCode 同款）。
本插件**不再自行实现具体功能**（不再拦截文件链接点击），而是向其他客户端插件
暴露两个**基础能力**（经 `ctx.provide('dsh-text-editor', …)` 提供的服务）：

1. **openFile**：把某个文件打开到 DSH 内的 **「文件」** 会话标签页（与「对话」
   「轨迹」并排），用 Monaco 显示、可编辑、可「保存」回磁盘（写入受会话沙箱策略
   约束）。标签带关闭按钮 ×。**同一会话可同时打开多个文件（至多 5 个，
   `MAX_EDITOR_TABS`），且编辑器 tab 是「会话作用域」的**：只出现在打开该文件的
   会话的 tab 栏里；切换到其他会话时消失，切回时重现（每会话各自保留打开文件，
   详见「会话作用域的标签」一节）。
2. **showDiff**：把一组文件的前后状态（before/after 文本）在 **「差异」** 标签页
   里逐个显示 Monaco 双栏 diff；顶部「上一个 / 下一个」按钮手动推进（无自动定时）。
   差异 tab 同样会话作用域。

其他客户端插件在 `inject: ['dsh-text-editor']` 后 `ctx.get('dsh-text-editor')`
取用这两个能力（详见下文「对外能力（服务契约）」）。

## 两个半部（重要）

- **宿主半部 `index.ts`**：跑在 DSH Node 进程内，Node 22+ Type Stripping 直接加载，
  不需要编译。**只是薄入口**：从 ctx 取服务后装配三条 HTTP 路由；实现按功能拆在
  `host/` 目录（read / write / monaco / http / types），`index.ts` 用 `.ts` 扩展名
  import 它们（Node 直接解析）：
  - `GET /dsh-text-editor/read?path=&cwd=` 读文件（走 `ctx.fs`，`~` 展开，>2MB 截断）
  - `POST /dsh-text-editor/write` 保存（按会话解析 sandboxPolicy）
  - `GET /dsh-text-editor/monaco/*` 托管本地 Monaco 发行版（有目录穿越防护）
  - 硬依赖 `webServer`、`fs`（由 `cordis.patch.yml` 挂载行的 `inject` 声明）。
- **浏览器半部 `src/`**（真源，按职责拆模块，入口 `src/client.ts`）→
  `scripts/build-client.mjs` 用 **esbuild** 打包成单文件（bundle，仅 `react` 为
  external）并包进 `window.__ModuleLoader__.load(...)` → **`lib/client.js`**
  （产物，勿手改）。负责：注册 `conversation.view` 的「文件」「差异」两个标签、
  用 `ctx.provide` 注册对外能力面（openFile / showDiff）、懒加载 Monaco、
  渲染/保存/展示 diff。**不再有文件链接点击拦截器**。模块图（单向无环）：
  `client.ts → controller → ui → {state, monaco, path, routes, commands}`；
  ui 的「动作」经 `commands.ts` 命令总线触发，避免与 controller 成环。

## 对外能力（服务契约）

本插件经 `ctx.provide('dsh-text-editor', api)` 暴露能力面（类型在 `src/api.ts`）：

```ts
interface TextEditorService {
  openFile(request: { path: string; cwd?: string; sessionId?: string }): void
  showDiff(request: { files: { label?: string; path?: string; before: string; after: string }[]; initialIndex?: number; sessionId?: string }): void
}
```

其他**客户端插件**这样消费（机制与 `slots`/`theme` 相同，激活顺序与卸载清理
都由框架保证）：

```ts
// 消费方插件
export const inject = ['slots', 'dsh-text-editor']
export function apply(ctx) {
  ctx.effect(() => {
    const te = ctx.get('dsh-text-editor')   // 未就绪返回 undefined，先判空
    te?.openFile({ path, cwd, sessionId })
    te?.showDiff({ files: [{ path, before, after }, …] })
  })
}
```

要点：
- `showDiff` 是**纯客户端渲染**：before/after 是调用方传入的内存文本，不读磁盘，
  不需要宿主新路由；`path` 仅用于语言高亮。
- `showDiff` 的可选 `initialIndex` 指定多文件时初始展示第几个文件的 diff（0 起，
  越界自动 clamp，缺省 0 = 第一个文件）；不影响重复调用的覆盖语义（每次调用都按
  新 `initialIndex` 重置初始位置）。
- `openFile` 走现有 `/read`、`/write` 宿主路由：`~` 展开、相对路径按 `cwd` 解析、
  保存按 `sessionId` 对应的会话沙箱策略。
- 想恢复「点击产物/工具链接自动打开」的功能：由**其他插件**自己挂 DOM 拦截器并调
  `openFile`，不要在本插件里加回（本插件定位是纯能力提供方）。

## 会话作用域的标签（怎么做到「切走消失、切回重现」）

DSH 的 `conversation.view` 槽注册是**全局**的（每个会话的 tab 栏都投影同一注册表），
所以本插件**不能**静态注册一个「文件」标签让它出现在所有会话。做法：

1. **按会话存状态**（`src/state.ts`）：`filesBySession: Map<sessionId, FileState[]>`、
   `diffBySession`，每会话各自保留自己的打开文件（至多 `MAX_EDITOR_TABS = 5`）。
2. **观察当前活动会话**（`src/controller.ts` `bind()`）：通过
   `ctx.get('sessions').currentProvideInfo`（uSES store，`getSnapshot()` 返回
   `{ sessionId, … }`）订阅变化 → `setActiveSessionId()` 写入 store。
3. **只按当前活动会话注册标签**（`reconcile()`）：活动会话变化 / 文件列表变化 /
   差异有无变化时，**先全部注销、再按当前活动会话的打开文件重注册**
   `conversation.view` 标签。切到没有打开文件的会话 → 无标签；切回 → 重新注册，
   且每个会话的 `view` 选中态（DSH 的 per-session chatStore）会按稳定 id
   （`dsh-text-editor-<fileKey>`）自动还原到上次查看的文件。
4. **内容跨切换保留**：切换 tab / 会话时视图卸载，`MonacoHost` 的清理回调把
   `editor.getValue()` 回写 store（`commitFileContent`，保留脏标记），切回时按 store
   内容重建 Monaco——未保存修改不丢。
5. **高频变化不重建标签**：reconcile 只在「注册相关」签名变化时执行
   （`registrationSignature()`：活动会话 id + 文件 key 列表 + 差异有无），
   内容/脏标记等变化只触发 uSES 重渲染组件本身，不重挂载标签/不重载 Monaco。

## 构建 / 验证（每次改代码后的标准流程）

```bash
cd ~/.dsh/dsh-text-editor
npm run typecheck          # tsc --noEmit：index.ts + host/*.ts + src/*.ts
npm run build              # 改 src/ 下任何文件后必须执行；esbuild 打包出 lib/client.js
npm run check              # node --check lib/client.js && index.ts + host/*.ts
```

改 `src/` 下任何文件后**必须 `npm run build`**——浏览器不跑 Type Stripping，直接读
`lib/client.js`（esbuild 把 `src/client.ts` 连同其相对 import 的模块打包成单文件，
仅 `react` 为 external）。`/plugins/dsh-text-editor/client.js` 路由实时读磁盘，所以
**只改客户端**刷新页面（Cmd/Ctrl+Shift+R）即可生效，无需重启服务器。**改 `index.ts`
或 `host/*.ts` 或挂载配置（profile 的 cordis.patch.yml / package.json）才需要重启
`dsh web`。**

## 部署位置与挂载

- 插件本体：`~/.dsh/dsh-text-editor/`
- 挂载：web profile
  - `~/.dsh/profiles/web/package.json`：dependencies 里 `"dsh-text-editor": "link:/Users/lz/.dsh/dsh-text-editor"`，`dsh.profile.bundles` 里加 `"dsh-text-editor"`
  - `~/.dsh/profiles/web/cordis.patch.yml`：`- id: dsh-text-editor\n  name: dsh-text-editor\n  inject: [webServer, fs]`
  - 依赖变更后 `cd ~/.dsh/profiles/web && pnpm install`
- 重启 `dsh web`：`bash ~/stop-dsh-web.sh && bash ~/start-dsh-web.sh`
  （若 agent 自身跑在 dsh web 进程内，重启会杀掉当前回合：用
  `python3 -c "import os; os.setsid(); os.execvp('bash',['bash','/tmp/dsh-text-editor-restart.sh','30'])"`
  这种分离延迟重启包装脚本，先交付说明再触发。macOS 没有 `setsid` 命令。）

## 验证服务器/插件状态

```bash
cat ~/.dsh-web.pid                                   # 当前 dsh web PID
curl -s -o /dev/null -w "%{http_code} %{size_download}B\n" \
  http://127.0.0.1:3080/plugins/dsh-text-editor/client.js   # 客户端 bundle
curl -s -o /dev/null -w "%{http_code} %{size_download}B\n" \
  http://127.0.0.1:3080/dsh-text-editor/monaco/loader.js     # Monaco 静态
curl -s "http://127.0.0.1:3080/dsh-text-editor/read"         # 期望 400 missing "path"
```

## 关键坑（务必先读，都是踩过的）

1. **客户端必须声明 `inject: ['slots']`**（`src/client.ts` 顶部 `export const inject`）。
   不声明时加载器不等待 `slots` 服务就绪就 apply，`ctx.get('slots')` 返回
   `undefined`，若用 `=== null` 判断会漏掉，随后 `slotsRef.inject(...)` 抛
   `Cannot read properties of undefined (reading 'inject')`，导致 **web 启动失败、
   插件在 HARNESS 面板报 failed to apply loader entry**。用
   `slotsRef === null || slotsRef === undefined` 双判断。
2. **Monaco API 入口在 `monaco.editor` 下**：`monaco.editor.create(el, opts)`、
   `monaco.editor.setTheme(t)`、`monaco.editor.setModelLanguage(model, lang)`。
   直接 `monaco.create(...)` 会报 `monaco.create is not a function`。
3. **宿主 `MONACO_ROOT` 的路径基准**：定义在 `host/monaco.ts`，用
   `fileURLToPath(new URL('../vendor/monaco/', import.meta.url))`——**`../`** 是
   相对 `host/` 目录（host/monaco.ts 在仓库根的下一层）。曾误用 `./`（相对
   index.ts 所在目录时才是 `./`），解析成 `~/.dsh/host/vendor/monaco` 导致 404。
   移动这个文件时务必同步改基准。
4. **`inject` 是挂载行配置**，不是模块导出：宿主硬依赖写进
   `cordis.patch.yml` 行的 `inject: [webServer, fs]`，模块里不再 `export inject`。
   客户端反之——客户端 `inject` 必须 `export const inject = [...]`（由加载器从
   插件对象读取）。
5. **`ctx.get(...)` 优先，且必须处理 undefined**：宿主用
   `ctx.get('fs')/ctx.get('webServer')`，缺失时静默 return（降级）；不要直接当
   ctx 属性访问，除非已在 `inject` 声明。
6. **产物 chips / 工具链接的 selector**（改了 DSH 上游 DOM 需复查；本插件**已不再**
   拦截这些链接，以下选择器只对「想恢复点击打开」的消费方插件有用）：
   - chips：`[data-produced-files-row] button[title]`（title=完整路径）
   - 工具卡片：`[data-tool="read"|"write"|"edit"] button[class*="_fileLink"]`
     （文本为展示路径：cwd 相对 / 绝对 / `~` 开头）
7. **读写路径解析**：`~` 展开为宿主主目录；相对路径按调用方传入的 `cwd` 解析
   （`openFile` 的 `cwd` 由消费方决定，通常取 `useSessions` 的 `s.byId[sessionId].cwd`）；
   保存按 `sessionId` 对应的会话沙箱策略，工作区外写入被 `fs` 拒绝（HTTP 403，
   状态栏显示错误）。
8. **文件沙箱**：向 `~/.dsh/` 写文件需 danger-full-access（已授权）；系统提示若
   声明 approval=never 就不要设置 sandbox_permissions。
9. **Monaco 发行版**：`vendor/monaco/`（约 13MB）来自 monaco-editor 0.52.2
   npm tgz，本地托管保证离线；改动用 /tmp 里的原始下载（`/tmp/monaco-dl/`）重铺。
10. **fire/mount 顺序（会话作用域的标签）**：注册不是「惰性按动作」，而是由
    `controller.ts` 的 `reconcile()` 统一驱动——它订阅 store，仅当「注册相关」状态
    变化（活动会话 id / 文件 key 列表 / 差异有无，见 `registrationSignature()`）才
    **先全部注销、再按当前活动会话重注册** conversation.view 标签。因此：
    - 每个打开的**文件 = 一个标签**，id = `dsh-text-editor-<fileKey>`（fileKey 是
      path 的稳定哈希，`state.hashKey`）；差异标签 id = `dsh-text-editor-diff`。
    - 标签只在「打开它的会话」出现：`bind()` 订阅 `sessions` 服务的
      `currentProvideInfo`，切会话时 `setActiveSessionId` → store emit → reconcile
      重建；同 id 在同一时刻只注册一份（先 dispose 再 register），不会重复注册抛错。
    - 容量上限 `MAX_EDITOR_TABS = 5`（`state.ts`）：满时驱逐「最近未用的非脏」tab，
      全脏则拒绝打开（在活动 tab 提示）。已打开的同路径文件会选中而非重复开。
    - store 的 `subscribe` 只驱动 reconcile 的**签名判断**，内容/脏标记等高频变化
      不触发重注册（否则标签会反复重挂载、Monaco 反复重载）。
11. **标签 label 是 React 元素，不是字符串**：DSH 渲染 tab 时用
    `resolveSlotLabel(entry.options.label)`（函数则调用、否则原样返回），返回值直接当
    标签 `<button role="tab">` 的 children。`reconcile()` 里每个文件标签的 `label` 返回
    `React.createElement(TabLabel, { sessionId, fileKey })`——`TabLabel` 是真实 React
    组件，用 `useSyncExternalStore(subscribe, () => getFileByKey(sessionId, fileKey))`
    反应式显示该文件的 basename（脏时带 ● 标记），并带 × 关闭按钮。`DiffTabLabel`
    同理订阅 `getDiffState()` 显示「差异 · n」。注意：
    - × 用 `<span role="button">` 而非 `<button>`（标签本身是 button，嵌套 button
      无效 HTML）；其 onClick 必须 `event.stopPropagation()`，否则冒泡触发外层 tab 的
      setView 切标签。
    - `sessionId`/`fileKey` 由 `reconcile()` 注册时**闭包捕获**传给 TabLabel 与
      FileView（FileView 也是 `() => React.createElement(FileView, { sessionId, fileKey })`，
      不依赖 DSH 注入 props）。`activateTab(fileKey)` 用
      `document.querySelector('[data-dsh-te-key="<fileKey>"]').closest('[role="tab"]')`
      定位具体文件的标签（文件多时不能用 textContent 精确匹配）；
      `activateDiffTab()` 用独立类 `.dsh-te-diff-tab-label`（两类不能混，否则点选串 tab）。
    - 用组件而非「重注册」来刷新标签：`TabLabel`/`DiffTabLabel` 订阅 store 后，内容
      变化只需 emit，标签文字自动更新，无需父级标签栏重渲染。
    - 工具栏里已**不再有**关闭按钮（2025-08：关闭交互只放标签上），别加回去。

## 常用文件地图

| 文件 | 作用 |
| --- | --- |
| `index.ts` | 宿主半部薄入口：取服务 + 装配三条路由 |
| `host/read.ts` | 宿主：GET /read 读文件（truncate / binary 检测） |
| `host/write.ts` | 宿主：POST /write 保存（按会话解析 sandboxPolicy） |
| `host/monaco.ts` | 宿主：/monaco/* 静态托管（目录穿越防护） |
| `host/http.ts` | 宿主：JSON 响应 / 请求体解析 / `~` 展开 |
| `host/types.ts` | 宿主：用到的 DSH 服务最小面类型 |
| `src/client.ts` | 浏览器半部入口（inject / apply / CSS 注入 / ctx.provide 能力面） |
| `src/api.ts` | 浏览器：对外能力契约（服务名 TEXT_EDITOR_SERVICE + 类型），供消费方使用 |
| `src/controller.ts` | 浏览器：文件/差异 标签生命周期 + 打开/读取/保存/关闭/推进 编排 |
| `src/ui.ts` | 浏览器视图层：TabLabel / DiffTabLabel / FileView / DiffView / MonacoHost / DiffHost |
| `src/monaco.ts` | 浏览器：Monaco AMD 加载封装 + 编辑/diff 实例单例 |
| `src/state.ts` | 浏览器：文件状态 store + 差异状态 store |
| `src/commands.ts` | 浏览器：UI → 编排层的命令总线（破环；含 diff 推进/关闭） |
| `src/routes.ts` | 浏览器：与宿主约定的 URL 常量与响应类型 |
| `src/path.ts` | 浏览器：basename / 扩展名 → language id |
| `src/css.ts` | 浏览器：编辑器 + 差异视图样式 |
| `lib/client.js` | esbuild 产物（勿手改，改 src 后 build） |
| `scripts/build-client.mjs` | esbuild 打包 + ModuleLoader 包装 |
| `tsconfig.json` | 两端类型检查（noEmit，允许 .ts 扩展名 import） |
| `cordis.patch.yml` | 挂载行声明（宿主 inject） |
| `vendor/monaco/` | 本地 Monaco 发行版 |
| `package.json` | `dsh.client.platform/immediately/external`、scripts、devDeps |
