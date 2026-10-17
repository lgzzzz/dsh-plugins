# 构建、测试与启用

> 本文件是 [dsh-ui-chat-verbose-fold 说明](../dsh-ui-chat-verbose-fold.md) 的第 3 册：构建、类型检查、测试分组、挂载和验收步骤。

-----

## 构建与类型检查

在插件目录里执行：

```powershell
node ..\node_modules\tsdown\dist\run.mjs
node ..\node_modules\typescript\bin\tsc --noEmit
```

工具链来自仓库根的 `node_modules`。正常安装状态下也可以直接跑包脚本：

```powershell
pnpm build
pnpm typecheck
```

`pnpm` 需要可用的 store 与安装锁；在受限环境里直接跑上面的 Node 入口即可，产物相同。DSH 沙箱可能拒绝直接执行 `.cmd`，Node 入口不受影响。

产物是 `lib/client.js`（浏览器半部）和 `lib/client.js.map`。宿主半部 `index.ts` 由 Node 22+ 的 Type Stripping 直接加载，不需要编译。

-----

## 测试

测试文件按主题分组：

| 文件 | 覆盖内容 |
| --- | --- |
| `test/projection.test.mjs` | verbose 投影、`collapseTiming` 保留、投影引用稳定、注入面形状判定、按 id 定位注册项 |
| `test/fold-anchor.test.mjs` | 滚动补偿纯记账：调用顺序、修正量符号、原生已补过时差值为 0、亚像素、无锚点 / 锚点不可测的降级 |
| `test/scroll-anchor.test.mjs` | 假 DOM 接线：共享滚动口发现、整批锚点排除、跟底 / 动画折叠跳过、流程列外过滤、限频重扫 / 回收、两个滚动口互不影响 |
| `test/inject-wrap.test.mjs` | 原地包装、两种收起时机、模式切换、注入面透传、幂等、晚到注册、缺席告警、形状告警、冻结 source、服务缺席 / 异常 / 无 `inject` 的 no-op |
| `test/artifact-client.test.mjs` | `lib/client.js` 的模块 id / 插件名 / `inject` 声明，以及真产物装配策略投影与滚动补偿、`ctx.effect` 清理 |
| `test/browser/run.mjs` | headless Chrome 实测：对照组建模问题，装插件后无原生锚定 / 有原生锚定两组锚点位移在 ±5px 内；找不到 Chrome 时告警跳过 |

`test/run-all.mjs` 用 `spawnSync`（`stdio: 'inherit'`）逐个跑五个 Node 测试文件，可以直接运行：

```powershell
node test\run-all.mjs
```

也可以逐个直接运行：

```powershell
node test\projection.test.mjs
node test\fold-anchor.test.mjs
node test\scroll-anchor.test.mjs
node test\inject-wrap.test.mjs
node test\artifact-client.test.mjs
```

`inject-wrap.test.mjs` 包含两个约 1 秒的有界探测窗口，整组测试需要几秒钟。浏览器实测需要先构建，然后：

```powershell
node test\browser\run.mjs
```

实测（headless Chrome，382px 过程组折叠）：对照组的锚点位移是 -380px；装插件后，无论滚动口有没有原生锚定，锚点位移都是 0px。装置需要先构建 `lib/client.js`；找不到 Chrome 时告警跳过。

契约校验：

```powershell
node check-css.mjs
```

它读取同目录的 `contract.json`，逐条校验上游的 `hidden="until-found"`、`data-chat-anchor-key`、`data-conversation-scroll`、`data-chat-flow`、`data-chat-following-tail` 与 `data-chat-motion`。任何一条缺失都会显式失败，并在 hint 中写明补偿会怎样退化。

-----

## 挂载

把插件目录挂进 web profile：

```powershell
dsh plugin --profile web add C:\Users\Administrator\IdeaProjects\dsh-plugins\dsh-ui-chat-verbose-fold
```

`add-plugins.ps1` / `add-plugins.sh` 已包含本插件，也可以用仓库根的完整挂载脚本。挂载后：

- 如果 `dsh web` 未运行：直接启动，刷新页面。
- 如果 `dsh web` 已运行：先退出再启动，或在「设置 → 插件」里关掉再打开本插件，然后刷新页面。客户端半部改动后只刷新页面可能仍拿到旧字节，因为 Host 在合成那一刻读取产物字节。

-----

## 验收

在「设置 → 通用设置」里把「工作步骤展示」切到「完全展开」，然后分别验证两种收起时机。

1. **回答结束后**：发起一轮带工具调用的请求。回答结束后，该轮的过程行应立即收起，只留下带用时的轮次抬头；点击抬头应重新展开逐行步骤，且没有组头。
2. **回答结束后 + 不跟底**：在最终回复还在流式输出时向上滚到回复中部，让过程行位于阅读线上方；该轮结束时过程行收起，正在读的那段内容应停在视口中的原位置，而不是整体上跳。再让视口停在底部重复一次，收起后仍应贴底。判定方法见[第 4 册](04-reading-anchor.md)。
3. **下次有新消息时**：完成一轮后，最新一轮的过程行保持展开；发送下一条消息后，上一轮收起，最新一轮展开。
4. **运行中**：正在运行的轮次过程行保持可见，不因收起时机提前隐藏。
5. **异常轮次**：中断或失败的轮次保持展开，轮次抬头显示对应状态。
6. **手动优先**：手动展开一个已收起的轮次后，它保持展开，直到读者再次收起。
7. **其他模式**：切回简洁 / 标准 / 详细，折叠策略仍由官方决定；收起发生时，本插件的同步 `hidden` 折叠补偿同样生效，但跟底与动画折叠按第 4 册的规则跳过。

如果完全展开下仍看不到收起，先打开浏览器控制台检查是否有 `[dsh-ui-chat-verbose-fold]` 前缀的告警：

- `未找到 conversation.view#chat`：插件没有拿到 `ui-chat` 的注册项，通常是客户端 roster 没有加载本插件，或页面仍在使用旧产物；
- `注入面没有 hooks.presentation`：`ui-chat` 的内部形状已变，补丁退化为 no-op，需要按新形状更新第 2 册里的注入面锚点。

卸载插件后，完全展开模式回到官方的「永不自动收起」语义。
