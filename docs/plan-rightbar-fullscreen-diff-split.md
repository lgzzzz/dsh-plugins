# 方案分析：右栏全屏状态驱动 diff 分栏

> 目标（用户原话）：当任意 diff 页面被打开或被切换到时，检测当前右边栏是不是全屏状态；
> 如果是全屏 → 把 diff 页面设为分栏；如果不是全屏 → 设为不分栏。
> **触发口径（用户最终确认，只认三种事件，均在触发时 set 一次，不做持续纠正）**：
> ① **打开一个侧边栏标签**，且它是 diff 标签 → 全屏则设分栏、非全屏则设不分栏；
> ② **从一个标签切换到另一个标签**，且被切换到的标签是 diff 标签 → 同样按当时全屏值 set；
> ③ **右边栏全屏状态发生变化** → 变为全屏则设分栏、变为非全屏则设不分栏。
> 三种事件之外（例如用户手动点页头「左右对比」）插件一律不介入。
> 本文只做实现方案分析，不含代码。

推荐形态：**新建一个 client-only TypeScript 插件 `dsh-rightbar-diff-split`**（宿主半部为空 `apply(){}`），
不并入现有 `dsh-kbd-hotkeys`——后者是「快捷键分发」，本插件是「状态跟随」，两者的触发源与生命周期不同。
（备选：并入 kbd-hotkeys，复用其 `rightbar-layout.ts` / `rightbar-view.ts` / `scope-binding.ts`，
代价是把一个持续订阅型行为塞进一个按键型插件。见 §8。）

---

## 1. 需求拆解

| 需求要素 | 上游对应事实 |
| --- | --- |
| 「diff 页面」 | 右栏「变更审阅」标签，tab 记录 `kind === 'changes-review'`（`@deepseek-ai/dsh-client-ui-deliverables`） |
| 「被打开或被切换到」 | ① 新建：该标签成为**当前面板的当前标签**（`layout.activePaneId` → pane 的 `activeTabId`）且此前不是；② 切换：`activeTabId` 变为另一个 diff 标签。两者都靠**当前标签 id 变化**判定 |
| 「右边栏全屏状态」 | 布局 store 的 `layoutInfo.rightbarFullscreen`——**上游自己算出来的那个布尔**（值翻转即事件 ③） |
| 「设置分栏 / 不分栏」 | 变更审阅视图 store 的动作 `toggledSplit(tabId)`（页头「左右对比」按钮同一入口，toggle 语义，故须先读 `byTab[tabId].split`） |

---

## 2. 上游事实（以源码为准）

### 2.1 「全屏」的真身在布局 store，不在 DOM

`dsh-client-ui-layout/lib/client.js`：

- `createLayoutStore()` → `layoutInfo.rightbarFullscreen`（`L411-467`、`lib/types/client/stores.d.ts L43`）；
- 布局 store **挂在 root 注册项的 `store` 座**上（`L610-636`），root 作用域、`resolveStore(handle, undefined)` 可取活实例；
- `data-rightbar-fullscreen` 只是它的投影（`L342`），**不是**真身。

### 2.2 但「真身」的上游定义在 sidebar-right：`fullscreen = autoFullscreen || mode==='fullscreen'`

`dsh-client-ui-sidebar-right/lib/client.js`：

- `RightbarSeat`（`L5350-5355`）：`autoFullscreen = viewportWidth < 768`；`fullscreen = autoFullscreen || surface.layout.mode === 'fullscreen'`；
- `track = shown && !autoFullscreen`（`L5361`，`shown = active && expanded`）；
- `syncPresentation({shown, track, fullscreen})` → `layout.openRightbar(track, fullscreen)`（`L8522-8525`）→ 写 `layoutInfo.rightbarFullscreen`。

**推论（本方案最关键的一点）**：`layoutInfo.rightbarFullscreen` 与上游面板内判定**恒等**，
因为两者是同一个反汇编值、同一次调用写入；且把「面板收起 → 不算全屏」也一并编码了进去
（`closeRightbar` 置 false，`layout.openRightbar` 只在 shown 时被调用）。

