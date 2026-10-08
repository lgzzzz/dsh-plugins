# 构建、测试与启用

> 本文件是 [dsh-focus-free-shortcuts 说明](../README.md) 的第 7 册：怎么构建、怎么跑测试、怎么启用与撤销。

---

## 9. 构建与测试

```bash
cd dsh-focus-free-shortcuts
../node_modules/.bin/tsdown                          # 构建产物（或 pnpm build）
node test/run-all.mjs                                # 跑测试（或 pnpm test）
node test/decide-escape.test.mjs                     # 只跑某一组
../node_modules/.bin/tsc --noEmit                    # 类型检查（或 pnpm typecheck）
node check-css.mjs                                   # 上游 DOM 锚点契约校验（或 pnpm check:css）
node --check lib/client.js && node --check index.ts  # 语法检查（或 pnpm check）
```

源码按「一组快捷键一个文件」分，每组自带纯判定与桥：

| 文件 | 内容 |
|---|---|
| `src/pane-keys.ts` | 第 1 组：面板键 `⌘⌥Enter` 全屏 / `⌘\` 分屏 |
| `src/page-close.ts` | 第 1 组附带：关闭当前页面 `page.close`（Web/macOS `⌘⌥W` / Web/Windows·Linux `Ctrl+Alt+W`）—— 与面板键同一条活动 dock pane 回退，只关页面、不关窗口；Web 独有（Desktop 的 `⌘W` 本来就免聚焦） |
| `src/stop-sequence.ts` | 第 2 组：停止序列 `Esc` `Esc` |
| `src/approval-keys.ts` | 第 3 组：审批键 `Enter` 允许一次 / `Esc` 拒绝 |
| `src/focus-composer.ts` | 第 4 组：聚焦输入框 `primary+alt+J`（macOS `⌘⌥J` / Windows/Linux `Ctrl+Alt+J`；官方没有的键，插件自己挂固定键） |
| `src/page-cycle.ts` | 第 5 组：页面循环 `primary+alt+←` / `primary+alt+→`（macOS `⌘⌥←` / `⌘⌥→` / Windows/Linux `Ctrl+Alt+←` / `Ctrl+Alt+→`；官方没有的键对，插件自己挂固定键；切页后自动聚焦新页面） |
| `src/strip-scroll.ts` | 第 5 组附带：右栏页签行的滚动 —— 注入一条作用域限定在右侧栏的 `scroll-behavior: auto` 规则（消掉"先回到最左、再迅速滑过去"的动画），并在切页前后保持观察窗口（`captureStripScroll` / `restoreStripScroll`：先还回旧位置，只有目标芯片不在窗口里时才按最小可见 + 24px 边缘余量推移）。纯视图补偿，不消费按键、不参与归属；由页面切换桥的注入作用域安装 / 卸载 |
| `src/session-cycle.ts` | 第 7 组：会话导航 `primary+↑` / `primary+↓`（macOS `⌘↑` / `⌘↓` / Windows/Linux `Ctrl+↑` / `Ctrl+↓`，全部候选）与 `primary+alt+↑` / `primary+alt+↓`（macOS `⌘⌥↑` / `⌘⌥↓` / Windows/Linux `Ctrl+Alt+↑` / `Ctrl+Alt+↓`，只走活跃会话）（官方没有的键对，插件自己挂两条固定键；候选只取左侧栏前三个工作区当前渲染出来的会话行，活跃 = 行上有状态点者，终端内另走捕获拦截） |
| `src/question-keys.ts` | 第 6 组：提问卡片 `Esc` 取消 / 关闭（同一个 `pendingInteraction` 槽位的提问域，调面板自己的 `dismiss()`） |
| `src/binding.ts` | 八组共用：上游手势 / 绑定 / 两类快捷键目录行的匹配（纯函数，无 DOM、无 Cordis） |
| `src/capture.ts` | 三桥共用：捕获阶段的按键落点（`composedElement` / `pressElement`）、原始手势（`captureGesture`）、归属上下文（`captureContext`：区域 + 模态）与终端落点判定（`terminalTarget`），由页面循环桥（终端）、会话导航桥（终端）与审批桥（过程卡片）的捕获钩子共用 |
| `src/focus-ring.ts` | 审批桥用：拿走某个控件的按键之后，给它打上官方的"无环聚焦"标记（`data-dsh-automatic-focus`）——焦点不动，那圈 `:focus-visible` 边框不显形；标记在 blur 或 Tab / 方向键导航时按官方同一套规则摘除 |
| `src/runtime.ts` | 八组共用：插件名与诊断、固定输入 keydown 窄化、主视图会话判定 |
| `src/client.ts` | 入口：把八组桥各装一次（`apply`），`name` / `inject` 也在这里导出 |

> 这些文件不自行重述上游类型：所有手势 / 绑定 / 目录行 / 待答审批 / 待答提问 / 会话与服务面都是 `import type` 自上游声明（清单见第 6 册第 8 节），打包时被擦除，客户端纯度门看不到它们。

`test/` 下按主题分散（A–Q 十七组，外加「平台键端到端」R、「页签行瞬时滚动」S 与「页面关闭桥」T 三组，共二十组；共享装置在 `test/helpers.mjs`，runner 是 `test/run-all.mjs`）：

- **A 绑定判定**（`test/decide-binding.test.mjs`）：`bindingMatches`（修饰键顺序无关、双键和弦拒绝）、`enabledBinding`（解绑 / 保留 / 冲突 / 缺席）
- **B Escape 准入**（`test/decide-escape.test.mjs`）：`escapeEligible` 逐项否决
- **C 目标归属**（`test/decide-ownership.test.mjs`）：`conversationOwnsTarget` 的假 DOM（含 approval / iframe / xterm / inert）、`mainViewSessionId` 的唯一主视图判定
- **D Escape 序列**（`test/decide-stop-sequence.test.mjs`）：窗口 / 代际 / reset
- **H 审批判定**（`test/decide-approval.test.mjs`）：`fixedRowOwns` / `approvalOutcomeFor`（跟随挂载的固定行、行改键、行缺席）、`approvalEligible` 逐项否决、`approvalPanelOwnsTarget`、`asAnswerableApproval` / `presentedApproval`
- **N 提问判定**（`test/decide-question.test.mjs`）：`questionEscapeEligible` 逐项否决（裸 `Esc` 且无修饰 / 非 repeat / 非组字 / 未消费 / 无模态 / 非终端；`editable` 准入）、`questionCardOwnsTarget` 的按卡片键归属（本卡片的文本域 / 根 / plan-review 卡片命中，别的键、composer、审批面板、body、无 `getAttribute` 的裸根落空）、`asDismissableQuestion` / `presentedQuestion`（`kind` 必须落在提问域、`key` 为字符串、`dismiss` 为函数）
- **J 聚焦判定**（`test/decide-focus-composer.test.mjs`）：固定行预约的物理组合（macOS `⌘⌥J` / Windows/Linux `Ctrl+Alt+J` 各自命中，另一平台的组合不命中）、`focusComposerEligible` 逐项否决（page 与文本控件都准入，模态 / 终端 / repeat / 组字 / 已消费否决）
- **L 页面循环判定**（`test/decide-page-cycle.test.mjs`）：固定行一行预约两个方向（macOS `⌘⌥←` / `⌘⌥→` 与 Windows/Linux `Ctrl+Alt+←` / `Ctrl+Alt+→`）、`pageCycleEligible` 逐项否决（页面 / 文本控件 / 终端 / 已被消费都准入，模态 / repeat / 组字否决）、`steppedPageId` 环状步进（回头绕到末尾、到头绕回开头、单页 / 空列表 / 当前页不在列表不切）
- **P 会话导航判定**（`test/decide-session-cycle.test.mjs`）：两条固定行各自预约一对方向键（macOS `⌘↑` / `⌘↓` 与 `⌘⌥↑` / `⌘⌥↓`，Windows/Linux `Ctrl+↑` / `Ctrl+↓` 与 `Ctrl+Alt+↑` / `Ctrl+Alt+↓`；各平台只认自己那一组，左右方向键不与任何一条命中）、`sessionStepFor` 归属（行只认自己那对键）、`sessionCycleRequest` 按命中的行定池子（不带 `Alt` → `all`，带 `Alt` → `active`）、`sessionCycleEligible` 逐项否决（页面 / 文本控件 / 终端 / 已被消费都准入，模态 / repeat / 组字否决）、候选口径 `displayedSidebar` / `displayedSessionIds`（假侧栏 DOM：前三个工作区、显示顺序、折叠分组不贡献会话行但仍占名额、「未分组」桶不占名额也不贡献、归档行被标出且不进候选、第四个工作区不进候选、工作区树模式下父分组自己的会话行仍归父分组、单列表模式没有工作区行、搜索 / 窄侧栏没有行标记、没有 document）、活跃判定 `sessionActive` / `activeAmong`（待答即活跃、`completionUnread` 即活跃、状态表的 `running` 优先、目录缺读数不算活跃、三项取并集）、池子 `sessionPool`（`all` 就是候选、`active` 就是活跃候选、没有活跃候选时是空池）、`steppedSessionId` 环状步进、`sessionCycleTarget`（目标等于当前会话 / 候选为空 / 活跃池为空 / 活跃池里只剩当前会话时都不动）
- **E 面板键桥接**（`test/bridge-pane-keys.test.mjs`）：聚焦让位、回退全屏/分屏、折叠/模态/repeat/过期目标、改绑/解绑/冲突、desktop 让位、服务缺席
- **T 页面关闭桥**（`test/bridge-page-close.test.mjs`）：焦点不在右侧栏时回退到活动 dock pane 关掉当前页并消费、已聚焦让位、折叠 / 无活动 pane / 陈旧侧栏标记 / 模态 / repeat / 组字 / 已被消费 / 不可关的页面一律不动作（只有 repeat 仍消费）、改绑 / 解绑 / 冲突 / 命令缺席、macOS 与 Windows 两种物理形态各认自己那一组、别的键不误关页面、desktop 让位、服务缺席即 no-op、缺 `observeFixedInput` 告警、卸载后不再关页
- **F 停止桥接**（`test/bridge-stop-sequence.test.mjs`）：主视图会话歧义、停止成功与全部否决路径、卸载复位
- **I 审批桥接**（`test/bridge-approval-keys.test.mjs`）：无焦点允许/拒绝、面板让位、无待答与已作答、别的待答域、准入否决、主视图歧义、固定行缺席、服务缺席即不装、答案拒绝告警、卸载复位；**捕获路径**（I⑧–I⑪）：焦点停在过程卡片上时 `Enter` / `Esc` 先被捕获路拦下并作答（事件被吞，卡片与固定通道都收不到）、面板内 / 文本控件 / 终端 / 模态 / 长按 / 组字 / 带修饰键 / 别的键一律让位不吞、没有待答 / 固定行缺席 / 已作答 / 主视图歧义 / 审批属于别的会话都不吞、卸载后捕获监听连同页面循环桥的一起释放；以及**作答后的焦点环**（I⑫）：捕获路与固定通道路都给被按下的控件打上无环标记且不移动焦点、带修饰键的按键不解除、Tab 导航与失焦各自释放标记并清掉监听、目标不是当前焦点时不打标记
- **O 提问桥接**（`test/bridge-question-keys.test.mjs`）：无焦点关卡片（页面空白处、卡片自己的答案文本域里）、别的文本控件不抢、plan-review 卡片、审批域不归这条桥、准入否决（终端 / 模态 / repeat / 组字 / 已消费 / 带修饰键）、主视图歧义、别的会话的提问（这一按仍归停止序列）、服务缺席即不装、关闭失败告警、卸载复位
- **K 聚焦桥接**（`test/bridge-focus-composer.test.mjs`）：无焦点聚焦、从文本控件抢回键盘、固定行挂载与卸载、准入否决、主视图歧义、`conversation.input` 缺失 / `for()` 抛错、服务缺席即不装
- **M 页面循环桥接**（`test/bridge-page-cycle.test.mjs`）：切页并自动聚焦（commit 之后才聚焦）、页面自聚焦时不抢、从文本控件 / 终端 / 已被消费里仍切页、折叠 / 单页 / 无活动页 / 无会话让位、缺服务即不装、卸载复位；终端内的**捕获阶段拦截**（M⑦–M⑩）：`.xterm` 内的事件在冒泡到固定通道之前就被终端停掉，所以桥在 window 捕获阶段先于 xterm 拦下（吞掉事件、不让终端的转义序列进 shell），判定与通道路径共用同一函数，非 `.xterm` 目标一律放行、模态 / 单页 / repeat 时不吞事件，卸载时捕获监听一并释放
- **Q 会话导航桥接**（`test/bridge-session-cycle.test.mjs`）：`⌘↓` / `Ctrl+↓` 与 `⌘↑` / `Ctrl+↑` 无焦点时在全部候选里环状走并消费按键（本组跑的是 Windows/Linux 那组物理键，macOS 的 `⌘` 系组合端到端见下面「平台键端到端」一条；当前会话由 `retainedBy.mainView` 给出，切换后跟随新的主视图会话继续走）、当前会话不在候选里时 ↓ 落候选首 / ↑ 落候选尾；`⌘⌥↓` / `Ctrl+Alt+↓` 与 `⌘⌥↑` / `Ctrl+Alt+↑` 只在活跃会话之间走（两个活跃只在它们之间走、跳过非活跃行、唯一活跃一键抵达、待答交互也算活跃、已完成未读也算活跃）、活跃池空或只剩当前会话时不动作、不消费（同一时刻 `⌘↓` / `Ctrl+↓` 照常在全部候选里往下走）；让位（侧栏没有任何行 / 只有一行且已是当前会话 / 没有 document / 别的键 / 右栏页面循环的键只切页不动会话）、文本框内与已被消费照常切换、模态层之上让位、终端内**捕获阶段拦截**（两对键都吞事件并切换、只切一次，活跃池只剩当前会话时同样放行不吞）、捕获路径让位（非终端目标 / 长按 / 模态 / 没有候选都不吞）、失败模式（缺 `uiWorkspace` 时停在注入等待里、不装也不告警，服务晚到后补装两条固定行并照常切换，`uiWorkspace` 形状不符时告警且不挂固定行，缺 `observeFixedInput` 告警）、卸载（两条固定行与捕获监听一起释放）
- **G 产物**（`test/artifact-client.test.mjs`）：`lib/client.js` 的模块 id / 插件名 / `inject` 声明与端到端装配（产物零 `require`，不依赖任何 external）
- **R 平台键端到端**（`test/bridge-platform-keys.test.mjs`，文件内分组标号 R①–R④）：经假注册表实装四条自挂固定行，验证 `primary` 按设备平台规范化成生效的物理绑定与键帽标签 —— macOS 上是 `meta` 系（`⌘⌥J` / `⌘⌥←` / `⌘⌥→` / `⌘↑` / `⌘↓` / `⌘⌥↑` / `⌘⌥↓`），Windows 上是 `control` 系（`Ctrl+Alt+J` / `Ctrl+Alt+←` / `Ctrl+Alt+→` / `Ctrl+↑` / `Ctrl+↓` / `Ctrl+Alt+↑` / `Ctrl+Alt+↓`），且各平台只认自己那一组物理组合（另一平台的组合不动作、不消费）
- **S 页签行滚动**（`test/strip-scroll.test.mjs`，文件内分组标号 S①–S⑫）：规则文本与作用面（锚在 `[data-sidebar-right-session] [data-dockkit-strip-tabs]`、`scroll-behavior: auto`、不用 `!important`、不按哈希类名定位）、注入一个带认领标记的标签、多个持有者共用一个标签且最后一个卸载时才摘除、同一文档已有同一份规则时复用且不由本实例摘除、没有 `document` / document 承载不了标签时退化为 no-op，经插件装配时装上与释放全部 effect 后摘掉；**观察窗口保持**：采集（所属条带 + `scrollLeft`，页签未渲染 / 没有活动页 / 别的会话的同名芯片 / 浮动 pane / 没有 document 都不记）、还原 + 最小推移（以旧窗口为起点：原来那颗、左邻、窗口最左都是零位移；左外侧 / 右外侧的最小推移含 24px 边缘余量）、让位（跨 pane / 目标未渲染 / 没有窗口 / 浮动 pane / 没有 document 都不动作不抛），以及经页面循环桥的接线（切页前记窗口 → `focus` 重建 chip box → 下一帧还回去；折叠时不采也不还）

> `test/run-all.mjs` 的 `ORDER`：A、B、C、D、H、N、J、L、P、E、T、F、I、O、K、M、Q、S、G；不在 `ORDER` 里的文件（如平台键端到端）按文件名补在最后跑。

### 9.1 上游 DOM 锚点契约校验（`check-css.mjs` + `css-contract.json`）

本插件的桥接读的是上游**没有对外承诺**的 DOM 锚点（清单与含义见第 6 册第 8 节）。锚点被改名 / 搬走时桥会退化成 no-op（不误动作），但"退化"在现场是静默的；`check-css.mjs` 在构建后把清单逐条对已安装的 DSH 客户端产物 grep 一遍，缺一条就显式失败，并在 `hint` 里写明这条契约对应的功能会退化成什么：

```bash
node check-css.mjs                        # 或 pnpm check:css；pnpm build 也会跑（tsdown && node check-css.mjs）
node check-css.mjs --dsh-root <DSH 根>    # 指定 DSH 安装位置
node check-css.mjs --manifest <清单>      # 换一份清单（默认同目录的 css-contract.json）
```

- DSH 根目录解析顺序：`--dsh-root` > `$DSH_ROOT` > `npm root -g` > 常见全局安装路径（纯路径回退，不依赖 spawn 成功）。
- 每条 check 是 `{ id, plugin, token | pattern, paths, hint }`：`token` 按子串、`pattern` 按正则（带 `s` 标志）匹配；`paths` 是从 `<DSH>/node_modules/@deepseek-ai/` 起算的搜索目录（省略即全量扫，很慢）；任一文件命中即通过。
- 覆盖 23 条锚点：审批面板根、会话根 / 输入区、提问卡片与 plan-review 根、模态选择器、`data-dsh-automatic-focus` 标记与主题那条 `outline:none` 规则、终端根类与 `xterm-helper-textarea`、右栏会话根与 `data-sidebar-right-open`、dockkit 的 pane / 浮动 pane / 活动标记 / chip box / 页面芯片、页签行的 `scroll-behavior:smooth`，以及左侧栏 `data-row-key` 的两个前缀与归档行标记。
- 退出码：`0` 全部通过（定位不到 DSH 根目录时只告警也算通过 —— 在别的机器上不会误报）；`1` 有锚点缺失（**升级 DSH 之后先看这里**）；`2` 清单路径或 JSON 有问题。
- 它只证明"**有东西可选**"：不解析选择器、不跑 CSS 引擎，所以证明不了"后代组合子真的命中""特异性真的赢过 dockkit 的类规则"。那两件事只能看运行时，见第 10 节的手测项。

---

## 10. 启用

```bash
dsh plugin --profile web add <本仓库路径>/dsh-focus-free-shortcuts
```

重启 / 刷新 GUI 后验证：

- 焦点放在输入框，按 `⌘⌥Enter` → 应直接全屏右侧栏面板；
- 右侧栏开着并至少有一张页面（不是只剩那块停靠 guide）时，焦点放哪儿都行（输入框、消息区、侧栏），按 `⌘⌥W`（macOS）/ `Ctrl+Alt+W`（Windows/Linux）→ 应直接关掉右侧栏**当前**那一页（活动 pane 的活动页面），键盘不用先点进右侧栏；焦点已经在面板内按同一键 → 由内置命令关页（插件让位），效果相同；
- 右侧栏折叠时按 `⌘⌥W` / `Ctrl+Alt+W` → 无动作（没有"当前显示的页面"；先用展开键展开，展开会顺手聚焦活动 pane）；只挂着那块停靠 guide 时按它 → 收起右侧栏（这是 `page.close` 自己的语义，与焦点在面板内时按同一键一致）；
- 打开设置 / 快捷键等弹窗后按 `⌘⌥W` / `Ctrl+Alt+W` → 弹窗被关掉、后台页面不受影响（这一按归弹出的模态层，插件让位）；
- 把关页键改绑到别的组合 → 新组合生效、旧组合不再触发；解绑或处于冲突中 → 无动作；
- 把焦点点到消息空白处（或任意非输入控件），连按两下 `Esc` → 应停止当前轮次；
- 让某个工具触发审批（例如需要越权执行的操作），**不要点审批卡片**：直接按 `Enter` → 应"允许一次"；再触发一次，直接按 `Esc` → 应"拒绝"；
- 触发审批后**先点一张过程卡片**（消息流里的执行卡片，或轨迹视图的行——它们是 `tabindex="0"` 的可聚焦卡片）把焦点留在卡片上，再按 `Enter` → 应"允许一次"，并且那张卡片**不展开 / 不改变选中**，也**不再出现焦点边框**（这一按由捕获路从卡片手里拿走）；
- 把焦点点进审批详情区（卡片中部那块可聚焦区域）再按 `Esc` → 仍然是拒绝，但这一按由面板自己处理（插件让位）；
- 让 agent 提一个问题（`ask_user_question`，或 plan 模式下的 plan-review 卡片），**不要点卡片**：直接按 `Esc` → 卡片应被取消 / 关闭（阻塞式提问 → 整组等待以 `ASK_CANCELLED` 结束，agent 收到"用户取消了提问"；带工具调用线索的提问 → 只收起面板，问题仍可从它的工具调用行重新打开）；焦点落在卡片自己的答案输入框里按 `Esc` → 同样关闭（自由文本问题会自动聚焦那个输入框）；
- 有待答提问时，把焦点点进侧栏搜索框或终端再按 `Esc` → **不**关卡片：那一按归控件自己（终端 / 别的文本控件保持自己的键）；
- 有待答提问时按 `Esc` 与连按两下 `Esc` 都不停止当前轮次（待答交互存在时停止侧拒绝）；
- 焦点放哪儿都行（消息区、侧栏、甚至别的文本控件里），按 `⌘⌥J`（macOS）/ `Ctrl+Alt+J`（Windows/Linux） → 应直接聚焦底部输入框，光标回到上次位置，可以立刻开始输入；
- 右侧栏开着并至少有两张页面时，任意焦点位置按 `⌘⌥→` / `⌘⌥←`（macOS）/ `Ctrl+Alt+→` / `Ctrl+Alt+←`（Windows/Linux） → 应切成下一页 / 上一页（环状），且键盘落到新页面：切到终端可直接打字，切到文件页方向键可直接滚动；焦点已经在终端里按这对键 → 依然能切页；
- 只有一张页面或右侧栏折叠时按这对键 → 无动作（折叠时先用展开键展开，展开会顺手聚焦活动 pane）。
- 页签行放不下所有页面（出现横向溢出）时来回切页 → 页签行**不应**"先回到最左、再滑到新的活动页签"：新活动页签直接出现在它该在的位置；连续往一个方向走、又切回相邻的那一颗时，**页签行完全不动**（来源页签仍在视野里，一眼能看出从哪儿切过来），只有目标页签不在当前窗口里时才最小幅度滚动（插件把 kit 那次"从 0 出发"的修正换成"以旧窗口为起点"，见第 3 册第 5.4 节；这条补偿与鼠标点页签共享前半段 —— 点页签同样不再滑动）。升级 DSH 之后想确认这层覆盖仍生效，可在 DevTools 里看 `getComputedStyle(document.querySelector('[data-sidebar-right-session] [data-dockkit-strip-tabs]')).scrollBehavior` 是否为 `auto`。
- 先在左侧栏展开若干工作区（默认只有当前会话所在的那一组会展开，且每组默认最多列出 5 行，多出来的藏在「展开更多」之后），然后任意焦点位置按 `⌘↓` / `⌘↑`（macOS）/ `Ctrl+↓` / `Ctrl+↑`（Windows/Linux） → 应在**前三个工作区当前显示出来**的会话行之间环状切换，顺序与侧栏一致，当前会话随之高亮；走一趟的顺序与眼睛看到的顺序相同；
- 另一条键对 `⌘⌥↓` / `⌘⌥↑` / `Ctrl+Alt+↓` / `Ctrl+Alt+↑` **只走活跃会话**：有会话正在运行、停在审批 / 提问卡片上等人回答、或刚跑完还没被看（行上那颗绿点）时，按这对键只在这些会话之间环状走，中间的普通会话会被跳过；
- 这时按 `⌘↓` / `⌘↑` / `Ctrl+↓` / `Ctrl+↑` 仍走全部候选 —— 两条键各守各的池子；如果没有任何活跃会话（所有行都是空闲点），或活跃池里只剩当前这一个会话，`⌘⌥↓` / `⌘⌥↑` / `Ctrl+Alt+↓` / `Ctrl+Alt+↑` 不动作、也不消费（想继续往下走就用 `⌘↓` / `⌘↑` / `Ctrl+↓` / `Ctrl+↑`）；
- 折叠掉某个工作区、或把某些会话留在「展开更多」之后，再按这两对键 → 这些会话行不在候选里（看不到就走不到）；归档行也不在候选里，所以不会弹出「已归档，不可打开」的提示；「未分组」桶不是工作区，既不占前三个名额也不贡献候选；
- 侧栏搜索框里有搜索词（列表区换成搜索结果）、侧栏收起成窄栏、或分组方式切成「单列表」时按这两对键 → 无动作、不消费（那时没有工作区分组行可读）；
- 焦点在终端里按这两对键 → 依然能切会话，且这些键不会被当成终端输入送进 shell（终端内按 `⌘↑/↓` / `Ctrl+↑/↓` 或 `⌘⌥↑/↓` / `Ctrl+Alt+↑/↓` 都会先被捕获路拦下）；模态弹窗打开时 → 让位给弹窗，不动作、不消费。

撤销：

```bash
dsh plugin --profile web remove dsh-focus-free-shortcuts
```

`add-plugins.sh` / `add-plugins.ps1` 已包含本插件。
