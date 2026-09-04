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
| `⌘/Ctrl+Shift+O` | 新建会话（走 `uiWorkspace.startSession`，与 New Session 按钮同路径） | 任意 |
| `⌘/Ctrl+K` | 命令面板：搜索命令 / 过滤切换会话 | 任意 |
| `⌘/Ctrl+/` | 快捷键速查表（含总开关） | 任意 |
| `⌘/Ctrl+B` | 开关侧栏（走 `layout.toggleSidebar`） | C |
| `⌘/Ctrl+Alt+←` / `→` | 上一个 / 下一个会话（按列表顺序） | 任意 |
| `PageUp` / `PageDown` | 对话上/下翻页 | C |
| `⌘/Ctrl+↑` / `↓` | 跳最旧 / 最新消息 | C |
| `⌘/Ctrl+Shift+C` | 复制最后一条回复 | 任意 |
| `⌘/Ctrl+Shift+;` | 复制对话里最后一个代码块 | 任意 |
| `⌘/Ctrl+.` | 打开设置 | 任意 |
| `⌘/Ctrl+Alt+M` | 打开模型选择器 | B、C |
| `⌘/Ctrl+Shift+E` 或 `Shift+Esc` | 聚焦输入框 | C |
| `Esc` | 中断当前回合 / 关弹层 | — |

`Esc` 中断回合仍由 `dsh-new-session` 插件承担，本插件不重复处理。

## 实现要点（源码核实结论）

- 审批：优先走 `uiSession.pendingSnapshot` 服务级 `answer('allowed-once' | 'rejected')`；
  服务不可用时回退 DOM——`[data-approval-key]` 卡片内按钮（拒绝在前、允许在后）。
- 问答/计划评审：`[data-question-key]` / `[data-plan-review-key]`；
  选项为滚动区内 `role="radio"/"checkbox"` 按钮，提交为滚动区外的最后一个按钮。
- 滚动：`[data-conversation-scroll]`；聚焦输入框：`[data-composer-input]`；
  消息流：`[data-chat-flow-kind="assistant"]`；侧栏：`layout` 服务；设置：
  侧栏 `button[aria-haspopup="dialog"]`；模型选择器：composer 卡片内
  `button[aria-haspopup="menu"]`；会话切换：`sessions.list` 快照 + `sessions.open(id)`。

服务注入：`['sessions', 'uiSession', 'uiWorkspace', 'layout']`（全部判空后才消费）。
无宿主逻辑（`index.ts` 为占位空宿主），无 react 依赖（命令面板/速查表为纯 DOM 浮层）。

## 自定义键位

`localStorage["dsh-kbd-hotkeys:v1"]`（JSON）：

```json
{
  "enabled": true,
  "bindings": {
    "sidebar.toggle": "mod+shift+s",
    "model.open": "mod+alt+m"
  }
}
```

- `bindings` 与默认表**浅合并**：只写想覆盖的动作 id（动作 id 见
  `src/config.ts` 的 `DEFAULT_BINDINGS`），改完刷新页面生效；
- 组合键写法：`mod`（⌘/Ctrl）+ `alt` + `shift` + 键名（字母/数字/`enter`/
  `backspace`/`escape`/`arrow*`/`pageup`/`pagedown`/`;` 等），如 `"Cmd+Shift+O"`；
- 总开关也可在速查表（`⌘/`）里勾选切换。
- 未实现（方案 P2，预留后续）：readline 编辑键（`Ctrl+A/E/K/U`、`Alt+B/F/D`）、
  `Esc Esc` 清空草稿、输入框历史反查、单键 `o`/`t`、`Shift+Tab` 权限模式循环、
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
