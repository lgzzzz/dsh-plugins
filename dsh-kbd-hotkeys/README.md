# dsh-kbd-hotkeys

DSH Web 降低鼠标依赖的全局快捷键插件（client-only，设计依据 `docs/dsh-hotkeys-proposal.md`）。

单一 `document` 捕获阶段 `keydown` 监听，按 **三态分发**（方案第 4.0 节）：

- **态 A** — 审批 / ask_user_question / 计划评审卡片打开：按键服务于卡片；
- **态 B** — 输入框（Lexical）聚焦：只保留带修饰键的全局组合，不干扰文本编辑；
- **态 C** — 其余（浏览对话）：全部导航键生效。

## 键位表（默认，macOS 为 ⌘；Win/Linux 的 ⌘ = Ctrl）

| 按键 | 功能 | 态 |
| --- | --- | --- |
| `⌘/Ctrl+Alt+Enter` | 审批：允许一次 | 任意 |
| `⌘/Ctrl+Alt+Backspace` | 审批：拒绝 | 任意 |
| `1`–`9` | 问答卡片：选择第 N 个选项（计划评审：确认/拒绝/去聊） | A |
| `Enter` | 问答卡片：确认提交 / 计划评审：确认执行 | A |
| `⌘/Ctrl+/` | 快捷键速查表（含总开关） | 任意 |
| `⌘/Ctrl+B` | 开关侧栏（走 `layout.toggleSidebar`） | C |
| `⌘/Ctrl+Alt+↑` / `↓` | 上一个 / 下一个**活跃会话** | 任意 |
| `⌘/Ctrl+Alt+←` / `→` | 上一个 / 下一个**会话视图标签**（同一会话内的 tab 页，如 chat / 计划 / 轨迹） | 任意 |
| `Esc` | 中断当前回合 / 关弹层 | — |

活跃会话的定义：**正在运行（`running`）∪ 有待处理交互（`uiSession.pendingSnapshot` 命中，即审批/问答/计划评审卡）∪ 刚完成未查看（`completed`，侧栏绿色「完成」提醒）**。
跳转以当前会话为锚，向目标方向找**最近**的活跃会话并打开（当前会话本身不活跃时同样可用，落点即方向上最近的活跃会话）。

`Esc` 中断回合仍由 `dsh-new-session` 插件承担，本插件不重复处理。

## 实现要点（源码核实结论）

- 审批：优先走 `uiSession.pendingSnapshot` 服务级 `answer('allowed-once' | 'rejected')`；
  服务不可用时回退 DOM——`[data-approval-key]` 卡片内按钮（拒绝在前、允许在后）。
- 问答/计划评审：`[data-question-key]` / `[data-plan-review-key]`；
  选项为滚动区内 `role="radio"/"checkbox"` 按钮，提交为滚动区外的最后一个按钮。
- 聚焦输入框：`[data-composer-input]`；侧栏：`layout` 服务；设置：
  侧栏 `button[aria-haspopup="dialog"]`；模型选择器：composer 卡片内
  `button[aria-haspopup="menu"]`。
- 会话跳转（`⌘/Ctrl+Alt+↑/↓`）：在**活跃会话**之间跳转。活跃 =
  正在运行（`running`）∪ 有待处理交互（`uiSession.pendingSnapshot` 命中）∪
  刚完成未查看（`completed`）。基础轴 = 可见会话（复刻 workspace 浏览器的
  `sessionVisible` 过滤：剔除子代理 / 归档 / 非当前空白行）× `byRecency`
  （updatedAt 新→旧，id 升序决胜）；以当前会话在轴上的位置为锚，向目标方向
  扫描**最近**的活跃会话并 `sessions.open(id)`；锚点不在可见轴 / 方向尽头无
  活跃会话时 no-op。`workspaces` 服务不可用时仅归档过滤降级（无归档集合）。
- 会话视图标签切换（`⌘/Ctrl+Alt+←/→`）：在同一个会话的头部视图 tab
  （`conversation.view`，如 chat / 计划 / 轨迹）之间切换。定位方式是**内容判别**
  而非 DOM 位置：遍历整页 `[role="tablist"]`，返回其 `role=tab` 按钮均不带
  `aria-controls` 的那一个（全应用仅 4 个 tablist——cordis 源码、trajectory 详情、
  settings-plugins 的 tab 都带 `id`+`aria-controls`，唯独会话视图 tab 不带，故可
  唯一锁定）。取 `role=tab` 按钮，以 `aria-selected` 识别当前标签、向 `delta`
  方向点击下一个并**循环切换**（最右按下一个回到第一个、最左按上一个跳到最后一个，
  模运算回绕；未选中时按方向落到第一个 / 最后一个）；不依赖
  `data-phase`/`header` 的 DOM 层级，兼容 slot 引擎对头部内容的任意渲染。

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

## 加载（用户操作）

```sh
cd /Users/lz/dsh-plugins/dsh-kbd-hotkeys
dsh plugin --profile web add link:.
# 重启 App 生效（常驻挂载不支持热重载）
```

卸载：`dsh plugin --profile web remove dsh-kbd-hotkeys`。

生效验证：`curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3080/plugins/dsh-kbd-hotkeys/client.js`
