# dsh-model-quick-switch

按 **`⌘⌥U`**（Windows / Linux 上是 `Ctrl+Alt+U`；逻辑组合 `primary+alt+U`，与仓库其它固定键一致）弹出模型浮层：候选是**设置里维护的模型列表**，`Enter` / 点击一行把**当前主视图会话**切换到该模型。浮层与 [`dsh-workspace-quick-switch`](dsh-workspace-quick-switch.md) 同一套面板 —— 一屏 10 行、窗口连续滑动、滚轮一格一行、`←` / `→` 滑一整屏；列表循环，两端继续走会绕回另一端。设置页「模型快速切换」从 Host 模型目录里按提供方浏览、添加，也能删除；列表保存在本插件的即时配置里，增删立刻反映到浮层。

-----

## 目录

- [它做什么](#它做什么)
- [安装与启用](#安装与启用)
- [实现要点](#实现要点)
- [验证](#验证)
- [边界](#边界)

-----

## 它做什么

### 模型浮层（`primary+alt+U`）

- **候选 = 设置里保存的列表**：顺序照抄列表（先添加的在前），不排序、不截断；一屏只渲染连续 10 行，标题右侧显示「n 个模型 · 显示 a–b」，装得下时退化成「n 个模型」。
- **窗口连续滑动**：滚轮一格就滑一行（1–10 → 2–11），与滚轮幅度无关；`←` / `→` 滑一整屏，`↑` / `↓` 移选中行并在它离开窗口时把窗口贴到边上。**列表循环**：末行再 ↓ 回到首行、首行再 ↑ 到末行，`←` / `→` 与滚轮到两端同样绕回。
- **当前模型会被标出来**：读主视图会话的 `modelSelection` 投影（没有显式选择时用模型目录里的默认值），同一提供方 + 模型的行带「当前」角标，打开时默认选中它。
- **`Enter` / 点击一行 = 切换模型**：调 `session.selectModel({ sessionId, provider, model, reasoningEffort? })`。成功后关闭浮层；失败时浮层**留在原地**，底部显示 Host 的 `code: message`（例如会话被另一个 DSH 占用的 `session/writer-held`）。
- **列表里的模型可以暂时不在目录里**：提供方下架、账号退登之后，存着的行照旧列出并标「目录外」，标题退回模型 id、副标题退回 provider id —— 浮层不替用户静默删数据，删不删是设置页的决定。
- **名称来自 Host 模型目录**：目录里有显示名时用目录名（模型名 / 提供方名 / 推理强度名），目录还没加载完时先显示 id，加载完成后原地换名，不闪退、不关闭。
- **没有打开的会话**：浮层照常打开并列出候选，确认时给出「先在左侧栏打开或新建一个会话」的提示。
- **随处都能按**：插件在 window 捕获阶段还挂了一条打开键监听，命中即吞掉这一按再开浮层。它覆盖 composer、设置页、终端（终端会 `stopPropagation`，固定通道的 window 冒泡收不到），捕获先跑，固定通道不会收到同一按、不会开两次。

### 设置页「模型快速切换」

- **位置**：设置面板左侧导航，排在「模型」与「插件」之间。
- **列表**：显示浮层里的全部模型（模型名 + 提供方 · 推理强度 + 可选「目录外」标），每行一个「删除」按钮。
- **添加**：点「添加模型」展开 Host 模型目录，按提供方分组（DeepSeek 账号第一、DeepSeek 第二，第三方保持目录顺序）列出模型；点「添加」写入列表，已添加的行显示「已添加」。目录加载失败时页面显示原因和「刷新模型目录」入口；目录为空时提示先去「设置 → 模型」配置提供方。
- **写入**：每次增删把整份列表按路径写回 `models` 字段；写入进行中禁用增删按钮，Host 拒绝时保留原列表并显示原因。
- **当前会话**：页面顶部显示主视图会话当前使用的模型（没有会话或从未选择时说明「跟随默认」）。

-----

## 安装与启用

先构建浏览器半部，再把包挂进 web profile。

```bash
cd dsh-model-quick-switch
pnpm install          # 首次：把 react / react-dom / @types/* 落进仓库根 node_modules
pnpm build            # 或 ../node_modules/.bin/tsdown

dsh plugin --profile web add /Users/lz/dsh-plugins/dsh-model-quick-switch
```

挂载后**重启 `dsh web` 并刷新浏览器**：`dsh.client.platform=web` + `immediately` 让客户端 roster 随页面加载，但 Host 在启动时读 profile；新增插件不会热挂进已运行的实例。

第一次打开时列表为空。进入「设置 → 模型快速切换 → 添加模型」，从当前模型目录里挑几个；之后 `⌘⌥U`（Windows / Linux 上是 `Ctrl+Alt+U`）就能切换。

-----

## 实现要点

| 关注点 | 做法 |
| --- | --- |
| 快捷键 | 注册一条**固定行**（group `application`）：`dsh-model-quick-switch.model-switch` 占逻辑组合 `primary+alt+U`（macOS 上是 `⌘⌥U`，Windows / Linux 上是 `Ctrl+Alt+U`），键帽按同一平台展开；经 `observeFixedInput` 的固定通道收键，命中时立刻 `consume()`（适配器就是 `preventDefault`）—— 固定行只「占住」组合键，不消费的话平台会把同一次按键再当一次自己的快捷键 |
| 打开键的捕获兜底 | 固定通道挂在 window 冒泡上，页面里任何一处 `stopPropagation`（终端、模态、编辑器）都会让它收不到；所以另挂 window 捕获阶段 `keydown` 监听，判定与固定通道共用 `ownedModelSwitch`，命中即 `preventDefault()+stopPropagation()` 再开浮层。捕获先跑，固定通道收不到同一按，不会开两次 |
| 浮层 | 注册进 `shell.overlay`（`order: 70`），等 ui-layout 声明该槽后再注册；业务 props 只由 `options.inject: () => ({ store, data, view })` 交出来，注册的第二个参数是组件本体 |
| 列表的真源 | 宿主 Config 的 `models` 字段（`z.array(...).volatile()`）：`dsh-settings` 只投影带 volatile 的命名空间，设置文档因此能读到、也能按路径写回；浏览器半部经 `ctx.configForms.get('dsh-model-quick-switch')` 读同一份快照并订阅变化 |
| 设置页 | 注册进 `settings.section`（id `dsh-model-quick-switch`，`order: 70`，label「模型快速切换」）；Host 半部用 `settings.configure({ auto: false })` 关掉按 schema 自动生成的通用表单页，避免出现两张编辑同一字段的页面 |
| 写入 | `form.mutate([{ op: 'set', path: ['models'], value }])` 整份替换（不是字段级 `set`，因为值是一个数组）；写入状态与 `writeError` 放在数据快照里，页面据此禁用按钮并显示原因 |
| 当前选择 | 读 `sessions.list` 快照里主视图会话（`retainedBy.mainView > 0`）的 `projectionValues.modelSelection.next ?? lastUsed`；没有显式选择时回退到模型目录的 `default` |
| 切换模型 | `remote.session.selectModel({ sessionId, provider, model, reasoningEffort? })`：请求只带一个会话与完整选择，Host 负责规范化并保存默认值；成功后把返回的 `selected` 写回快照，投影随后也会推同一个值 |
| 模型目录 | `remote.session.modelCatalog()`：只在打开浮层或进入设置页时拉取，并发调用共用一次请求；`groups` 展开成设置页的分组与浮层的显示名，`failures` 原样显示 |
| 候选投影 | 列表顺序照抄；`matchesCurrent` 里「没写推理强度」的选择覆盖同模型的任意强度，「写了强度」的要求强度相等；目录里找不到的行加「目录外」角标。规则在 `src/model.ts`，设置页与浮层共用 |
| 浮层内的按键 | 在 document 捕获阶段接管 `Esc` / `Enter` / `↑` / `↓`（选行）与 `←` / `→`（滑一整屏），带修饰键的按键一律放行；确认**不**预先关闭浮层，失败时它要留着显示错误 |
| 滚轮 | 监听挂在浮层根节点上（`passive: false`），每次都 `preventDefault()`；`wheelStep` 只看方向（非零即 ±1），所以一格固定滑一行；`ctrlKey` 的捏合手势放行 |
| 服务晚到 | 只等 `slots` / `shortcuts`；`configForms`、`sessions`、`remote` 各用等待子 fiber 接上（设置文档、会话目录、远程链路都可能比本插件激活晚）。缺席时浮层照常能开，表现为空列表、没有会话提示或可读的服务不可用错误 |
| 样式 | 插件自己的 `<style>`（随 fiber 卸载移除），只用自己的类名与主题令牌 `--dsw-*` / `--dsh-*`，亮 / 暗主题自动跟随 |

宿主半部（`index.ts`）只声明 Config schema 与 `auto: false`，没有构建产物，由 Node Type Stripping 直接加载；**改客户端代码必须重建 `lib/client.js`**。

-----

## 验证

```bash
cd dsh-model-quick-switch
pnpm typecheck                 # tsc --noEmit
pnpm check:css                 # 上游槽位 / 主题令牌契约校验（--dsh-root / $DSH_ROOT 可指定 DSH 根）
node test/run-all.mjs          # 六个测试文件
```

`check-css.mjs` 逐条校验 `shell.overlay` / `settings.section` 两个槽位，以及样式表消费的全部主题令牌；清单在 [`css-contract.json`](../dsh-model-quick-switch/css-contract.json)，上游改名 / 删 token 时显式失败。

| 测试文件 | 覆盖 |
| --- | --- |
| `test/palette.test.mjs` | 纯状态：固定行的逻辑组合（`primary` 按平台展开成 ⌘⌥U / Ctrl+Alt+U，各平台只认自己那一组）、下标收敛、窗口（最大起点 / 收敛 / 按行滑动 / 整屏 / 贴边）、store 的连续滑动与循环绕回、滚轮一格一行、浮层六键 |
| `test/model.test.mjs` | 配置读写（坏形状、去重、保序）、选择身份（强度算身份、分隔符不撞车）、当前匹配、目录排序 / 展开 / 显示名回退、候选行的「当前」与「目录外」 |
| `test/host.test.mjs` | 宿主 Config：默认空列表、必填字段校验、`models` 带 `volatile`（设置文档才会投影它）、`apply` 只声明 `auto: false` |
| `test/overlay.test.mjs` | 真 React 渲染：候选 / 当前角标 / 目录外角标 / 选中行、空态、错误与进行中提示、一屏 10 行与 2–11 窗口、六键接管、滚轮、设置页的列表 / 只读 / 目录错误 / 不可用状态 |
| `test/install.test.mjs` | 装配：固定行与两个槽位、`primary+alt+U` 打开并消费、候选来自设置与目录、`Enter` 走 `selectModel` 并在成功后关闭、失败留在浮层、没有会话 / 没有远程 / 设置服务晚到、全局捕获（终端 / 页面）与卸载清理、固定行被挤掉时两条通路都不抢、macOS 上认 ⌘⌥U 而不认 Ctrl+Alt+U、设置页增删与写入被拒 |
| `test/artifact-client.test.mjs` | 产物：模块 id / 插件名 / `inject`、只向模块表要 `react`、浮动行 + 浮层 + 设置页、候选与切换、设置页写入随产物发布、依赖缺失时只是不安装 |

`test/run-all.mjs` 用 `spawnSync` 逐个跑；受限沙箱里 spawn 被拒时直接逐个执行：

```bash
node test/palette.test.mjs && node test/model.test.mjs && node test/host.test.mjs \
  && node test/overlay.test.mjs && node test/install.test.mjs && node test/artifact-client.test.mjs
```

-----

## 边界

- **只切当前主视图会话**：浮层没有会话选择器。要切别的会话，先在左侧栏打开它。subagent 子会话不提供这个入口（Host 的 `selectModel` 也不接受）。
- **列表不自动跟随目录**：模型下架不会从列表里消失，只会标「目录外」；重新上架后角标消失。删除由用户在设置页决定。
- **添加只从 Host 模型目录里挑**：模型目录拉不到时「添加模型」面板没有候选（页面显示原因与刷新入口），删除仍然可用。目录里没有的路由可以先手工写进 profile 的 `models`，它会以「目录外」的形式出现在浮层里。
- **设置页只添加模型本身**：从目录添加时 `reasoningEffort` 留空（交给默认值）。需要固定强度时，在 profile patch 里给 `models` 条目写 `reasoningEffort`；列表会按「默认强度」与「显式强度」分成两行，浮层分别标出。
- **不做搜索、不做拖拽排序**：列表顺序就是添加顺序；要调整顺序只能改 profile 里的 `models` 数组。候选多时靠滚轮 / `←` / `→` 滑动。
- **一次只列 10 行、不做虚拟滚动**：窗口一次渲染连续 10 行；视口矮于约 800px 时列表内部滚动，键盘选中行会自动滚进可见区。
- **设置页只在 Web 客户端出现**：它注册进 `settings.section`，由 ui-settings-general 渲染；没有该外壳的组合里浮层仍可用，但列表只能通过 profile patch 编辑。
- **改键位要改源码**：固定行不可在快捷键设置里改。键位声明在 [`src/palette.ts`](../dsh-model-quick-switch/src/palette.ts) 的 `MODEL_SWITCH_BINDING` / `modelSwitchKeys`，改完重建并重启。这里用的是逻辑 `primary`（与 `dsh-workspace-quick-switch`、`dsh-keyboard-shortcuts` 的固定键同一套规则）：macOS 上落成 `⌘⌥U`，Windows / Linux 上是 `Ctrl+Alt+U`。注意 `⌘⌥U` 同时是 Safari / Chrome 的「查看网页源代码」：在浏览器里它可能先被浏览器截走、页面收不到；在 DSH 桌面端里没有这个冲突。
- **不消费其它组合键**：只有 `primary+alt+U` 被本插件接管；别的组合键（含 `⌘⌥M`、`⌘⌥I`、`⌘H`）照旧归平台与浏览器。
