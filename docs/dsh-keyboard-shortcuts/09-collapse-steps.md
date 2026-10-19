# 折叠中间步骤

> 本文件是 [dsh-keyboard-shortcuts 说明](../dsh-keyboard-shortcuts.md) 的第 9 册：`⌘⌥.` / `Ctrl+Alt+.` 折叠当前会话已展开的工作步骤，以及两层目标、焦点保持与失败边界。

-----

## 概述

会话里的工作步骤（思考、工具调用、命令输出）按上游自己的开合状态渲染：轮次级过程按钮（“已完成，用时 …”）、过程组标题（“执行了命令，已读取文件”），以及过程组内单个可展开的步骤行。插件挂一条固定行 `dsh-keyboard-shortcuts.collapse-steps`，按键命中后**点击这些上游标题**，由上游自己的开合状态收口；插件不维护折叠状态，也不改消息数据。按键只折叠，不展开。

动作分两层：先收所有展开的轮次过程与过程组标题；没有可收的外层时，再收展开着的单步详情。这样一次按键先把整段过程收起，不会在外层还开着时逐个去点被它遮住的详情。

-----

## 1. 行为

| 键（macOS / Windows·Linux） | 落在主会话 | 没有可折的展开项 |
|---|---|---|
| `⌘⌥.` / `Ctrl+Alt+.` | 折叠所有展开的轮次过程与过程组标题；没有外层展开项时折叠单步详情 | 不动作、不消费 |

- 只作用于**主会话**：`[data-slot="main.conversation"]` 内的 `[data-conversation-scroll]`。槽位标记缺席时，只在全文档恰好有一个消息滚动口时使用它；多个滚动口且没有槽位时不猜。
- 外层目标：
  - `[data-turn-process][aria-expanded="true"]`：轮次过程按钮；
  - `[data-step-process]` 内的 `[data-process-activity][aria-expanded="true"]`：过程组标题。
- 单步详情：`[data-disclosure-row]` 与 `[data-expandable]` 中 `aria-expanded="true"` 的元素，并且必须落在 `[data-step-process]` 或 `[data-chat-flow-kind="tool-call" | "assistant-step" | "turn-process"]` 容器里。系统提示词、上下文注入、提问卡片等非工作步骤的折叠行不收。
- 被上游标记为不可操作的外层（运行中 / 没有内容时的 `disabled`，或 `aria-disabled="true"`）跳过，不占外层名额。
- 只处理已经渲染到 DOM 的项：不在 DOM 里的轮次保持原来的开合状态；滚动回来时不会自动收起。
- 模态层打开、长按重复、输入法组合中、已被前面的处理器消费时不动作，也不消费。
- 焦点在终端 `.xterm` 内时由 window 捕获阶段接管：命中且有目标可折时 `preventDefault()` + `stopPropagation()`，这一按不进 shell；没有目标时不吞，终端照常收到。
- 不抢焦点：上游标题的点击处理器会先 `focus()` 自己。插件在合成点击期间临时把目标元素的 `focus` 覆盖成空函数，点击结束后恢复原属性，因此焦点留在 composer、终端或原来的位置。

-----

## 2. 实现

固定行由 `src/collapse-steps.ts` 注册（group `application`，键帽 `⌘⌥.` / `Ctrl+Alt+.`）。固定输入观察者先判准入与 `fixedRowOwns`，再收集目标；确认至少有一个目标可折时才 `consume()`，然后逐个点击。终端捕获复用同一份准入、目标收集和点击逻辑。

```ts
const targets = currentCollapseTargets()
if (targets.length === 0) return
input.consume()
collapseSteps(targets)
```

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

-----

## 3. 失败模式与 DOM 契约

| 情况 | 行为 |
|---|---|
| `[data-turn-process]` 改名 / 消失 | 收不到轮次过程；若过程组标题仍存在，按键退到过程组标题，否则退到单步详情 |
| `[data-process-activity]` 改名 / 消失 | 收不到过程组标题；轮次过程与单步详情仍按各自锚点工作 |
| `[data-step-process]` 改名 / 消失 | 过程组标题不再被认领，单步详情的容器判定也少一层 |
| `[data-disclosure-row]` / `[data-expandable]` 改名 | 外层都收起后，单步详情不再被折叠；外层那一按不受影响 |
| `[data-chat-flow-kind]` 改名 | “完全展开”模式下分不清工作步骤与系统提示词，单步详情折叠不接管 |
| 主会话槽位 / 滚动口标记消失 | 找不到作用域；只有全文档恰好一个滚动口时才回退 |
| 上游标题的 click 不再切换开合 | 按键会点击，但没有视觉变化；插件的目标收集仍会消费这一按 |
| 模态层打开 | 让给弹窗，不动作、不消费 |
| 运行中的轮次过程 | 上游 `disabled`，跳过；单步详情仍可在第二层收起 |
| 插件卸载 | 固定行、观察者与捕获监听随 scope 释放，按键恢复原状 |

`css-contract.json` 的 `turn-process-control`、`process-group-header`、`step-process-root`、`chat-flow-kind`、`step-disclosure-row`、`step-expandable` 与 `main-conversation-slot` 七条契约在构建后校验这些锚点；缺一条时 `check-css.mjs` 显式失败并写明退化后果。

-----

## 4. 验证

```bash
node test/focus-decide-collapse-steps.test.mjs   # 准入、两层目标、作用域、去重
node test/focus-bridge-collapse-steps.test.mjs   # 固定行、消费边界、焦点保持、终端捕获、卸载
node check-css.mjs                               # DOM 锚点契约
```

手测：打开一个有多轮历史的会话，展开若干“已完成，用时 …”过程与其中的工具行；焦点放在 composer 或终端里按 `⌘⌥.` / `Ctrl+Alt+.`，所有轮次过程与过程组标题收起，焦点不移动；再按一次，若仍有展开的单步详情则收起；没有展开项时按键不产生动作；在模态弹窗打开或长按该组合时不折叠。
