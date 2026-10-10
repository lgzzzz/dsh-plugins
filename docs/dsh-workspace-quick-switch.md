# dsh-workspace-quick-switch

按 **`⌘⌥M`（macOS） / `Ctrl+Alt+M`（Windows/Linux）** 弹出一个浮层，里面列出**左侧栏当前的前 10 个工作区**（顺序就是左侧栏 Workspace 分组的顺序）；用 `↑` / `↓` 选，按 `Enter` 或点击某一行，**在那个工作区里新建会话**并切过去。`Esc` 关掉；遮罩会吃掉点击，点浮层外面不会关闭。焦点落在右侧栏终端里时这个键同样生效。

-----

## 它做什么

本节按使用者能观察到的现象列出全部行为；每条行为背后的机制见「实现要点」。

- **候选 = 左侧栏那一份**：读 Workspace 控制器的 `list` 快照。宿主把工作区的持久显示顺序通过 `follow()` 的 `order` 增量送下来，所以手动拖拽、`dsh-workspace-activity-sort` 之类的上浮改的正是这一份；浮层只取前 10 个，不改顺序、不做自己的排序。
- **浮层开着的时候候选继续跟随**：工作区新增/删除/改序，列表立刻跟着变，选中行按原下标保留（候选变短到装不下这个下标时回到第一行）。
- **当前工作区会被标出来**：读主视图会话的 `retainedBy.mainView`，再按工作区自己的 `sessionIds` 归属映射(`sessions` 服务缺席时就不标)，打开时默认选中它。
- **`Enter` 与左侧栏那个按钮是同一个动作**：调 `uiWorkspace.startSession(workspaceId)` —— 复用该工作区已有的空白会话，没有才真创建一个。
- **没有工作区时**照常弹浮层，给出「先在左侧栏添加一个工作区」的提示，`Enter` 不做动作。
- **服务晚到也能补上**：`workspaces` / `sessions` 经 gateway + WebSocket 的远程链路提供，页面刚起来时还不存在；插件照常先占住快捷键与浮层，服务到位后再接上订阅，候选与「当前」标记随即补上（不需要刷新页面）。
- **焦点在终端里也能开**：焦点落在右侧栏终端(`.xterm`)里时，终端会在自己的 textarea 处理器里 `stopPropagation()`，事件到不了固定通道；插件因此在 window **捕获阶段**另挂一个 `keydown` 监听，在事件进入终端前判定，命中即吞掉这一按(`preventDefault()+stopPropagation()`)再开同一张浮层 —— 这一按既不会丢，也不会被 Windows/Linux 的 AltGr 当成字符送进 shell。判定与固定通道共用同一个函数，两条路互斥、一次按键只开一次。

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
| 快捷键 | 注册**固定行** `dsh-workspace-quick-switch.quick-switch`(group `application`，占据逻辑组合 `primary+alt+M`，注册表按平台落成 macOS 的 `⌘⌥M` / Windows 与 Linux 的 `Ctrl+Alt+M`)，经 `observeFixedInput` 的固定通道收取按键；带修饰键/重复/组合输入/已消费的输入一律放行；**命中时立刻 `consume()`**(适配器就是 `preventDefault`)—— 固定行只「占住」组合键，上游不会替它消费(`effectiveShortcuts` 把固定行排除在可配置行之外)，不消费的话平台会把同一次 `⌘⌥M` 再执行一遍自己的快捷键（macOS 上顺手把窗口最小化就是这么来的） |
| 终端内的快捷键 | 落在 `.xterm` 里的 keydown 到不了固定通道，所以另挂一个 window **捕获阶段** `keydown` 监听：只对 `closest('.xterm')` 命中的按键出手，判定(`quickSwitchOwns`)与固定通道完全共用，命中即 `preventDefault()+stopPropagation()` 再开同一张浮层 —— 两条路互斥、一次按键只开一次 |
| 浮层 | 注册进 `shell.overlay`(加法式列表槽，`order: 60`)，等 ui-layout 声明该槽后再注册；整层默认 click-through，只有遮罩吃指针事件，面板自己拿焦点 |
| 槽位契约 | 注册的第二个参数必须是**组件本体**(`PaletteOverlay`)，业务 props 只由 `options.inject: () => ({ store })` 交出来 —— 渲染器对条目做的是 `jsx(entry.component, props)`；`slots.inject` / `slots.register` 还必须以**槽位服务对象本身**为接收者调用(上游用 `this.ctx`，Cordis 服务代理据此把 effect 记到本插件这个 scope 上)，自己 `bind` 到别处会让上游连 `this.ctx` 都读不到 |
| 浮层内的按键 | 本插件在 `document` 捕获阶段接管 `Esc` / `Enter` / `↑` / `↓`（只在浮层开着时），所以先于页面上任何本地控件看到按键，并 `preventDefault` + `stopPropagation` |
| 样式 | 插件自己的 `<style>`（随 fiber 卸载移除），只用主题令牌 `--dsw-*` / `--dsh-*`(多数带回退值；`--dsw-font-family` 没有)，亮/暗主题自动跟随 |
| 依赖 | `inject: ['slots', 'shortcuts']` —— 只等这两个，所以 `⌘⌥M` / `Ctrl+Alt+M` 与浮层从启动起就在；`workspaces` / `sessions` 用**等待子 fiber**(`scope.inject`)接上：服务到位才跑、换实现时先卸载再重跑，缺席就只是空候选（不告警，那不是故障）；`uiWorkspace` 缺席则固定行照旧在、按键不做动作 |

