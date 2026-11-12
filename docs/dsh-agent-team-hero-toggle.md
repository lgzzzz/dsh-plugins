# dsh-agent-team-hero-toggle

在空白新会话行的「新建工作树」右侧加一个「团队协作」开关。纯客户端插件：状态读会话的
`agentTeam` 投影，写入走 `remote.agentTeams.setEnabled(sessionId, enabled)`；**不遮掉**
模型菜单里原有的「启用智能体团队协作」行（方案 A2）——首轮前用这个快捷开关，会话开始后
仍可回到模型菜单修改（含上游的停用确认弹窗）。上游产物一行未改，从 profile 移除即恢复。

> 同一组开关也出现在 `dsh-model-quick-switch` 的 `⌘⌥U` 菜单顶部（「新建工作树」+「团队协作」），
> 便于纯键盘操作；两边写的是同一份会话投影与同一个 `agentTeams/setEnabled`。

-----

## 它加的是什么

| | 行为 |
|---|---|
| 位置 | 槽位 `conversation.hero.options`，`id: agent-team.hero`，`order: 10`；forge 的「新建工作树」在同一槽默认 `order: 0`，所以排到它右边 |
| 出现时机 | 只在 **hero（空白新会话）行**：`conversationPhase` 为 `blank` 且会话已打开。首轮开始（`turn/start`）后整行消失 |
| 外观 | 28px 高芯片：`role="switch"` 的按钮，左侧 28×16 轨道 + 圆点，右侧短标签「团队协作」；`aria-label` / `title` 用全称与说明 |
| 状态 | `useProjection('agentTeam').enabled`，不做乐观更新；点击后只加 pending 锁，等投影追上 |
| 写入 | 注册项 `inject(sessionId)` 交出的 `setEnabled`，最终调 `remote.agentTeams.setEnabled` |
| 隐藏条件 | 子代理会话（血缘或会话目录 `origin === 'subagent'` 任一成立）、`agentTeam` 投影缺席、`remote.agentTeams` 链路缺席（整项不注册） |
| 失败反馈 | 开关旁出现红色 `!`，`title` 变成 `mode.failed` 同款文案，Console 打一次 `[dsh-agent-team-hero-toggle]` 告警；勾选态保持在投影值上，不假装成功 |

两个决定行为的事实：

1. **开团队协作写的是 `team/mode` 事件，不是 `turn/start`**。会话列表元数据里的 `blank`
   只在 `turn/start` 时翻假，所以点完开关，hero 行和开关都不会消失。
2. **hero 行天然是「开跑前」的入口**。首轮开始后要改团队设置，仍走模型菜单里的旧行；
   A2 保留它，也保留了「停用前确认」这条上游流程。

-----

## 为什么是这个方案

| 方案 | 结论 |
|---|---|
| 只改 CSS 把开关挪过去 | 不可行：两个控件在不同渲染子树里（hero 行 vs 模型弹出层），CSS 不能跨子树移动 DOM |
| 改 DSH 上游 `ui-agent-team` 包 | 最干净，但改的是 npm 产物，升级即丢失；长期应提上游 PR |
| **新增客户端插件（本实现）** | 不改上游一行产物，可卸载恢复，沿用本仓库的 slot / 注入模式 |
| 真移动（再遮蔽菜单旧行） | 更贴近「移动」字面，但首轮后就不能再改设置；本次按用户选择走 A2，不做遮蔽 |

-----

## 实现文件

| 文件 | 职责 |
|---|---|
| [`src/client.ts`](../dsh-agent-team-hero-toggle/src/client.ts) | 浏览器入口：注册字典、挂样式、等 `remote.agentTeams`、注册 hero 槽 |
| [`src/component.ts`](../dsh-agent-team-hero-toggle/src/component.ts) | `role="switch"` 芯片组件；读投影、pending 锁、失败标记 |
| [`src/registration.ts`](../dsh-agent-team-hero-toggle/src/registration.ts) | 槽键 / 注册 id / `order` 与注册选项（纯模块，测试可直接 import） |
| [`src/logic.ts`](../dsh-agent-team-hero-toggle/src/logic.ts) | 可见性、失败文案、异常收敛 |
| [`src/styles.ts`](../dsh-agent-team-hero-toggle/src/styles.ts) | 插件前缀的芯片样式（挂一张 `<style>`，不依赖上游 primitives） |
| [`src/locales.ts`](../dsh-agent-team-hero-toggle/src/locales.ts) | 本插件字典（zh / en） |
| [`index.ts`](../dsh-agent-team-hero-toggle/index.ts) | 宿主半部空实现 |
| [`check-css.mjs`](../dsh-agent-team-hero-toggle/check-css.mjs) + [`css-contract.json`](../dsh-agent-team-hero-toggle/css-contract.json) | 上游槽位 / 注册 / 投影 / 端点 / 令牌的静态契约 |

