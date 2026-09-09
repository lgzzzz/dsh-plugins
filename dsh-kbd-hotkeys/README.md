# dsh-kbd-hotkeys

DSH Web 降低鼠标依赖的全局快捷键插件（client-only，设计依据 `docs/dsh-hotkeys-proposal.md`）。

单一 `document` 捕获阶段 `keydown` 监听，按 **三态分发**（状态名即代码中的 `StateName`）：

- **`card`（卡片态）** — 当前会话有审批 / ask_user_question / 计划评审卡片待处理：
  按键服务于卡片；
- **`editing`（输入态）** — 焦点在可编辑元素（输入框 / textarea / contenteditable）：
  只保留带修饰键的全局组合，不干扰文本编辑；
- **`browse`（浏览态）** — 其余（浏览对话）：全部导航键生效。

## 键位表（默认，macOS 为 ⌘；Win/Linux 的 ⌘ = Ctrl）

| 按键 | 功能 | 态 |
| --- | --- | --- |
| `⌘/Ctrl+Alt+Enter` | 审批：允许一次 | 任意 |
| `⌘/Ctrl+Alt+Backspace` | 审批：拒绝 | 任意 |
| `1`–`9` | 问答卡片：选择第 N 个选项（计划评审：确认/拒绝/去聊） | `card` |
| `Enter` | 问答卡片：确认提交 / 计划评审：确认执行 | `card` |
| `⌘/Ctrl+/` | 快捷键速查表（含总开关） | 任意 |
| `⌘/Ctrl+B` | 开关侧栏（走 `layout.toggleSidebar`） | `browse` |
| `⌘/Ctrl+Alt+↑` / `↓` | 上一个 / 下一个**活跃会话** | 任意 |
| `⌘/Ctrl+Alt+←` / `→` | 上一个 / 下一个**会话视图标签**（同一会话内的 tab 页，如 chat / 计划 / 轨迹） | 任意 |
| `Esc` | 停止当前会话的整棵运行中交互树（自身 + 运行中的直系子代理后代；one-shot 子代理跳过） | 任意 |

> 「任意」= 三态均允许（动作 `states` 为 `['card','editing','browse']`）。

活跃会话的定义：**正在运行（`running`）∪ 有待处理交互（`uiSession.pendingInteractions` 命中，即审批/问答/计划评审卡）∪ 刚完成未查看（`completed`，侧栏绿色「完成」提醒）**。
跳转以当前会话为锚，向目标方向找**最近**的活跃会话并打开（当前会话本身不活跃时同样可用，落点即方向上最近的活跃会话）。

`Esc` 与迁移前（`dsh-new-session`）行为一致：只停止运行中的会话树，**不吞键**，
页面默认 `Esc` 行为（关弹层 / 退出编辑态）照常执行；速查表浮层打开时由浮层优先关闭。

## 实现要点（源码核实结论）

**服务级（不触碰 DOM）**

- 审批：`uiSession.pendingInteractions.getSnapshot()`（公开观察面；同源的私有字段
  `pendingSnapshot` 仅作兼容回退）取 `kind==='approval'` 载体，调
  `answer('allowed-once' | 'rejected')`；**不再回退 DOM 点击**。
- 问答 / 计划评审：同一待处理表取 `PendingQuestion`（`kind==='question' | 'plan-review'`）：
  - **计划评审**：`1` = 确认执行、`2` = 拒绝、`3` = 去聊天里说、`Enter` = 确认执行。
    标签取自请求数据——`questions[0].intent.approve` 是确认标签、其余选项是拒绝标签，
    `cancel()` 对应「去聊天里说」。**不再依赖 DOM 按钮顺序**：上游计划评审卡片的
    DOM 底部顺序实为 *去聊天里说 / 拒绝 / 确认执行*，与旧实现的假设相反（旧实现里
    `Enter` 实际点到了「去聊天里说」、数字键顺序也颠倒）。
  - **通用问答**：插件镜像一份草稿进度（题号 + 每题 `selected`/`custom`/`skipped`；
    上游卡片状态存在 Session 级 slot store 内、外部不可读）。数字键选中 / 切换选项
    （单选自动翻到下一题），`Enter` 推进并在最后一题按
    `answer({ answers: [{ id, selected, custom? }] })` 成批结算。
- `card` 态判定：当前会话是否命中待处理交互表（服务级），不再用
  `[data-approval-key]` 等 DOM 查询，故不受卡片渲染时序影响。
- 侧栏开关：`layout.toggleSidebar()`。
- 会话跳转（`⌘/Ctrl+Alt+↑/↓`）：在**活跃会话**之间跳转。活跃 =
  正在运行（`running`）∪ 有待处理交互（待处理交互表命中）∪
  刚完成未查看（`completed`）。基础轴 = 可见会话（复刻 workspace 浏览器的
  `sessionVisible` 过滤：剔除子代理 / 归档 / 非当前空白行）× `byRecency`
  （updatedAt 新→旧，id 升序决胜）；以当前会话在轴上的位置为锚，向目标方向
  扫描**最近**的活跃会话并 `sessions.open(id)`；锚点不在可见轴 / 方向尽头无
  活跃会话时 no-op。`workspaces` 服务不可用时仅归档过滤降级（无归档集合）。
- `Esc` 停止会话（动作 `session.stop`，自 `dsh-new-session` 迁移）：起点 =
  `sessions.list.getSnapshot().current`，沿 `subagentsByParent[id].entries` 递归
  `kind==='child'` 的直系子代理（visited 去重），对每个节点 `sessions.binding(id)`
  → `session.getSnapshot().running === true` 时 `session.cancel()`；`subagent.address
  .mode === 'one-shot'` 的一次性子代理不可取消（跳过取消但仍继续递归其后代）；
  与迁移前一致**不吞键**，`Esc` 的页面默认行为照常执行。

