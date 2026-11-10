# dsh-workspace-quick-switch

两张结构相同、候选不同的浮层：

- **工作区浮层**：按 **`⌘⌥M`（macOS） / `Ctrl+Alt+M`（Windows/Linux）** 弹出，按左侧栏 Workspace 分组的顺序列出工作区；按 `Enter` / 点击一行，**在那个工作区里新建会话**并切过去。
- **会话浮层**：按 **`⌘⌥I`（macOS） / `Ctrl+Alt+I`（Windows/Linux）** 弹出，按左侧栏筛选条件为 **单列表 + 最近更新 + 隐藏已归档** 时的会话顺序列出会话；按 `Enter` / 点击一行，**打开那个会话**。

两张浮层都是**一屏 10 行、更多用 `←` / `→` 翻页**，用 `↑` / `↓` 选，`Esc` 关掉；遮罩会吃掉点击，点浮层外面不会关闭；同时只开一张（开一张会关掉另一张）。焦点落在右侧栏终端里时两个键同样生效。

-----

## 它做什么

本节按使用者能观察到的现象列出全部行为；每条行为背后的机制见「实现要点」。

### 工作区浮层（`⌘⌥M` / `Ctrl+Alt+M`）

- **候选 = 左侧栏那一份**：读 Workspace 控制器的 `list` 快照。宿主把工作区的持久显示顺序通过 `follow()` 的 `order` 增量送下来，所以手动拖拽、`dsh-workspace-activity-sort` 之类的上浮改的正是这一份；浮层照抄顺序、不做自己的排序，也**不截断**——全部工作区都在候选里，只是分页显示。
- **一屏 10 个，`←` / `→` 翻页**：一页固定 10 行（行号是全局序号，第二页从 11 开始），页在两端环状绕回；标题右侧显示「23 个工作区 · 第 2 / 3 页」，只有一页时退化成「4 个工作区」且底栏不出现翻页提示。翻页后选中行落在新一页的第一行。
- **翻页只认 `←` / `→`**：`↑` / `↓` 在当前页内环状走 —— 走到本页第一行再 `↑` 绕到本页最后一行，走到本页最后一行再 `↓` 绕回本页第一行，**不会**因为按到页边界就把页翻过去。想到别的工作区，先 `←` / `→` 翻页。
- **浮层开着的时候候选继续跟随**：工作区新增/删除/改序，列表立刻跟着变，选中行按原下标保留（候选变短到装不下这个下标时回到第一行）。
- **当前工作区会被标出来**：读主视图会话的 `retainedBy.mainView`，再按工作区自己的 `sessionIds` 归属映射(`sessions` 服务缺席时就不标)，打开时默认选中它。
- **`Enter` 与左侧栏那个按钮是同一个动作**：调 `uiWorkspace.startSession(workspaceId)` —— 复用该工作区已有的空白会话，没有才真创建一个。

### 会话浮层（`⌘⌥I` / `Ctrl+Alt+I`）

- **顺序与左侧栏「单列表 + 最近更新 + 隐藏已归档」逐条一致**：候选不是照抄会话目录的 `ids`(那是宿主的目录顺序，含已归档与 subagent 子会话)，而是照上游 `ui-workspace` 的派生链投影：
  1. **单列表**的成员：所有普通会话；`origin: 'subagent'` 的子会话排除；空白会话(“新会话”占位行)只保留主视图当前那一个；
  2. **最近更新**排序：按 `updatedAt` 倒序、同刻按 id 升序；
  3. 当前空白会话提到最前；
  4. **隐藏已归档**：归档会话不出现在候选里(它们仍占排序位置，取消归档就回到原位)；
  5. 渲染分段：空白行 → 置顶行 → 其余，三个分区内部保持上面的相对顺序。
  规则全部落在 `src/sessions.ts` 的纯函数里，逐条对应上游的 `sessionMemberIds` / `orderByRecency` / `pinCurrentBlank` / `sectionMembers`。
