# dsh-session-panel-dock

让会话面板（会话标题栏最左侧开关控制的「环境 / 变更请求 / 子智能体 / 共享任务 / 后台任务」面板）
**始终以停靠形态出现**，不再因为 Chat 视图空间不足退化成浮层。纯客户端 CSS 插件：主对话的
停靠探针恒为 1px；面板打开时给主对话正文宽度设上限
`min(自然宽度, max(480px, 列宽 − 400px))`，让 Conversation 主体把正文和输入框向左让位；
面板因此占一列，而不是压在正文上。上限不放大自然宽度，宽外框上正文保持上游宽度或用户拖拽
偏好。空间窄到正文无法再让位时，面板仍保持 `docked` 形态（此时会覆盖正文右缘，这是
「无论空间是否足够都保持停靠」的直接代价）。
不注册服务、没有配置项、不写面板的显示偏好；从 profile 移除即恢复上游行为。

-----

## 它改的是什么

上游 `@deepseek-ai/dsh-client-ui-session-panel` 的呈现判定只有一条
（`node_modules/@deepseek-ai/dsh-client-ui-session-panel/src/client/visibility.ts`）：

```ts
if (fits) return visibility.pinned ? 'docked' : 'hidden'
return visibility.overlay === sessionId ? 'overlay' : 'hidden'
```

`fits` 来自该 Chat 视图里的停靠探针 `<span data-session-panel-probe>`：探针宽度 `>= 1px`
即视为有停靠空间。探针宽度由面板样式表按末端留白（gutter）计算：

```css
max(gutter - 40px(间距) - 8px(边距) - 300px(面板最小宽) + 1px, reserve-room)
```

所以空间不足时探针为 0，按开关只会打开浮层。上游正文宽度默认是
`clamp(680px, 列宽 × 0.64, 880px)`（或用户拖拽后的值）；窄外框、用户把正文拖宽、或其它把
正文钉宽的补丁会让末端留白小于 348px，主体拒绝让位，面板只能压住消息。

本插件用两条规则改变这个结果：

| 规则 | 锚点 | 作用 |
|---|---|---|
| 探针恒开 | `[data-slot='main.conversation'] [data-session-panel-probe]` | `width: 1px !important`；`fits` 永远成立，`overlay` 分支不可达 |
| 正文让位 | `[data-slot='main.conversation'] [data-conversation-content]:has([data-session-panel-probe][data-session-panel-reserve])` | 面板 pin 住时把 `--dsh-chat-content-width-resolved` 与 `--dsh-chat-content-width` 设为 `min(自然宽度, max(480px, 列宽 − 400px))`；自然宽度取用户拖拽值或上游 `clamp(680px, 列宽 × 0.64, 880px)` |

第二条里的 `400px` 是让 Conversation 主体真的让位所需的空间：

```text
400px = 348px（40 间距 + 300 面板 + 8 边距）
      +  32px（主体让位后正文前至少保留的起始留白）
      + 约 20px（滚动口比列宽少的边距 / 滚动条预留）
```

主对话的宽度上限生效后，`--dsh-chat-end-reserve-max`（滚动口宽 − 正文列宽 − 32px）达到
348px 以上，上游的末端预留机制才会把正文和输入框向起始边移动，最终 gutter 恰为 348px、
面板宽 300px、与正文之间保留 40px。宽外框上自然宽度小于上限，正文不会被放大，只由末端预留
向左移动。

-----

## 生效范围

| 场景 | 结果 |
|---|---|
| 主对话（`main.conversation`） | 面板打开时始终 `docked`；正文按上限收窄，与面板间隔 40px |
| 主对话里空间充足（Chat 外框约 ≥ 1110px） | 正文保持自然宽度（用户拖拽值或 `clamp(680px, 列宽 × 0.64, 880px)`），真实并排、不遮挡 |
| 主对话里较窄但仍能停靠（约 870–1110px） | 正文按上限 `max(480px, 列宽 − 400px)` 收窄，面板仍真实并排、间隔 40px |
| 主对话里空间不足（约 < 870px） | 探针仍恒为 1px，面板仍是 `docked`，但会覆盖正文右缘；不退回浮层 |
| 嵌入的侧边对话（embedded Chat） | 保持上游行为：不让位，空间不足时仍是 `hidden` / `overlay` |
| 面板的显示 / 隐藏 | 仍由标题栏开关的 `pinned` 偏好决定；本插件不写 `dsh.sessionPanel.pinned` |
| 关闭面板后 | 正文恢复自然宽度；再次打开时按上限收窄并停靠 |
| 轨迹等非 Chat 视图 | 不渲染面板，本插件也不起作用 |

本插件在面板 pin 住时以更高特异性同时覆盖 `--dsh-chat-content-width-resolved`（上游预留
计算的输入）和 `--dsh-chat-content-width`（正文、气泡、卡片、输入框消费的变量）。宽外框上
自然宽度小于上限，正文保持原宽；窄外框或拖宽超过上限时才收窄。面板隐藏时两条规则都不命中，
正文恢复上游宽度。

