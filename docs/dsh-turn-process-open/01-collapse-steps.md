# 折叠中间步骤

> 本文件是 [dsh-turn-process-open 说明](../dsh-turn-process-open.md) 的第 1 册：`⌘⌥.` / `Ctrl+Alt+.` 折叠当前会话已展开的工作步骤、把最新一轮封口成历史轮次的组头形态，以及两层目标、阅读位置补偿、焦点保持与失败边界。

-----

## 概述

会话里的工作步骤（思考、工具调用、命令输出）按上游自己的开合状态渲染：轮次级过程按钮（“已完成，用时 …”）、过程组标题（“执行了命令，已读取文件”），以及过程组内单个可展开的步骤行。本插件挂一条固定行 `dsh-turn-process-open.collapse-steps`，按键命中后**点击这些上游标题**，由上游自己的开合状态收口；插件不维护折叠状态，也不改消息数据。按键只折叠，不展开。

动作分两层：先收所有展开的轮次过程与过程组标题；没有可收的外层时，再收展开着的单步详情。这样一次按键先把整段过程收起，不会在外层还开着时逐个去点被它遮住的详情。

带锁标记（`data-turn-process-locked`，由同一插件的锁定器维护）的轮次过程不参与折叠；同一按会把**最新一轮的平铺明细封口**成历史轮次的组头形态，使折叠结果与“下一条消息发送过来之后”完全一致（第 5 节）。

折叠前后还做一次**阅读位置补偿**：以会话视口上边界下 1px 为阅读线，折叠后让阅读线以下第一个仍可见的行保持原来的屏幕位置；视口内没有这样的行时，向前找到第一个不会被折叠的行，把它放到阅读线下 3px。

-----

## 1. 行为

| 键（macOS / Windows·Linux） | 落在主会话 | 没有可折的展开项 |
|---|---|---|
| `⌘⌥.` / `Ctrl+Alt+.` | 折叠所有展开的轮次过程（带锁标记的除外）与过程组标题；把最新一轮封口成组头形态；没有外层展开项时折叠单步详情，并保持阅读位置 | 不动作、不消费 |

- 只作用于**主会话**：`[data-slot="main.conversation"]` 内的 `[data-conversation-scroll]`。槽位标记缺席时，只在全文档恰好有一个消息滚动口时使用它；多个滚动口且没有槽位时不猜。
- 外层目标：
  - `[data-turn-process][aria-expanded="true"]`：轮次过程按钮；带 `data-turn-process-locked` 的跳过；
  - `[data-step-process]` 内的 `[data-process-activity][aria-expanded="true"]`：过程组标题。
- 单步详情：`[data-disclosure-row]` 与 `[data-expandable]` 中 `aria-expanded="true"` 的元素，并且必须落在 `[data-step-process]` 或 `[data-chat-flow-kind="tool-call" | "assistant-step" | "turn-process"]` 容器里。系统提示词、上下文注入、提问卡片等非工作步骤的折叠行不收。
- 被上游标记为不可操作的外层（运行中 / 没有内容时的 `disabled`，或 `aria-disabled="true"`）跳过，不占外层名额。
- 只处理已经渲染到 DOM 的项：不在 DOM 里的轮次保持原来的开合状态；滚动回来时不会自动收起。
- 模态层打开、长按重复、输入法组合中、已被前面的处理器消费时不动作，也不消费。
- 焦点在终端 `.xterm` 内时由 window 捕获阶段接管：命中且有目标可折时 `preventDefault()` + `stopPropagation()`，这一按不进 shell；没有目标时不吞，终端照常收到。
- 不抢焦点：上游标题的点击处理器会先 `focus()` 自己。插件在合成点击期间临时把目标元素的 `focus` 覆盖成空函数，点击结束后恢复原属性，因此焦点留在 composer、终端或原来的位置。

-----

## 2. 阅读位置补偿

阅读线是**会话显示区视口的上边界下 1px**（滚动口的 `getBoundingClientRect().top + clientTop + 1`）。视口下边界取 composer 座位 `[data-composer-seat]` 的顶；没有 composer 时取滚动口底。夹在 composer 后面的行不算在视口内。