### 2.3 diff 分栏的写面

`dsh-client-ui-deliverables/lib/client.js`：

- 注册项 key `CHANGES_REVIEW_ID = '@deepseek-ai/dsh-client-ui-deliverables'`（`L1972`），
  注册在 slot `sidebar.right.pane.tab`，带 `store: createReviewStore()`（`L2267-2288`，排他 store，框架每会话铸一份）；
- 状态 `byTab[tabId] = {index, split, wrap, navigated}`，首次 `navigated` 播种 `split: true`（`L2020-2032`）；
- 写面只有 `toggledSplit(d, tabId) { bucket(d,tabId).split = !tab.split }`（`L2047-2050`）——**toggle，无 setSplit**；
- 桶缺席时 `bucket()` 抛错（`L1999-2003`）。

### 2.4 取数范式（本仓库已在用，直接照抄）

`slots.entries(<slot>)` → 带 `store` 的注册项 → 会话作用域绑定（`uiSession.bindingSource({sessionId, binding})`）
→ `slots.resolveStore(handle, binding)` → 活实例的 `getSnapshot()` / `actions` / `subscribe()`。
模板：`dsh-kbd-hotkeys/src/scope-binding.ts`、`dsh-sidebar-default-collapsed/src/boot-collapse.ts`（root 作用域传 `undefined`）。

**关键补充（本方案要用、现有插件还没用的能力）**：活实例是引擎 store，带
`subscribe(fn) => unsubscribe`（`dsh-client-store/lib/types/contract.d.ts L58-72`）——
即本插件可以**事件驱动**、无需轮询。

---

## 3. 架构草图

```text
                 ┌────────────────────────────────────────────┐
  布局 store ───►│ layoutInfo.rightbarFullscreen / viewportWidth│  ← 全屏真身（订阅）
  （root 作用域） └────────────────────────────────────────────┘
                 ┌────────────────────────────────────────────┐
  rightbar store │ bySession[sid].layout: activePaneId/tabs    │  ← 「当前 diff 标签是哪个」（订阅）
  （会话作用域）  └────────────────────────────────────────────┘
                 ┌────────────────────────────────────────────┐
  review store   │ byTab[tabId].split                          │  ← 现状 + 写面 toggledSplit（订阅 + 读）
  （会话作用域）  └────────────────────────────────────────────┘
                              │
                     apply()  ← 三种事件统一入口；见 §4 判定表、§5 事件判定
                              │ desired = 全屏；现状 ≠ desired 才写
                              ▼
                 actions.toggledSplit(tabId)
```

服务依赖（`export const inject`）：`slots`、`sessions`、`uiSession`
（`slots` 取三份活实例，`sessions`+`uiSession` 只为构造会话作用域绑定）。
默认不注入 `sidebarRight`：全屏判定不需要它（`layoutInfo` 更准，见 §2.2 推论）。

---

## 4. 判定与写入

### 4.1 状态推导

```text
sessionId  = uiSession.current.getSnapshot().key
layoutInfo = resolveStore(entries('root') 上带 store 的注册项, undefined).getSnapshot().layoutInfo
layout     = resolveStore(entries('rightbar.session') 上带 store 的注册项, binding(sessionId)).getSnapshot().bySession[sessionId].layout

展开   = layout.expanded === true
全屏   = layoutInfo.rightbarFullscreen === true          // 上游同一反汇编值
目标标签 = layout.tabs[layout.nodes[layout.activePaneId].activeTabId]，要求 kind === 'changes-review'
期望分栏 desired = 全屏                                  // 非全屏 → false
```

### 4.2 判定表

