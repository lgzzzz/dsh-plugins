# 收起中间过程行时保持阅读位置

> 状态：本计划已实现并提交（`22f26a4`）。保留当时的实施范围、验收标准与边界，供后续维护对照。
>
> 实现时为了让插件可构建、可挂载，提交同时包含 `.gitignore` 的 `lib/` 忽略行、`add-plugins.ps1` / `add-plugins.sh` 的清单项与 `pnpm-lock.yaml` 的 importer；其余按本计划执行。浏览器实测已运行并通过：对照组锚点位移 -380px，装插件后 0px。

## 目标与验收标准

在现有插件 `dsh-ui-chat-verbose-fold` 的浏览器半部增加一层 DOM 滚动补偿：

1. **核心场景**：「完全展开」+「回答结束后」，一轮仍在流式输出时把视口滚到最终回复中间（不跟底）；该轮结束时思考/工具调用等过程行自动收起，正在读的内容在视口中的视觉位置不变（锚点位移 ≤ 1px 视为通过），不需要再向上滚找回位置。
2. **跟底场景**：视口停在底部跟随时，同样的收起仍停在底部，不被补偿拉离底部。
3. **无副作用场景**：收起发生在阅读线下方、展开、`slots` 服务缺席、没有共享滚动口、没有可用锚点时不写滚动位置。
4. **不抢上游的活**：「下次有新消息时」的动画折叠由 ui-chat 自己补偿，本插件跳过。
5. 构建、类型检查、新增测试、契约校验全部通过；不新增插件注册、依赖、profile 条目或锁文件改动。

## 根因

- 收起时机为「回答结束后」时，`ChatView` 的 `deferCompletedTurns` 为 `false`，列上的 `data-chat-motion` 不出现。过程行由 `useSearchableHidden` 在 layout effect 中一次性写入 `hidden="until-found"`，没有滚动补偿。
- ui-chat 自带的 `foldDriver` / 滚动补偿只在 `data-chat-motion` 生效时运行，也就是「下次有新消息时」的延迟折叠路径；「回答结束后」这条即时折叠路径完全依赖浏览器原生 scroll anchoring。
- 浏览器选择锚点时可能选中视口顶部正被收起的过程行。该锚点随批量隐藏一起消失时，原生 anchoring 对这一次布局变化不生效，阅读线上方的全部高度当场消失，视口内容整体上移。
- 现有 `dsh-ui-chat-verbose-fold` 只投影 `foldCompletedTurns`，把完全展开模式送进了这条没有补偿的即时折叠路径；因此需要在同一插件里补上阅读位置补偿。

## 方案

在 `dsh-ui-chat-verbose-fold` 浏览器半部增加「纯记账 + DOM 适配」两层，不 fork 上游、不改 `node_modules`、不新增插件：

- 监听 `[data-chat-flow]` 流程列内、带锚点关系的行从「无 `hidden`」变成「有 `hidden`」的批次。
- 在属性变化的微任务里，把本批元素临时显回、强制布局、量一次阅读线下方第一条可用锚点行；再按原值写回 `hidden`、再量一次；差值写回 `scrollTop`。
- 原生 anchoring 已经补过时，第二次测量读到的是补过的位置，差值为 0，不重复写。
- 本批元素及其祖先/后代在选锚点时整批排除，防止锚到马上又要隐藏的行。
- 以下路径跳过：跟底（`[data-chat-following-tail]`）、动画折叠（`[data-chat-motion]`）、共享滚动口缺席、锚点不可测、顶部没有可回写的负空间。
- 滚动补偿独立于策略投影安装：`slots` 缺席时策略投影 no-op，但 DOM 补偿仍尝试安装；插件卸载时由 `ctx.effect` 清理观察者。
- 插件挂载期间补偿对所有模式的同步 `hidden` 折叠生效；它不改变非 verbose 模式的折叠策略。

## 变更清单（按子系统）

### 1. 浏览器半部源码

