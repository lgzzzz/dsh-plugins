# dsh-header-action-order

DSH Web 的**会话标题栏图标顺序**插件:把标题右侧动作区(`conversation.session.header.actions`)里
各插件注册的图标按固定顺序重排 —— 当前把 **定时任务(schedule)与后台作业 / 工具调用(job-list)
挪到最后**,其余保持上游先后。

纯浏览器半部 + 空宿主占位:宿主侧没有任何改动,不写 `~/.dsh/`,不改 Profile。

## 顺序配置

顺序写在 [`src/order.ts`](src/order.ts) 的 `HEADER_ACTION_ORDER`(数组下标越小越靠左):

```ts
export const HEADER_ACTION_ORDER: readonly string[] = [
  'agent-preset',      // 代理预设标签:紧跟标题
  'agent-team',        // Agent Team
  'subagent-catalog',  // 子代理
  'schedule-catalog',  // 定时任务 → 最后
  'job-list',          // 后台作业(工具调用)→ 最后
]
```

改完执行 `npm run build` 重新生成 `lib/client.js`,client-hmr 会在 500ms 内热推送(页面无需刷新)。

- **id 怎么来的**:id 是各上游插件注册时的 `options.id`,在当前构建里是
  `agent-preset` / `agent-team` / `subagent-catalog` / `schedule-catalog` / `job-list`
  (以及本仓库 `dsh-desktop-notify` 早期版本用过的 `desktop-notify`)。改名后对应项会落到「未列出」段。
- **未列出的 id**(上游新增的图标、或你不想管的项)一律排在 `HEADER_ACTION_ORDER` 之后,
  段内按它们**上游原先的 order** 保持相对先后(`UNLISTED_ORDER_BASE = 1000` 起)。
- 表里出现重复 id 时取**第一次**出现的下标。

## 实现依据(以上游源码为准)

| 事实 | 位置 |
| --- | --- |
| 该组是 list 槽 `conversation.session.header.actions`(session 作用域),渲染成 `div.headerActions` 里的一串兄弟节点(锚点 `div[data-slot=...]` 是 `display:contents`) | `dsh-client-ui-conversation/lib/client.js` 的 `ConversationSessionHeader` |
| 渲染端每帧按**活注册项**的 `options.order` 现算排序:`entriesOfSlot(key).map(e => ({order: e.options.order ?? 0}))` → `sort((a,b) => a.order - b.order)` | `dsh-client-ui-renderer/lib/client.js` 的 `renderOutletContent` |
| slot API 只有 `entries`(只读)/ `register` / `subscribe`,**没有 reorder / update** | `dsh-client-ui-slots/lib/index.js` 的 `SlotCore` |
| 上游各图标当前 order:agent-preset `-10`、schedule-catalog `10`、job-list `20`、agent-team `20`、subagent-catalog `30` | 各 `dsh-client-ui-*` / `dsh-experimental-client-ui-agent-team` 的 `slots.register` |

因此本插件**改写活注册项上的 `options.order`**,而不是「同 id + 更低 priority 遮蔽后把上游组件重新注册一遍」:
后者会换掉注册项标识(该图标 React 重挂一次)、并在上游 client-hmr 重建时留下悬空的旧组件引用;
改写 order 不换标识、不重挂、不重新跑上游 `inject`,影响面只有排序,而且幂等。

时序:图标由不同插件各自 `slots.inject` 注册,其中 `agent-team` 来自独立 bundle(挂载顺序在本地插件之后),
所以本插件在**槽声明时**应用一次,并在 `slots.subscribe` 每次注册变化后重放(见 `src/client.ts`)。

## 已知限制

- **写的是别人注册项上的字段**。上游若把 `options` 冻结 / 改成只读,单条写入抛错会被捕获并放弃该项
  (控制台一条 warn),其余项照写、页面不受影响。
- 只改**顺序**,不改位置:图标仍在这一个 `div.headerActions` 里。要改整组在标题行中的位置得用纯 CSS
  (摊平 `titleCluster` + flex `order`),不在本插件范围。
- 只覆盖这一个槽;`conversation.session.header.utilities` / `.corner` 与本插件无关。
- 上游改 id 或新增图标时,对应项落到「未列出」段而不是报错;想让它进表就改 `HEADER_ACTION_ORDER` 并重建。
- 顺序在 `apply` 后即生效,不提供运行时设置界面(要改就改常量 + 重建)。

## 源码结构

| 文件 | 职责 |
| --- | --- |
| `src/order.ts` | 顺序常量 + 纯计划 `planOrderWrites` + 写入 `applyHeaderActionOrder`(无 DOM、无 cordis) |
| `src/types.ts` | slots 服务 / 上下文的最小结构类型切片(只含本插件消费的字段) |
| `src/client.ts` | 浏览器半部入口:`inject` + `apply`(槽声明时应用 + 注册变化重放) |
| `test-order.mjs` | 纯 Node 诊断脚本(见下) |

本插件**不需要 react**:产物无任何 external。

## 构建与验证

```sh
npm install                  # 或直接用已装的 esbuild + 全局 tsc
npm run typecheck            # tsc --noEmit
npm run build                # src/client.ts → lib/client.js(入仓产物,禁止手改)
npm run check                # node --check 产物与宿主入口
node test-order.mjs          # 纯 Node,无需浏览器(需先 build)
```

`test-order.mjs` 三部分:A 纯计划分支(重排 / 幂等 / 未列出项 / 无 id / 重复表项);
B 以**类方法形态**的 slots 桩直载 `src/*.ts` 驱动 `apply`(渲染序、后到注册重放、冻结写入单条放弃、
`entries` 抛错不炸);C 用 `window.__ModuleLoader__` 桩载入构建产物,校验包名 / `inject` / 无外部依赖,
并走一遍「装配 → 后到图标 → 顺序仍正确」。

## 加载(由用户执行)

```sh
cd <仓库根>/dsh-header-action-order && dsh plugin --profile web add link:.   # 或在任意目录用绝对路径
# 重启 App 生效
```

装入后:浏览器半部改动重新 `npm run build` 即由 client-hmr 在 500ms 内热推送;宿主半部 / 组合变更需重启 App。

卸载:

```sh
dsh plugin --profile web remove dsh-header-action-order
# 重启 App 生效
```