| 面板 | 全屏 | 当前 diff 标签 | 现状 split | 动作 |
| --- | --- | --- | --- | --- |
| 展开 | 是 | 变更审阅 | false | **写**（→ 分栏） |
| 展开 | 是 | 变更审阅 | true | 无（幂等） |
| 展开 | 否 | 变更审阅 | true | **写**（→ 不分栏） |
| 展开 | 否 | 变更审阅 | false | 无 |
| 展开 | 任意 | 非变更审阅 / 无标签 | — | 无（只对 diff 动手） |
| 收起 | — | — | — | 无（上游 `rightbarFullscreen=false`，且面板不可见） |
| 任意 | 任意 | 变更审阅但 `byTab[tabId]` 缺席（body 未挂载） | — | **推迟**（见 §5.4） |

---

## 5. 触发源：只认三种事件（其余一律不触发）

订阅本身是持续的，但 **三种事件之外任何通知都不触发写入**（判定为事件后统一调 `apply()`）：

| # | 事件 | 判定依据（与上一次快照比对） |
| --- | --- | --- |
| ① | 打开一个侧边栏标签，且它是 diff 标签 | 当前标签 `activeTabId` 变成了一个此前**从未出现过**的 id（上游 `planOpenContent` 铸新 TabId），且该标签 `kind === 'changes-review'` |
| ② | 从一个标签切换到另一个标签，且被切换到的标签是 diff 标签 | 当前标签变为一个 diff 标签，且它与上一次的当前 diff 标签不同（含切面板 `focusPane` 后当前标签落在 diff 上） |
| ③ | 右边栏全屏状态变化 | `layoutInfo.rightbarFullscreen` 的值翻转；**对象是当时的当前 diff 标签**（当前标签不是 diff 标签时不写） |

①② 的区分：`lastDiffTabId === undefined` → ①，否则 → ②。**被切换到的标签不是 diff 标签时两者都不触发**。
两者对写入口径完全一致（都按「当时全屏值 → 期望分栏」set 一次），分开只为诊断日志可读。

三种事件的动作都是**同一个函数** `apply()`：`desired = 全屏；若 splitOf(当前 diff 标签) !== desired 则 toggledSplit`。

订阅面（只为捕获这三种事件而存在）：

| 订阅 | 位置 | 捕获的事件 |
| --- | --- | --- |
| A | 布局 store 活实例 `subscribe` | ③（`setMode`／页头按钮／⌘S）以及 ② 的伴生布局提交；同时用来读 `layoutInfo` |
| B | rightbar store 活实例 `subscribe` | ① 的标签记录提交与 focus、② 的 `focusTab`／`focusPane`、`closeTab` |
| C（可选） | `uiSession.current`（`HostObservable.subscribe`） | 切会话时重新解析会话作用域 store；**不单独触发写入**（见风险 13） |
| D（仅用于解除 §5.4 的推迟） | `slots.subscribe('sidebar.right.pane.tab', …)` | diff 页 body 挂载（视图桶诞生） |

事件判定用两个**只读快照变量**（模块闭包内，不写 window）：

```text
lastDiffTabId  : string | undefined   // 上一次已知的「当前 diff 标签」id
lastFullscreen : boolean | undefined  // 上一次已知的全屏值（undefined = 尚未读到，见风险 11）

onLayoutNotify():   fs = 读 layoutInfo.rightbarFullscreen
                    if (lastFullscreen !== undefined && fs !== lastFullscreen) apply('fullscreen')   // 事件 ③
                    lastFullscreen = fs
                    checkTabEvent()

onRightbarNotify(): checkTabEvent()

checkTabEvent():    tab = 当前面板的当前标签
                    if (tab === undefined || tab.kind !== 'changes-review') { lastDiffTabId = undefined; return }
                    if (tab.id !== lastDiffTabId) apply(lastDiffTabId === undefined ? 'open' : 'switch') // 事件 ① / ②
                    lastDiffTabId = tab.id
```

`apply()` 内部再做一次**幂等读**：`splitOf(byTab[tabId]) === 期望值` 就什么也不做（见 §4.2）。
这层读是防抖与防自激（布局与视图两条通知可能同一 tick 各触发一次），不是触发条件。