`dsh.client.platform = web`、`immediately: true`：页面加载即挂，不等某个页面打开。

-----

## 作用范围与边界

| | 结果 |
|---|---|
| 空白新会话行 | 工作树右侧出现「团队协作」开关，勾选即写入当前会话；刷新后按投影恢复 |
| 首轮开始后的会话 | hero 行消失，开关不可见；模型菜单里的旧行仍可改（A2） |
| 子代理会话 | 不渲染（Host 端也会以 `TEAM_LEAD_REQUIRED` 拒绝子代理写入） |
| 未挂团队服务的部署 | `remote.agentTeams` 等不到，开关整项不注册；不报错 |
| 投影尚未加载 | 不渲染，投影到达后自动出现 |
| 停用团队协作 | 直接写入，不弹确认：hero 阶段正常没有 `modelSelection.lastUsed`，上游确认条件不成立；极端情况下（已有 lastUsed 但仍处于 blank）会跳过确认，这是已知边界 |
| 窄窗口 | 可见标签用短文案「团队协作」，全称在 `aria-label` 与 `title`；若仍挤压左侧控件，行本身是上游布局，本插件不改 |
| 语言 | 注册 zh / en；其余语言由 locale 服务的回退链处理 |
| 卸载插件 | 注册项与样式随 fiber 回收；模型菜单旧行从未改动 |

与模型菜单旧行的差别（有意保留）：旧行在写入失败时用菜单自带 toast 报错；本开关没有菜单
上下文，用红色 `!` + `title` + Console 告警替代，不引入新的全局浮层。

-----

## 怎么确认它真的生效

装载后开发者工具 Console：

```js
// 空白新会话页：开关在不在、状态对不对
const el = document.querySelector('[role="switch"][aria-label="启用智能体团队协作"]')
el?.getAttribute('aria-checked')      // "false" / "true"
el?.textContent                       // 含「团队协作」
el?.title                             // 说明文案（失败时是失败原因）

// 样式表是否挂上
document.querySelector('style[data-plugin-css="dsh-agent-team-hero-toggle/hero-toggle.css"]') !== null

// 旧行仍然存在（A2）
// 打开模型菜单，菜单里仍有「启用智能体团队协作」这一行
```

- 页面没有开关、Console 也没有本插件告警 → 先看 `__DSH_BOOT__` 里有没有
  `dsh-agent-team-hero-toggle`，没有就是没装进 profile / 没刷新页面。
- 开关出现但点击无反应 → 看 Console 是否有 `[dsh-agent-team-hero-toggle] 保存团队协作设置失败`，
  以及 Host 侧 `agentTeams/setEnabled` 是否可达。
- 首轮后开关消失是预期行为，不是 bug；去模型菜单改。

-----

## 构建、测试与挂载

```bash
# 仓库根：新包记进 workspace / lockfile
pnpm install

# 构建浏览器半部（tsdown → lib/client.js）并跑全部校验
pnpm --filter dsh-agent-team-hero-toggle build
pnpm --filter dsh-agent-team-hero-toggle test
pnpm --filter dsh-agent-team-hero-toggle typecheck
pnpm --filter dsh-agent-team-hero-toggle check:css

# 挂进 web profile（路径按当前 checkout 调整）
dsh plugin --profile web add /Users/lz/dsh-plugins/dsh-agent-team-hero-toggle
```

然后刷新 GUI 页面。客户端半部改动后要重新 `build`；Host 在页面加载时重新读产物，通常刷新即可。
从 profile 移除本包并刷新即恢复原状。

> 在 `.agents/worktrees/*` 会话里预览时，`dsh plugin add` 会把这个临时 worktree 路径写进
> profile；合并回主 checkout 后应 `remove` 再按主仓库路径 `add` 一次，避免 worktree 删除后
> profile 指向失效路径。

-----

## 上游契约与校验

[`check-css.mjs`](../dsh-agent-team-hero-toggle/check-css.mjs) 按 [`css-contract.json`](../dsh-agent-team-hero-toggle/css-contract.json)
对 DSH 安装产物逐条 grep，`pnpm check:css` 触发（不挂在 `pnpm build` 上）。校验 15 条：

- `conversation.hero.options` 仍被新会话行渲染（`dsh-client-ui-conversation/lib`）；
- forge 仍以 `id: forge-panel.worktree` 注册在同一槽（`dsh-experimental-client-ui-forge/lib`）；
- `agentTeam` 投影键与 `agentTeams/setEnabled` 端点仍在（`dsh-agent-team/lib`）；
- 芯片样式消费的 11 个 `--dsw-*` 令牌仍在（`dsh-client-ui-theme/lib`）。

任一改名都会在构建后显式失败；运行时找不到槽/链路时本插件静默不装，不冒泡异常。
