# dsh-rightbar-diff-split

本插件承担两件**互不依赖**的事：

1. **分栏回正**：让右栏「**变更审阅**」diff 的左右对比（分栏）与右栏**全屏状态**恒等 ——
   **分栏 = 全屏**，任何时刻都相等；
2. **悬停浮窗抑制**：一条样式规则摘掉聊天区「改动卡片」文件行的**悬停 diff 浮窗**（见下）。

纯浏览器半部（宿主半部为空占位），注入 `slots` + `sessions` + `uiSession` 三个服务（样式补丁
不依赖任何服务，`ctx.get` 全返回 `undefined` 也照装）。它是**状态跟随**、不是快捷键：不接管任何
键位、不改 DOM 结构、不点击按钮、不轮询、**不引入任何延迟调度器**（无 `requestAnimationFrame` /
`setTimeout` / `queueMicrotask` / `Promise.then` / 防抖）；唯一的 DOM 写入是向 `document.head`
追加一个 `<style data-plugin="dsh-rightbar-diff-split">`（fiber 退场时摘除）。

> 实现依据：`docs/plan-rightbar-fullscreen-diff-split.md`（方案分析）。本插件采用其推荐形态
> （新建独立插件），并已从早期「只认三种事件」演进为**持续回正**：只作用当前会话当前面板的
> 当前标签、只对 `changes-review` 动手、取数任一环不可用即本次 no-op 等口径保持不变。

## 页头「左右对比」按钮 = 只读状态指示器

页头工具行里的 `<button data-review-tool="split" aria-pressed={split}>` **保留**，但**点击改变
不了状态**：点击提交后，插件在**同一次同步通知内**把 `split` 翻回去，终态永远等于全屏值，
视觉上就是「点了没反应」（连一帧中间态都没有）。按钮因此降级为**只读状态指示器** ——
`aria-pressed`、图标旋转、tooltip 文案仍然准确反映当前状态。

本插件**不接管键位、不动按钮的 DOM**（唯一的样式写入是「浮窗抑制」那条规则，与分栏无关）。同理：

- `dsh-kbd-hotkeys` 的 `sidebarRight.diffSplit`（默认未绑定）写的是同一份 store，会被同一次同步
  通知回正 ⇒ 绑定后表现为**点了没反应**；该插件的 ⌘/Ctrl+S 现在**只切全屏**、不再同步分栏
  （因此与本插件无交叉）。**本插件不改那个插件**；
- 想真正切换分栏，只能改全屏状态（面板全屏 / 退出全屏）。

## 浮窗抑制：改动卡片的文件行不再弹悬停 diff

聊天区回合末尾「改动卡片」里的每个文件行都挂在 `dsh-client-ui-deliverables` 的 `HoverCard`
上（`variant: "preview"`、`openDelayMs: 500`），悬停 500ms 弹出「路径头 + 整段 diff」浮窗。
本插件用**一条样式规则**把该浮窗整棵子树从布局与命中测试里摘掉：

```css
/* dsh-rightbar-diff-split: suppress the changed-files card's hover diff popup */
[data-changes-hover-preview] {
  display: none;
}
```

| 事实（判定依据，以源码为准） | 依据 |
| --- | --- |
| 浮窗根元素带稳定标记 `data-changes-hover-preview`（路径头另有 `data-changes-preview-path`），**整个 `@deepseek-ai` scope 内只有这一处** | `dsh-client-ui-deliverables/lib/client.js` L1190–1199（`ChangedFilePreview`） |
| 浮窗是挂在**文件行**上的 `HoverCard`：`variant: "preview"`、`openDelayMs: 500`、`widthAnchorRef` = 卡片元素 | 同上 L1126–1138 |
| `HoverCard` 上游自带 `disabled` 抑制开关，但 `ChangedFiles` **没有传** ⇒ 触发路径无法从外部关闭 | 同上（props 无 `disabled`） |
| 浮窗内容只在浮窗打开期间挂载（`"Mounted only while its hover card is open"`），内部 `FileDiff` 固定 `split: false, wrap: false` | 同上 L1178–1210 |
| 命中与定位全在 `HoverCard` 内部实现（`position: fixed` + 内联 left/top/width/maxHeight），类名是 CSS-module 哈希 ⇒ **不能**当锚点 | 同上 |
| 反复悬停**不会**反复发请求：读取走 `HostReadStore.loadUrl`，已有非重试状态即 `return` | 同上 L180–193 |

