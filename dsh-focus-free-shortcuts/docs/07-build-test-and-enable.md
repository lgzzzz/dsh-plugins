# 构建、测试与启用

> 本文件是 [dsh-focus-free-shortcuts 说明](../README.md) 的第 7 册：怎么构建、怎么跑测试、怎么启用与撤销。

---

## 9. 构建与测试

```bash
cd dsh-focus-free-shortcuts
../node_modules/.bin/tsdown                          # 构建产物（或 pnpm build）
node test/run-all.mjs                                # 跑测试（或 pnpm test）
node test/decide-escape.test.mjs                     # 只跑某一组
../node_modules/.bin/tsc --noEmit                    # 类型检查（或 pnpm typecheck）
node --check lib/client.js && node --check index.ts  # 语法检查（或 pnpm check）
```

源码按「一组快捷键一个文件」分，每组自带纯判定与桥：

| 文件 | 内容 |
|---|---|
| `src/pane-keys.ts` | 第 1 组：面板键 `⌘⌥Enter` 全屏 / `⌘\` 分屏 |
| `src/stop-sequence.ts` | 第 2 组：停止序列 `Esc` `Esc` |
| `src/approval-keys.ts` | 第 3 组：审批键 `Enter` 允许一次 / `Esc` 拒绝 |
| `src/focus-composer.ts` | 第 4 组：聚焦输入框 `Ctrl+Alt+J`（官方没有的键，插件自己挂固定键） |
| `src/page-cycle.ts` | 第 5 组：页面循环 `Ctrl+Alt+←` / `Ctrl+Alt+→`（官方没有的键对，插件自己挂固定键；切页后自动聚焦新页面） |
| `src/question-keys.ts` | 第 6 组：提问卡片 `Esc` 取消 / 关闭（同一个 `pendingInteraction` 槽位的提问域，调面板自己的 `dismiss()`） |
| `src/binding.ts` | 六组共用：上游手势 / 绑定 / 两类快捷键目录行的匹配（纯函数，无 DOM、无 Cordis） |
| `src/runtime.ts` | 六组共用：插件名与诊断、固定输入 keydown 窄化、主视图会话判定 |
| `src/client.ts` | 入口：把六组桥各装一次（`apply`），`name` / `inject` 也在这里导出 |

> 这些文件不自行重述上游类型：所有手势 / 绑定 / 目录行 / 待答审批 / 待答提问 / 会话与服务面都是 `import type` 自上游声明（清单见第 6 册第 8 节），打包时被擦除，客户端纯度门看不到它们。

`test/` 下按主题分散（A–O 十五组，共享装置在 `test/helpers.mjs`，runner 是 `test/run-all.mjs`）：

- **A 绑定判定**（`test/decide-binding.test.mjs`）：`bindingMatches`（修饰键顺序无关、双键和弦拒绝）、`enabledBinding`（解绑 / 保留 / 冲突 / 缺席）
- **B Escape 准入**（`test/decide-escape.test.mjs`）：`escapeEligible` 逐项否决
- **C 目标归属**（`test/decide-ownership.test.mjs`）：`conversationOwnsTarget` 的假 DOM（含 approval / iframe / xterm / inert）、`mainViewSessionId` 的唯一主视图判定
- **D Escape 序列**（`test/decide-stop-sequence.test.mjs`）：窗口 / 代际 / reset
- **H 审批判定**（`test/decide-approval.test.mjs`）：`fixedRowOwns` / `approvalOutcomeFor`（跟随挂载的固定行、行改键、行缺席）、`approvalEligible` 逐项否决、`approvalPanelOwnsTarget`、`asAnswerableApproval` / `presentedApproval`
- **N 提问判定**（`test/decide-question.test.mjs`）：`questionEscapeEligible` 逐项否决（裸 `Esc` 且无修饰 / 非 repeat / 非组字 / 未消费 / 无模态 / 非终端；`editable` 刻意准入）、`questionCardOwnsTarget` 的按卡片键归属（本卡片的文本域 / 根 / plan-review 卡片命中，别的键、composer、审批面板、body、无 `getAttribute` 的裸根落空）、`asDismissableQuestion` / `presentedQuestion`（`kind` 必须落在提问域、`key` 为字符串、`dismiss` 为函数）
- **J 聚焦判定**（`test/decide-focus-composer.test.mjs`）：固定行预约的物理组合（只有 `Ctrl+Alt+J` 命中）、`focusComposerEligible` 逐项否决（page 与文本控件都准入，模态 / 终端 / repeat / 组字 / 已消费否决）
- **L 页面循环判定**（`test/decide-page-cycle.test.mjs`）：固定行一行预约两个方向（`Ctrl+Alt+←` / `Ctrl+Alt+→`）、`pageCycleEligible` 逐项否决（页面 / 文本控件 / 终端 / 已被消费都准入，模态 / repeat / 组字否决）、`steppedPageId` 环状步进（回头绕到末尾、到头绕回开头、单页 / 空列表 / 当前页不在列表不切）
- **E 面板键桥接**（`test/bridge-pane-keys.test.mjs`）：聚焦让位、回退全屏/分屏、折叠/模态/repeat/过期目标、改绑/解绑/冲突、desktop 让位、服务缺席
- **F 停止桥接**（`test/bridge-stop-sequence.test.mjs`）：主视图会话歧义、停止成功与全部否决路径、卸载复位
- **I 审批桥接**（`test/bridge-approval-keys.test.mjs`）：无焦点允许/拒绝、面板让位、无待答与已作答、别的待答域、准入否决、主视图歧义、固定行缺席、服务缺席即不装、答案拒绝告警、卸载复位
- **O 提问桥接**（`test/bridge-question-keys.test.mjs`）：无焦点关卡片（页面空白处、卡片自己的答案文本域里）、别的文本控件不抢、plan-review 卡片、审批域不归这条桥、准入否决（终端 / 模态 / repeat / 组字 / 已消费 / 带修饰键）、主视图歧义、别的会话的提问（这一按仍归停止序列）、服务缺席即不装、关闭失败告警、卸载复位
- **K 聚焦桥接**（`test/bridge-focus-composer.test.mjs`）：无焦点聚焦、从文本控件抢回键盘、固定行挂载与卸载、准入否决、主视图歧义、`conversation.input` 缺失 / `for()` 抛错、服务缺席即不装
- **M 页面循环桥接**（`test/bridge-page-cycle.test.mjs`）：切页并自动聚焦（commit 之后才聚焦）、页面自聚焦时不抢、从文本控件 / 终端 / 已被消费里仍切页、折叠 / 单页 / 无活动页 / 无会话让位、缺服务即不装、卸载复位；终端内的**捕获阶段拦截**（M⑦–M⑩）：`.xterm` 内的事件在冒泡到固定通道之前就被终端停掉，所以桥在 window 捕获阶段先于 xterm 拦下（吞掉事件、不让终端的转义序列进 shell），判定与通道路径共用同一函数，非 `.xterm` 目标一律放行、模态 / 单页 / repeat 时不吞事件，卸载时捕获监听一并释放
- **G 产物**（`test/artifact-client.test.mjs`）：`lib/client.js` 的模块 id / 插件名 / `inject` 声明与端到端装配（产物零 `require`，不依赖任何 external）

> 组号沿用首次加入时的字母：A–G 是原有七组，H（审批判定）与 I（审批桥接）是第二轮新增，J（聚焦判定）与 K（聚焦桥接）是第三轮新增，L（页面循环判定）与 M（页面循环桥接）是第四轮新增，N（提问判定）与 O（提问桥接）是第五轮新增。`test/run-all.mjs` 的 `ORDER` 按主题排：A、B、C、D、H、N、J、L、E、F、I、O、K、M、G。

---

## 10. 启用

```bash
dsh plugin --profile web add /Users/lz/dsh-plugins/dsh-focus-free-shortcuts
```

重启 / 刷新 GUI 后验证：

- 焦点放在输入框，按 `⌘⌥Enter` → 应直接全屏右侧栏面板（不再需要先点面板）；
- 把焦点点到消息空白处（或任意非输入控件），连按两下 `Esc` → 应停止当前轮次；
- 让某个工具触发审批（例如需要越权执行的操作），**不要点审批卡片**：直接按 `Enter` → 应"允许一次"；再触发一次，直接按 `Esc` → 应"拒绝"；
- 把焦点点进审批详情区（卡片中部那块可聚焦区域）再按 `Esc` → 仍然是拒绝，但这一按由面板自己处理（插件让位）；
- 让 agent 提一个问题（`ask_user_question`，或 plan 模式下的 plan-review 卡片），**不要点卡片**：直接按 `Esc` → 卡片应被取消 / 关闭（阻塞式提问 → 整组等待以 `ASK_CANCELLED` 结束，agent 收到"用户取消了提问"；带工具调用线索的提问 → 只收起面板，问题仍可从它的工具调用行重新打开）；焦点落在卡片自己的答案输入框里按 `Esc` → 同样关闭（自由文本问题会自动聚焦那个输入框，这正是要能关掉它的场景）；
- 有待答提问时，把焦点点进侧栏搜索框或终端再按 `Esc` → **不**关卡片：那一按归控件自己（终端 / 别的文本控件保持自己的键）；
- 有待答提问时按 `Esc` 与连按两下 `Esc` 都不停止当前轮次（待答交互存在时停止侧本来就拒绝）；
- 焦点放哪儿都行（消息区、侧栏、甚至别的文本控件里），按 `Ctrl+Alt+J` → 应直接聚焦底部输入框，光标回到上次位置，可以立刻开始输入；
- 右侧栏开着并至少有两张页面时，任意焦点位置按 `Ctrl+Alt+→` / `Ctrl+Alt+←` → 应切成下一页 / 上一页（环状），且键盘落到新页面：切到终端可直接打字，切到文件页方向键可直接滚动；焦点已经在终端里按这对键 → 依然能切页；
- 只有一张页面或右侧栏折叠时按这对键 → 无动作（折叠时先用展开键展开，展开会顺手聚焦活动 pane）。

撤销：

```bash
dsh plugin --profile web remove dsh-focus-free-shortcuts
```

`add-plugins.sh` / `add-plugins.ps1` 已包含本插件。