### 5.1 为什么必须比对 `lastDiffTabId`（缺少 `≠` 就退化成「持续纠正」）

**订阅是持续的，通知却是高频的。** rightbar store 的 `subscribe` 覆盖了所有会改 `bySession` 的动作，
而它并不是「标签切换」专用通道：

| 会发通知的动作 | 是否属于事件 ①② |
| --- | --- |
| `focusTab` / `openContent` / `focusPane` / `closeTab` | 是 |
| `setExpanded`（展开收起面板）、`setMode`（切全屏） | 否（后者走事件 ③） |
| `placeTab` / `dropTab`（拖拽标签）、`splitPane` / `resizeSplit`（分栏与拖分隔条） | 否 |
| `floatTab` / `unfloatPane` / `moveFloat` / `resizeFloat`（浮窗拖动） | 否 |
| `open(sessionId)`（面板首次物化）、`undo` / `redo` | 否 |

若去掉 `tab.id !== lastDiffTabId`，「当前标签是 diff 标签」这一条会在**上述每一次**通知里都成立，
于是**每一次拖拽、每一次移动浮窗、每一次拖动分隔条**都会调用 `apply()`，按当时的全屏值把 split 回正。
后果就是用户在非全屏下手动点页头「左右对比」开的分栏，会在下一次任意右栏操作时被立刻关掉——
即从「三种事件触发一次」退化成「持续纠正」，直接违背已确认的口径。

**`lastDiffTabId` 的全部职责，就是把这句 `apply('open' | 'switch')` 限制在「当前标签 id 真的变了」这一刻。**
它不是缓存、不是去重优化，而是**触发条件本身**：三种事件的判定都靠与上一次快照比对，而不是靠订阅本身。

顺带它还有两个作用：

1. **承担「切走必须重置」的语义**：`checkTabEvent()` 在当前标签不是 diff 标签时把
   `lastDiffTabId` 置回 `undefined`。否则「diff A → 文件标签 → diff A」这条路径里，
   `lastDiffTabId` 仍是 A，`id !== lastDiffTabId` 不成立 ⇒ 切回时不触发 ⇒ 事件 ② 漏掉
   （用户口径明确要求「切换到 diff 标签」要设一次）。**这一步是漏触发风险的主要来源。**
2. **用 id 的「新铸性」天然区分事件 ① 与 ②**：上游每次 `openContent` 都铸新 TabId，
   所以 `lastDiffTabId === undefined` ⇒ 这次是打开（①），否则是切换（②）；
   不需要额外保存「本会话曾见过哪些 diff 标签」，也不需要查上游的 occurrence 域。

> 注意区分**两处**判等，它们职责不同、不可互相替代：
> - `id !== lastDiffTabId`（§5 表格）＝ **事件筛选**：决定「要不要做」；
> - `splitOf(...) !== desired`（§4.2）＝ **幂等读**：决定「做了要不要真写」。
>
> 只留后者会退化成持续纠正；只留前者则在同 tick 多通知时会重复 toggle 两次（split 翻回原样），
> 所以两者必须同时存在。

### 5.2 切走重置与切回语义的取舍

因为切走时重置为 `undefined`，「diff A → 非 diff → diff A」会被记成事件 ①（打开）而不是 ②（切换）。
**两者写入口径完全相同**（都按当时全屏值 set 一次），故行为无差异，只有诊断标签不同。
若要精确区分，额外记一个 `lastAnyTabId` 即可；本方案默认不做（无行为收益）。

### 5.3 为什么这样就不会跟用户打架

用户手动点页头「左右对比」时，通知确实会到达订阅，但 `activeTabId` 与 `rightbarFullscreen`
都没变 ⇒ 不满足 ①②③ ⇒ 插件不介入，用户的选择被保留（**这就替代了此前「记住目标 key」的设计**）。
只有当用户切标签、切全屏、或重开 diff 时，才由插件按当时的全屏值重新设定——正好是需求要的语义。

