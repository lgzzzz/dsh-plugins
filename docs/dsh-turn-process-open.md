# 中间过程锁定展开：CSS 可行性结论与实现计划

> 状态：**待实施**（2026-10-19）。本文是计划与 CSS 方案分析，不是已完成功能的说明；实现完成后改写为
> `dsh-turn-process-open` 的插件说明，并补上 [docs/README.md](README.md) 的插件表与契约表索引。

-----

## 1. 目标

「工作步骤展示 = 详细」时：

- 轮次过程（中间过程，`[data-turn-process]`，标题为“已完成，用时 …”）**锁定为展开**，任何新消息 / 自动收起都不再把它折叠；
- 过程组（`[data-process-activity]`，标题为“执行了命令，已读取文件”一类）**保持上游的默认折叠状态**，并且是唯一可开合的一层；
- `⌘⌥.` / `Ctrl+Alt+.` 折叠快捷键不再试图折叠中间过程（否则刚折就被重新打开，会闪一下）；
- 不引入新的滚动跳动；过程组展开时的阅读位置补偿沿用现有逻辑。

验收：新消息到来后上一轮的中间过程保持展开、过程组仍折叠；点中间过程标题（鼠标 / 键盘 / 辅助技术）无反应；过程组标题可正常开合；`⌘⌥.` 只收过程组与单步详情；页面加载、切换会话后同样成立。

## 2. 现状机制（从上游产物确认）

`dsh-client-ui-chat` 的 `ChatNodeSeat` 中：

```js
const storedOpen = useStore((s) => turnProcessOpen(s, processSpec, bottom === true && deferCollapse))
const processOpen = alwaysOpen || storedOpen
const processHidden = controllerInactive || foldable && processMember && !processOpen
```

- `turnProcessOpen()` 的规则：`turnProcesses` 里有本轮记录且 `answerStep` 匹配时，`collapsed !== true` 即展开；否则回落到 `defaultOpen`。`detailed` 的 `collapseTiming` 为「回答结束后」时 `defaultOpen=false`，未手动开过的轮次**默认就是折叠的**；当前用的是「下次有新消息时」，上一轮在发出下一条消息前保持展开，发出后回落折叠。
- 折叠的行通过 `useSearchableHidden()` 设成 `hidden="until-found"`（不是 `display:none`，UA 样式为 `content-visibility:hidden`）；过程组根另有 `outerHidden`，组标题在「下次有新消息时 + 外层折叠」时用普通 `hidden` 隐藏；组展开体 `[data-step-process-body]` 是内层折叠。
- 展开体限高已由 `dsh-ui-css-patches` 去掉；本轮不重复处理。
- 上游没有「不折叠整轮、但保留过程组」的展示模式：`detailed` 是 `foldCompletedTurns:true + stepGrouping:"history"`，`verbose/完全展开` 是 `foldCompletedTurns:false + stepGrouping:"none"`（过程组也平铺）。**这是必须先改状态、而不是只改外观的根本原因。**

## 3. 纯 CSS 方案分析（重点）

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

1. **上游布局规则以 `[hidden]` 为条件，补可见性不等于补布局。**
   `ChatGroupSeat` 的行间距是 `.O_Ebla_content > :not([hidden]):not(:empty) ~ :not([hidden]):not(:empty) { margin-top: var(--dsh-chat-flow-gap,6px) }`，列级间距同理。行虽然被 CSS 重新画出来，但 `hidden` 属性还在，gap 全部消失。实测一个已展开的过程组折叠前后 594px → 456px；这一处会话的 `scrollHeight` 从 2478 变 2328、`scrollTop` 从 1754 变 1604，产生 **150px 的滚动位移**（原生滚动锚定在内容变矮时补的）。要修只能逐条复刻上游的 `:not([hidden])` gap 规则（6/12/16px 三种），上游一改就再错。
2. **开合状态不是 CSS 能改的。** 折叠时标题上的 `aria-expanded`、`data-open`、chevron 方向、`compactAnswer` 都按 `processOpen=false` 渲染；CSS 把内容画出来后，标题仍然宣称“已折叠”，语义和视觉互相矛盾。`pointer-events:none` 只能挡鼠标，挡不住键盘 / 辅助技术的 click，也不能把按钮移出 tab 序。
3. **折叠会触发 JS 副作用，CSS 拦不住。** 外层折叠会重置成员子树的 disclosure（`disclosureReset`），并让视口按被假定收起的高度做滚动保持；这些写入发生在 React 提交 / 布局阶段，CSS 只影响绘制，改不了 `scrollTop` 与状态。上述 150px 就是实证。
4. **标题的隐藏路径不止一条。** 过程组根是 `useGroupAction(outerHidden)`，组标题是 `useGroupHeaderAction(..., deferCompletedTurns && outerHidden)`（普通 `hidden`），成员行是 `useSearchableHidden`（`hidden="until-found"`）。纯 CSS 要同时覆盖三条路径，且不能误放内层展开体，选择器和模式限定都很脆。

