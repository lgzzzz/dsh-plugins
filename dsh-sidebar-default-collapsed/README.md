# dsh-sidebar-default-collapsed

让**左侧边栏在每次加载页面时默认收起**的本地持久化插件。
纯浏览器半部：宿主半部为空占位，注入 `layout` + `slots` 两个服务，启动时一次性调用
`ctx.layout.toggleSidebar()`。不注入样式、不改 DOM、不写 Profile。

## 上游事实（判定依据，以源码为准）

| 事实 | 依据 |
| --- | --- |
| 左栏初值硬编码为展开：`layoutInfo.sidebar: 280`（`narrowExpanded: false`、`viewportWidth: window.innerWidth`） | `dsh-client-ui-layout/lib/client.js` 的 `createLayoutStore()` |
| 唯一能写到「收起」的入口是 `toggleSidebar()`：宽窗（`viewportWidth >= 1024`）时 `280 ⟷ 0`；窄窗时翻转 `narrowExpanded` | 同上 actions；断点常量 `SIDEBAR_AUTO_COLLAPSE = 1024` |
| `setSidebar(px)` 被 clamp 到 `264–420`，写不到 0（拖拽不是关闭手段） | 同上 |
| 服务面 `ILayout` 只有 `toggleSidebar()`，**没有** `setSidebarCollapsed(bool)` 之类的读/写面 | `lib/types/client/service.d.ts` |
| 面板几何是纯内存态：store 无 `persist` spec → 刷新即回到初值 | `lib/types/client/stores.d.ts`、该包 README |
| `ui-layout` 的 roster 行没有 `config`，layout client 也不读 config → **patch / CSS 层改不了默认值** | `dsh-web-app/cordis.patch.yml` |
| 布局 store handle 挂在 `root` 注册项的 `store` 字段上；`ctx.layout` 与它共享同一个 store 实例 | `client.js` 的 `apply()`（`provide("layout")` + `register({ name: "root", store })`） |
| Web shell 先 `await` 全部插件 apply，之后才 `uiRenderer.mount()` → 在 apply 里写入，**首帧即收起，无闪动** | `dsh-web-frontend/dist` 引导序列（`await clientModules.start(...)` 之后才 `await mount(...)`） |

## 实现

三步，全走服务面，无降级（读不到即 no-op，不回退 DOM / 不点按钮）：

1. **读活 store 判幂等**：`slots.entries('root')` → 带 `store` 字段的注册项 →
   `slots.resolveStore(handle, undefined)` → `getSnapshot().layoutInfo`
   （`resolveStore` 以 handle 对象标识查表，故必须原样回传注册项上的那个对象；root 作用域不传 binding）。
   形状校验只认「数值 `sidebar` + 数值 `viewportWidth`」，据此跳过 `root` 上其它插件的 store。
2. **窄窗不动**：`viewportWidth < 1024` 时上游本来就收起，而此时 `toggleSidebar()` 会走
   `narrowExpanded` 分支**反而把栏展开**——这一条守卫是必需的，故判定一律以 store 里的
   `viewportWidth` 为准（它与 `toggleSidebar` 内部比较的是同一个值，而非 `window.innerWidth`）。
3. **写入一次**：`sidebar !== 0` 时以方法形式调用 `ctx.layout.toggleSidebar()`
   （上游服务是类实例，摘引用调用会丢 `this`）。

### 一次性标记

判定结果记在 `window.__dshSidebarDefaultCollapsed` 上，而不是模块作用域：

- `dsh-client-hmr` 的热替换会重新 `import` 模块并替换 fiber，**模块级变量随之重置**；窗口属性才跨替换存活。
- 语义因此是「每次页面加载只判定一次」：加载后第一次 apply 关闭侧栏，之后（用户手动打开过、插件
  因重建/图变更被重新 apply）不再插手用户的选择。
- 只有读到 store 才置标记；读不到（服务/座位尚未就绪）时不置，留给下次 apply 重试。

`collapseSidebarOnBoot()` 返回判定结果，便于诊断：`closed`（唯一写入的分支）/ `already-closed` /
`narrow` / `visited` / `no-store` / `no-service` / `failed`（toggle 抛错已吞）。

## 已知边界

1. **窄窗加载 → 之后把窗口拉宽**：上游 `setViewportWidth` 跨断点会把 `narrowExpanded` 清零，
   而 `sidebar` 偏好仍是 280，于是侧栏展开一次，本插件不介入（一次性判定已完成）。用户主动把窗口
   拉宽时给出侧栏不算错；要堵住需区分「用户拖成 280」与「默认 280」，代价与误伤都不划算。
2. **刷新即回默认**：上游面板几何不持久化，本插件也 **不**做「记住上次状态」——那是另一种语义
   （「保持上次」而非「默认关闭」）。想要后者应给 layout store 加 persist spec。
3. macOS 桌面端（`data-platform=darwin`）收起后左栏列宽为 0，重开入口靠会话头 leading 座位的按钮；
   本仓库的 `dsh-kbd-hotkeys` 默认 `mod+b` 即 `layout.toggleSidebar()`，两条路都在。其它平台收起后
   保留 56px 图标轨，自带开关。
4. 依赖上游私有面：`toggleSidebar()` 的宽窄分支语义、`root` 注册项的 `store` 座位与
   `slots.resolveStore` 都属实现细节（`resolveStore` 在上游类型里是 private 方法）。上游改写这些
   行为时本插件静默失效（no-op），不会报错、也不会破坏布局。

## 构建与验证

```sh
npm install
npm run typecheck && npm run build && npm run check
node test-boot.mjs
```

- `test-boot.mjs`（纯 Node、无浏览器）：A 部分直接以 Type Stripping 载入 `src/boot-collapse.ts`，
  覆盖宽/窄、断点 1023/1024、已收起、一次性标记幂等、取数不可用（服务缺席 / 无 `resolveStore` /
  `entries` 抛错 / `resolveStore` 抛错 / 快照形状不符）、`root` 上混入其它 store、服务与方法缺席、
  toggle 抛错共 8 组场景；B 部分用 `window.__ModuleLoader__` 桩载入产物 `lib/client.js`，核对
  包名 / `inject` 声明与 `apply` 装配。桩里 `toggleSidebar` 写成读 `this` 的类方法，故「摘引用调用」
  这类缺陷会被测出来。
- `build`：`scripts/build-client.mjs` **直接执行 esbuild 平台二进制**（而非 JS API，后者用 stdio
  管道通信，受限沙箱下 `spawn` 报 `EPERM`）→ `lib/client.js`（入仓，禁止手改）。
- 现场核对（挂载后、浏览器控制台）：

  ```js
  window.__dshSidebarDefaultCollapsed          // true ⇒ 本次加载已判定
  document.querySelector('[data-sidebar-collapsed]') !== null   // 首帧即收起
  getComputedStyle(document.querySelector('[data-sidebar-collapsed]')).gridTemplateColumns
  // 第一轨 = 56px（非 macOS）/ 0px（macOS darwin）；展开态为 280px
  ```

## 加载

```sh
cd <仓库根>/dsh-sidebar-default-collapsed
dsh plugin --profile web add link:.                  # 重启 App 生效（bundle 层不支持热重载）
dsh plugin --profile web remove dsh-sidebar-default-collapsed
```

仅浏览器半部改动：`npm run build` 后由 client-hmr 在 500ms 内热替换，无需重启。
