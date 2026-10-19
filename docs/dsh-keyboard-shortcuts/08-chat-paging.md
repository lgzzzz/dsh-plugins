# 消息滚动口的翻页补偿

> 本文件是 [dsh-keyboard-shortcuts 说明](../dsh-keyboard-shortcuts.md) 的第 8 册：PageUp/PageDown 按可见消息带翻页，以及 Space 原生翻页的屏蔽。

-----

## 概述

Chat 的消息滚动口把底部 sticky 的 composer 也算进 `clientHeight`。浏览器原生 PageUp/PageDown 按整个滚动口翻页，而读者实际能看到的消息带只有 `clientHeight - composerHeight`；两者相差 `composerHeight - 原生重叠量`，composer 较高或窗口较矮时每页会跳过明显一段内容。插件在 window 捕获阶段接管落在滚动口内的裸 PageUp/PageDown，按可见消息带重算步长并用 rAF 缓动；Space 的原生翻页直接吞掉。输入框、按钮、终端、模态层与内层可滚动区保持原生。

-----

## 1. 行为

| 键 | 落在消息滚动口内 | 落在其它位置 |
|---|---|---|
| `PageUp` / `PageDown` | 按可见消息带翻页，保留 50px 重叠 | 不接管，保持原生 |
| `Space` | 吞掉，不翻页 | 不接管，保持原生 |

- 只处理**裸键**：带 Shift / Control / Alt / Meta 的组合留给页面、文本选择或输入控件。
- 只处理 `[data-conversation-scroll]` 内的目标；目标为 `<body>` 时用当前焦点或页面上唯一可见的滚动口解析，多栏同时可见且无法判定时不猜。
- Space 在 composer、按钮、输入框、下拉、终端、模态层，以及还能滚动的内层滚动区保持原样。
- 命中时只 `preventDefault()`，不 `stopPropagation()`；Chat 自己的 `onIntent` 仍要看到这一按来打断跟随动画。

-----

## 2. 步长

```ts
const band = scroller.clientHeight - composer.offsetHeight
const step = Math.max(1, band - 50)
const next = clamp(scroller.scrollTop ± step, 0, scrollHeight - clientHeight)
```

- `50` 是 `PAGE_OVERLAP`：下一页仍能看到上一页最后一段内容。
- 翻页由模块内的 rAF 控制器完成：单次使用 320ms 的三次 Hermite 缓动；动画未结束时再按 PageUp/PageDown，会把新目标叠在当前动画终点上，并保留当前速度，不会从半路跳回起点。
- 滚轮、触摸、指针按下或其它按键会立即取消动画；滚动位置被页面自己的跟随动画改掉时，下一帧也会停止，避免两边抢 `scrollTop`。
- `prefers-reduced-motion: reduce` 或环境没有 rAF 时直接写 `scrollTop`，不排帧。
- 不调用 `scrollTo({ behavior: 'smooth' })`；到达顶部 / 底部时交给浏览器处理边界与滚动链。
- 1440×900、composer 128px 时，滚动口 824px、可见带 696px、步长 646px。

-----

## 3. 让位边界

以下情况不接管，事件原样交给浏览器或更近的滚动容器：

- 目标在 `.xterm` 内、模态 / 菜单 / 列表框中，或事件已被更早的处理器消费、正在输入法组合中；
- PageUp/PageDown 的目标是 `select`、`input`、`textarea`、`combobox`、`slider`、`spinbutton` 等自己有翻页语义的控件；
- Space 的目标是 `button`、`input`、`textarea`、`select`、`summary`、`video` / `audio`、`contenteditable` 或带对应 `role` 的控件；
- 目标与滚动口之间有一个还能沿该方向滚动的元素（过程组 body、代码块、长草稿输入框）：内层先滚，内层到边界后的下一次按键再交给外层；
- 滚动口里没有 `[data-composer-seat]`、composer 高度为 0，或可见带不为正：算不出补偿，保持原生；
- 多栏同时可见、目标与焦点都不在任何一个滚动口内：不猜归属。

-----

## 4. 失败模式与 DOM 契约

| 情况 | 行为 |
|---|---|
| `[data-conversation-scroll]` 消失或改名 | 找不到消息滚动口，翻页补偿退化为 no-op；原生 PageUp/PageDown 的越界与 Space 翻页回来 |
| `[data-composer-seat]` 消失或改名 | 算不出 composer 高度，退化为 no-op |
| composer 高度为 0 / 可见带 ≤ 0 | 不接管，保持原生 |
| 多个滚动口同时可见且无法从焦点判定 | 不接管，避免滚错栏 |
| 插件卸载 | window 捕获监听随 scope 释放，不再拦截任何键 |

`css-contract.json` 的 `conversation-scroll` / `composer-seat` 两条契约在构建后校验这两个锚点；锚点缺失时 `check-css.mjs` 显式失败并写明退化后果。

-----

## 5. 验证

```bash
node test/chat-paging.test.mjs   # 几何决策 + rAF 动画 + window 捕获行为
pnpm test                        # 全部测试
node check-css.mjs               # DOM 锚点契约
```

手测：打开一个有足够历史的消息滚动口，焦点放在消息区，按 PageDown / PageUp，滚动位移应等于 `滚动口高度 - composer 高度 - 50`；动画应平滑到位，连按应在当前目标上继续翻页，滚轮或其它按键应立即停住动画；在消息区按 Space 不应滚动；在 composer 内按 Space 应正常输入空格。
