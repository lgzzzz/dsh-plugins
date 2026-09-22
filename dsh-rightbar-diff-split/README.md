# dsh-rightbar-diff-split

让右栏「**变更审阅**」diff 的左右对比（分栏）跟随右栏**全屏状态**的本地持久化插件：
**全屏 → 分栏；非全屏 → 不分栏**。

纯浏览器半部（宿主半部为空占位），注入 `slots` + `sessions` + `uiSession` 三个服务。
它是**状态跟随**、不是快捷键：不接管任何键位、不改 DOM、不点击按钮、不轮询，只在
**三种事件**发生的那一刻按当时全屏值设一次。

> 实现依据：`docs/plan-rightbar-fullscreen-diff-split.md`（方案分析）。本插件是其中的推荐形态
> （新建独立插件），并采用其待确认项的全部默认口径：只认三种事件 / 只作用当前会话当前面板的
> 当前标签 / 从 diff 切走不写入 / 生效时不补写既有状态。

## 上游事实（判定依据，以源码为准）

| 事实 | 依据 |
| --- | --- |
| 「全屏」真身是布局 store 的 `layoutInfo.rightbarFullscreen`，`data-rightbar-fullscreen` 只是它的 DOM 投影 | `dsh-client-ui-layout/lib/client.js`（`openRightbar` / `closeRightbar` 写它）、`lib/types/client/stores.d.ts` |
| 该值由 sidebar-right 的面板反汇编得到：`fullscreen = viewportWidth < 768 \|\| layout.mode === 'fullscreen'`，收起时 `closeRightbar()` 置 false | `dsh-client-ui-sidebar-right/lib/client.js` 的 `RightbarSeat` / `syncPresentation` |
| 布局 store 挂在 `root` 注册项的 `store` 座上（root 作用域 → `resolveStore(handle, undefined)`） | `dsh-client-ui-layout` 的 `apply()`；`dsh-client-ui-renderer` 的 `resolveStore` 以 handle 对象标识查表 |
| 右栏布局（当前面板 / 标签）在会话级 store 上：`rightbar.session` 注册项的 store，`bySession[sessionId].layout` 给出 `nodes` / `tabs` / `activePaneId` | `dsh-client-ui-sidebar-right/lib/client.js` 的 seat 注册与 `createSidebarRightStore` |
| `nodes[activePaneId].kind === 'pane'` 是上游不变量；浮窗被聚焦时 `activePaneId` 就是那个浮窗 | 同上的布局校验；`getPane(layout, layout.activePaneId).activeTabId` |
| 变更审阅页 = 注册项 key `@deepseek-ai/dsh-client-ui-deliverables`（`sidebar.right.pane.tab`，会话作用域），其标签记录 `kind === 'changes-review'` | `dsh-client-ui-deliverables/lib/client.js` |
| 视图状态 `byTab[tabId] = {index, split, wrap, navigated}`：**首次 `navigated` 播种 `split: true`**（页 body 的 effect 才调），写面只有 `toggledSplit(d, tabId) { tab.split = !tab.split }`（**toggle，无 setSplit**），桶缺席时抛错 | 同上 |
| 活实例是引擎 store，带 `subscribe(fn) => unsubscribe`（uSES 的 invalidation 侧，默认同步 flush） | `dsh-client-store/lib/types/contract.d.ts`、`lib/index.js` 的 `createSnapshotStore` |
| `uiSession.current` 是当前会话的绑定源（`getSnapshot().key` = 会话 id，带 `subscribe`）；`bindingSource({sessionId, binding})` 物化会话作用域绑定 | `dsh-client-ui-session/lib/client.js` |
| 服务面 `layout` 只有 `toggleSidebar` / `openRightbar` / `closeRightbar`，**没有读面** | `dsh-client-ui-layout` 的 `service.d.ts` |

## 触发口径（只认三种事件）

| # | 事件 | 判据（与上一次快照比对） | 动作 |
| --- | --- | --- | --- |
| ① | 打开一个标签，且它是变更审阅 | 当前标签 `activeTabId` 变成一个此前未知的 id，且 `kind === 'changes-review'` | 按当时全屏值 set 一次 |
| ② | 切到另一个标签，且被切到的是变更审阅 | 当前标签变为 diff 标签，且 id 与上次已知的 diff 标签不同 | 同上 |
| ③ | 右栏全屏状态变化 | `layoutInfo.rightbarFullscreen` 翻转；对象是**当时的当前 diff 标签** | 变为全屏 → 分栏；变为非全屏 → 不分栏 |

三种事件之外（手动点页头「左右对比」、拖标签 / 拖分隔条 / 移动浮窗、展开收起面板但全屏值未变、
切换文件名……）插件**一律不介入**，用户的选择被保留。

## 实现

### 1. 三步取数（`src/resolve.ts`）

