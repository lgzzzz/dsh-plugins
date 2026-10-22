# dsh-keyboard-shortcuts

Web 快捷键插件：一层把八条快捷键注册成**官方快捷键服务**的只读固定行，命中后调用官方命令注册表；另一层为内置命令够不着的状态补上免聚焦桥接（连按两下 `Esc` 停止、审批面板 `Enter` / `Esc`、提问卡片 `Esc`、全屏右栏 `Esc` 关栏、`⌘⌥J`、`⌘⌥K`、`⌘⌥←/→`、`⌘↑/↓`、`⌘⌥↑/↓`、`⌘\` 分屏）。面板全屏与关闭当前页面在 Web 上还会在焦点不在右栏时回退到当前 Session 的活动 dock 面板；消息滚动口内的 PageUp/PageDown 按可见消息带翻页，Space 的原生翻页被吞掉。

## 目录

- [快捷键](#快捷键)
- [为什么走固定行](#为什么走固定行)
- [工作方式](#工作方式)
- [与官方快捷键设置的关系](#与官方快捷键设置的关系)
- [构建、测试与启用](#构建测试与启用)
- [已知边界](#已知边界)
- [分册目录](#分册目录)

-----

## 快捷键

主修饰键 `primary` 在 macOS 上展开为 `⌘`，在 Windows/Linux 上展开为 `Ctrl`；下表按 Windows/Linux 记。

### 八条固定键

| 动作 | 官方命令 id | 固定行 id | 快捷键 |
| --- | --- | --- | --- |
| 新建会话 | `session.new` | `dsh-keyboard-shortcuts.session.new` | `Ctrl+Alt+N` |
| 展开／收起左侧栏 | `sidebar.left.toggle` | `dsh-keyboard-shortcuts.sidebar.left.toggle` | `Ctrl+Alt+B` |
| 在本地打开 | `workspace.openLocal` | `dsh-keyboard-shortcuts.workspace.openLocal` | `Ctrl+Alt+P` |
| 展开／收起右侧栏 | `sidebar.right.toggle` | `dsh-keyboard-shortcuts.sidebar.right.toggle` | `Ctrl+Alt+O` |
| 工作区文件 | `workspace.files` | `dsh-keyboard-shortcuts.workspace.files` | `Ctrl+Alt+\` |
| 新建终端 | `terminal.new` | `dsh-keyboard-shortcuts.terminal.new` | `Ctrl+Alt+L` |
| 面板全屏／退出全屏 | `pane.fullscreen.toggle` | `dsh-keyboard-shortcuts.pane.fullscreen.toggle` | `Ctrl+Alt+Enter` |
| 关闭当前页面／窗口 | `page.close` | `dsh-keyboard-shortcuts.page.close` | `Ctrl+Alt+,` |

固定行的显示名称直接读官方命令目录里的 `label`，所以文案、大小写与官方界面一致。固定行**只占用按键**，动作仍由官方命令自己的 `resolve()` / `run()` 执行。

### 免聚焦桥接

| 动作 | 键（macOS / Windows·Linux） | 行为 |
| --- | --- | --- |
| 停止当前回合 | `Esc` `Esc` | 焦点不在会话区（如 `<body>`）时按主视图 Session 停止 |
| 审批：允许一次 / 拒绝 | `Enter` / `Esc` | 焦点不在审批面板内时作答；焦点在过程卡片上时先吞掉按键再作答 |
| 取消 / 收起提问卡片 | `Esc` | 调卡片自己的 `dismiss()`；只在当前会话有待答提问时 |
| 关闭全屏右栏 | `Esc` | 全屏呈现的右栏上吞掉这一按并折叠；待答卡片被浮层盖住时不在这一按上作答 |
| 聚焦输入框 | `⌘⌥J` / `Ctrl+Alt+J` | 把键盘交回 composer，光标还原 |
| 聚焦右栏当前页面 | `⌘⌥K` / `Ctrl+Alt+K` | 键盘落到右栏当前显示页（通常是终端 `.xterm-helper-textarea`） |
| 切换右栏页面 | `⌘⌥←` / `⌘⌥→` | 环状切页，并把键盘交给新页面 |
| 切换会话 | `⌘↑` / `⌘↓` | 左侧栏前三个工作区当前显示的会话行之间环状导航 |
| 切换活跃会话 | `⌘⌥↑` / `⌘⌥↓` | 只在行上有状态点的活跃会话之间切换 |
| 分屏 | `⌘\` | 焦点不在面板内时回退到活动 dock 面板并分屏 |

固定键与 `⌘⌥J` / `⌘⌥K` / 切页 / 会话键在终端 `.xterm` 内同样生效：终端会在自己的处理器里 `preventDefault()+stopPropagation()`，所以各桥另挂 window **捕获阶段**监听，在事件进入终端前判定并吞掉这一按，既不误动作，也不把按键当输入送进 shell。分屏没有捕获钩子，终端内的 `⌘\` / `Ctrl+\` 不保证到达固定通道。

### 消息滚动口翻页

| 键 | 行为 |
| --- | --- |
| `PageUp` / `PageDown` | 按可见消息带（滚动口高度 − composer 高度）翻页，保留 50px 重叠 |
| `Space` | 吞掉，不翻页 |

只处理消息滚动口内的裸键；输入框、按钮、终端、模态层与内层可滚动区保持原生。机制、让位边界与失败模式见 [第 8 册](dsh-keyboard-shortcuts/08-chat-paging.md)。

-----

## 为什么走固定行

Web/Linux 的官方可配置绑定校验（`isWebBindingAllowed()`）只放行极少数组合：`Ctrl+/`、`Ctrl+Shift+,`、`Ctrl+Shift+.`。`Ctrl+Alt+N`、`Ctrl+Alt+B` 这类组合会被标成 `unsupported-browser`，既不能保存进 `dsh.keybindings.v1`，也不会执行。因此不能靠 `shortcuts.edit()` 把这些键写进官方设置。

固定行（`registerFixed()`）不做这层 Web 组合校验，是保留这些组合的公开入口。它只读、不可改绑，并在官方快捷键参考里占一行。动作执行仍走官方命令注册表，不在本插件里重写。

-----

## 工作方式

1. `registerFixed()` 为八个官方命令各注册一条固定行，占用 `primary+alt+…` 组合；另为 `⌘⌥J` / `⌘⌥K` / `⌘⌥←/→` / `⌘↑/↓` / `⌘⌥↑/↓` 注册五条自挂固定行；
2. `observeFixedInput()` 接收官方适配器投递的本地按键；命中固定组合时先 `consume()`，再调用官方注册表的 `registry.invoke(commandId, context)`，或交给本插件自己的桥执行；
3. 焦点在终端 `.xterm` 内时，官方固定通道收不到按键（xterm 会截断冒泡），插件另挂 window 捕获阶段的 keydown：命中即 `preventDefault()` + `stopPropagation()`，再走同一条执行路径；
4. macOS Web 上 `⌘⌥N` 的 Option+N 是死键，官方固定通道会把这一按标成组字中；插件另在捕获阶段认领它，`preventDefault()` + `stopPropagation()` 后直接调 `session.new`（只限 Web，Desktop 由原生键盘桥接处理）；
5. 长按、输入法组合中、已被前面的处理器消费的按键都不执行；
6. 面板全屏与关页在 Web 上先走 `sidebarRight.commandTarget()` 的免聚焦回退：焦点不在面板内时解析当前 Session 的活动 dock pane，消费按键后执行与官方命令相同的 `toggleFullscreen()` / `closeTarget()`；
7. 模态层、区域、目标面板与失败原因由官方命令的 `resolve()` 判断；插件只把 `region / modal / target` 原样交过去；
8. 消息滚动口另挂一条与固定键无关的 window 捕获监听：PageUp/PageDown 按 `clientHeight - composerHeight - 50` 翻页，并用 rAF 缓动；Space 直接吞掉；输入框、按钮、终端、模态层与内层可滚动区不接管；

`registry` 是官方快捷键服务实例上的内部字段（公开的 `Shortcuts` 接口没有「按 id 调命令」的方法）。插件对它做结构检查：`invoke` 缺席时告警并完全不安装固定行，而不是退回自己调用业务服务。

-----

## 与官方快捷键设置的关系

- 固定行**不写** `dsh.keybindings.v1`，也不出现在可编辑命令列表里；它们是只读行。
- 与固定行重叠的官方可配置命令会进入冲突状态（官方目录里的红字），正常按键派发不会执行它们；本插件的固定通道仍按命令 id 调官方命令，所以目标动作照常执行。
- Web/Linux 上这些官方命令大多没有默认绑定，基本不会产生冲突。
- Web（macOS/Windows）上会重叠的官方默认键包括：
  - `session.new`、`sidebar.left.toggle`、`pane.fullscreen.toggle` 的默认键与目标相同，动作也相同；
  - `workspace.files` 的 `Ctrl+Alt+P` 被让给「在本地打开」；
  - `workspace.openLocal` 的 `Ctrl+Shift+O` 仍可用（与固定行不重叠）；
  - `sidebar.right.toggle` 的 `Ctrl+Shift+B` 仍可用；
  - `terminal.new` 的 `Ctrl+\`` 仍可用；
  - `workspace.add` 的 `Ctrl+Alt+O` 与右栏开关重叠，会被固定行压成冲突，添加工作区需要另用按钮或在设置里改绑；
  - `settings.open` 的 `Ctrl+Alt+,` 与关页重叠，会被压成冲突，设置入口需要另用按钮或在设置里改绑；
  - `session.search` 的 `⌘⌥K` 被「聚焦右栏页面」固定行占用，搜索需要另用按钮或在设置里改绑。