- **每行显示**「标题 + 工作区 · 相对时间」：标题用会话的持久标题，空白会话是「新会话」、没有标题的是「未命名」；工作区取账下归属，不属于任何工作区时退回 `cwd` 末段。置顶 / 进行中会以角标出现在标题后面。
- **当前会话会被标出来**：主视图会话(同样是 `retainedBy.mainView`)带「当前」角标，并作为打开时的初始选中行 —— 它排在后面几页时，浮层直接开在那一页。
- **`Enter` 与点击左侧栏那一行是同一个操作**：调 `uiWorkspace.openSession(sessionId)`。
- **浮层开着的时候候选继续跟随**：会话新增、标题变化、`updatedAt` 推进、归档 / 置顶集合变化都会让列表重新投影，选中行按原下标保留(候选变短到装不下这个下标时回到第一行)。
- **没有会话时**照常弹浮层，给出「先在左侧栏新建一个会话」的提示。
- **没有工作区时**照常弹浮层，给出「先在左侧栏添加一个工作区」的提示，`Enter` 不做动作。
- **服务晚到也能补上**：`workspaces` / `sessions` 经 gateway + WebSocket 的远程链路提供，页面刚起来时还不存在；插件照常先占住两个快捷键与两张浮层，服务到位后再接上订阅，候选与「当前」标记随即补上（不需要刷新页面）。
- **焦点在终端里也能开**：焦点落在右侧栏终端(`.xterm`)里时，终端会在自己的 textarea 处理器里 `stopPropagation()`，事件到不了固定通道；插件因此在 window **捕获阶段**另挂一个 `keydown` 监听，在事件进入终端前判定，命中即吞掉这一按(`preventDefault()+stopPropagation()`)再开对应浮层 —— 这一按既不会丢，也不会被 Windows/Linux 的 AltGr 当成字符送进 shell。判定与固定通道共用同一个函数，两条路互斥、一次按键只开一次。
- **macOS 的 `⌘⌥I` 是死键**：Option+I 在 macOS 上组字成 `ˆ`，官方适配器会把这一按的 `key` 读成 `"Dead"`、`composing` 标成 true，固定通道的观察者于是让位。插件另挂一条只认 `key === 'Dead'` 的捕获补偿(与 `dsh-keyboard-shortcuts` 对 `⌘⌥N` 的做法同源)，把这一按认领下来开浮层；焦点在 `.xterm` 内时让给终端捕获。`⌘⌥M` 不是死键，但它走的是同一套判定，补偿对两者都生效。

-----

## 安装与启用

先构建浏览器半部，再把包挂进 web profile。

```powershell
# 1) 构建浏览器半部(产物是 lib/client.js)
cd dsh-workspace-quick-switch
pnpm install          # 首次:把 react / react-dom / @types/* 落进仓库根 node_modules
pnpm build            # 或 ../node_modules/.bin/tsdown

# 2) 挂进 web profile
dsh plugin --profile web add C:\Users\LGZ\dsh-plugins\dsh-workspace-quick-switch
```

挂载后**刷新浏览器**即可(`dsh.client.platform=web` + `immediately`，客户端 roster 会随页面加载)。

-----

## 实现要点

下表是排查入口：每行一个关注点、它的做法，以及做法依赖的上游事实。