**口径与代价（有意为之）**：这不是「阻止触发」，而是「呈现抑制」—— 上游 500ms 后依旧进入 open、
依旧 portal 挂载、依旧有 Escape 监听与淡出；被摘掉的只是它的**可见性与命中面**。用 `display: none`
而不是 `opacity` / `visibility`：后两者仍占着 `position: fixed` 的命中区，会挡住底下的文件行与
页头按钮。

样式只在 `document.head` 追加一个 `<style>`，清理函数与订阅一起挂在 `ctx.effect`：client-hmr
换 fiber 即摘除（`ctx.effect` 缺席时仍装，只是没有生命周期钩子来摘）。取不到 `document` /
`document.head` / `createElement` 即整条 no-op，**不抛**。上游若不再打该属性，本补丁**静默失效**
（浮窗重新出现），不会误伤其它 UI。

## 上游事实（判定依据，以源码为准）

| 事实 | 依据 |
| --- | --- |
| 「全屏」真身是布局 store 的 `layoutInfo.rightbarFullscreen`，`data-rightbar-fullscreen` 只是它的 DOM 投影 | `dsh-client-ui-layout/lib/client.js`（`openRightbar` / `closeRightbar` 写它）、`lib/types/client/stores.d.ts` |
| 该值由 sidebar-right 的面板反汇编得到：`fullscreen = viewportWidth < 768 \|\| layout.mode === 'fullscreen'`，收起时 `closeRightbar()` 置 false | `dsh-client-ui-sidebar-right/lib/client.js` 的 `RightbarSeat` / `syncPresentation` |
| 布局 store 挂在 `root` 注册项的 `store` 座上（root 作用域 → `resolveStore(handle, undefined)`） | `dsh-client-ui-layout` 的 `apply()`；`dsh-client-ui-renderer` 的 `resolveStore` 以 handle 对象标识查表 |
| 右栏布局（当前面板 / 标签）在会话级 store 上：`rightbar.session` 注册项的 store，`bySession[sessionId].layout` 给出 `nodes` / `tabs` / `activePaneId` | `dsh-client-ui-sidebar-right/lib/client.js` 的 seat 注册与 `createSidebarRightStore` |
| `nodes[activePaneId].kind === 'pane'` 是上游不变量；浮窗被聚焦时 `activePaneId` 就是那个浮窗 | 同上的布局校验；`getPane(layout, layout.activePaneId).activeTabId` |
| 变更审阅页 = 注册项 key `@deepseek-ai/dsh-client-ui-deliverables`（`sidebar.right.pane.tab`，会话作用域），其标签记录 `kind === 'changes-review'` | `dsh-client-ui-deliverables/lib/client.js` |
| 视图状态 `byTab[tabId] = {index, split, wrap, navigated}`：**首次 `navigated` 播种 `split: true`**（页 body 的 effect 才调） | 同上 |
| **`toggledSplit` 是 toggle（`tab.split = !tab.split`），没有 `setSplit`**：所以只能「先读后写」，且读与写必须在同一段同步代码里完成 | 同上 L2047–2050 |
| **该 store 是 sync flush**：`defineStore` 只传 `persist`、**不传 `flush`** ⇒ `createSnapshotStore(init)` 走默认分支，`api.subscribe(fn)` 在 zustand 通知里**同步**调回调 | `dsh-client-store/lib/index.js` L70–102（sync 分支）/ L147–152 |
| **uSES 只比较「上一次渲染的值」与 `getSnapshot()`**：同 tick 内「用户提交 → 我们回正提交」结束时，React 要么合并成一次渲染、要么根本不排渲染 | `dsh-client-ui-renderer` 的 uSES 桥 |
| 页头按钮与 `navigated` 播种写的是**同一个 store** ⇒ 两者都会通知插件 | `dsh-client-ui-deliverables/lib/client.js` L1893–1903 / L2020–2030 |
| 活实例是引擎 store，带 `subscribe(fn) => unsubscribe`（uSES 的 invalidation 侧，默认同步 flush） | `dsh-client-store/lib/types/contract.d.ts`、`lib/index.js` 的 `createSnapshotStore` |
| `uiSession.current` 是当前会话的绑定源（`getSnapshot().key` = 会话 id，带 `subscribe`）；`bindingSource({sessionId, binding})` 物化会话作用域绑定 | `dsh-client-ui-session/lib/client.js` |
| 服务面 `layout` 只有 `toggleSidebar` / `openRightbar` / `closeRightbar`，**没有读面** | `dsh-client-ui-layout` 的 `service.d.ts` |

## 回正口径（持续回正）