- 固定行只读；要改这些键位，修改 `src/shortcuts.ts` 的 `TARGETS`（或自挂固定行的绑定常量）后重新构建。

-----

## 构建、测试与启用

```bash
cd dsh-keyboard-shortcuts
../node_modules/.bin/tsdown            # 构建 lib/client.js
node test/run-all.mjs                  # 29 个测试文件
../node_modules/.bin/tsc --noEmit      # 类型检查
node check-css.mjs                     # 上游 DOM 锚点契约校验
node --check lib/client.js && node --check index.ts
```

启用：

```bash
dsh plugin --profile web add /home/lgzzz/dsh-plugins/dsh-keyboard-shortcuts
```

重启 `dsh web`（或按仓库 README 的插件开关流程重新载入）后刷新 GUI。客户端产物改动后必须重新构建并让 Host 重新读取 `lib/client.js`。

撤销：

```bash
dsh plugin --profile web remove dsh-keyboard-shortcuts
```

`add-plugins.sh` / `add-plugins.ps1` 与对应的 `remove-plugins` 脚本已包含本插件。

-----

## 已知边界

| 情况 | 行为 |
| --- | --- |
| 焦点在终端 `.xterm` 内 | 由各桥在捕获阶段拦下；不会把 `Ctrl+Alt+…` 当 AltGr 字符送进 shell |
| macOS Web 的 `⌘⌥N` | Option+N 是死键，浏览器把它报成 `key = "Dead"`；官方固定通道会标成组字中，插件在捕获阶段直接执行 `session.new`，不启动死键组合 |
| 焦点在页面 / 输入框 | 固定键走官方固定输入通道；免聚焦桥按各自归属判定 |
| `pane.fullscreen.toggle`（Web） | 焦点不在右栏、右栏展开时回退到活动 dock 面板并 `toggleFullscreen()`；面板已聚焦、右栏折叠、有模态或解析不出面板时交回官方命令 |
| `page.close`（Web） | 固定键 `⌘⌥,` 在焦点不在右栏时回退到活动 dock 面板并 `closeTarget()`；模态、折叠、不可关或已聚焦时交回官方命令 |
| `pane.split` | 跟随 `pane.split` 的生效绑定；右栏折叠、焦点已在面板内或解析不出目标时不接管 |
| 官方命令未注册 | `registry.invoke()` 按 id 找不到命令时不动作；固定行仍显示在参考里 |
| `registry.invoke` 缺席 | 插件告警并完全不安装固定行，不退回自己执行动作 |
| 另一个插件注册了相同固定键 | 两条固定行都会收到输入；本插件只调自己的官方命令。避免同时启用使用相同组合的插件 |
| 系统 / 窗口管理器先截获组合 | 页面收不到 keydown，固定行也不会触发；这是浏览器与桌面环境的限制 |
| 模态层打开 | 官方 `invoke()` 按命令声明的 `modals` 决定是否执行；插件不越过模态层 |
| 会话导航候选 | 只取左侧栏此刻渲染出来的会话行；折叠工作区、被「展开更多」挡住的行、归档行、搜索过滤与窄侧栏都不算候选 |
| 消息滚动口缺少 composer / 滚动口标记 | PageUp/PageDown/Space 不接管，保持原生 | 翻页补偿只在能算出可见消息带时生效；`css-contract.json` 的 `conversation-scroll` / `composer-seat` 兜住锚点 |