**DOM 级（上游无可用服务面，本次未改动）**

- 会话视图标签切换（`⌘/Ctrl+Alt+←/→`）：在同一个会话的头部视图 tab
  （`conversation.view`，如 chat / 计划 / 轨迹）之间切换。定位方式是**内容判别**
  而非 DOM 位置：遍历整页 `[role="tablist"]`，返回其 `role=tab` 按钮均不带
  `aria-controls` 的那一个（全应用仅 4 个 tablist——cordis 源码、trajectory 详情、
  settings-plugins 的 tab 都带 `id`+`aria-controls`，唯独会话视图 tab 不带，故可
  唯一锁定）。取 `role=tab` 按钮，以 `aria-selected` 识别当前标签、向 `delta`
  方向点击下一个并**循环切换**（最右按下一个回到第一个、最左按上一个跳到最后一个，
  模运算回绕；未选中时按方向落到第一个 / 最后一个）；不依赖
  `data-phase`/`header` 的 DOM 层级，兼容 slot 引擎对头部内容的任意渲染。
  原因：`selectView` / `openView` 是 slot 注入的 React 回调，上游没有可调用的服务面。
- 打开设置（动作 `settings.open`，无默认键位）：侧栏
  `button[aria-haspopup="dialog"]`（取最后一个匹配）。原因：打开状态是
  ui-settings-general 组件内 `useState`，无 store、无命令、无服务。
- 打开模型选择器（动作 `model.open`，无默认键位）：composer 卡片内
  `button[aria-haspopup="menu"]`。原因：下拉展开是 ui-model-selection 组件内
  `useState`。
- 聚焦输入框（动作 `composer.focus`，无默认键位）：`[data-composer-input]`。
  原因：上游 `commandUi.bindComposerFocus` 在当前版本无任何调用点，
  `popupFor(actx).dismiss({ focusComposer: true })` 实际为 no-op。

## 服务化后的已知限制

- **通用问答的选中态由插件镜像维护，卡片不会实时高亮**：按键后卡片外观不变，
  直到 `Enter` 结算后卡片消失。计划评审与审批是一次性决策，无此问题。
- **通用问答请勿在同一请求内混用鼠标点选与数字键**：镜像只在按键时更新，鼠标
  点选不会同步；混用可能导致提交内容与卡片显示不一致。焦点在卡片自定义文本框时
  数字键 / `Enter` 交回卡片自身处理（不吞键），行为正常。
- 计划评审键位语义以请求数据为准（`1`/`2`/`3` = 确认 / 拒绝 / 去聊天里说）；
  请求未提供「拒绝」选项时 `2` 为空操作。
- 镜像按载体 key 缓存，请求结算（应答 / 取消 / 作用域销毁）后自动回收。

服务注入：`['sessions', 'uiSession', 'layout', 'workspaces']`（全部判空后才消费）。
无宿主逻辑（`index.ts` 为占位空宿主），无 react 依赖（速查表为纯 DOM 浮层）。

## 自定义键位

`localStorage["dsh-kbd-hotkeys:v1"]`（JSON）：

```json
{
  "bindings": {
    "sidebar.toggle": "mod+alt+s",
    "model.open": "mod+alt+m"
  }
}
```

- `bindings` 与默认表**浅合并**：只写想覆盖的动作 id（动作 id 见
  `src/config.ts` 的 `DEFAULT_BINDINGS`），改完刷新页面生效；
  > 已移除的动作（新建会话 / 对话滚动 / 复制等）即使残留在旧 `bindings` 里也不会
  > 触发（分发前先查动作注册表，未注册即忽略），无需清理。
- 组合键写法：`mod`（⌘/Ctrl）+ `alt` + 键名（字母/数字/`enter`/
  `backspace`/`escape`/`arrow*`/`pageup`/`pagedown`/`;` 等），如 `"Cmd+Alt+M"`；
  默认键位一律不使用 `shift` 作为修饰键（解析器仍兼容旧自定义配置里的 `shift`，仅作过渡）；
  旧配置中的 `"enabled"` 字段已废弃：快捷键默认启用、无总开关，该项被忽略。
- 未实现（方案 P2，预留后续）：readline 编辑键（`Ctrl+A/E/K/U`、`Alt+B/F/D`）、
  `Esc Esc` 清空草稿、输入框历史反查、单键 `o`/`t`、权限模式循环（预留，默认不绑定）、
  Leader 前缀集。

## 构建

```sh
npm install
npm run typecheck   # tsc --noEmit
npm run build       # esbuild → lib/client.js（入仓，禁手改）
npm run check       # node --check 产物与宿主
```

诊断脚本（非插件产物，纯 Node + 最小 DOM 桩，无需浏览器）：

```sh
node test-services.mjs   # 服务级动作路径：审批/问答/计划评审/card 态判定（DOM 桩不提供任何卡片）
node test-dispatch.mjs   # 分发链路：⌘/Ctrl+Alt+↑/↓ 活跃会话跳转
```

## 加载（用户操作）

```sh
cd /Users/lz/dsh-plugins/dsh-kbd-hotkeys
dsh plugin --profile web add link:.
# 重启 App 生效（常驻挂载不支持热重载）
```

卸载：`dsh plugin --profile web remove dsh-kbd-hotkeys`。

生效验证：`curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3080/plugins/dsh-kbd-hotkeys/client.js`
