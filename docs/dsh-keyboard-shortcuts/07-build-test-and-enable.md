# 构建、测试与启用

> 本文件是 [dsh-keyboard-shortcuts 说明](../dsh-keyboard-shortcuts.md) 的第 7 册：怎么构建、怎么跑测试、怎么启用与撤销。

-----

## 9. 构建与测试

```bash
cd dsh-keyboard-shortcuts
../node_modules/.bin/tsdown                          # 构建产物（或 pnpm build）
node test/run-all.mjs                                # 跑测试（或 pnpm test）
node test/run-all.mjs focus-bridge                   # 只跑文件名匹配的一组
../node_modules/.bin/tsc --noEmit                    # 类型检查（或 pnpm typecheck）
node check-css.mjs                                   # 上游 DOM 锚点契约校验（或 pnpm check:css）
node --check lib/client.js && node --check index.ts  # 语法检查（或 pnpm check）
```

源码按「一组快捷键一个文件」分，每组自带纯判定与桥：

| 文件 | 内容 |
|---|---|
| `src/shortcuts.ts` | 八条官方命令的目标表：命令 id、逻辑绑定、固定行 id、平台键帽与手势匹配 |
| `src/fixed-keys.ts` | 固定键组：挂八条固定行、接固定输入、补终端捕获；Web 上的全屏 / 关页免聚焦回退 |
| `src/pane-split.ts` | 分屏桥 `⌘\` / `Ctrl+\`：跟随 `pane.split` 的生效绑定，焦点不在面板内时回退到活动 dock pane |
| `src/stop-sequence.ts` | 停止序列 `Esc` `Esc` |
| `src/approval-keys.ts` | 审批键 `Enter` 允许一次 / `Esc` 拒绝 |
| `src/focus-composer.ts` | 聚焦输入框 `primary+alt+J`（macOS `⌘⌥J` / Windows/Linux `Ctrl+Alt+J`；固定键，终端内另走捕获拦截） |
| `src/focus-page.ts` | 聚焦右栏当前显示的页面 `primary+alt+K`（macOS `⌘⌥K` / Windows/Linux `Ctrl+Alt+K`；复用页面切换桥的 `focusShownPage`；Web 上占用 `session.search` 的默认键位） |
| `src/page-cycle.ts` | 页面循环 `primary+alt+←` / `primary+alt+→`（切页后自动聚焦新页面） |
| `src/strip-scroll.ts` | 右栏页签行的滚动补偿：`scroll-behavior: auto` + 切页前后保持观察窗口；纯视图补偿，不消费按键 |
| `src/question-keys.ts` | 提问卡片 `Esc` 取消 / 关闭（调面板自己的 `dismiss()`） |
| `src/session-cycle.ts` | 会话导航 `primary+↑/↓`（全部候选）与 `primary+alt+↑/↓`（只走活跃会话） |
| `src/fullscreen-dismiss.ts` | 全屏右栏上的裸 `Esc` 关栏；同时给审批桥与提问桥判让位（`fullscreenSidebarShown()`） |
| `src/binding.ts` | 多数桥共用：手势 / 绑定 / 两类快捷键目录行的匹配（纯函数） |
| `src/capture.ts` | 捕获阶段共用：按键落点、原始手势、归属上下文、终端落点判定 |
| `src/focus-ring.ts` | 审批桥用：拿走按键后打上官方“无环聚焦”标记 |
| `src/runtime.ts` | 插件名与诊断、固定输入 keydown 窄化、主视图会话判定 |
| `src/client.ts` | 入口：依次安装各桥，导出 `name` / `inject` / `apply` |

> 这些文件不自行重述上游类型：手势 / 绑定 / 目录行 / 待答审批 / 待答提问 / 会话与服务面都是 `import type` 自上游声明（清单见第 6 册第 8 节），打包时被擦除。

`test/` 共 28 个测试文件，共享装置在 `test/focus-helpers.mjs` 与 `test/helpers.mjs`，runner 是 `test/run-all.mjs`：

- **固定键与判定**：`bridge.test.mjs`（目标表、固定行 id、平台修饰键）、`install.test.mjs`（固定行装配、固定输入、终端捕获、卸载）、`fullscreen.test.mjs`（全屏免聚焦桥）、`page-close.test.mjs`（关页免聚焦回退）、`artifact-client.test.mjs`（`lib/client.js` 的模块 id / 插件名 / `inject` 与八条固定行）；
- **纯决策**：`focus-decide-binding.test.mjs`（绑定匹配、`enabledBinding`、分屏归属）、`focus-decide-escape.test.mjs`、`focus-decide-ownership.test.mjs`、`focus-decide-stop-sequence.test.mjs`、`focus-decide-approval.test.mjs`、`focus-decide-question.test.mjs`、`focus-decide-focus-composer.test.mjs`、`focus-decide-focus-page.test.mjs`、`focus-decide-page-cycle.test.mjs`、`focus-decide-session-cycle.test.mjs`、`focus-decide-fullscreen-dismiss.test.mjs`；
- **桥接**：`focus-bridge-pane-split.test.mjs`（分屏回退）、`focus-bridge-stop-sequence.test.mjs`、`focus-bridge-approval-keys.test.mjs`、`focus-bridge-question-keys.test.mjs`、`focus-bridge-focus-composer.test.mjs`、`focus-bridge-focus-page.test.mjs`、`focus-bridge-page-cycle.test.mjs`、`focus-bridge-session-cycle.test.mjs`、`focus-bridge-fullscreen-dismiss.test.mjs`；
- **端到端与补偿**：`focus-bridge-platform-keys.test.mjs`（macOS / Windows 物理键与键帽）、`focus-strip-scroll.test.mjs`（页签行滚动）、`focus-artifact-client.test.mjs`（真产物装配：固定键、全屏 / 关页回退、停止 / 审批 / 提问、会话导航、终端捕获、全屏关栏）。

> `test/run-all.mjs` 的 `ORDER` 先跑固定键层与判定，再跑各桥，最后跑产物与滚动补偿；不在 `ORDER` 里的文件按文件名补在最后。

### 9.1 上游 DOM 锚点契约校验（`check-css.mjs` + `css-contract.json`）

本插件的桥接读的是上游**没有对外承诺**的 DOM 锚点（清单与含义见第 6 册第 8 节）。锚点被改名 / 搬走时桥会退化成 no-op（不误动作），但"退化"在现场是静默的；`check-css.mjs` 在构建后把清单逐条对已安装的 DSH 客户端产物 grep 一遍，缺一条就显式失败，并在 `hint` 里写明这条契约对应的功能会退化成什么：

```bash
node check-css.mjs                        # 或 pnpm check:css；不在 pnpm build 里（build 只跑 tsdown）
node check-css.mjs --dsh-root <DSH 根>    # 指定 DSH 安装位置
node check-css.mjs --manifest <清单>      # 换一份清单（默认同目录的 css-contract.json）
```

- DSH 根目录解析顺序：`--dsh-root` > `$DSH_ROOT` > `npm root -g` > 常见全局安装路径。
- 每条 check 是 `{ id, plugin, token | pattern, paths, hint }`：`token` 按子串、`pattern` 按正则（带 `s` 标志）匹配；`paths` 是从 `<DSH>/node_modules/@deepseek-ai/` 起算的搜索目录。
- 覆盖 24 条锚点：审批面板根、会话根 / 输入区、提问卡片与 plan-review 根、模态选择器、`data-dsh-automatic-focus` 标记与主题规则、终端根类与 `xterm-helper-textarea`、右栏会话根 / 展开标记 / 呈现方式、dockkit 的 pane / 浮动 pane / 活动标记 / chip box / 页面芯片、页签行的 `scroll-behavior:smooth`，以及左侧栏 `data-row-key` 的两个前缀与归档行标记。
- 退出码：`0` 全部通过（定位不到 DSH 根目录时只告警也算通过）；`1` 有锚点缺失（**升级 DSH 之后先看这里**）；`2` 清单路径或 JSON 有问题。
- 它只证明"**有东西可选**"：不解析选择器、不跑 CSS 引擎。运行时行为仍需按第 10 节手测。

-----

## 10. 启用与手测

```bash
dsh plugin --profile web add <本仓库路径>/dsh-keyboard-shortcuts
```

重启 / 刷新 GUI 后验证：

- 焦点在输入框，按 `⌘⌥Enter` / `Ctrl+Alt+Enter` → 右侧栏直接全屏；再按一次还原；
- 焦点在输入框，按 `⌘⌥,` / `Ctrl+Alt+,` → 关掉右侧栏**当前**那一页，键盘不用先点进右栏；焦点已在面板内按同一键 → 官方命令关页（插件让位），效果相同；
- 右栏折叠时按 `⌘⌥,` → 无动作；打开设置 / 快捷键弹窗后按 `⌘⌥,` → 弹窗被关掉、后台页面不受影响；
- 按八条固定键里的其余各键（`⌘⌥N` 新会话、`⌘⌥B` 左栏、`⌘⌥P` 在本地打开、`⌘⌥O` 右栏、`⌘⌥\` 工作区文件、`⌘⌥L` 新建终端）→ 对应官方动作执行；打开「设置 → 快捷键」能看到这些只读固定行，与它们重叠的可配置项显示冲突；
- 焦点点到消息空白处，连按两下 `Esc` → 停止当前轮次；
- 触发审批，**不要点卡片**：直接按 `Enter` → 允许一次；再触发一次，按 `Esc` → 拒绝；先把焦点点在一张过程卡片上再按 `Enter` → 允许一次，卡片不展开 / 不改变选中，也不留焦点边框；
- 让 agent 提一个问题（`ask_user_question` 或 plan-review 卡片），**不要点卡片**：直接按 `Esc` → 卡片取消 / 关闭；焦点落在卡片自己的答案输入框里按 `Esc` → 同样关闭；焦点在侧栏搜索框或终端里按 `Esc` → 不关卡片；
- 右栏全屏后，任意焦点位置按 `Esc` → 右栏收起；焦点在终端或右栏自己的文本控件里按 `Esc` → 不关栏；全屏 + 回合运行中按 `Esc` → 先关栏、不停止；关栏后再连按两下 → 停止；
- 任意焦点位置按 `⌘⌥J` / `Ctrl+Alt+J` → 聚焦底部输入框，光标回到上次位置；焦点在终端里按同一键 → 仍聚焦输入框，且这一按不进 shell；
- 在终端里按 `⌘⌥N` / `Ctrl+Alt+N` → 新建会话并切过去，这一按不进 shell；焦点在页面 / 文本控件里按同一键 → 由官方命令处理；
- 右侧栏有两张以上页面时，任意焦点位置按 `⌘⌥→` / `⌘⌥←` → 环状切页，键盘落到新页面（终端可直接打字）；焦点在终端里 → 仍能切页；
- 页签行横向溢出时来回切页 → 相邻来回切时页签行不动、来源页签留在视野里；在 DevTools 里确认 `[data-sidebar-right-session] [data-dockkit-strip-tabs]` 的 `scrollBehavior` 为 `auto`；
- 展开若干工作区后按 `⌘↓` / `⌘↑` → 在左侧栏前三个工作区当前显示的会话行之间环状切换；按 `⌘⌥↓` / `⌘⌥↑` → 只在活跃会话之间切换；
- 焦点在终端里按这两对键 → 仍能切会话，且不进 shell；模态弹窗打开或长按重复时 → 消费但不切换。

撤销：

```bash
dsh plugin --profile web remove dsh-keyboard-shortcuts
```

`add-plugins.sh` / `add-plugins.ps1` 已包含本插件；整仓卸下用 `remove-plugins.sh` / `remove-plugins.ps1`（在 `dsh` 未运行时跑，跑完重新启动 `dsh web`）。