`slots.entries(<slot>)` → 带 `store` 的注册项 → 会话作用域绑定（`uiSession.bindingSource({sessionId, binding: sessions.binding(sessionId)})`
→ `slots.resolveStore(handle, binding)` → 活实例的 `getSnapshot()`。与渲染端同一份内存态
（绝不用 `handle.create()`：那会铸出第二个实例）。三份 store：

- **布局 store**（`root`，root 作用域）：形状判据 `layoutInfo.rightbarFullscreen` 是布尔
  （`root` 上还有其它插件的 store，故按形状认）；
- **右栏 store**（`rightbar.session`，会话作用域）：形状判据快照带 `bySession` 对象；
- **变更审阅视图 store**（`sidebar.right.pane.tab` 中 `options.key === '@deepseek-ai/dsh-client-ui-deliverables'`，
  会话作用域）：形状判据快照带 `byTab` 对象且实例带 `actions`。

任一步不可用（服务缺席、`entries` / `resolveStore` / `binding` 抛错、形状漂移）即 `undefined` → no-op，
绝不回退 DOM。

### 2. 判定与写入（`src/diff-split.ts`）

```text
sessionId   = uiSession.current.getSnapshot().key
fullscreen  = 布局 store 的 layoutInfo.rightbarFullscreen
当前标签    = bySession[sessionId].layout → nodes[activePaneId].activeTabId → tabs[id].kind
期望值 desired = fullscreen
写入 = 当前标签是 changes-review 且 byTab[tabId].split ≠ desired 时调 actions.toggledSplit(tabId)
```

判定表（`apply()`）：

| 全屏 | 当前标签 | 现状 split | 结果 |
| --- | --- | --- | --- |
| 是 | 变更审阅 | false | `written`（→ 分栏） |
| 是 | 变更审阅 | true | `aligned`（幂等，不写） |
| 否 | 变更审阅 | true | `written`（→ 不分栏） |
| 否 | 变更审阅 | false | `aligned` |
| 任意 | 非变更审阅 / 无标签 | — | `no-target`（只对 diff 动手） |
| 任意 | 变更审阅但 `split` 非布尔 | — | `unknown`（状态未知，不猜也不写） |
| 任意 | 变更审阅但 `byTab[tabId]` 缺席 | — | `deferred`（页 body 未挂载，待完成） |
| 任意 | 取数链任一环不可用 | — | `unavailable` |

**两处判等职责不同、必须同时存在**：

- `tab.id !== lastDiffTabId` = **事件筛选**（要不要做）。订阅是持续的、通知是高频的
  （右栏 store 的 `subscribe` 覆盖所有改 `bySession` 的动作：拖标签、拖分隔条、浮窗移动、展开收起……），
  缺了它「当前标签是 diff」在每一次通知里都成立，就会退化成「持续纠正」——用户手动开的分栏会被
  下一次任意右栏操作关掉；
- `splitOf(...) !== desired` = **幂等读**（做了要不要真写）。同一 tick 的两条通知（布局 + 右栏）
  会各触发一次，缺了它会 toggle 两次翻回原样。

`lastDiffTabId` 的另一个职责是「切走必须重置」：当前标签不是 diff 标签时置回 `undefined`，
否则 `diff A → 文件标签 → diff A` 这条路径切回时 id 未变、事件 ② 会漏掉。
读不到布局 / 面板 / 标签记录时**不动快照**（读不到 ≠ 没有 diff 标签），避免误判成「重新打开」。

### 3. 订阅与退订（`src/subscriptions.ts`、`src/client.ts`）

| 订阅 | 位置 | 捕获 |
| --- | --- | --- |
| A | 布局 store 活实例 `subscribe` | 事件 ③，并用来读 `layoutInfo` |
| B | 右栏 store 活实例 `subscribe` | 事件 ①② |
| C | `uiSession.current.subscribe` | 换会话 → 会话级快照作废 + 重建会话级订阅 |
| D | `slots.subscribe('root' / 'rightbar.session' / 'sidebar.right.pane.tab')` | 座位晚到 / 重注册 → 重建 + 解除待完成 |
| E | 变更审阅视图 store 活实例 `subscribe` | 视图桶诞生（页 body 挂载）→ 解除待完成 |

实例**每次现解析、不缓存**；解析成功才建立订阅，重建先全量退订。全部订阅走
`ctx.effect(() => () => hub.dispose())`：client-hmr 的 fiber 替换即退订，模块闭包里的只读快照
（`lastDiffTabId` / `lastFullscreen`）随新 fiber 重置，**不写 `window` 标记**（本插件是持续行为，
不是一次性启动判定）。

### 4. 「打开时」的时序坑