折叠前按文档顺序记下阅读线以下、折叠前可见的每一行（`top` 为视口坐标）：

- 聊天流行：`[data-chat-flow-key]`，含过程组行与嵌套在过程组里的成员行；
- 单步详情行：`[data-disclosure-row]` / `[data-expandable]`，且落在与折叠目标相同的 `[data-step-process]` / `tool-call` / `assistant-step` / `turn-process` 范围里。

折叠后按同一顺序取**第一个仍然可见的行**作为锚点——也就是从阅读线向前遇到的第一个不会被折叠掉的行。被 `[hidden]` 祖先藏起来、或被虚拟化到高度 0 的行跳过。

- **锚点折叠前在视口内**：写回滚动位置，让锚点的屏幕 `top` 与折叠前一致。滚动位置夹在 `[0, scrollHeight - clientHeight]`。
- **视口内没有锚点**：继续向前找第一个仍然可见的行（它原本在视口下方），把它的顶部放到阅读线下 3px。整屏都被折叠内容占满时，读者从折叠段结束的地方继续，而不是把视图拉回折叠段内部。
- **没有仍可见的锚点**：不补偿。没有“下一行”时不做猜测。
- **点击没有改变布局**：锚点仍在原位；即使它原本在视口下方也不拉上来，避免目标没有真正收起时把视图拽走。
- 上游正在跑折叠动画（`[data-chat-motion="collapse"]` / `"reveal"`）时不补偿：上游自己的帧补偿已经在保持阅读位置，再补一次会叠加成二次滚动。
- 会话处于跟随尾部（`[data-chat-following-tail]`）时不补偿：此时应留在底部，而不是把视图拉回阅读线。
- 补偿只写滚动口的 `scrollTop`；不插入占位元素、不改上游 store、不抢焦点。读不到几何（假 DOM、已卸载的滚动口）时直接跳过，折叠照常完成。

实现分两步，顺序不能反：

```ts
const plan = planReadingAnchor(root)  // 点击前：记下阅读线以下的行
collapseSteps(targets)                // 点击上游标题
queueMicrotask(() => applyReadingAnchor(plan)) // 上游提交布局后：按锚点补 scrollTop
```

点击后行会被隐藏或重排；如果等点击后再找锚点，就只能看到新几何，无法知道它折叠前在哪。上游对合成点击的 React 提交发生在当前事件处理器返回之后，所以补偿排进微任务，等布局落定再量。补偿抛错或单行点击抛错都只告警，不影响已经完成的那部分折叠。

-----

## 3. 实现

固定行由 `src/collapse-steps.ts` 注册（group `application`，键帽 `⌘⌥.` / `Ctrl+Alt+.`），阅读位置规则在 `src/reading-anchor.ts`，封口在 `src/collapse-seal.ts`。固定输入观察者先判准入与 `fixedRowOwns`，再按滚动口收集目标批次；确认至少有一个目标可折或可封口时才 `consume()`，然后逐批封口、点击并补偿。终端捕获复用同一份准入、目标收集与折叠逻辑。

```ts
const batches = currentCollapseBatches()
if (!batches.some(batchHasWork)) return
input.consume()
collapseBatches(batches)
```

每批的顺序是 `planReadingAnchor` → `sealGroups(batch.seals)` → `collapseSteps(batch.targets)` → 微任务补偿；封口与点击都可能改变高度，共用同一份阅读位置。

点击使用 `element.click()`，让上游的 React `onClick` 正常执行：

```ts
const hadOwnFocus = Object.prototype.hasOwnProperty.call(element, 'focus')
const originalFocus = element.focus
element.focus = () => {}
try {
  element.click()
} finally {
  if (hadOwnFocus) element.focus = originalFocus
  else delete element.focus
}
```

- `element.click()` 派发的是普通点击，上游无需额外分支；DOM 顺序与真实点击一致。
- `focus` 覆盖只发生在点击期间，且只覆盖目标元素自己的属性，不改原型，不影响其它元素。
- 单个目标点击抛错时捕获并告警，继续处理后面的目标。
- 每个滚动口独立采集与补偿；一份批次的折叠不影响另一份的阅读位置。

