# 原因：收起时机为什么没有消费者

> 本文件是 [dsh-ui-chat-verbose-fold 说明](../dsh-ui-chat-verbose-fold.md) 的第 1 册：设置本身没有坏，完全展开模式的策略把整轮折叠的渲染路径全部短路了。

-----

## 两个设置各自存在，也都会持久化

「工作步骤展示」和「工作步骤收起时机」是同一张 Host 设置表单里的两个独立字段：

| 设置行 | 字段 | 取值 |
| --- | --- | --- |
| 工作步骤展示 | `ui-chat.transcriptView` | `compact` / `standard` / `detailed` / `verbose`（完全展开） |
| 工作步骤收起时机 | `ui-chat.collapseTiming` | `completion`（回答结束后）/ `next-input`（下次有新消息时） |

`TranscriptViewPolicy` 同时订阅这两个字段，`derivePresentationPolicy(mode, collapseTiming)` 把两者合成为一份 `ChatPresentationPolicy`。切换收起时机时，实时 source 会发布新的策略，Chat 的 `usePresentation` 选择器也会重新求值。因此「设置没保存」「写入被拒绝」或「订阅没触发」都不是本问题的原因。

-----

## 官方完全展开策略没有打开整轮折叠

`ui-chat` 的策略表按模式给出四个字段：

| 模式 | `foldCompletedTurns` | `stepGrouping` |
| --- | --- | --- |
| 简洁 `compact` | `true` | `collapsed` |
| 标准 `standard` | `true` | `collapsed` |
| 详细 `detailed` | `true` | `history` |
| 完全展开 `verbose` | `false` | `none` |

`collapseTiming` 会原样放进四种策略，但渲染层只在整轮折叠成立时读取它。完全展开的 `foldCompletedTurns: false` 把下面四条路径同时短路。

-----

## 收起时机的四个消费点

### 1. ChatView：是否把最新一轮留到下次输入

`ChatView` 读取 `policy.collapseTiming === 'next-input'` 得到 `deferCompletedTurns`，再结合待处理 transcript 得到 `deferCollapse`，把它传给过程组和过程行的座位。这个值决定「最新一轮是否默认保持展开」，但它只影响后续的自动收起判断；没有整轮折叠时，它不会自己隐藏任何内容。

### 2. ChatNodeSeat：过程成员是否被隐藏

`ChatNodeSeat` 先读取 `policy.foldCompletedTurns`，得到 `foldCompleted`。只有它为 `true` 时，座位才计算 `processWindowReady`、`foldable` 和 `processHidden`。完全展开下 `foldCompleted` 为 `false`，于是：

- `processWindowReady` 为 `false`；
- `foldable` 为 `false`；
- `processHidden` 为 `false`。

每个工具调用、思考行都直接渲染，没有任何行会因收起时机而被隐藏。

### 3. ChatGroupSeat：过程组是否被整组隐藏

`ChatGroupSeat` 的 `outerHidden` 同样以 `foldCompleted` 为前提：

```text
outerHidden = foldCompleted && turnClosed && spec && !alwaysOpen && !storedOpen
```

完全展开下 `foldCompleted` 为 `false`，`outerHidden` 恒为 `false`，过程组根节点不会被隐藏。收起时机在这里还影响 `grouped` 和组头可见性，但 `grouped` 的第一个分支要求 `stepGrouping` 为 `collapsed` 或 `history`；完全展开的 `stepGrouping: 'none'` 让该分支也不成立。

### 4. TurnProcessNodeView：轮次抬头是否可点开

轮次抬头按钮的 `canCollapse` 要求 `turnProcess.foldable`。完全展开下 `foldable` 为 `false`，抬头仍会显示「用时 / 已停止 / 失败」等状态，但按钮是禁用状态，不能展开或收起过程行。

-----

## 结论

完全展开模式的设计语义是「保留时长或状态抬头，但不支持收起，历史过程行直接显示」。在这个语义下，收起时机确实没有作用对象；设置本身、Host 持久化和实时策略订阅都正常。要让收起时机生效，必须让完全展开模式也进入整轮折叠路径，而不是只改设置行或等待一次重新渲染。

下一页说明为什么最小改法是只把 `foldCompletedTurns` 投影为 `true`，以及这样做会保留和改变哪些行为。
