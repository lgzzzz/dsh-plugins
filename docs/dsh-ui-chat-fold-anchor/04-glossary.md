# 术语速查表

> 本文件是 [dsh-ui-chat-fold-anchor 说明](../dsh-ui-chat-fold-anchor.md) 的第 4 册：全篇反复出现的名词，一行一个定义；需要展开的解释在链接到的分册里。

-----

| 词 | 含义 |
|---|---|
| **滚动口**（scrollport） | 真正发生滚动的那个元素：插件读写它的 `scrollTop`，所有几何测量的参照边也取自它。共享滚动模式下是外层 `[data-conversation-scroll]`，普通模式下就是列表本身；详见[第 2 册](02-how-it-works-and-failure-modes.md)的「滚动口是什么」 |
| **列表** | 承载聊天行的容器，尾部占位元素的父元素；`hidden` 折叠信号观察在它身上 |
| **占位元素**（spacer） | 列表尾部的 `[data-chat-turn-spacer]`；插件只凭它反查列表与滚动口 |
| **阅读线** | 滚动口顶边下方 1px 的水平参考线，与 ui-chat `capturePosition()` 的取样线相同。ui-chat 选活跃轮次另有一条位置更靠下的线，上游文档里说的「阅读线」指的是那一条；详见[第 2 册](02-how-it-works-and-failure-modes.md)的「阅读线是什么」 |
| **锚点行** | 带 `data-chat-anchor-key`、被选作参照物的那条行（压住阅读线的那条）；补偿就是让它在折叠前后停在同一个视觉位置。选取规则见[第 2 册](02-how-it-works-and-failure-modes.md)的「锚点行怎么选」 |
| **本批 / 批元素** | 一次折叠里一起被写上 `hidden` 的那组元素——具体就是同一个 `MutationObserver` 回调里到达、且「从无到有」的那些 `hidden` 记录的目标元素。补偿期间它们被临时显回，所以选锚点时要整批排除，连同它们的祖先与后代 |
| **修正量** | 同一条锚点行在「折叠前」与「折叠后」两次测量里的偏移之差，也就是写回滚动口的像素数；绝对值小于 `MIN_DELTA`（0.5px）按亚像素抖动处理，不写 |
| **即时折叠** | ui-chat 直接给行写 `hidden`、不做高度过渡的收起路径（设置「工作步骤收起时机」=「回答结束后」）；本插件补偿的就是它，带高度过渡的那条路径见[第 2 册](02-how-it-works-and-failure-modes.md)的「已知边界」 |
| **过程组** | 承载一轮工作步骤的组容器（成员区 `[data-step-process-content]`）；收起时机到点后被隐藏，也就是本插件要补的那次折叠 |
| **`hidden="until-found"`** | 元素不可见但仍留在可搜索树里；浏览器「在页面中查找」命中时触发 `beforematch`，ui-chat 借此把行显回，「收起」因此不必卸载节点 |
| **原生滚动锚定** | 浏览器自己维持阅读位置的能力：视口上方内容高度变化时由它调整滚动位置，受 CSS `overflow-anchor` 控制。Safari 不支持；ui-chat 在折叠动画进行期间写内联 `overflow-anchor: none` 把它关掉，贴底跟随时另有一条 CSS 规则关掉 |
| **探针**（probe） | `HiddenBatchProbe`：读写滚动位置、显隐本批元素、测量锚点这一组 DOM 能力的接口。纯逻辑 `fold-anchor.ts` 只依赖它，所以能在假探针上直接测 |
| **假 DOM / 假探针** | 测试替身，只实现插件真正用到的那部分语义（选择器、`dataset`、`hidden` 归零高度、子树通知），用于没有浏览器的 Node 测试 |
| **限频重扫** | 用 `childList` 观察会话挂载 / 卸载，最多每 500ms 重扫一遍滚动口 |
| **契约清单** | 插件目录里的 `contract.json`：钉住上游 DOM 形状的 4 条事实，由 `pnpm check:css` 逐条校验，缺失即显式失败 |