-----

## 4. 失败模式与 DOM 契约

| 情况 | 行为 |
|---|---|
| `[data-turn-process]` 改名 / 消失 | 收不到轮次过程；若过程组标题仍存在，按键退到过程组标题，否则退到单步详情 |
| `[data-process-activity]` 改名 / 消失 | 收不到过程组标题；轮次过程与单步详情仍按各自锚点工作 |
| `[data-step-process]` 改名 / 消失 | 过程组标题不再被认领，单步详情的容器判定也少一层 |
| `[data-disclosure-row]` / `[data-expandable]` 改名 | 外层都收起后，单步详情不再被折叠；外层那一按不受影响 |
| `[data-chat-flow-kind]` 改名 | “完全展开”模式下分不清工作步骤与系统提示词，单步详情折叠不接管 |
| 主会话槽位 / 滚动口标记消失 | 找不到作用域；只有全文档恰好一个滚动口时才回退 |
| `[data-chat-flow-key]` 改名 | 阅读位置补偿找不到行锚点，退化为 no-op；折叠本身仍生效 |
| `[data-chat-turn]` 改名 | 封口认不出最新锁轮次；折叠本身仍生效 |
| 轮次过程标题滚出阅读线、展开步骤仍在读 | 阅读行按文档顺序继续向前找，不要求标题行仍在视口里 |
| `[data-composer-seat]` 消失 | 视口下边界退回滚动口底；被 composer 盖住的行可能被误判在视口内 |
| `[data-chat-following-tail]` 消失 | 在会话底部折叠时也会做阅读线补偿，可能把视图从底部拉开 |
| `[data-chat-motion]` 消失 | 认不出上游正在做帧补偿，可能和它的阅读位置保持叠加成二次滚动 |
| 滚动口没有几何 | 跳过补偿，折叠照常完成 |
| 没有仍可见的锚点 | 不补偿；按键仍然消费 |
| 补偿目标越过滚动范围 | 夹到 `0` 或最大滚动位置，只能尽量接近锚点原位 |
| 上游标题的 click 不再切换开合 | 按键会点击，但没有视觉变化；插件的目标收集仍会消费这一按 |
| 模态层打开 | 让给弹窗，不动作、不消费 |
| 运行中的轮次过程 | 上游 `disabled`，跳过；过程组与单步详情仍可按各自规则收起 |
| 锁定器未起作用（锁标记缺失） | 轮次过程重新参与折叠；封口不启用（不误藏内容） |
| `data-group-expanded-mode` 改名 / 消失 | 封口认不出平铺轮次；折叠后保持平铺，不丢内容 |
| `data-step-process-body` 改名 / 消失 | 封口的隐藏成员规则落空；组头显示、成员仍平铺（退化，不丢内容） |
| `:has()` 不支持 | 跳过封口，只告警一次；平铺形态不变 |
| 上游折叠动画在跑 | 由上游帧补偿接管；本插件不补 |
| 插件卸载 | 固定行、观察者与捕获监听随 scope 释放，按键恢复原状 |

`css-contract.json` 的 `turn-process-control`、`process-group-header`、`step-process-root`、`chat-flow-kind`、`step-disclosure-row`、`step-expandable`、`main-conversation-slot`、`chat-flow-row`、`chat-flow-turn`、`chat-following-tail`、`chat-motion`、`group-expanded-mode`、`step-process-body` 与已有的 `composer-seat` / `conversation-scroll` 契约一起在构建后校验这些锚点；缺一条时 `check-css.mjs` 显式失败并写明退化后果。

-----

## 5. 封口：折叠后的形态对齐

“详细”模式下，最新一轮的中间过程是**平铺**的（组根带 `data-group-expanded-mode`，组头普通 `hidden`，组体可见），更早的轮次是**分组**的（组头可见、组体 `hidden="until-found"`）。加锁之后，上一轮在新消息到达时保持展开，于是“折叠样式”就是分组形态。

### 5.1 目标