### 5.4 「打开时」的时序坑

打开 diff 标签的顺序是：store 先提交 tab 记录并 focus → React 渲染页 body → body 的 effect
才调 `actions.navigated(tabId, …)` 播种 `byTab[tabId]`。因此事件 ① 到达时
`resolveStore` 可能拿不到桶（调用 `toggledSplit` 会抛，必须包 try/catch 且视为 no-op）。

处理：这一次 `apply()` 记为**待完成**，由 D 订阅（页 body 挂载）解除；
兜底再加一次有界 rAF 重试（**最多 1 帧**，不做定时轮询、不做长轮询）。
待完成状态不影响事件判定：期间若发生 ③，按最新全屏值重算期望值即可。绝不回退 DOM 点击。

---

## 6. 边界与风险

| # | 情形 | 行为 / 处理 |
| --- | --- | --- |
| 1 | 窄窗（框架宽 < 768） | 上游 `autoFullscreen` 恒真 ⇒ 面板展开即全屏 ⇒ 分栏。这正是上游语义，不做特殊处理 |
| 2 | 面板收起 | `rightbarFullscreen=false` ⇒ 不分栏 |
| 3 | 用户在非全屏动手开分栏 | **保留，不纠正**：`activeTabId` 与全屏值都没变 ⇒ 不满足 ①②③（已按用户口径确认） |
| 4 | `byTab[tabId].split` 非布尔 | 视为「状态未知」，不写（与 `dsh-kbd-hotkeys/src/rightbar-view.ts L84-90` 同判据） |
| 5 | 浮窗中的 diff | `activePaneId` 指向浮窗时同样成立，自动覆盖 |
| 6 | 多右栏（未来） | 只看当前会话 + `activePaneId`，不枚举全部面板 |
| 7 | store 活实例重建 | 每次 `apply()` 现解析（不缓存实例），订阅在解析成功时建立、失败/失效时重建 |
| 8 | 插件 HMR | 全部订阅走 `ctx.effect(() => cleanup)`，fiber 替换即退订；事件快照是模块闭包变量，随 fiber 重建重置；不写 `window` 标记（本插件是持续行为，不是一次启动判定） |
| 9 | 服务缺席（`slots`/`sessions`/`uiSession`） | 判空后 no-op，绝不抛错拖垮 Web 启动（AGENTS 注意事项 2/9）；服务方法一律以方法形式 `call(owner, …)` |
| 10 | 上游版本漂移 | `rightbarFullscreen`（0.1.x `stores.d.ts`）与 `toggledSplit`（deliverables store）是消费面；形状校验放第一位，字段改名即静默 no-op 而非误写 |
| 11 | 首帧竞态 | `apply` 时 root 注册已提交、面板可能还没挂载：A 订阅先建立，快照初值为 `undefined`，**第一次读到状态只记快照不写**（不算事件），避免 boot 期误判为「全屏改变」 |
| 12 | 插件生效前的既有状态 | 例如插件加载时 diff 已开着且是全屏：不补写（用户口径只认三种事件）。如需要「生效即对齐一次」，那是一行额外的首帧对齐，默认不做（见 §8.4） |
| 13 | 切换会话 | 会话切换会换掉会话作用域 store 目标；若切过去后当前标签仍是 diff，`activeTabId` 通常已变化 ⇒ 走事件 ② 正常处理；标签 id 恰好相同的极端情形不补写（由 §8.2 决定是否加显式会话事件） |
| 14 | 同时打开多个 diff 标签 | **已确认**只作用于**当前面板的当前标签**，其余 diff 标签各自的分栏状态不动（上游 `toggledSplit` 本就是 per-tab 的） |
| 15 | 从 diff 标签切到非 diff 标签 | **已确认不写入**（事件 ② 要求「被切换到的标签是 diff」）；`lastDiffTabId` 置回 `undefined`，下次切回 diff 时按事件 ① 处理 |