| 文件 | 变更 |
| --- | --- |
| `dsh-ui-chat-verbose-fold/src/fold-anchor.ts`（新增） | 纯记账：`Anchor`、`HiddenBatchProbe`、`MIN_DELTA = 0.5`、`compensateHidden(probe)`。固定顺序 reveal → settle → pick → restore → settle → measure → delta → write；无锚点/测不到时返回 `null`，亚像素返回 `0`。复用已删除插件 `0f99d6a~1` 中经过测试的实现与注释结构。 |
| `dsh-ui-chat-verbose-fold/src/scroll-anchor.ts`（新增） | DOM 适配层。常量：`ANCHOR_ATTRIBUTE='data-chat-anchor-key'`、`HIDDEN_ATTRIBUTE='hidden'`、`HIDDEN_SELECTOR='[hidden]'`、`CONVERSATION_SCROLL_SELECTOR='[data-conversation-scroll]'`、`CHAT_FLOW_SELECTOR='[data-chat-flow]'`、`FOLLOWING_TAIL_SELECTOR='[data-chat-following-tail]'`、`MOTION_SCOPE_SELECTOR='[data-chat-motion]'`、`READING_LINE_OFFSET=1`、`DISCOVERY_THROTTLE_MS=500`。`FoldAnchorViewport` 观察滚动口子树的 `hidden` 属性；`createScrollAnchorRuntime(document)` 发现并回收共享滚动口，用 `childList` 限频重扫新挂载的滚动口。 |
| `dsh-ui-chat-verbose-fold/src/client.ts` | `ClientContext` 增加可选 `effect`；`apply()` 先安装滚动补偿再走原有 `slots` 策略投影。补偿安装失败只告警，不影响策略投影。 |

`scroll-anchor.ts` 的关键行为：

- `onHidden(records)` 只接受 `oldValue === null` 的记录，按目标去重；逐条过滤：已断开、位于跟底根内、位于 `data-chat-motion` 折叠作用域内、不在 `data-chat-flow` 列内、自身/后代/祖先都不带 `data-chat-anchor-key` 的元素直接忽略。
- 补偿期间先 `MutationObserver.disconnect()`，在 `finally` 中清空本批记账并重新观察，避免自己显回/隐藏写出的属性变化被当成新批次。
- `pick()` 用滚动口顶边 + 1px 作阅读线，按 DOM 顺序取第一条未被隐藏、非本批（含祖先/后代）、高度非 0、底边越过阅读线的锚点行。
- `measure(key)` 按锚点键重测同一条行；行被隐藏、卸载、清空时返回 `null`，整次补偿放弃。
- 运行时 `discover()` 以 `[data-conversation-scroll]` 为滚动口；一个滚动口一个 `FoldAnchorViewport`；`isConnected === false` 的滚动口回收。默认初始化时立即扫一次，`document.body` 上的子树变化按 500ms 限频重扫。
- `dispose()` 断开 body observer 与所有 viewport observer。

### 2. 构建与契约

| 文件 | 变更 |
| --- | --- |
| `dsh-ui-chat-verbose-fold/package.json` | 描述改为「遵守收起时机，并在收起时保持阅读位置」；版本 `1.1.0` → `1.2.0`；增加 `"check:css": "node check-css.mjs"`；其余不变。 |
| `dsh-ui-chat-verbose-fold/contract.json`（新增） | 钉住 6 条当前上游事实：`setAttribute("hidden", "until-found")`、`data-chat-anchor-key`、`data-conversation-scroll`（ui-chat 与 ui-conversation 任一存在即可）、`data-chat-flow`、`data-chat-following-tail`、`data-chat-motion`。每条 hint 写明失效后果（静默 no-op / 跟底被拉走 / 动画折叠双补）。 |
| `dsh-ui-chat-verbose-fold/check-css.mjs`（新增） | 复用仓库现有 `check-css.mjs` 模式：默认读同目录 `contract.json`，支持 `--dsh-root` / `--manifest`，逐条校验并在末尾汇总失效规则。 |

不修改 `index.ts`、`cordis.patch.yml`、`add-plugins.*`、`remove-plugins.*`、profile `package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`。

### 3. 测试