**一条规则**：`split` 必须等于全屏值。任一次订阅通知（布局 store / 右栏 store / 变更审阅
视图 store 的提交）、任一次 slots 注册变化、任一次会话切换，以及插件加载，都就地跑一次
`drive()`：读全屏值 → 读当前会话当前面板的当前标签 → 若是 `changes-review` 且快照里的
`split !== 全屏值`，调一次 `actions.toggledSplit(tabId)`（**先读后 toggle**，幂等）。

**唯一判据是「现读快照的 `split` 与现读的全屏值是否相等」**：没有事件筛选（不比对上一次
标签 id / 上一次全屏值），也**没有任何「上次写入值」之类的记忆** —— 记忆会让「用户绕过
插件改成的发散」被漏掉，也会掩盖真正的回归。

判定表（`DiffSplitOutcome`）：

| 全屏 | 当前标签 | 现状 | 结果 |
| --- | --- | --- | --- |
| 是 | 变更审阅 | `split === false` | `written`（→ 分栏） |
| 是 | 变更审阅 | `split === true` | `aligned`（幂等，不写；稳态下每条通知都走这里） |
| 否 | 变更审阅 | `split === true` | `written`（→ 不分栏） |
| 否 | 变更审阅 | `split === false` | `aligned` |
| 任意 | 变更审阅 | `byTab[tabId]` 缺席（页 body 未挂载，上游 `navigated` 尚未播种） | `no-bucket`（本次不写、不留簿记，靠下一次通知自愈） |
| 任意 | 变更审阅 | `split` 非布尔（形状漂移） | `unknown`（不猜也不写） |
| 任意 | 非变更审阅 / 无标签 / 面板形状不符 | — | `no-target`（只对 diff 动手） |
| 任意 | 取数链任一环不可用（服务缺席、`entries` / `resolveStore` / `binding` 抛错、`actions.toggledSplit` 缺席、快照形状漂移） | — | `unavailable`（本次不写、不抛） |
| 任意 | 变更审阅 | 写入时 `toggledSplit` 抛错（如上游 `bucket()` 抛） | `write-failed`（不崩，靠下一次通知自愈） |

**无降级、无重试**：任一步取数不可用即本次不写、不抛、不加簿记（不再有 pending / 有界重试），
等下一次通知 —— 这就是新的「自愈」口径。

### 五路订阅各自的作用

| 订阅 | 位置 | 作用 |
| --- | --- | --- |
| A | 布局 store 活实例 `subscribe` | **发散源 + 自愈源**：全屏翻转（`openRightbar` / `closeRightbar` / 窄窗 autoFullscreen）→ 直接回正 |
| B | 右栏 store 活实例 `subscribe` | **发散源 + 自愈源**：打开 / 切换当前标签、面板展开收束等任何 `bySession` 提交 → 直接回正 |
| E | 变更审阅视图 store 活实例 `subscribe` | **发散源 + 自愈源**：页 body 挂载时的 `navigated` 播种（`split: true`），以及**页头按钮 / 热键的 `toggledSplit` 自身** → 直接回正 |
| C | `uiSession.current.subscribe` | **重绑**：换会话 → 会话级 store 实例按会话 id 铸，订阅必须跟着换（先重建再回正） |
| D | `slots.subscribe('root' / 'rightbar.session' / 'sidebar.right.pane.tab')` | **重绑**：座位晚到 / 重注册 → 先重建订阅再回正 |

A/B/E 走 `onNotify`（直接 `drive()`）；C/D 走 `onRebuild`（`hub.rebuild()` 后再 `drive()`）。
实例**每次现解析、不缓存**；解析成功才建立订阅，重建先全量退订；三键 slot 单键失败不拖垮其余。

### 为什么必须同步（三条事实合起来才成立）

1. 写面只有 `toggledSplit`（toggle、无 setSplit）⇒ 只能先读后写，读与写之间不能被别的提交
   插进来，否则会把别人的翻转吃掉；
2. 该 store 是 **sync flush** ⇒ 我们能在**触发它的那次同步通知栈内**再提交一次；
3. uSES 只认「上一次渲染值」⇒ 这条序列结束时 React 合并成一次渲染（或干脆不排渲染），
   **一帧中间态都不会出现**。

若改成 `requestAnimationFrame` / `setTimeout` / `queueMicrotask` / `Promise.then` 之后再回正，
中间那一帧就会真的画出来（按钮闪一下、图标转一下）。所以 `src/` 里不出现任何调度器，
`drive()` 也不做任何 await。

### 为什么桶缺席不再需要「待完成」