| 关注点 | 做法 |
| --- | --- |
| 快捷键 | 注册**两条固定行**(group `application`)：`dsh-workspace-quick-switch.quick-switch` 占 `primary+alt+M`、`dsh-workspace-quick-switch.session-switch` 占 `primary+alt+I`，注册表按平台落成 macOS 的 `⌘⌥M` / `⌘⌥I` 与 Windows/Linux 的 `Ctrl+Alt+M` / `Ctrl+Alt+I`；两条都经 `observeFixedInput` 的固定通道收取按键，带修饰键/重复/组合输入/已消费的输入一律放行；**命中时立刻 `consume()`**(适配器就是 `preventDefault`)—— 固定行只「占住」组合键，上游不会替它消费(`effectiveShortcuts` 把固定行排除在可配置行之外)，不消费的话平台会把同一次 `⌘⌥M` 再执行一遍自己的快捷键（macOS 上顺手把窗口最小化就是这么来的） |
| 终端内的快捷键 | 落在 `.xterm` 里的 keydown 到不了固定通道，所以另挂一个 window **捕获阶段** `keydown` 监听：只对 `closest('.xterm')` 命中的按键出手，判定(`ownedPalette`，两条固定行同一套)与固定通道完全共用，命中即 `preventDefault()+stopPropagation()` 再开对应浮层 —— 两条路互斥、一次按键只开一次 |
| macOS 死键 | Option+I 是死键（`ˆ`），官方适配器的固定通道读数会是 `key: "Dead"` + `composing: true`，观察者因此让位。另挂一条只认 `key === 'Dead'` 的 window 捕获监听（只在 `platform === 'macos'` 时安装），在同一批按键上跑 `ownedPalette`，命中即 `preventDefault()+stopPropagation()` 再开浮层；落点在 `.xterm` 内时让给上面的终端捕获。长按（`repeat`）只吞不动作 |
| 两张浮层互斥 | 打开任一张时先把另一张 `close()`：遮罩与浮层都是全屏层，叠两张只会让人以为按键没生效。候选与选中行各自独立，关闭不清候选 |
| 会话候选 | 会话浮层的候选由 `src/sessions.ts` 投影：单列表成员(`sessionMemberIds` 口径) → `updatedAt` 倒序(`orderByRecency`) → 当前空白会话提前(`pinCurrentBlank`) → 滤掉归档(`archivedFilter: 'default'`) → 空白 / 置顶 / 其余分段(`sectionMembers`)，与左侧栏那三个筛选条件的显示结果逐条对应。归档 / 置顶集合读 Workspace 控制器快照的 `archivedSessionIds` / `pinnedSessionIds`(缺席按空集) |
| 会话的打开动作 | `uiWorkspace.openSession(sessionId)` —— 与点击左侧栏那一行同一个动词；该动词缺席时只告警、不打开浮层（开一个按 Enter 什么都不做的列表更让人困惑） |
| 浮层 | 两张浮层都注册进 `shell.overlay`(加法式列表槽，工作区 `order: 60` / 会话 `order: 61`)，等 ui-layout 声明该槽后再注册；同一个 `PaletteOverlay` 组件 + 各自一份 `PaletteView` 文案(标题、计数单位、空态、底栏提示)，整层默认 click-through，只有遮罩吃指针事件，面板自己拿焦点 |
| 槽位契约 | 注册的第二个参数必须是**组件本体**(`PaletteOverlay`)，业务 props 只由 `options.inject: () => ({ store, view })` 交出来 —— 渲染器对条目做的是 `jsx(entry.component, props)`；`slots.inject` / `slots.register` 还必须以**槽位服务对象本身**为接收者调用(上游用 `this.ctx`，Cordis 服务代理据此把 effect 记到本插件这个 scope 上)，自己 `bind` 到别处会让上游连 `this.ctx` 都读不到 |
| 浮层内的按键 | 本插件在 `document` 捕获阶段接管 `Esc` / `Enter` / `↑` / `↓`（选行）与 `←` / `→`（翻页）（只在浮层开着时），所以先于页面上任何本地控件看到按键，并 `preventDefault` + `stopPropagation`；带修饰键的 `←`/`→`（`Ctrl+←`、`⌘←` 这类有主的键）一律放行 |
| 分页 | 候选在 store 里是**全量**（两个投影函数都不截断），状态只多一个 `page`；页号由 `clampPage` / `turnPage` / `pageSlice` 几个纯函数管，渲染只取当前页那一段。**`move`（`↑`/`↓`）走 `moveWithinPage`，只在当前页内环状步进，绝不改页**；改页的只有 `turn`（`←`/`→`）与两个「程序化定位」入口：打开时落在当前工作区所在页（`pageOf`），`select(index)` 点击/程序选中时页跟着走。最后一页不满时，页内环状范围按实际行数收敛（25 个工作区的第三页只有 5 行，`↓` 到第 25 行就绕回第 21 行） |
| 样式 | 插件自己的 `<style>`（随 fiber 卸载移除），只用主题令牌 `--dsw-*` / `--dsh-*`(多数带回退值；`--dsw-font-family` 没有)，亮/暗主题自动跟随 |
| 浮层高度 | 面板**不设固定上限**，只吃满浮层层留给它的高度（`max-height: 100%`：浮层是 `inset: 0` 的定长容器，上下各留内边距，百分比有确定参照）；视口高度不足 860px 时由末尾的 `@media` 收紧内边距**并把两行文字的行高写死**（`normal` 会随字体回退变化，中文字体比拉丁字体高 2~3px/行，10 行累计足以让第 10 行掉出视口），压到约 551px —— 视口 ≥ 800px 就能一次看全 10 行；更矮的窗口才由**列表内部滚动**兜底，此时选中行靠 `scrollIntoView({ block: 'nearest' })` 跟随（打开时与每次 ↑/↓ 之后都补一次） |
| 依赖 | `inject: ['slots', 'shortcuts']` —— 只等这两个，所以两组键与两张浮层从启动起就在；`workspaces` / `sessions` 用**等待子 fiber**(`scope.inject`)接上：服务到位才跑、换实现时先卸载再重跑，缺席就只是空候选（不告警，那不是故障）；`uiWorkspace` 缺席则固定行照旧在、按键不做动作 |