| 文件 | 覆盖 |
| --- | --- |
| `test/fold-anchor.test.mjs`（新增） | 纯逻辑：两次测量的调用顺序与修正量符号；原生已补过时差值为 0 不写；亚像素不写；无锚点/锚点不可测返回 `null`；正/负修正量。 |
| `test/fake-dom.mjs`（新增） | 从被删除插件适配的假 DOM：元素树、`dataset`/属性双向映射、`hidden` 祖先归零高度、`scrollTop` 夹取与写入记录、`MutationObserver` 子树通知、`[attr]` / `[attr="value"]` 选择器；`buildChat({ following, motion })` 摆出共享滚动口、流程列、过程组、回答行、占位元素。 |
| `test/scroll-anchor.test.mjs`（新增） | 接线：发现滚动口并在过程组收起后补回阅读位置；无共享滚动口不装；收起在阅读线下方不写；展开不写；整批元素及祖先/后代都不能当锚点；非锚点行、流程列外元素、跟底、动画折叠均跳过；限频重扫/回收/dispose；两个滚动口互不影响；连续两批折叠都能补偿。 |
| `test/artifact-client.test.mjs` | 保留现有产物注册与策略投影断言；增加假 DOM 下用真 `lib/client.js` 装配一次：`ctx.effect` 安装补偿、收起后 `scrollTop` 补回、清理后观察者归零。 |
| `test/run-all.mjs` | A–C 顺序加入 `fold-anchor.test.mjs`、`scroll-anchor.test.mjs`。 |
| `test/browser/fold-harness.html` + `test/browser/run.mjs`（新增） | 从被删除插件适配的 headless Chrome 实测：对照组（不装插件、无原生锚定）位移接近 `-折叠高度`；装插件后（无原生锚定 / 有原生锚定）锚点位移 ±5px 内。找不到 Chrome 时告警跳过。 |

### 4. 文档

| 文件 | 变更 |
| --- | --- |
| `docs/dsh-ui-chat-verbose-fold.md` | 概述补充「收起时保持阅读位置」；分册表加入第 4 册；失败路径说明改为「策略投影与滚动补偿可独立降级」。 |
| `docs/dsh-ui-chat-verbose-fold/04-reading-anchor.md`（新增） | 当前行为的独立说明：为什么即时折叠会顶走内容、阅读线/锚点行/本批元素的定义、显回—测量—复原—测量算法、与原生 anchoring 的分工、跳过条件、失败模式、术语。 |
| `docs/dsh-ui-chat-verbose-fold/02-solution-and-boundaries.md` | 边界表补充滚动补偿的守卫与降级；说明该补偿在插件挂载期间对所有模式的同步折叠生效，非 verbose 模式的折叠策略仍由官方决定。 |
| `docs/dsh-ui-chat-verbose-fold/03-build-test-and-enable.md` | 测试表加入三组新测试与浏览器实测；命令加入 `check:css` / `test:browser`；验收步骤加入「滚到最终回复中间、不跟底，回答结束后内容不上跳」，并修正「其他模式完全不受影响」的表述。 |
| `docs/README.md` | 插件表描述更新；契约表加入 `dsh-ui-chat-verbose-fold` / `contract.json`；`contract.json` 例外说明加入本插件；契约清单数量 6 → 7。 |

## 数据流

```
apply(ctx)
  ├─ installReadingCompensation(document)
  │    └─ createScrollAnchorRuntime(document)
  │         ├─ discover(): 每个 [data-conversation-scroll] → FoldAnchorViewport.observe()
  │         └─ body childList observer（限频 500ms）补发现新滚动口
  └─ slot 策略投影（原有逻辑，不变）

ui-chat 收起行 → hidden="until-found"
  → FoldAnchorViewport.onHidden(records)
      → 过滤跟底 / 动画折叠 / 流程列外 / 非锚点批次
      → disconnect 自身 observer
      → compensateHidden(probe)
           reveal（本批去掉 hidden）→ settle → pick（阅读线下第一条非批锚点）
           → restore（按原值写回）→ settle → measure
           → |delta| < 0.5 ? 0 : scrollTop += delta
      → clear folded + reconnect observer
```