打开 diff 标签的顺序是：store 先提交标签记录并 focus → React 渲染页 body → body 的 effect 才调
`actions.navigated(tabId)` 播种 `byTab[tabId]`。故事件 ① 到达时视图桶可能还不存在（`toggledSplit`
会抛）——这一次记为**待完成**（成对记下「会话 id + 标签 id」），由 E（视图桶诞生）/ D（注册变化）
解除，兜底再加**一次**有界重试（`requestAnimationFrame`，无 rAF 环境退化为一次 0ms 宏任务；
**不是轮询**：至多调度一次）。待完成期间若发生 ③，解除时按**最新**全屏值重算；换会话、或目标已不是
当前 diff 标签时待完成作废（会话与标签都必须是当时的那个，防跨会话误写）。

## 已知边界

1. **收起面板 = 非全屏**：从全屏收起时上游 `closeRightbar()` 置 `rightbarFullscreen = false`，
   这属于事件 ③ → 插件会把当前 diff 标签设为不分栏（与方案的「风险 2 / 事件 ③」口径一致）。
   在非全屏（push）状态下收起再展开不产生全屏翻转，插件不介入，手动分栏被保留。
2. **窄窗（框架宽 < 768）**：上游 `autoFullscreen` 恒真 ⇒ 面板展开即全屏 ⇒ 分栏。这是上游语义，
   不做特殊处理。
3. **同一 tick 内先标签事件、后全屏翻转**：两次事件会各写一次（第一次按旧全屏值、第二次按新值），
   最终状态正确、中间多一次 toggle；上游两次 store 提交的顺序由它自己决定，插件不与它争。
4. **换会话**：会话级快照作废后按新会话当前标签重新判定（id 恰好与旧会话相同也会按事件 ① 重设一次）。
5. **多右栏标签 / 其它面板**：只作用「当前会话 + 当前面板的当前标签」；同一面板内其它 diff 标签、
   浮窗里的 diff、其它会话的 diff 都不动（`toggledSplit` 本就是 per-tab 的）。
6. **依赖上游私有面**：`layoutInfo.rightbarFullscreen`、`rightbar.session` 的 `store` 座、
   `slots.resolveStore`（上游类型里是 private 方法）、deliverables 的 `toggledSplit` 与注册项 key
   都属实现细节。上游改写时本插件**静默失效**（no-op）而非误写：形状校验放第一位。
7. **生效时不补写既有状态**：插件加载时若 diff 已开着，`apply()` 那一刻不会立即对齐一次。但注意
   「首帧」与「第一个事件」的区分：若加载后**第一条**布局通知（帧宽 / 左栏宽等无关提交）到达时
   当前标签已是 diff，该通知会走 `checkTabEvent` 判为事件 ① 并按当时全屏值写一次——它是事件驱动，
   不是加载时主动补写，故口径与「只认三种事件」一致。
8. **`dsh-kbd-hotkeys` 的 ⌘/Ctrl+S**：该插件在切全屏时也会同步分栏（它自己的键位语义）。两者
   按同一入口写同一份 store，结果一致；本插件不做键位、不与之冲突。

## 构建与验证

```sh
npm install
npm run typecheck && npm run build && npm run check
node test-diff-split.mjs
```

- `test-diff-split.mjs`（纯 Node、无浏览器）三个部分：
  - **A** 以 Type Stripping 直载 `src/diff-split.ts` + `src/subscriptions.ts`，用类方法形态的
    store / slots 桩驱动：三种事件各自触发写入、非三事件一律不介入（非全屏与全屏下各 6 轮
    各类右栏通知后手动分栏仍保留）、判定表全部行、首次读到状态只记快照、桶缺席的推迟 /
    解除 / 作废（含「换会话后旧会话待完成作废，哪怕新会话有同 id 标签」）、推迟期间全屏翻转
    按最新值、同 tick 双通知只 toggle 一次、各环缺席或抛错时 no-op 不抛、订阅建立 / 重建不
    叠加 / 换会话重绑 / 退订归零；
  - **B** 用 `window.__ModuleLoader__` 桩载入产物 `lib/client.js`，核对包名 / `inject` 声明、
    `apply` 装配（生效不补写、三种事件端到端、`ctx.effect` 退订）与容错；
  - **C** 同上产物下的「无 effect / 二次 apply」等边界。
- `build`：`scripts/build-client.mjs` **直接执行 esbuild 平台二进制**（而非 JS API，后者用 stdio
  管道通信，受限沙箱下 `spawn` 报 `EPERM`）→ `lib/client.js`（入仓，禁止手改）。
- 人工（`npm run build` 后 client-hmr 会在 500ms 内热推送，无需刷新）：打开 diff（全屏 → 分栏 /
  非全屏 → 不分栏）、切到另一个 diff 标签、⌘/Ctrl+S 与页头按钮切全屏、非全屏下手动开分栏后不再
  被插件改动、收起再展开面板、跨 768px 缩放窗口。

## 加载

```sh
cd <仓库根>/dsh-rightbar-diff-split
dsh plugin --profile web add link:.                  # 重启 App 生效（bundle 层不支持热重载）
dsh plugin --profile web remove dsh-rightbar-diff-split
```

仅浏览器半部改动：`npm run build` 后由 client-hmr 在 500ms 内热替换，无需重启。