宿主半部是空实现(没有 `dsh.client` 之外的东西需要宿主做)，所以**改客户端代码必须重建 `lib/client.js`**。Host 在合成那一刻就把产物字节读进快照，所以重新构建后仅刷新页面可能仍拿到旧字节 —— 重启 `dsh web`，或在「设置 → 插件」里关掉再打开本插件，然后刷新页面。

-----

## 验证

验证分构建期的契约校验与运行期的测试两层。

```bash
cd dsh-workspace-quick-switch
pnpm typecheck                 # tsc --noEmit
pnpm check:css                 # 上游槽位 / 主题令牌契约校验(--dsh-root / $DSH_ROOT 可指定 DSH 根)
node test/run-all.mjs          # 六个测试文件(spawn 被沙箱拒时逐个跑,见下)
```

`pnpm check:css`（即 `node check-css.mjs`，不挂在 `pnpm build` 上）逐条校验浮层注册进的 `shell.overlay` 槽、
注入样式消费的 `--dsw-*` / `--dsh-*` 令牌，清单在 [`css-contract.json`](../dsh-workspace-quick-switch/css-contract.json)：
上游改名 / 删 token 时**校验即失败**，不会让浮层静默不显示或掉到兜底色。

| 测试文件 | 覆盖 |
| --- | --- |
| `test/palette.test.mjs` | 纯状态：候选投影（全量、顺序照抄、当前标记）、下标收敛、环状步进、**页内环状步进（`↑`/`↓` 不出本页、末页按实际行数收敛）**、**分页（页数/收敛/环状翻页/切片）**、**store 分页（`turn` 的落点与绕回、`↑`/`↓` 不翻页、候选变短后收敛、单页不动）**、store 写入与批量通知 |
| `test/sessions.test.mjs` | 会话候选投影：**单列表成员**（subagent 排除、空白只留当前）、**最近更新排序**（同刻按 id、不改入参）、**当前空白会话提前**、**分段渲染**（空白 → 置顶 → 其余，归档的置顶不算置顶）、**端到端投影 = 左侧栏「单列表 + 最近更新 + 隐藏已归档」**、显示标题与工作区标签（cwd 末段回退）、相对时间、初始选中行与空输入 |
| `test/keys.test.mjs` | 按键解码：**六个键**（`Esc`/`Enter`/`↑`/`↓`/`←`/`→`）归浮层，带修饰键/组合中/已消费/长按确认都放行；**两组键**的平台键帽与识别（macOS 认 `⌘⌥M` / `⌘⌥I` 且不认 `Ctrl+Alt+…`，Windows/Linux 反之；`M` 与 `I` 两组互不串台） |
| `test/overlay.test.mjs` | 浮层渲染（真 React）：候选行、第二行、`aria-*`、「当前」角标、`installPaletteKeys` 的接管范围、**分页渲染（一屏 10 行、全局序号、页码文案、单页时退化成总数且无翻页提示）**、**高度策略（面板不吃固定像素上限、列表自己滚动、顶部内边距仍让开标题栏）**、**选中行滚进可见区（按选中行的 DOM id 查找、`block: 'nearest'`、找不到时静默）**、**会话浮层用同一组件换一份文案与候选（根标记 / 标题 / 计数单位 / 底栏提示 / 角标 / 独立行 id 前缀 / 空态）**、**两张浮层各挂一份按键监听、只认自己那个 store** |
| `test/install.test.mjs` | 装配：**两条固定行**注册(`macOS` 落成 `⌘⌥M` / `⌘⌥I`、`Windows` 落成 `Ctrl+Alt+M` / `Ctrl+Alt+I`)、**两张浮层**注册进 `shell.overlay`、候选跟随快照、按键到 `startSession` 的端到端、**命中时消费这次按键（别的组合键、已消费输入、固定行被挤掉时都不消费）**、上游缺席时的降级、**工作区/会话服务晚到后补上读数**、**终端内的捕获拦截(各平台只认自己那一组、非 `.xterm` 目标/别的键/长按/组字/固定行被挤掉都放行不吞、没有 `window` 时静默、卸载后监听撤掉)**、**←/→ 端到端翻页(翻到第二页、第二页上 `Enter` 命中第 11 个工作区、重开回到第一页、两页时环状绕回)**、**`↑`/`↓` 端到端不翻页(连按 10 次 ↓ 仍停在第 0 页并绕回本页首行、末页 `↓` 只在末页内绕)**、**会话浮层端到端(`Ctrl+Alt+I` 打开、顺序=空白→置顶→最近更新、subagent 与归档不在候选、`Enter` 走 `openSession`、归档集合变化立刻生效、当前会话换了之后初始选中行跟着走、两张浮层互斥)**、**会话浮层的分页与第 11 行命中**、**macOS 的 `⌘⌥I` 与死键补偿(`composing` 的读数让位、`Dead` 那一按被认领并吞掉、卸载撤掉监听)**、卸载清理 |
| `test/artifact-client.test.mjs` | 产物：`lib/client.js` 的模块 id / 插件名 / `inject`、只向模块表要 `react`、**两条固定行 + 两张浮层**、装配后端到端可用、命中时同样消费按键、**产物里 `←`/`→` 也归浮层且一屏 10 行（漏掉翻页的产物会退回「10 个封顶」的旧行为）**、**终端内的 ⌘⌥M 在产物里同样开浮层并吞掉事件**、**产物里的会话浮层候选顺序与 `Enter → openSession`**、**产物里的 macOS 死键补偿** |