按 `⌘⌥.` 后，最新一个**带锁且展开**的轮次立即呈现成分组形态：轮次过程标题仍展开，其下出现折叠着的过程组标题，成员行不可见；与“下一条消息发送过来之后”的 DOM 状态和几何一致。

### 5.2 动作与顺序

`src/collapse-seal.ts`：

1. 找最后一个 `[data-turn-process][data-turn-process-locked][aria-expanded="true"]`，取它所在行（`[data-chat-turn]`）的轮次；没有锁标记时整段空转。
2. 取该轮次下仍平铺（`data-group-expanded-mode`）、尚未封口（`data-dsh-collapse-sealed`）、且组头容器里确有 `[data-process-activity]` 的 `[data-step-process]` 组根。
3. 组根写 `data-dsh-collapse-sealed`；移除组头容器的 `hidden`。
4. 一条受限 CSS 隐藏组体；组头 `aria-expanded=true` 时放回组体。

顺序固定为：采集阅读位置 → 封口 → 点击折叠目标 → 微任务补偿滚动。封口本身会明显改变高度，必须参与补偿；只折点击会让阅读位置漂移。

### 5.3 为什么移除组头 `hidden`

上游 `useMotionHidden` 在 `hidden` 翻成 false 时，只有元素**还带** `hidden` 属性才会跑一次高度 reveal 动画。封口时把它移除，下一条消息到达、真正进入分组态时就不会再“从 0 高度长出来”，折叠前后无位移、无闪烁。

### 5.4 CSS

```css
[data-step-process][data-group-expanded-mode][data-dsh-collapse-sealed]:has(> div > [data-process-activity]) > [data-step-process-body] { display: none !important; }
[data-step-process][data-group-expanded-mode][data-dsh-collapse-sealed]:has(> div > [data-process-activity][aria-expanded="true"]) > [data-step-process-body] { display: block !important; }
[data-step-process][data-group-expanded-mode][data-dsh-collapse-sealed] > div[hidden]:has([data-process-activity]) { display: block !important; }
```

三段都要求「平铺 + 已封口」：下一条消息到达、`data-group-expanded-mode` 消失后自动失效，交回上游。前两段要求组头容器里存在 `[data-process-activity]`——上游结构变化时只会退化成“不封口”，不会出现“组头看不见、内容又被藏起来”。

### 5.5 边界

- 没有锁标记（锁定器未起作用）：不封口，行为与未装本插件时相同。
- 运行中的轮次：没有轮次过程标题，不封口。
- 没有过程组 / 组头不可用：没有可封口组根。
- 右栏会话：只在主会话滚动口内封口。
- 封口后再按一次：没有可折项、没有可封口组，不消费。
- `:has()` 不支持：跳过封口并告警一次；平铺形态不变。
- 卸载：仍平铺的组写回组头 `hidden`、移除标记与 `<style>`。
- 封口期间组体用 `display:none`，浏览器“在页面中查找”暂时找不到组内文本；真正分组态用 `hidden="until-found"` 可被 beforematch 找到。组根也不会补 `data-chat-paging-anchor`（锁定轮次不会跑上游折叠落点）。两者不影响视觉形态。

-----

## 6. 验证

```bash
node test/collapse-targets.test.mjs   # 准入、两层目标、作用域、去重
node test/collapse-reading.test.mjs   # 阅读线、锚点、向前对齐、夹紧与跳过边界
node test/collapse-bridge.test.mjs    # 固定行、消费边界、焦点保持、终端捕获、阅读补偿、卸载
node test/collapse-seal.test.mjs      # 封口目标、组头显示、幂等、清理与样式单例
node check-css.mjs                    # DOM 锚点契约
```

手测：打开一个有多轮历史的会话，把视图滚到一段展开的过程中间，确认阅读线落在过程内部后按 `⌘⌥.` / `Ctrl+Alt+.`。若折叠后阅读线下方仍有可见行，该行应停在原来的屏幕位置；若整屏都被折叠内容占满，向前第一个不会被折叠的行应落在阅读线下 3px。再验证三种边界：在会话底部跟随尾部时折叠，视图留在底部；焦点放在 composer 或终端里，焦点不移动；模态弹窗打开或长按组合时不折叠、不消费。
