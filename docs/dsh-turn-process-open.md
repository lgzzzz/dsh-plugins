# 中间过程锁定展开

> 状态：**已实施**（2026-10-19）。插件目录 [`dsh-turn-process-open/`](../dsh-turn-process-open)。本文是插件说明：
> 上游机制、选定方案、契约、失败模式与验证方式。原计划里的纯 CSS 分析与实测数据保留在第 3 节。

-----

## 1. 作用

「工作步骤展示 = 详细」时：

- 轮次过程（中间过程，`[data-turn-process]`，标题为“已完成，用时 …”）**锁定为展开**：任何新消息 / 自动收起都不再把它折叠；
- 过程组（`[data-process-activity]`，“执行了命令，已读取文件”一类）保持上游的默认折叠状态，并且是唯一可开合的一层；
- `⌘⌥.` / `Ctrl+Alt+.` 不再折叠中间过程；同一按会把最新一轮的**平铺明细即时封口成历史轮次的组头形态**，与“下一条消息发送过来之后”完全一致（见 [09-collapse-steps.md](dsh-keyboard-shortcuts/09-collapse-steps.md#5-封口折叠后的形态对齐)）；
- 不引入新的滚动跳动；阅读位置补偿沿用 `dsh-keyboard-shortcuts` 的现有逻辑。

验收：新消息到来后上一轮的中间过程保持展开、过程组仍折叠；点中间过程标题（鼠标 / 键盘 / 辅助技术）无反应；过程组标题可正常开合；`⌘⌥.` 只收过程组与单步详情并完成封口；页面加载、切换会话后同样成立。

## 2. 现状机制（从上游产物确认）

`dsh-client-ui-chat` 的 `ChatNodeSeat` 中：

```js
const storedOpen = useStore((s) => turnProcessOpen(s, processSpec, bottom === true && deferCollapse))
const processOpen = alwaysOpen || storedOpen
const processHidden = controllerInactive || foldable && processMember && !processOpen
```

- `turnProcessOpen()` 的规则：`turnProcesses` 里有本轮记录且 `answerStep` 匹配时，`collapsed !== true` 即展开；否则回落到 `defaultOpen`。`detailed` 的 `collapseTiming` 为「回答结束后」时 `defaultOpen=false`；「下次有新消息时」时最新一轮 `defaultOpen=true`、更早的轮次回落折叠。
- 折叠的行通过 `useSearchableHidden()` 设成 `hidden="until-found"`（不是 `display:none`，UA 样式为 `content-visibility:hidden`）；过程组根另有 `outerHidden`，组标题在「下次有新消息时 + 外层折叠」时用普通 `hidden` 隐藏；组展开体 `[data-step-process-body]` 是内层折叠。
- 展开体限高已由 `dsh-ui-css-patches` 去掉；本轮不重复处理。
- 上游没有「不折叠整轮、但保留过程组」的展示模式：`detailed` 是 `foldCompletedTurns:true + stepGrouping:"history"`，`verbose/完全展开` 是 `foldCompletedTurns:false + stepGrouping:"none"`（过程组也平铺）。**这是必须先改状态、而不是只改外观的根本原因。**
- store 只有 `actions.setTurnProcessOpen` 一个写入点（`init` 之外没有其它写入），所以插件写入的记录不会被上游在会话中途清掉。
- 分组形态由 `deferCollapse` 派生：只有最新一个 exchange 平铺（组根带 `data-group-expanded-mode`，组头普通 `hidden`，组体可见），更早的轮次分组（组头可见、组体 `hidden="until-found"`）。锁定轮次的 `outerHidden=false`，所以“新消息到达后”看到的是组头 + 折叠的组体。

### 2.1 上游稳定性（实测）

对比 `dsh-client-ui-chat` 的 **0.1.7-rc.2（9/24）、0.2.0-rc.2（9/29）、0.2.1-rc.2（10/17）**：

- `data-turn-process`、`data-turn-process-messages/tool-calls/subagents` 三周内未改；
- `turnProcess` prop 对象（`spec / foldable / hasContent / open / setOpen`）三版一致；
- `setTurnProcessOpen` 的签名与 `turnProcessOpen` 的“记录优先”语义一致；
- 头部按钮的 `aria-expanded`（仅 `hasContent` 时出现）与 `disabled` 语义一致。

0.2.1 重构了 `ChatNodeSeat` 的 props（新增 `useChatNodeBottom` / `deferCollapse` / `useGroupAction`），但没有动本插件依赖的四处。契约校验（第 5 节）覆盖其中可静态检查的部分。

## 3. 为什么不是纯 CSS（原计划保留）

### 3.1 CSS 能做到的部分

- `[hidden="until-found"]` 的隐藏可以通过作者样式覆盖：

  ```css
  [data-turn-process-hidden][hidden],
  [data-step-process][hidden] { content-visibility: visible !important; }
  ```

  在真实页面上验证过：被折叠的成员行会重新得到高度（24px），组根也能恢复内容；只覆盖这两个选择器不会放出组展开体，因此过程组仍然折叠。
- 组标题的 `hidden` 是普通属性，需要额外的 `:has()` + 模式限定才能放出来：

  ```css
  [data-step-process]:not([data-group-expanded-mode]) > div[hidden]:has([data-process-activity]) {
    display: block !important;
  }
  ```

### 3.2 CSS 解决不了的部分（实测）

1. **上游布局规则以 `[hidden]` 为条件，补可见性不等于补布局。** 行虽然被 CSS 重新画出来，但 `hidden` 属性还在，`ChatGroupSeat` 的 `:not([hidden])` gap 全部消失。实测一个已展开的过程组折叠前后 594px → 456px；`scrollHeight` 从 2478 变 2328、`scrollTop` 从 1754 变 1604，产生 **150px 的滚动位移**。
2. **开合状态不是 CSS 能改的。** 折叠时标题上的 `aria-expanded`、`data-open`、chevron 方向都按 `processOpen=false` 渲染；CSS 把内容画出来后，标题仍然宣称“已折叠”。`pointer-events:none` 挡不住键盘 / 辅助技术的 click，也不能把按钮移出 tab 序。
3. **折叠会触发 JS 副作用，CSS 拦不住。** 外层折叠会重置成员子树的 disclosure（`disclosureReset`），并让视口按被假定收起的高度做滚动保持；这些写入发生在 React 提交 / 布局阶段。
4. **标题的隐藏路径不止一条。** 过程组根是 `useGroupAction(outerHidden)`，组标题是 `useGroupHeaderAction(..., deferCompletedTurns && outerHidden)`（普通 `hidden`），成员行是 `useSearchableHidden`（`hidden="until-found"`）。

### 3.3 结论

**没有可靠的纯 CSS 方案。** 强行 CSS 化的结果是“看起来展开、状态仍折叠、折叠瞬间仍跳 150px、组头可能点不开”。

需求 N 的封口是**另一类** CSS：它不改变任何开合状态，只隐藏已经渲染的组体、放出上游自己的组头；组头的 `aria-expanded` 与点击语义保持正确。它用 `:has(> div > [data-process-activity])` 做结构守卫，结构变化时只会“不封口”，不会把内容藏没。见第 4.4 节。

## 4. 实现

### 4.1 写入口：fiber

`src/fiber.ts` 从标题元素取 `__reactFiber$…`，沿 `return` 链（深度上限 64）读：

- `turnProcess`：`TurnProcessNodeView` 的 props，含 `spec.turn` / `spec.answerStep` 与 `setOpen(open)`；
- `actions`：`ChatNodeSeat` / `ChatFlow` 的 props，即 `conversation.chat.flow` 槽位 store handle 暴露的绑定动作 `setTurnProcessOpen(turn, answerStep, open)`。它**绕过 `alwaysOpen`**，运行中也能预写记录。

两者都做了形状守卫；找不到返回 null。这是本插件唯一的“非公开依赖”。React 的属性名不会被压缩器改写，`__reactFiber$` 在开发 / 生产构建里都有；风险主要在组件边界或 prop 改名，契约校验能覆盖其中一部分。

### 4.2 seed 与锁标记

`src/pin.ts`：

- 作用域：`[data-slot="main.conversation"]` 内的 `[data-conversation-scroll]`；槽位缺席且全文档只有一个滚动口时用它（不猜右栏）。
- 每个标题的 key：`${sessionId}|${turn}|${answerStep}`。key 变了才写；展开且已加锁时直接早退，不再走 fiber。
- 写入顺序：优先 `actions.setTurnProcessOpen(turn, answerStep, true)`，否则 `turnProcess.setOpen(true)`（`alwaysOpen` 时是 no-op）。
- **只有观察到 `aria-expanded === 'true'` 才加锁**；标题折叠时移除锁并按上限重试（3 次），耗尽后告警一次、保持不锁（不拦截点击）。
- 锁标记：`data-turn-process-locked`。
- 观察：`document.documentElement` 上 `childList + subtree + attributes`（过滤 `aria-expanded` / `disabled` / 计数属性），回调合并到 16ms 后执行一次同步；观察整棵文档是为了覆盖会话切换后的新滚动口。
- 卸载：断开观察、移除定时器、移除点击监听、移除样式、移除所有锁标记。

### 4.3 点击与降级

- `<style>`：`[data-turn-process][data-turn-process-locked] { cursor: default; pointer-events: none; }`。
- `document` 捕获阶段的 `click`：只拦 `isTrusted === true` 且落在带标记标题上的事件。键盘 Space / Enter 派发可信 click，会被拦截；辅助技术可能派发不可信 click，放行给降级 / 可访问性场景。
- 找不到 fiber：不加锁，改为在标题折叠时合成一次点击（临时置空 `focus()`）重新打开；只告警一次，达到上限后放弃。
- 任何一步失败都只影响该标题，不影响其他轮次或过程组。

### 4.4 与 `⌘⌥.` 折叠的配合（封口）

`dsh-keyboard-shortcuts` 的 `src/collapse-seal.ts`：

- 目标：最新一个带 `data-turn-process-locked` 且 `aria-expanded="true"` 的标题所属轮次；只处理该轮次下仍平铺（`data-group-expanded-mode`）、尚未封口、且组头容器里有 `[data-process-activity]` 的组根。
- 动作：组根写 `data-dsh-collapse-sealed`；移除组头容器的 `hidden`（避免下一条消息到达时触发 reveal 动画）；一条受限 CSS 隐藏组体、组头展开时放回组体。
- 顺序：采集阅读位置 → 封口 → 点击折叠目标 → 微任务补偿滚动。封口本身会改变高度，必须参与补偿。
- 下一条消息到达：轮次进入分组态，`data-group-expanded-mode` 消失，CSS 选择器不再命中；组头早已可见，`hidden` 属性也已被移除，因此不跑 reveal 动画。封口标记留在组根上，不再有视觉效果。
- 卸载：仍平铺的组写回组头 `hidden`、移除标记、移除样式。
- 已知非视觉差异：封口期间组体用 `display:none`，浏览器“在页面中查找”暂时找不到组内文本（真正分组态用 `hidden="until-found"` 可被 beforematch 找到）；组根不会补 `data-chat-paging-anchor`（锁定轮次不会跑上游折叠落点）。两者不影响折叠后的视觉形态。

## 5. 上游契约

`css-contract.json` 由 `check-css.mjs` 在构建后对 DSH 安装产物逐条 grep（`pnpm check:css`）：

| id | 校验的上游事实 | 失效后的退化 |
| --- | --- | --- |
| `turn-process-control` | `"data-turn-process":` | 认不出标题，插件空转，自动折叠恢复 |
| `turn-process-message-count` | `"data-turn-process-messages":` | 内容更新不再重新 seed；锁本身仍生效 |
| `turn-process-tool-calls` | `"data-turn-process-tool-calls":` | 同上 |
| `turn-process-subagents` | `"data-turn-process-subagents":` | 同上 |
| `turn-process-prop` | `spec: processSpec, … setOpen` | fiber 读不到 handle，退化为合成点击 |
| `turn-process-answer-step` | `answerStep: number` | 记录的代次可能不匹配，锁不生效 |
| `turn-process-set-open` | `setOpen(open: boolean)` | `setOpen` 降级路径不可用 |
| `turn-process-store-action` | `setTurnProcessOpen` | 无法绕过 `alwaysOpen`，退化为 `setOpen` / 合成点击 |
| `main-conversation-slot` | `"main.conversation"` | 找不到主会话作用域；只有唯一滚动口时回退 |
| `conversation-scroll` | `data-conversation-scroll` | 找不到标题集合，空转（不误锁右栏） |
| `conversation-session` | `data-conversation-session` | key 的 sessionId 退化为空串，仍锁定 |

跨插件契约：`data-turn-process-locked` 由本插件写入；`dsh-keyboard-shortcuts` 用它跳过折叠并触发封口。缺席时封口不启用（单独使用快捷键的行为不变）。

## 6. 边界与失败模式

- **详细 + 下次有新消息时（推荐设置）**：完全无折叠；上一轮在新消息到来时保持展开，过程组转为折叠并显示组标题。
- **详细 + 回答结束后**：运行中通过 `actions` 预写展开记录，正常也不会折；若最终 `answerStep` 恰在“关闭”那次提交里才变化，可能出现一帧折叠后再展开。
- **最新一轮在“下次有新消息时”下**：按 `⌘⌥.` 后立即封口成历史轮次的组头形态；发下一条消息后形态不变。
- **完全展开模式**：没有带 `aria-expanded` 的可折标题，插件空转；过程组本来就平铺。
- **已停止 / 出错 / 中断的轮次**：上游 `alwaysOpen`，本来就不折；`disabled` 的标题跳过。
- **右栏会话**：不锁、不封口。
- **没有过程组的轮次**：无可封口组根；只折单步详情。
- **`:has()` 不支持**：跳过封口并只告警一次；平铺形态不变。
- **封口后用户展开某个组**：CSS 按 `aria-expanded` 恢复组体，可正常收合。
- **卸载**：移除标记 / 监听 / 样式 / observer / 定时器；已写入 store 的展开记录保留到页面刷新或会话 store 重建（无法通过公开接口清除）。
- **React 内部结构变化**：fiber 找不到 → 合成点击降级；不加标记、不拦点击。
- **键盘可达性**：标题仍是可聚焦按钮，但激活被拦截；不改上游 tab 序，属于已知取舍。

## 7. 手工验证

1. 载入多轮会话（详细 + 下次有新消息时）：所有可折标题 `aria-expanded="true"` 且带 `data-turn-process-locked`；历史轮次的过程组标题有高度、组展开体仍隐藏；成员行不再 `hidden`。
2. 鼠标点击中间过程标题：`aria-expanded` 不变、`defaultPrevented` 命中；点击过程组标题：组展开体展开。
3. `⌘⌥.`：最新一轮立即出现组头、成员行不可见；再按一次不动作；发下一条消息后该轮无位移、无 reveal 动画。
4. 切换会话再切回：标题重新 seed，过程组保持折叠，滚动位置无漂移。
5. 卸载插件后硬刷新：自动折叠恢复，平铺形态恢复。

## 8. 假设

- 只作用于主会话；右栏会话不锁、不封口。
- 接受用 React fiber 读取渲染器 props 作为唯一能改上游开合状态的手段（有降级与构建期契约）。
- 封口依赖 `dsh-keyboard-shortcuts` 写入的锁标记；不修改上游设置值，也不改写会话数据。
- 不新增配置项；插件在 profile 里即开启，移除即关闭。