### 3.3 结论

**没有可靠的纯 CSS 方案。** CSS 只能把 `hidden` 的内容重新画出来，无法改变开合状态、无法阻止折叠时的滚动写入与 disclosure 重置、也无法纠正 `aria-expanded` 语义。强行 CSS 化的结果是“看起来展开、状态仍折叠、折叠瞬间仍跳 150px、组头可能点不开”。

如果要零 JS，只能接受这些缺陷；本计划不采用。CSS 只保留一条观感规则（见 4.3）。

## 4. 选定方案：把上游的开合状态锁成“开”

### 4.1 原理

`turnProcessOpen()` 在 store 有匹配 `answerStep` 的记录时直接返回记录值。只要往 per-session Chat store 写入 `{ turn, answerStep, collapsed:false }`，该轮**永远不会折叠**：不触发折叠动画、不触发滚动补偿、不重置 disclosure，`aria-expanded` 也保持 true。过程组的折叠是组件内 `useDisclosure()` 加 `[data-step-process-body][hidden]`，不受影响，仍是默认折叠、标题可开合。

### 4.2 访问方式（已在真实 GUI 验证）

- 标题元素 `[data-turn-process]` 上挂着 React 的 `__reactFiber$…` 属性。沿父链向上：
  - `TurnProcessNodeView` 的 `memoizedProps.turnProcess` 提供 `spec`（`turn`、`answerStep`）与 `setOpen()`；
  - `ChatFlow` 的 `memoizedProps.actions.setTurnProcessOpen(turn, answerStep, open)` 可**绕过 `alwaysOpen`**，在轮次还在运行时就把展开记录写进去——这样「回答结束后」时机也不会先折一次。
- 两条路径都做了实机验证：写过记录后折叠的轮次立即展开；store 的 `answerStep` 与 `spec` 匹配即持续生效。
- 这是 React 内部属性，属于本方案唯一的“非公开依赖”。实现里做能力探测，并保留降级路径（见 4.4）。

### 4.3 交互与观感

- 写入成功后给标题加标记 `data-turn-process-locked`，并挂一条 CSS：

  ```css
  [data-turn-process][data-turn-process-locked] { cursor: default; pointer-events: none; }
  ```

  鼠标点到标题不再有 hover / 指针反馈；键盘 / 辅助技术的激活由 document 捕获阶段的 `click` 拦截（只拦 `isTrusted === true`，放行本插件降级路径的合成点击）。标题仍在 DOM 中作为“已完成，用时 …”的标签，chevron 按展开态显示。
- 过程组标题完全不动；点它照常展开 / 收起。组内单步详情也照旧。
- `⌘⌥.` 的折叠目标选择器排除带标记的标题：

  ```ts
  const TURN_PROCESS_SELECTOR = '[data-turn-process]:not([data-turn-process-locked])'
  ```

  没有装新插件时选择器行为不变；装了之后快捷键先收过程组 / 单步详情，不会再碰中间过程。

### 4.4 降级

- 找不到 `actions` 时退回 `turnProcess.setOpen(true)`（只在非 `alwaysOpen` 时生效）。
- 连 `turnProcess` 也找不到（React 内部结构变化）时：不拦点击、不加标记，改为监听 `aria-expanded=false` 后合成一次点击（临时置空 `focus`）把它重新打开；只告警一次。此时“新消息到来”的瞬间仍可能折一次再开，属于降级行为，文档写明。
- 任何一步失败都只影响该标题，不影响其他轮次或过程组。

## 5. 代码改动

### 5.1 新插件 `dsh-turn-process-open`

目录结构与现有插件一致：

