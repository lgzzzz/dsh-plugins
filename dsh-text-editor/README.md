# dsh-text-editor

应用内 Monaco 文本编辑器：**文件面在右侧栏**。工作区文件树里点开的文本文件、以及
对话区（消息 / 工具卡）里的文件链接，都开进右栏的编辑器 tab，可编辑、可保存；
图片与 PDF 仍由内置文档预览渲染。另外对外提供一个客户端能力服务（`openFile` /
`showDiff`）。

## 功能

### 1. 接管右栏的文本文件（extension 档 tab 类型）

浏览器半部向上游 `ctx.sidebarRightTabs` 注册一个资源 tab 类型：

| 字段 | 值 |
| --- | --- |
| `id`（也是正文 / 标题注册的 key） | `dsh-text-editor/editor` |
| `kind` | `dsh-text-editor` |
| `patterns` | `['dsh-resource://file/**']`（含 `:` → 整串匹配地址） |
| `priority` | 未声明 → 上游最高档 **`extension`** |
| `canOpen(address)` | 可解析成 session 作用域地址 **且** path 非空 **且** 非图片/PDF |
| `title(address)` | 路径 basename（打开时捕获；未保存时 chip 实时追加 ` ●`） |

由此：

- **右栏文件树**的行（上游 `ui-sidebar-files` 调 `tab.actions.openResource`）与
  **对话区的文件链接**（上游 `ui-chat` 调 `ctx.sidebarRight.openResource`）走的是同一条
  认领路径，两者都由本编辑器接管——`extension` 档排在 `builtin`（图片 / PDF / HTML
  预览）与 `fallback`（文档预览的文本兜底）之前；
- 图片（png/jpg/jpeg/gif/webp/bmp/ico/svg）与 PDF 被 `canOpen` 否决，继续由
  `ui-sidebar-documentpreview` 渲染；
- 同一文件的 tab 由上游按 (kind, 地址) 去重：再次打开只是聚焦既有 tab 并送达新导航。

正文注册到 keyed slot `sidebar.right.pane.tab`（key = 类型 id），经框架注入的
`useTabInfo()` 读 `tab.contentId`（地址）与 `tab.navigation.params.line`：

- 读取：`GET /dsh-text-editor/read?path=&cwd=`（工作区相对路径按会话 cwd 解析；
  宿主截断到 2MB 并做 NUL 二进制探测，二进制文件给出说明而不进编辑器）；
- 编辑 / 保存：Monaco 实例由正文自己持有（同一时刻只挂载活动 tab 的那一个），
  工具栏「保存」或 `Ctrl/Cmd+S` → `POST /dsh-text-editor/write`，宿主按 sessionId
  解析该会话的沙箱策略，工作区外写入被拒；
- **未保存修改跨 tab 保留**：正文卸载时把内容回写到 `src/state.ts` 的 store（按
  会话 + path 哈希分条），再挂载时直接复用；tab 被关闭（上游的 AbortSignal 中止，
  正文与 chip 标题都挂了该监听）时丢弃该条状态；
- 带行号的导航（`params.line`）按 navigation revision 定位一次。

### 2. 「差异」tab（`showDiff` 能力）

一组文件的 before/after diff 仍展示在**会话主区**的 `conversation.view` 标签里
（Monaco 双栏、只读、手动「上一个 / 下一个」与「上一处 / 下一处修改」）。文件面
移入右栏后，会话主区不再出现任何文件 tab。

### 3. 对外服务（`ctx.provide('dsh-text-editor', …)`）

```ts
interface TextEditorService {
  /** 把路径开进右栏编辑器（文本→本编辑器，图片/PDF→内置预览；同文件去重聚焦）。 */
  openFile(request: { path: string; cwd?: string; sessionId?: string }): void
  /** 在会话主区「差异」tab 顺序展示文件 diff。 */
  showDiff(request: {
    files: { label?: string; path?: string; before: string; after: string }[]
    initialIndex?: number
    sessionId?: string
  }): void
}
```