宿主半部是空实现(没有 `dsh.client` 之外的东西需要宿主做)，所以**改客户端代码必须重建 `lib/client.js`**。Host 在合成那一刻就把产物字节读进快照，所以重新构建后仅刷新页面可能仍拿到旧字节 —— 重启 `dsh web`，或在「设置 → 插件」里关掉再打开本插件，然后刷新页面。

-----

## 验证

验证分构建期的契约校验与运行期的测试两层。

```bash
cd dsh-workspace-quick-switch
pnpm typecheck                 # tsc --noEmit
pnpm check:css                 # 上游槽位 / 主题令牌契约校验(--dsh-root / $DSH_ROOT 可指定 DSH 根)
node test/run-all.mjs          # 五个测试文件(spawn 被沙箱拒时逐个跑,见下)
```

`pnpm check:css`（即 `node check-css.mjs`，不挂在 `pnpm build` 上）逐条校验浮层注册进的 `shell.overlay` 槽、
注入样式消费的 `--dsw-*` / `--dsh-*` 令牌，清单在 [`css-contract.json`](../dsh-workspace-quick-switch/css-contract.json)：
上游改名 / 删 token 时**校验即失败**，不会让浮层静默不显示或掉到兜底色。

| 测试文件 | 覆盖 |
| --- | --- |
| `test/palette.test.mjs` | 纯状态：候选投影（前 10 个、顺序照抄、当前标记）、下标收敛、环状步进、store 写入与批量通知 |
| `test/keys.test.mjs` | 按键解码：四个键归浮层，带修饰键/组合中/已消费/长按确认都放行；平台键帽与识别(`macOS` 键帽 `⌘` `⌥` `M`、认 `⌘⌥M` 且不认 `Ctrl+Alt+M`，反之亦然) |
| `test/overlay.test.mjs` | 浮层渲染（真 React）：候选行、路径、`aria-*`、「当前」角标、`installPaletteKeys` 的接管范围 |
| `test/install.test.mjs` | 装配：固定行注册(`macOS` 落成 `⌘⌥M`、`Windows` 落成 `Ctrl+Alt+M`)、槽位注册、候选跟随快照、按键到 `startSession` 的端到端、**命中时消费这次按键（别的组合键、已消费输入、固定行被挤掉时都不消费）**、上游缺席时的降级、**工作区/会话服务晚到后补上读数**、**终端内的捕获拦截(各平台只认自己那一组、非 `.xterm` 目标/别的键/长按/组字/固定行被挤掉都放行不吞、没有 `window` 时静默、卸载后监听撤掉)**、卸载清理 |
| `test/artifact-client.test.mjs` | 产物：`lib/client.js` 的模块 id / 插件名 / `inject`、只向模块表要 `react`、装配后端到端可用、命中时同样消费按键、**终端内的 ⌘⌥M 在产物里同样开浮层并吞掉事件** |

`test/run-all.mjs` 用 `spawnSync` 逐个跑；受限沙箱里 spawn 会被拒（EPERM），此时直接：

```bash
node test/palette.test.mjs && node test/keys.test.mjs && node test/overlay.test.mjs \
  && node test/install.test.mjs && node test/artifact-client.test.mjs
```

-----

## 边界

以下限制来自设计取舍或上游事实，不是缺陷。

- **默认绑定按平台落成**：固定行声明的是逻辑组合 `primary+alt+M`，注册表按设备平台规范化成生效的物理绑定 —— macOS 上是 `⌘⌥M`，Windows 与 Linux 上是 `Ctrl+Alt+M`。「两个修饰键 + 普通键」在 `web:windows` / `web:macos` 档案下合法；固定行又不走可配置命令的 Web 允许表(`isWebBindingAllowed`)，`registerFixed` 只做键码规范化与校验，所以 Linux 上同样注册成功。按键与其它命令的冲突由快捷键服务按固定行规则裁决（固定行先拿到这一按），快捷键目录里能看到这一行。
- **组合键归插件所有，不会落到平台那一层**：固定行命中时插件自己 `consume()`(`preventDefault`)，所以 `⌘⌥M` 只开浮层 —— 不会连带触发平台/浏览器自己的同名快捷键(典型就是 macOS 上 `⌘M` 的最小化窗口)；`uiWorkspace` 缺席、浮层开不了的时候也照样消费，否则这一按照样会被平台拿走（终端内的捕获路径同理：先吞再开，开不出来也不把这一按还给平台）。反过来，别的组合键(含 `⌘M` 本身)一律不消费，系统与浏览器的快捷键照旧生效。
- **不做搜索过滤、不做拖拽排序、不切换工作区归属**：浮层只负责「选一个工作区，在那里新建会话」。
- **前 10 个**：顺序里第 11 个之后的工作区不出现（需要在更多工作区里建会话时，用左侧栏本身）。
- **点浮层外面不关闭**：遮罩(`.dsh-workspace-quick-switch-backdrop`)吃指针事件，但没有绑定关闭动作，所以只有 `Esc` 能关；点击某一行反而等同确认。
- **鼠标划过不改选中行**：悬停只给高亮，`Enter` 永远落在键盘/点击选中的那一行；点击某一行直接就是 `Enter` 的效果。