`test/run-all.mjs` 用 `spawnSync` 逐个跑；受限沙箱里 spawn 会被拒（EPERM），此时直接：

```bash
node test/palette.test.mjs && node test/sessions.test.mjs && node test/keys.test.mjs \
  && node test/overlay.test.mjs && node test/install.test.mjs && node test/artifact-client.test.mjs
```

-----

## 边界

以下限制来自设计取舍或上游事实，不是缺陷。

- **默认绑定按平台落成**：两条固定行声明的是逻辑组合 `primary+alt+M` / `primary+alt+I`，注册表按设备平台规范化成生效的物理绑定 —— macOS 上是 `⌘⌥M` / `⌘⌥I`，Windows 与 Linux 上是 `Ctrl+Alt+M` / `Ctrl+Alt+I`。「两个修饰键 + 普通键」在 `web:windows` / `web:macos` 档案下合法；固定行又不走可配置命令的 Web 允许表(`isWebBindingAllowed`)，`registerFixed` 只做键码规范化与校验，所以 Linux 上同样注册成功。按键与其它命令的冲突由快捷键服务按固定行规则裁决（固定行先拿到这一按），快捷键目录里能看到这一行。
- **组合键归插件所有，不会落到平台那一层**：固定行命中时插件自己 `consume()`(`preventDefault`)，所以 `⌘⌥M` 只开浮层 —— 不会连带触发平台/浏览器自己的同名快捷键(典型就是 macOS 上 `⌘M` 的最小化窗口)；`uiWorkspace` 缺席、浮层开不了的时候也照样消费，否则这一按照样会被平台拿走（终端内的捕获路径同理：先吞再开，开不出来也不把这一按还给平台）。反过来，别的组合键(含 `⌘M` 本身)一律不消费，系统与浏览器的快捷键照旧生效。
- **不做搜索过滤、不做拖拽排序、不切换工作区归属**：工作区浮层只负责「选一个工作区，在那里新建会话」，会话浮层只负责「选一个会话，打开它」——不改标题、不归档、不置顶。
- **会话浮层只覆盖那一个筛选组合**：顺序按「单列表 + 最近更新 + 隐藏已归档」投影，**不跟随**左侧栏当前的视图选项 —— 用户在左侧栏切到「按工作区树 / 手动排序 / 显示已归档」时，浮层仍是这一套顺序。理由是这个组合是默认视图，也是「排好序的一次性列表」最有用的一种；跟随视图选项意味着浮层要复制上游整套视图状态（含浏览器本地持久化的手工排序），那是另一个插件的体量。
- **会话浮层不折叠**：会话行在左侧栏受「每分组 5 行 + 展开更多」的水位线限制，浮层不受限 —— 它列出全部可见会话，用分页浏览。
- **一页 10 行、不做虚拟滚动**：翻页是整页替换（`pageSlice` 只渲染当前页），不是把几十行塞进一个滚动列表；页数多时靠 `←` / `→` 逐页走，没有跳页输入。
- **矮窗口里第 10 行要滚动**：视口高度低于约 800px（macOS 顶栏下约 860px）时，10 行候选超出浮层可用高度，列表内部滚动；键盘选中行会自动滚进可见区，第 10 行仍然可达，只是需要按 ↓ 或滚动。
- **点浮层外面不关闭**：遮罩(`.dsh-workspace-quick-switch-backdrop`)吃指针事件，但没有绑定关闭动作，所以只有 `Esc` 能关；点击某一行反而等同确认。
- **鼠标划过不改选中行**：悬停只给高亮，`Enter` 永远落在键盘/点击选中的那一行；点击某一行直接就是 `Enter` 的效果。