-----

## 怎么确认它真的生效

```js
// DevTools Console
const main = document.querySelector('[data-slot="main.conversation"] [data-conversation-content]')
const panel = document.querySelector('[data-session-panel]')
const probe = document.querySelector('[data-session-panel-probe]')
const flow = document.querySelector('[data-chat-flow]')
const rect = el => el ? el.getBoundingClientRect() : null
console.table({
  presentation: panel?.getAttribute('data-session-panel') ?? null,
  probe: probe ? getComputedStyle(probe).width : null,
  contentWidth: main ? getComputedStyle(main).getPropertyValue('--dsh-chat-content-width').trim() : null,
  gap: rect(panel) && rect(flow) ? Math.round(rect(panel).left - rect(flow).right) : null,
})
```

- `presentation` 为 `docked`、`probe` 为 `1px`、`gap` 约 `40`：生效。
- `presentation` 为 `null`：面板当前被关闭（`pinned === false`），按一下标题栏的会话面板开关。
- `presentation` 为 `overlay`：样式没加载，或加载顺序被别的样式压过。先看
  `document.querySelector('style[data-plugin-css="dsh-session-panel-dock/session-panel-dock.css"]')`
  是否存在；面板打开时 `probe` 仍为 `0px` 说明探针规则没命中。
- `gap` 小于 40 或为负：Chat 外框已经窄到正文无法再让位（约 < 870px），按预期停靠但覆盖正文。
- `contentWidth` 不等于自然宽度（宽外框）或 `列宽 − 400px`（收窄时，最低 480px）：上文的
  `data-conversation-content` 或 `--dsh-conversation-column-width` 契约已变，跑
  `pnpm --filter dsh-session-panel-dock check:css`。

-----

## 已知边界

- **窄窗口覆盖正文**：Chat 外框约窄于 870px 时，正文已经停在下限 480px，Conversation 主体无法
  再让出 348px。面板仍为 `docked`，但会覆盖正文右缘；这是本插件对「无论空间是否足够」的取舍。
- **正文可能更窄**：Chat 外框约 ≥ 1110px 时正文保持自然宽度；约 870–1110px、或用户把正文
  拖宽超过上限时，主对话正文收窄到 `max(480px, 列宽 − 400px)`。宽表格、代码块可能因此出现
  横向滚动或裁切。
- **宽度拖拽手柄仍然可用**：面板显示期间，把手拖到超过上限不会改变显示宽度；拖窄仍生效，
  并在面板隐藏后保留为上游的宽度偏好。面板占据末端 348px 后起始侧留白变小，正文越宽左侧
  手柄越窄（1440px 外框、正文取上限 1040px 时约 4px）；右侧手柄不受影响。
- **下限可调**：在 `:root` 上覆盖 `--dsh-session-panel-content-min` 可以改变上限的最低值。
  调低（如 400px）能让更窄的窗口继续真实并排，但正文更挤；调高（如 640px）更接近上游最小
  正文宽度，但会更早出现覆盖。
- **嵌入的侧边对话仍可能浮层**：规则只作用于主对话；侧边对话本来就不让位，保持上游的
  `hidden` / `overlay` 行为。
- **面板偏好不被修改**：用户把面板关掉后，本插件不会重新打开；需要用户按标题栏开关。
- **上游锚点或常量变更**：`data-session-panel-probe` / `data-session-panel-reserve` /
  348px 阈值 / 正文宽度变量等任一变化时，`check:css` 在构建后显式失败；运行时只表现为
  面板退回浮层或压住正文，不会报错。

-----

## 挂载与启用

```bash
pnpm install
pnpm --filter dsh-session-panel-dock build
pnpm --filter dsh-session-panel-dock check:css
dsh plugin --profile web add /Users/lz/dsh-plugins/dsh-session-panel-dock
```

挂载后 Host 会重新合成客户端 roster，**刷新页面**即可加载本插件（页面的 `__DSH_BOOT__`
里能看到 `dsh-session-panel-dock` 条目）。Host 若在启动时冻结了 profile 与产物字节，刷新后
页面仍未带本条目，再重启 `dsh web` 并刷新。

恢复上游行为：`dsh plugin --profile web remove dsh-session-panel-dock`，刷新页面。

-----

## 进一步探索

- [`dsh-client-ui-session-panel` 源码](../node_modules/@deepseek-ai/dsh-client-ui-session-panel/src/client/visibility.ts) —— 呈现判定、探针与 `pinned` / `overlay` 状态。
- [`dsh-client-ui-conversation` 的末端预留](../node_modules/@deepseek-ai/dsh-client-ui-conversation/src/client/skeleton/ConversationRoot.module.css) —— `--dsh-chat-end-reserve-max` 与让位公式。
- [DSH 组件 CSS 架构](dsh-css-architecture.md) —— `data-*` 锚点、CSS 变量与运行时 `<style>` 注入路径。
