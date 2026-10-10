# 3. 构建、测试与启用

本册给出构建、测试、契约校验的命令与它们各自覆盖什么，以及把插件挂进 web profile 的方式。读完能自己跑一遍并判断改动有没有破坏契约。

-----

## 命令

在插件目录（或仓库根用 `pnpm -r`）下：

| 命令 | 作用 |
|---|---|
| `pnpm build` | tsdown 产出 `lib/client.js`（浏览器半部）与宿主半部 bundle |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | 三组 Node 测试，见下 |
| `pnpm test:browser` | headless Chrome 实测，见下；找不到 Chrome 时告警跳过（退出码 0） |
| `pnpm check:css` | 对 DSH 安装产物校验 `contract.json` 里的 7 条上游契约 |
| `pnpm check` | `lib/client.js` 与 `index.ts` 的语法检查 |

-----

## 三组 Node 测试

`node test/run-all.mjs` 按 A–C 主题顺序跑：

- **A 纯逻辑**（`test/fold-anchor.test.mjs`）——探针是替身，验证参照点记账、修正量符号、亚像素抖动、锚点失效，以及即时折叠的「显回→量→复原→量→写」调用顺序与「原生锚定已补过则差值为 0」。
- **B 接线**（`test/client-wiring.test.mjs`）——用带布局模型的假 DOM 摆 9 组场景：滚动口发现（共享/普通两种模式、限频重扫）、窗口开合、`ResizeObserver` 修正、即时折叠修正、锚点失效停手、折叠在阅读线下方不写、折叠窗口接管过的元素不补第二次、尾随输出让位。
- **C 产物**（`test/artifact-client.test.mjs`）——载入真产物 `lib/client.js`，校验模块 id / 插件名 / 无 external，并在假 DOM 上把「折叠窗口内补回阅读位置」走通一遍（含 `ctx.effect` 的清理）。

假 DOM 只实现插件真正用到的那部分语义：`[attr]` / `[attr="value"]` 选择器、`dataset` 与属性表的双向映射、`style` 写入触发属性记录、`hidden` 归零高度并把下方内容整体上移、`MutationObserver` 的子树通知、`ResizeObserver` 由测试显式推进。

-----

## 浏览器实测装置

`node test/browser/run.mjs` 用 headless Chrome 打开 `test/browser/fold-harness.html`，跑五组折叠场景并断言锚点位移：

1. 动画折叠 + 不装插件 → 应当看到阅读位置被顶走（复现问题）；
2. 即时折叠 + 滚动口没有原生锚定 + 不装插件 → 同上；
3. 动画折叠 + 装插件；
4. 即时折叠、没有原生锚定 + 装插件；
5. 即时折叠、有原生锚定 + 装插件。

第 1、2 组的断言是「位移接近 −折叠高度」，第 3–5 组的断言是「位移在 ±30px / ±5px 内」——装置同时证明问题与修复都在场。它需要先 `pnpm build`（装置加载 `lib/client.js`），并用 `--chrome <path>` 或 `$CHROME` 指定浏览器；找不到 Chrome 时只告警跳过。

假 DOM 测不出「布局之后、绘制之前」的真实时序，浏览器实测补的是这一段：五组场景的实测值见[第 1 册的行为对照表](01-behavior-difference.md#装与不装各看到什么)。

-----

## 怎么自己看一眼

1. 在 GUI 里发一条会让 Agent 跑一段工具调用的消息；
2. 最终回复还在输出（或刚输出完）时向上滚一段，让最终回复停在视口中部；
3. 等过程组折叠：不装插件时正在看的那段会整体上移（折叠量大时移出视口），装上插件后停在原处。

两种折叠时机都值得试：默认的「回合结束时」走即时折叠，设置里切到「下一次输入时」才走带画的折叠动画。

-----

## 启用

```bash
./add-plugins.sh                      # 仓库根：把所有本地插件挂进 web profile
dsh plugin --profile web add <目录>    # 只挂这一个
```

挂载后刷新 GUI 页面即生效。**改过客户端半部（`src/client.ts`）必须先 `pnpm build`**：Host 在合成那一刻就把产物字节读进快照，重新构建后仅刷新页面可能仍拿到旧字节——还要重启 `dsh web`，或在「设置 → 插件」里关掉再打开本插件，再刷新页面（完整说明见 [dsh-changes-hover-off 的挂载与启用](../dsh-changes-hover-off.md#挂载与启用)）。

停用或改回原行为：在「设置 → 插件」里关掉本插件，或从 profile 里移除；插件不改 ui-chat 的状态，移除后页面行为即回到上游默认。