-----

## 分册目录

| 分册 | 内容 |
|---|---|
| [1. 行为差异与影响面](dsh-keyboard-shortcuts/01-behavior-difference.md) | 固定键层与免聚焦桥接层、仍然依赖焦点或状态的内置快捷键、全屏右栏 `Esc`；DOM / 焦点 / `keydown` / `closest()` / `preventDefault()` 预备知识 |
| [2. 归属判定](dsh-keyboard-shortcuts/02-ownership-resolution.md) | 键盘事件的完整链路；分屏、关页、停止序列、审批面板、提问卡片与全屏右栏 `Esc` 各自的归属判定 |
| [3. 固定输入通道与固定键桥接](dsh-keyboard-shortcuts/03-fixed-input-and-pane-keys.md) | 机制总览；固定键、分屏、关页回退；固定输入与「消费即让位」；`enabledBinding`；右栏页签行的滚动补偿 |
| [4. 停止桥接（`Esc Esc`）](dsh-keyboard-shortcuts/04-stop-sequence-bridge.md) | `handleStopInput`；轮次身份；双按序列；归属不重叠 |
| [5. 审批键与提问卡片桥接](dsh-keyboard-shortcuts/05-approval-key-bridge.md) | `handleApprovalInput`；捕获路径；提问卡片取消；全屏右栏关栏桥（5.11）；各桥的归属不重叠 |
| [6. 边界与依赖契约](dsh-keyboard-shortcuts/06-boundaries-and-contracts.md) | 与内置命令的对照表；已知边界与失败模式；依赖的非正式契约 |
| [7. 构建、测试与启用](dsh-keyboard-shortcuts/07-build-test-and-enable.md) | 构建 / 测试命令；源码与测试分组；上游 DOM 锚点契约校验；启用与撤销 |
| [8. 消息滚动口的翻页补偿](dsh-keyboard-shortcuts/08-chat-paging.md) | PageUp/PageDown 按可见消息带翻页；Space 屏蔽；让位边界、失败模式与验证 |