---

## 7. 验证方式（交付前必须跑）

1. `npm run typecheck`（tsc --noEmit，含宿主 `index.ts` 与 `src/*`）；
2. `npm run build`（esbuild 平台二进制 → `lib/client.js`）+ `npm run check`（产物 `node --check`）；
3. **纯 Node 诊断脚本**（照 `dsh-sidebar-default-collapsed/test-boot.mjs` 与
   `dsh-kbd-hotkeys/test/*.mjs` 的路子，无需浏览器）：
   - A 部分：Type Stripping 直载 `src/*.ts`，用类方法形态的 slots/store 桩驱动判定与事件分发，覆盖
     ① 打开 / ② 切换 / ③ 全屏翻转 三种事件各自触发写入、非三事件（如手动 toggle 引发的通知）**不触发**、
     §4.2 判定表全部行、首次读到状态只记快照、桶缺席时推迟与解除、各环缺席/抛错时 no-op；
   - B 部分：`__ModuleLoader__` 桩载入产物，校验包名 / `inject` / `apply` 装配与订阅/退订；
4. 人工：`npm run build` 后 client-hmr 会在 500ms 内热推送（无需刷新），依次验证
   打开 diff（全屏 → 分栏 / 非全屏 → 不分栏）、切到另一个 diff 标签、⌘/Ctrl+S 与页头按钮切全屏、
   非全屏下手动开分栏后不再被插件改动、收起再展开面板、跨 768px 缩放窗口。

---

## 8. 待确认

1. ~~覆盖强度~~ —— **已确认**：只认三种事件，触发时按当时全屏值 set 一次；不做持续纠正；
   非全屏下手动开的栏保留。
2. ~~事件 ③ 的作用对象~~ —— **已确认**：只设置**当前的 diff 标签**（当前面板的当前标签）；
   同一面板内其它 diff 标签、其它面板/会话的 diff 标签都不动。
3. ~~从 diff 标签切走时是否清除~~ —— **已确认：不处理**（事件 ② 只要求「被切换到的标签是 diff」）。
   切走时 `lastDiffTabId` 置回 `undefined`（不作任何写入），下次切回该 diff 标签按事件 ① 重设。
4. **切换会话要不要算显式事件**：默认「否」（靠 ② 的标签变化自然覆盖，见风险 13）。
5. **插件归属**：新建 `dsh-rightbar-diff-split`（推荐）还是并入 `dsh-kbd-hotkeys`。
6. **生效时是否对齐一次**：插件加载时若 diff 已开着，要不要立即按当前全屏值设一次？默认「否」（风险 12）。

---

## 9. 为什么不用这些替代路线

| 替代路线 | 否掉的理由 |
| --- | --- |
| 读 `window.innerWidth < 768` 判全屏 | 上游判的是**框架元素**宽度（ResizeObserver 量 `frameRef`），与窗口宽在文档滚动条/跨断点改窗时有偏差；且漏掉手动 `mode==='fullscreen'` |
| 读 DOM `data-rightbar-fullscreen` | 属性变化确实可被 MutationObserver 观察到，但它是投影而非真身，且给插件引入 DOM 契约；`layoutInfo` 是同一次反汇编的源头，且现在是可订阅的 |
| 直接 `slots.resolveStore(layoutHandle)` 再 `handle.create()` | 绕过 renderer 的实例缓存会铸出**第二个实例**（state 不同步）；必须走 `resolveStore(handle, undefined)` 拿框架缓存的那一份 |
| 调 `actions.setMode` 去「制造」全屏 | 反了：本插件是**读**全屏、写分栏。写 `layoutInfo` 是 sidebar-right 的职责，插件不得越权 |
| 用 `sidebarRight` 服务面推断全屏 | 服务只暴露 `isExpanded()`/`active()` 等，没有 fullscreen 读面；`layoutInfo.rightbarFullscreen` 更直接且更准 |