- `package.json`：`dsh.client.platform=web`、`immediately:true`、`dsh.bundle.patch=./cordis.patch.yml`；脚本 `build` / `typecheck` / `check` / `test` / `check:css`；devDependencies 为 `@deepseek-ai/cordis`、`tsdown`、`typescript`。
- `index.ts`：宿主半部空实现（照 `dsh-changes-hover-off`）。
- `cordis.patch.yml`：`insert` 一条 `dsh-turn-process-open`。
- `tsconfig.json`、`tsdown.config.mjs`：照现有插件复制，入口 `src/client.ts`。
- `src/fiber.ts`：从元素取 `__reactFiber$…`，沿 `return` 链找 `turnProcess` 与 `actions.setTurnProcessOpen`（深度上限、类型守卫、找不到返回 null）。
- `src/pin.ts`：
  - 常量：`HEADER='[data-turn-process]'`、`PIN_ATTR='data-turn-process-locked'`、`MAIN_SLOT='[data-slot="main.conversation"]'`、`SCROLL='[data-conversation-scroll]'`、`SESSION='[data-conversation-session]'`。
  - `conversationRoots()`：复用 `dsh-keyboard-shortcuts` 的主会话作用域规则（主槽位优先；主槽位缺席且全文档只有一个滚动口时用它）。
  - `seedHeader(header, state)`：
    1. 取 `sessionId`（最近的 `[data-conversation-session]`）、fiber 中的 `spec`；
    2. 键 `${sessionId}|${spec.turn}|${spec.answerStep ?? 0}`；键未变且标题是展开态则跳过；标题是 `aria-expanded=false` 时强制重试；
    3. 优先 `actions.setTurnProcessOpen(turn, answerStep ?? 0, true)`；否则 `setOpen(true)`；失败则走 4.4 的点击降级；
    4. 成功后 `setAttribute(PIN_ATTR, '')` 并记键；失败则移除标记。
  - `installPin()`：
    - 每个主滚动口一个 `MutationObserver`：`childList:true` + `attributes:true`，属性过滤为 `aria-expanded`、`disabled`、`data-turn-process`、`data-turn-process-messages`、`data-turn-process-tool-calls`、`data-turn-process-subagents`；回调合并到微任务再 `sync`。
    - `sync`：重取根（处理会话切换 / 根重建）、读会话 id、遍历 `[data-turn-process]`，跳过 `disabled` / `aria-disabled` / 无 `aria-expanded` 的标题。
    - 根不存在时用短定时器重试（`immediately` 插件可能先于聊天挂载），找到后停止。
    - 内联 `<style>` 写入 4.3 的 CSS；`document` 捕获阶段 `click` 拦截器（`isTrusted` + `closest('[data-turn-process][data-turn-process-locked]')` → preventDefault + stopPropagation）。
    - 返回值统一清理：断开 observer、移除监听、移除 style、移除所有标记、清掉定时器。
- `src/client.ts`：`name = 'dsh-turn-process-open'`，`apply(ctx)` 用 `ctx.effect` 装 `installPin`。

设计约束：

- 只在主会话作用域生效；右栏若有另一份会话不锁。
- 只按 DOM 中已渲染的轮次写入，不预造数据；会话切换后新 store 通过新标题重新 seed。
- 同一标题的 seed 键去重；`answerStep` 变化（重新生成）或标题被折叠时重试。
- 不修改 `transcriptView` / `collapseTiming` 设置；`完全展开` 下没有可折标题，插件自然空转。

### 5.2 `dsh-keyboard-shortcuts`

- `src/collapse-steps.ts`：`TURN_PROCESS_SELECTOR` 改为 `[data-turn-process]:not([data-turn-process-locked])`；注释说明标记由 `dsh-turn-process-open` 写入。
- `test/focus-decide-collapse-steps.test.mjs`：新增用例——带标记的展开标题不进入外层目标；同轮有展开的过程组时收过程组；只有带标记标题 + 展开详情时收详情。
- 文档：`docs/dsh-keyboard-shortcuts/09-collapse-steps.md` 的外层目标列表加 `:not([data-turn-process-locked])` 与一句说明；`docs/dsh-keyboard-shortcuts.md` 的概述同步。

### 5.3 契约与文档

- 新插件 `css-contract.json` + `check-css.mjs`（照 `dsh-keyboard-shortcuts` 的通用校验器复制，改默认清单），校验：
  - `"data-turn-process":`、`"data-turn-process-messages":`、`"data-turn-process-tool-calls":`、`"data-turn-process-subagents":`（`dsh-client-ui-chat/lib`）；
  - `TurnProcessSpec.answerStep`（`dsh-client-ui-chat/lib/types/client/contract/turn-process.d.ts`）；
  - `setOpen(open: boolean)`（`.../contract/slots.d.ts`）；
  - `setTurnProcessOpen`（`.../types/client/stores.d.ts`）；
  - `main.conversation`、`data-conversation-scroll`、`data-conversation-session`（`dsh-client-ui-conversation/lib`）。

  每条 hint 写明失效后的退化（例如计数属性改名 → 运行中 `answerStep` 变化可能延迟一拍，锁定仍生效；`setOpen`/`setTurnProcessOpen` 改名 → 无法 seed，退化为点击重开）。
