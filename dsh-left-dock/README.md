# dsh-left-dock

把 DSH Web 的左栏换成一个 IntelliJ 风格的**左坞**：栏内是一条活动栏（两枚按钮），
右侧是当前面板；两个面板**同一时间只出现一个**，并且**各自记住自己的宽度**。

```
┌────┬──────────────────────────┬───────────────┐
│ 会 │  会话面板                 │               │
│ 话 │  新会话 / 会话列表 / 设置   │   对话区       │
├────┤                          │               │
│ 文 │  ← 点第二枚按钮切到文件树   │               │
│ 件 │  文件面板（工作区目录树）    │               │
└────┴──────────────────────────┴───────────────┘
```

| 按钮 | 行为 |
| --- | --- |
| 第一枚（会话） | 会话面板**已展开**时点击 = 收起（只留活动栏）；否则切到会话面板并展开 |
| 第二枚（文件） | 文件面板**已展开**时点击 = 收起；否则切到文件面板并展开 |

- **互斥**：活动栏记录当前面板（`mode`），只显示当前那一个（两块面板都保持挂载，
  非当前的一块 `display:none`，这样切回来时会话浏览器的搜索词/展开态/滚动位置还在）。
- **宽度不共享**：两个面板各记一份轨道宽度；切换时把该模式的那份写回框架左栏轨道，
  拖动框架的列把手时把新值回写给**当前**模式。宽度持久化在 `localStorage`
  （键 `dsh.left-dock.v1`）。
- **点击文件**：走仓库内 `dsh-text-editor` 的公开能力面
  `openFile({ path, cwd, sessionId })`，文件内容显示在对话区的「文件」tab 里
  （可编辑、可保存）。

## 它接管的到底是什么

`ui-layout` 的 `AppFrame` 把左栏做成一个 single 槽位 `sidebar`，内置 `ui-sidebar`
在其中渲染 `SidebarRoot`，并在同一注册里**声明** 6 个子座位：

| 子座位 | kind | 谁注册进来 |
| --- | --- | --- |
| `sidebar.brand.mark` / `sidebar.brand.name` | single | `ui-brand-official` |
| `sidebar.panellist` | list | 全局面板图标（id 对应 `main` 面板 key） |
| `sidebar.workspaces` | single | `ui-workspace`（会话/工作区浏览器） |
| `sidebar.settings` | single | `ui-settings-general`（设置入口 + 面板） |
| `sidebar.footer.action` | list | `ui-cordis`（Cordis 面板入口）等 |

一个槽位只能有**一个声明者**，而本插件的需求是「同一列里放活动栏 + 两个面板」。
因此：

1. 本 bundle 的 `cordis.patch.yml` **停用内置 `ui-sidebar` 行**；
2. 本插件注册 `sidebar` 槽位的占位组件，并把上面这 6 个子座位**按原名原 kind
   重新声明**，再在会话面板里原样渲染它们。

于是 `ui-workspace` / `ui-settings-general` / `ui-brand-official` / `ui-cordis`
的注册项**不需要任何改动就继续生效**：停掉 ui-sidebar 只是换掉了那一层的壳。
`ui-sidebar` 原本注册的 `sidebar` 字典命名空间没有任何其他消费者（已核实内置包中
无人 `bind("sidebar")`），本插件自带 `leftDock` 命名空间。

> `dsh-client-ui-sidebar` 出现在 `ui-workspace` / `ui-settings-general` /
> `ui-brand-official` / `ui-cordis` 的 `package.json` **模块级** `dsh.client.inject`
> 里；客户端模块图对缺失的 inject 依赖是**跳过**（`arriveGraphRow` 只在本行存在时
> 递归），因此停用该行不会影响这些包的加载顺序或激活。

## 用到的公开面

| 面 | 用途 | 取用方式 |
| --- | --- | --- |
| `slots.register` / `slots.inject` | 占用 `sidebar` 槽位、声明 6 个子座位、渲染它们 | 硬依赖（`export const inject = ['slots']`） |
| `slots.entriesOfSlot` + `slots.subscribe` | 读 `sidebar.panellist` 行元数据（id/order/label） | 可选，缺失则不打面板行 |
| `slots.entries('root')` → `slots.resolveStore(handle, undefined)` → `actions.setSidebar(px)` | 写左栏轨道宽度（`ctx.layout` 没有宽度写入口） | 可选，缺失则拖动/切换不写宽度 |
| `ctx.layout.toggleSidebar()` | 展开/收起左栏 | 可选 |
| `ctx.layout.selectPanel(id)` | 点击面板行切换 `main` 面板 | 可选（未注册的 key 会抛错，已捕获） |
| `ctx.get('uiWorkspace').startSession()` | 新会话按钮 | 可选 |
| `ctx.get('remote.workspaceFiles').list(sessionId, path, signal)` | 文件树列目录 | 可选，缺失时面板显示「服务未就绪」 |
| `ctx.get('dsh-text-editor').openFile({path, cwd, sessionId})` | 打开文件到对话区 tab | 可选，缺失时提示服务未就绪 |
| `ctx.locale.register(NS, {zh, en})` + 注册项 `locale: NS` | 文案（合成 `t` prop） | 可选，缺失时回退内置字典 |