对外新增的浏览器半部导出只有测试/契约用到的常量与 `compensateHidden` / `createScrollAnchorRuntime`；不新增服务、槽位或公共 API。

## 边界与失败模式

| 情况 | 行为 |
| --- | --- |
| 宿主侧装配（无 `document` / `MutationObserver`） | 浏览器补偿 no-op；策略投影照旧。 |
| `slots` 服务缺席 | 策略投影 no-op；滚动补偿仍尝试安装。 |
| 没有 `[data-conversation-scroll]`（非共享滚动模式） | 不装观察；后续挂载的滚动口由限频重扫补上。 |
| 阅读线下没有可用锚点，或锚点被本批隐藏/卸载/清空 | 本次不写滚动位置。 |
| 跟底（`[data-chat-following-tail]`） | 跳过，保持上游的贴底行为。 |
| 动画折叠（`[data-chat-motion]`，即「下次有新消息时」） | 跳过，由 ui-chat `foldDriver` 补偿，避免双补。 |
| 隐藏元素不在 `[data-chat-flow]` 列内、或自身/后代/祖先都没有锚点键 | 忽略，避免误判普通 `hidden`。 |
| 浏览器原生 anchoring 已补过 | 两次测量差值为 0，不重复写。 |
| 滚动位置在顶部、没有负空间可回写 | 写入被浏览器夹取，只能部分补偿；这是滚动范围本身的边界。 |
| 上游改掉 `hidden="until-found"` 或 `data-chat-*` 锚点 | 运行时静默 no-op；`check:css` 显式失败并给出后果。 |
| 插件重复装配 | 每个 `apply` 一个运行时；正常由 `ctx.effect` 清理，不叠加观察者。 |

## 验证

实现完成后按顺序执行：

1. 构建：插件目录下 `..\node_modules\.bin\tsdown.cmd`（或 `pnpm build`），确认 `lib/client.js` 已更新。
2. 类型检查：`..\node_modules\.bin\tsc.cmd --noEmit`。
3. 单元/接线/产物测试（沙箱下逐个跑，避免子进程管道限制）：
   - `node test\projection.test.mjs`
   - `node test\fold-anchor.test.mjs`
   - `node test\scroll-anchor.test.mjs`
   - `node test\inject-wrap.test.mjs`
   - `node test\artifact-client.test.mjs`
4. 契约校验：插件目录下 `node check-css.mjs`，期望 6/6 通过。
5. 语法检查：`node --check lib/client.js && node --check index.ts`。
6. 可选真浏览器实测：`node test\browser\run.mjs`；若沙箱禁止启动 Chrome，报告「未运行」并保留装置，不把它算作通过。
7. 实机验收（需要重新加载插件产物）：在「设置 → 通用设置」保持「工作步骤展示 = 完全展开」「工作步骤收起时机 = 回答结束后」，发一轮带工具调用的请求；在最终回复流式输出时向上滚到回复中部，等该轮结束收起过程行，确认正在读的那段没有上跳；再让视口停在底部重复一次，确认仍贴底。重新构建后需重启 `dsh web` 或在「设置 → 插件」里关掉再打开本插件，再刷新页面。

## 假设与不做

- 当前 GUI 使用 `[data-conversation-scroll]` 共享滚动口；列表自身滚动的布局不在本次范围，插件静默 no-op。
- ui-chat 继续用 `hidden="until-found"` 收起行，并保留 `data-chat-anchor-key` / `data-chat-flow` / `data-chat-following-tail` / `data-chat-motion`；这些由新契约清单钉住。
- 复用已删除插件的实现与测试，但不恢复它的插件身份、注册项或 profile 条目；修复落在当前 `dsh-ui-chat-verbose-fold`。
- 不修改上游包、不 fork、不新增依赖、不改锁文件；不改 `slots` 策略投影的原有语义。
- 不修复「下次有新消息时」的动画折叠（上游已有补偿），也不补偿展开动作与 React 直接卸载节点。
- 不提交、不推送；不重启 `dsh web`，实机重新加载需要用户许可或在用户操作后进行。