- 本文件（`docs/dsh-turn-process-open.md`）：实现完成后改写为插件说明，保留第 3 节的 CSS 分析与实测数据、fiber 依赖与降级、标记约定、边界、手工验证。
- `docs/README.md`：插件表新增一行，契约表新增一行。
- 新插件的 `lib/client.js` 构建产物（gitignore，不提交）。

### 5.4 构建与挂载

```bash
cd dsh-turn-process-open && pnpm build
dsh plugin --profile web add /Users/lz/dsh-plugins/dsh-turn-process-open   # 或 ./add-plugins.sh
# 重启 dsh web（新的客户端 roster 需要服务端重新生成），再硬刷新页面
```

## 6. 边界与失败模式

- **详细 + 下次有新消息时（当前设置）**：完全无折叠；上一轮在新消息到来时保持展开，过程组转为折叠并显示组标题。
- **详细 + 回答结束后**：运行中通过 `actions` 预写展开记录，正常也不会折；若最终 `answerStep` 恰在“关闭”那次提交里才变化，可能出现一帧折叠后再展开（降级路径），文档写明。
- **最新一轮在“下次有新消息时”下**：上游 `deferCollapse` 让这一轮的组不分组、步骤平铺，组标题不显示；发出下一条消息后它变成历史轮次，组标题出现并保持折叠。这是上游的既有行为，本插件不改。
- **完全展开模式**：无可折标题，插件空转；过程组本来就平铺。
- **已停止 / 出错 / 中断的轮次**：上游 `alwaysOpen`，本来就不折，seed 无害。
- **右栏会话**：不锁。
- **卸载**：移除标记 / 监听 / 样式 / observer；已写入 store 的展开记录保留到页面刷新或会话 store 重建（无法通过公开接口清除）。
- **React 内部结构变化**：fiber 找不到 → 点击降级；`pointer-events` 与标记不会误锁无法打开的轮次。
- **键盘可达性**：标题仍是可聚焦按钮，但激活被拦截；不做 `tabindex=-1`（不改上游 tab 序），文档记为已知取舍。
- **长会话**：只对已渲染标题 seed；初始化时一次性写入，回调合并到微任务；不会遍历未渲染的历史。

## 7. 测试与验收

### 单元测试（新插件）

- `fiber.test.mjs`：父链查找、`turnProcess` / `actions` 缺失、`setOpen` 非函数、深度上限、preferred/fallback 顺序。
- `pin.test.mjs`：主会话作用域与单滚动口回退；`disabled` / 无 `aria-expanded` 跳过；seed 键去重与 `answerStep` 变化重试；折叠态强制重试；标记写入 / 失败移除；可信点击拦截、不可信放行、过程组标题不受影响；会话 id 参与键；卸载清理。
- `artifact-client.test.mjs`：构建产物模块 id / 插件名 / `apply`；假 document + 假 fiber 下真的写入、加标记、装样式、拦截点击；卸载后全清。
- `run-all.mjs` 收录以上文件。

### 现有套件

- `dsh-keyboard-shortcuts/test/run-all.mjs` 全绿（含新增“带标记标题被跳过”用例）。
- 两插件 `node check-css.mjs` 全绿；`pnpm -r typecheck`；`git diff --check`。

### 实机验证（headless Chrome + CDP，1100×800）

1. 载入多轮会话：所有可行标题 `aria-expanded="true"` 且带 `data-turn-process-locked`；历史轮次的过程组标题有高度、组展开体仍 `hidden`；成员行不再 `hidden`。
2. CDP 真实鼠标点击中间过程标题：`aria-expanded` 不变、`defaultPrevented` 命中；真实点击过程组标题：组展开体展开。
3. `⌘⌥.`：先展开一个过程组，按键后组收起、中间过程保持展开；阅读位置补偿的既有断言仍通过。
4. 切换会话再切回：标题重新 seed，过程组保持折叠，滚动位置无漂移。
5. 手工（需要真实发消息）：完成一轮后发出下一条，上一轮中间过程保持展开、过程组折叠。

### 命令

```bash
cd dsh-turn-process-open && pnpm build && node test/run-all.mjs && node check-css.mjs
cd ../dsh-keyboard-shortcuts && node test/run-all.mjs && node check-css.mjs
cd .. && pnpm -r typecheck && git diff --check
```

## 8. 假设

- 锁定只作用于主会话；右栏会话不锁。
- 接受用 React fiber 读取渲染器 props 作为唯一能改上游开合状态的手段（有 4.4 的降级与构建期契约）；若要求绝对不碰 React 内部，则只能退回 3.1 的 CSS 可见性补丁，并接受 3.2 列出的缺陷，需要另行确认。
- 不新增配置项；插件在 profile 里即开启，移除即关闭。
- 不修改上游设置值，也不改写会话数据；只写 per-session Chat store 的开合记录。