除 `slots` 外全部**调用时** `ctx.get`，且判空后才用：任何一项缺席都只是对应功能降级，
不会让整条插件不激活（否则左栏会因为没有占位组件而空白）。

### ⚠️ `remote.workspaceFiles` 的一个坑（已踩过一次）

`remote` 是 Remote 载体服务，各命名空间由 `dsh-api-gateway` 的客户端以

```js
remoteServiceKey(namespace) === `remote.${namespace}`   // → 'remote.workspaceFiles'
super(ctx, remoteServiceKey(name))                       // RemoteNamespaceService extends Service
```

注册成**独立服务**，并在 `Remote` 面对象上挂成 **accessor**。后者要求「该名字出现在
inject 里」，所以直接访问 `ctx.get('remote').workspaceFiles` 会抛：

```
cannot get property "remote.workspaceFiles" without inject
```

本插件不把它写进静态 `inject`（那会让整条插件在该能力缺席时永不激活、左栏空白），
而是两条路并用：

1. **动态 inject**：`ctx.inject(['remote','remote.workspaceFiles'], …)` —— 子 fiber
   就绪时绑定 `list`，同时把「文件服务就绪」经 `hooks: { fileService }` 告诉组件
   （组件据此自动重新加载；命名空间下线时信号自动熄灭）。
2. **惰性兜底**：`ctx.get('remote.workspaceFiles')` —— 命名空间本身就是已提供的服务
   名，而 `ctx.get` 读服务表、**不做 inject 检查**，所以每次调用都能重新解析；
   命名空间方法在实例上以 getter 形式安装，取用后需锁 `this`（本插件取一次并 bind）。

## 加载

> 加载属于用户操作（仓库规范：代理不自行改 Profile / 不自行 install / 不自行重启）。

```sh
cd C:/Users/LGZ/dsh-plugins/dsh-left-dock
dsh plugin --profile web add link:.
# 重启 App 生效（浏览器半部随组合重载，宿主半部为常驻挂载）
```

卸载：

```sh
dsh plugin --profile web remove dsh-left-dock
```

**注意**：本插件生效期间内置 `ui-sidebar` 行由本 bundle 的补丁停用（见上）；
`dsh plugin remove` 后补丁一并消失，内置左栏自动回来。

## 构建与验证

```sh
npm install          # 仅 devDependencies：esbuild / typescript / @types/react
npm run typecheck    # tsc --noEmit
npm run build        # src/client.ts → lib/client.js（esbuild 单文件 + ModuleLoader 包装）
npm run check        # node --check 产物与宿主
```

`lib/client.js` 为构建产物且入仓（与仓库内其它 TS 插件一致）；源码改动后必须重新
`npm run build`，client-hmr 会在 500ms 内热推送，页面无需刷新。

## 已知限制

1. **收起态只保留活动栏**（56px 的轨道里只有两枚按钮）。内置 `ui-sidebar` 收起时还会
   画品牌标、新会话图标、工作区头像列与设置图标；这些内容在展开会话面板后都可用，
   但收起态不再出现。
2. **窄视口（< 1024px）下宽度不可控**：`AppFrame` 在该区间把左栏折叠状态交给
   `narrowExpanded` 覆盖位，宽度回落合同默认值（280），这是 ui-layout 自身的响应式
   行为，本插件只沿用。
3. **面板行的 `active` 高亮**按 `false` 传给 `sidebar.panellist` 图标（未接
   `usePanelInfo`）；行本身仍可点击切换。当前内置包中无人注册该座位。
4. `sidebar.panellist` / `sidebar.footer.action` 行的标签只识别字符串或同步返回字符串的
   函数（与上游 `resolveSlotLabel` 的常用形态一致）。

## 上游来源与许可

- 结构参照上游 `dsh-client-ui-sidebar`（`SidebarRoot.tsx` / `SidebarRoot.module.css`）、
  `dsh-client-ui-sidebar-files`（`FilesBody.tsx` / `face.ts` / `locales.ts`）与
  `dsh-client-ui-layout`（`AppFrame.tsx` / `columns.ts` / `stores.ts`），
  版本锚点 `dsh-v0.1.5-rc.1`（与当前安装的 `@deepseek-ai/dsh` 0.1.5-rc.1 一致）。
  这些包为 MIT。
- 本插件**不打包**上游组件，只复刻其 DOM 结构、CSS 变量用法与目录树语义；配色全部取自
  ui-theme 的 CSS 变量（`--dsw-specific-sidebar-fill`、`--dsw-alias-label-*` 等），
  因此主题与字号设置下与周围界面一致。
- 图标为内联 SVG（上游图标来自 `dsh-client-ui-primitives`，该包不在 DSH 客户端模块表里，
  本插件 bundle 无法 require）。