消费方：`export const inject = ['slots', 'dsh-text-editor']`，然后 `ctx.get('dsh-text-editor')`
（未就绪时为 `undefined`，须判空）。类型权威定义见 [`src/api.ts`](src/api.ts)。
`verify-consumer/` 是动态验证这两个能力的临时插件（用法见其 README）。

## 结构

```
dsh-text-editor/
├── index.ts            宿主半部入口（装配：read/write/monaco 三条路由）
├── host/               宿主实现：read.ts / write.ts / monaco.ts / http.ts / types.ts
├── src/                浏览器半部源码（入口 src/client.ts）
│   ├── client.ts       装配：inject、样式、注册右栏编辑器、提供能力服务
│   ├── sidebar.ts      文件面：右栏 tab 类型 + Monaco pane 正文 + chip 标题
│   ├── file-io.ts      文件读写（宿主路由）+ 当前挂载编辑器登记
│   ├── address.ts      dsh-resource://file 地址解析/构造 + 文本类判定
│   ├── controller.ts   编排层：差异 tab 生命周期
│   ├── ui.ts           视图层：差异标签 / 差异视图 / Monaco diff 容器
│   ├── monaco.ts       Monaco AMD 加载 + monaco 全局缓存 + 当前 diff 实例
│   ├── state.ts        文件状态 store（按会话+路径）与差异状态 store
│   ├── commands.ts     UI → 编排层的差异命令总线
│   ├── routes.ts       与宿主约定的 URL 常量与响应类型
│   ├── path.ts         basename / 扩展名 → Monaco language id
│   ├── faces.ts        上游客户端服务的最小结构切片
│   └── css.ts          编辑器与差异视图样式
├── scripts/build-client.mjs   esbuild 打包 src/client.ts → lib/client.js
├── lib/client.js       浏览器半部产物（入仓；禁止手改）
├── test-address.mjs    地址 / 接管域的纯逻辑验证（node test-address.mjs）
└── cordis.patch.yml    挂载行（inject: [webServer, fs]）
```

`lib/client.js` 只把 `react` 声明为 external（由 DSH ModuleLoader 的模块表提供）；
`@deepseek-ai/*` 的运行时服务全部经 `ctx.get(name)` 取用（`inject` 声明在
`src/client.ts`：`slots` / `sessions` / `sidebarRightTabs` / `sidebarRight`）。

## 构建与验证

```sh
cd <仓库根>/dsh-text-editor
npm install                 # 首次：装 esbuild / typescript / monaco-editor
npm run typecheck           # tsc --noEmit
node test-address.mjs       # 地址解析/构造 + 文本接管域（15 项断言）
npm run build               # esbuild → lib/client.js（+ 铺 vendor/monaco/）
npm run check               # node --check 产物与宿主
```

> 构建依赖 `monaco-editor`：`scripts/build-client.mjs` 会把
> `node_modules/monaco-editor/min/vs` 复制到**不入仓**的 `vendor/monaco/`。
> 该目录缺失时编辑器报 `Monaco 加载失败：Monaco loader failed to load`
> （宿主 `/dsh-text-editor/monaco/*` 路由 404）；`npm install && npm run build` 即恢复。

本插件**不含宿主行为改动**，因此改动只走浏览器半部：`npm run build` 后产物 mtime
变化，client-hmr 在 500ms 内热推送（页面无需刷新/重启）。宿主半部（`index.ts` /
`host/*`）若改动则需重启 App。

## 加载（属用户操作）

```sh
cd <仓库根>/dsh-text-editor && dsh plugin --profile web add link:.
# 重启 App 生效
```

依据仓库 `AGENTS.md` 强制规范第 1 条，代理不代为执行加载 / 重启。

## 已知限制

- 只接管 `dsh-resource://file/session/**` 作用域；`absolute` 作用域地址不由本编辑器
  打开（上游文档预览同样不认领）。
- 右栏编辑器不提供保存冲突检测：宿主按沙箱策略写回，磁盘上的外部改动会被覆盖。
- 关闭带未保存修改的 tab 会丢弃这些修改（与上游标签语义一致，无确认弹窗）。
- 目标会话的右栏 seat 未挂载（空白会话 / 右栏插件缺席）时 `openFile` 不动作。