打开 diff 的顺序是：store 先提交标签记录并 focus → React 渲染页 body → body 的 effect 才调
`actions.navigated(tabId)` 播种 `byTab[tabId]`。事件到达时桶可能还不存在，但**播种本身会提交
同一个 store** ⇒ 一定还会再通知我们一次，于是本次 `no-bucket`、下一次自然对齐。
上游 `navigated` 首次总是播种 `split: true`，所以「全屏打开 → 已对齐不写 / 非全屏打开 →
被回正一次」都落在同一个机制上。

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
desired     = 布局 store 的 layoutInfo.rightbarFullscreen
当前标签    = bySession[sessionId].layout → nodes[activePaneId].activeTabId → tabs[id].kind
写入 = 当前标签是 changes-review 且 byTab[tabId] 存在且 split ≠ desired 时调 actions.toggledSplit(tabId)
```

`createDiffSplitSync(services, { log? })` 只暴露两个方法：`drive(): DiffSplitOutcome`（唯一入口）
与 `state(): { fullscreen, writes, lastOutcome }`（**只读诊断，不参与判定**）。

### 3. 订阅与退订（`src/subscriptions.ts`、`src/client.ts`）

`createSubscriptionHub({ services, onNotify, onRebuild })` 装配 A–E 五路；`client.ts` 里
`onNotify: () => core.drive()`、`onRebuild: () => { hub?.rebuild(); core.drive() }`，
随后 `hub.rebuild()` → `core.drive()`（**加载即对齐一次**）。全部订阅走
`ctx.effect(() => () => hub.dispose())`：client-hmr 的 fiber 替换即退订，模块闭包里的诊断快照
随新 fiber 重置，**不写 `window` 标记**。

### 4. 呈现补丁（`src/hover-preview.ts`、`src/client.ts`）

`installHoverPreviewStyles(document, name)` 追加 `<style data-plugin="dsh-rightbar-diff-split">`
（唯一规则见「浮窗抑制」），返回摘除函数；`apply` 在装配回正**之前**调用它，摘除函数与
`hub.dispose()` 挂在同一个 `ctx.effect` 清理里。它与服务解析、订阅、回正**零耦合**：
`ctx` 全缺时样式照装，`document` 不可用时整条 no-op、回正路径不受影响。
`host` 入参按结构校验（`createElement` 是函数、`head` 是带 `appendChild` 的对象），不匹配即返回
`undefined` —— 便于诊断脚本用桩驱动、也避免形状漂移时误写。

## 已知边界

1. **收起面板 = 非全屏**：从全屏收起时上游 `closeRightbar()` 置 `rightbarFullscreen = false`，
   这会导致「回正为不分栏」（终态仍与全屏值恒等）。在非全屏（push）状态下收起再展开不产生
   全屏翻转，插件不介入（此时 split 本就等于 false）。
2. **窄窗（框架宽 < 768）**：上游 `autoFullscreen` 恒真 ⇒ 面板展开即全屏 ⇒ 分栏。这是上游语义，
   不做特殊处理。
3. **同一 tick 的双提交是幂等的**：一次用户提交往往触发不止一条通知（布局 + 右栏 + 审阅），
   第一条把 `split` 写回全屏值，其余各条读到的已是 `aligned`，不会翻第二次。
4. **换会话**：会话级订阅重绑后按新会话当前标签重新判定（id 恰好与旧会话相同也照样按现读判）。
5. **多右栏标签 / 其它面板**：只作用「当前会话 + 当前面板的当前标签」；同一面板内其它 diff 标签、
   浮窗里的 diff（`activePaneId` 指向浮窗时它就成为「当前标签」，此时**会**按它判定）、其它会话的
   diff 都不动（`toggledSplit` 本就是 per-tab 的）。
6. **依赖上游私有面**：`layoutInfo.rightbarFullscreen`、`rightbar.session` 的 `store` 座、
   `slots.resolveStore`（上游类型里是 private 方法）、deliverables 的 `toggledSplit` 与注册项 key
   都属实现细节。上游改写时本插件**静默失效**（no-op）而非误写：形状校验放第一位。
7. **按钮 / 热键不再能改变状态（设计如此）**：`dsh-kbd-hotkeys` 的 `sidebarRight.diffSplit`
   （默认未绑定）写的是同一份 store，会被同一次同步通知回正，因而变成**无效**（点击 / 按键后的
   终态仍等于全屏值）；该插件的 ⌘/Ctrl+S 已改为只切全屏、不碰分栏，故与本插件无交叉。
   本插件不改那个插件。
8. **新开 diff 标签时上游先播种 `split: true`**：非全屏下紧接着被我们回正为 `false`，这中间会有
   **一次渲染后的一帧**（上游自己的播种渲染，与本次改动无关；插件无法在播种发生前阻止它）。
9. **`ctx.effect` 缺席时不退订、也不摘样式**：与旧版一致，没有 `ctx.effect` 就没有 fiber 生命周期
   钩子（HMR 重建会各自留一份订阅与一份 `<style>`）；正常 Web 组合下 `ctx.effect` 恒在。
10. **浮窗抑制是上游私有标记上的呈现补丁**：`data-changes-hover-preview` 属 deliverables 的实现
    细节，上游改写或换锚点时本补丁**静默失效**（浮窗重新出现），不会误伤其它 UI；它也无法恢复
    上游「悬停即触发」的行为 —— 要彻底关掉触发只能由上游给 `HoverCard` 传 `disabled`。

## 构建与验证

```sh
npm run typecheck && npm run build && npm run check
node test-diff-split.mjs
```

- `test-diff-split.mjs`（纯 Node、无浏览器、无 DOM、无定时器）三个部分：
  - **A** 以 Type Stripping 直载 `src/diff-split.ts` + `src/subscriptions.ts`，用类方法形态的
    store / slots 桩驱动：判定表全部行、**点击回正的同步性**（用户 toggle 返回后的**下一条语句**
    就断言已回正，不许 await / 不许 flush 定时器）、稳态下几十轮非发散通知零写入且恒为 `aligned`、
    写失败 `write-failed` 后由下一次通知自愈、加载即对齐、布局 / 右栏 / 审阅三条通知路径**各自**
    都能回正、桶缺席 `no-bucket` 且不留簿记、订阅 A–E 的建立 / 重建不叠加 / 换会话重绑 /
    拓扑通知「先重建再回正」/ 退订归零、各环缺席或抛错时 no-op 不抛；
  - **B** 用 `window.__ModuleLoader__` 桩载入产物 `lib/client.js`，核对包名 / `inject` 声明、
    `apply` 装配（五路订阅、`ctx.effect` 登记 1 个 disposer、**加载即对齐**）与产物级端到端
    （全屏翻转、换标签、新开标签播种、**模拟点击页头按钮 → 同步回正**、退订后不再介入）；
  - **C** 同上产物下的「ctx 全缺 / `ctx.get` 抛错 / 无 effect / 二次 apply（HMR 重建）」容错。
- **样式补丁 `src/hover-preview.ts` 无自动化覆盖**：`test-diff-split.mjs` 是纯 Node 环境（无
  `document`），只覆盖回正路径；样式补丁按下面人工验证清单第 0 条核对。
- `build`：`scripts/build-client.mjs` **直接执行 esbuild 平台二进制**（而非 JS API，后者用 stdio
  管道通信，受限沙箱下 `spawn` 报 `EPERM`）→ `lib/client.js`（入仓，禁止手改）。
- 人工验证清单（`npm run build` 后 client-hmr 会在 500ms 内热推送，无需刷新）：
  0. **聊天区「改动卡片」的文件行悬停 500ms 不再弹 diff 浮窗**：DevTools 里该浮窗节点仍在
     （`[data-changes-hover-preview]`）但 `display: none`、不占命中区（底下的行与页头按钮照常可点）；
  1. **点页头「左右对比」按钮无反应**（`aria-pressed` / 图标 / tooltip 仍随状态变化）；
  2. **`dsh-kbd-hotkeys` 的分栏热键（若绑过）无效**；其 ⌘/Ctrl+S 只切全屏、不动分栏；
  3. 拖分隔条 / 缩放窗口 / 展开收束面板 / 移动浮窗不打断稳态（split 恒等于全屏值）；
  4. 进入全屏 → 立即分栏；退出全屏（含收起）→ 立即不分栏；
  5. 全屏下打开新的 diff 标签：先看到上游播种的一帧分栏（见边界 8），随后与全屏值一致；
     非全屏下打开：播种后立刻变为不分栏；
  6. 切到另一个 diff 标签 → 立即对齐；切到非 diff 标签 → 插件不动任何东西。

## 加载

```sh
cd <仓库根>/dsh-rightbar-diff-split
dsh plugin --profile web add link:.                  # 重启 App 生效（bundle 层不支持热重载）
dsh plugin --profile web remove dsh-rightbar-diff-split
```

仅浏览器半部改动：`npm run build` 后由 client-hmr 在 500ms 内热替换，无需重启。
