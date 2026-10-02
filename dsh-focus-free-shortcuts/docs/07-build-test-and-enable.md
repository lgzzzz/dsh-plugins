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
| `src/focus-composer.ts` | 第 4 组：聚焦输入框 `Ctrl+Alt+J`（唯一一把"官方没有、插件自己挂固定键"的键） |
| `src/binding.ts` | 四组共用：上游手势 / 绑定 / 两类快捷键目录行的匹配（纯函数，无 DOM、无 Cordis） |
| `src/runtime.ts` | 四组共用：插件名与诊断、固定输入 keydown 窄化、主视图会话判定 |
| `src/client.ts` | 入口：把四组桥各装一次（`apply`），`name` / `inject` 也在这里导出 |

> 这些文件不自行重述上游类型：所有手势 / 绑定 / 目录行 / 待答审批 / 会话与服务面都是 `import type` 自上游声明（清单见第 6 册第 8 节），打包时被擦除，客户端纯度门看不到它们。

`test/` 下按主题分散（A–I 九组，共享装置在 `test/helpers.mjs`，runner 是 `test/run-all.mjs`）：

- **A 绑定判定**（`test/decide-binding.test.mjs`）：`bindingMatches`（修饰键顺序无关、双键和弦拒绝）、`enabledBinding`（解绑 / 保留 / 冲突 / 缺席）
- **B Escape 准入**（`test/decide-escape.test.mjs`）：`escapeEligible` 逐项否决
- **C 目标归属**（`test/decide-ownership.test.mjs`）：`conversationOwnsTarget` 的假 DOM（含 approval / iframe / xterm / inert）、`mainViewSessionId` 的唯一主视图判定
- **D Escape 序列**（`test/decide-stop-sequence.test.mjs`）：窗口 / 代际 / reset
- **H 审批判定**（`test/decide-approval.test.mjs`）：`fixedRowOwns` / `approvalOutcomeFor`（跟随挂载的固定行、行改键、行缺席）、`approvalEligible` 逐项否决、`approvalPanelOwnsTarget`、`asAnswerableApproval` / `presentedApproval`
- **J 聚焦判定**（`test/decide-focus-composer.test.mjs`）：固定行预约的物理组合（只有 `Ctrl+Alt+J` 命中）、`focusComposerEligible` 逐项否决（page 与文本控件都准入，模态 / 终端 / repeat / 组字 / 已消费否决）
- **E 面板键桥接**（`test/bridge-pane-keys.test.mjs`）：聚焦让位、回退全屏/分屏、折叠/模态/repeat/过期目标、改绑/解绑/冲突、desktop 让位、服务缺席
- **F 停止桥接**（`test/bridge-stop-sequence.test.mjs`）：主视图会话歧义、停止成功与全部否决路径、卸载复位
- **I 审批桥接**（`test/bridge-approval-keys.test.mjs`）：无焦点允许/拒绝、面板让位、无待答与已作答、别的待答域、准入否决、主视图歧义、固定行缺席、服务缺席即不装、答案拒绝告警、卸载复位
- **K 聚焦桥接**（`test/bridge-focus-composer.test.mjs`）：无焦点聚焦、从文本控件抢回键盘、固定行挂载与卸载、准入否决、主视图歧义、`conversation.input` 缺失 / `for()` 抛错、服务缺席即不装
- **G 产物**（`test/artifact-client.test.mjs`）：`lib/client.js` 的模块 id / 插件名 / `inject` 声明与端到端装配（产物零 `require`，不依赖任何 external）

> 组号沿用首次加入时的字母：A–G 是原有七组，H（审批判定）与 I（审批桥接）是第二轮新增，J（聚焦判定）与 K（聚焦桥接）是本轮新增。`test/run-all.mjs` 的 `ORDER` 按主题排：A、B、C、D、H、J、E、F、I、K、G。

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
- 焦点放哪儿都行（消息区、侧栏、甚至别的文本控件里），按 `Ctrl+Alt+J` → 应直接聚焦底部输入框，光标回到上次位置，可以立刻开始输入。

撤销：

```bash
dsh plugin --profile web remove dsh-focus-free-shortcuts
```

`add-plugins.sh` / `add-plugins.ps1` 已包含本插件。
