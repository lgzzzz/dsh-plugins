# dsh-subagent-forge-panel

子智能体会话的会话面板里，**直接不显示** forge 的 Git 与变更请求行——那条「状态已停止更新 /
Git 与变更请求信息可能已过时」连同它旁边注定失败的重试按钮一起消失，不留说明、不留占位。
纯客户端插件：一个不可见的标记元素加一条 CSS 规则，上游产物一行未改，从 profile 移除即恢复。

> 这一行不是网络抖动：Host 的普通会话路由拒绝 `header.origin === 'subagent'` 的会话身份，
> forge 面板的 `follow` 流在第一帧状态之前就结束，于是连接行与它的「重试」会一直挂在面板里，
> 点几次也不会成功。判定的来由见[为什么子会话拿不到 Git 与变更请求](#为什么子会话拿不到-git-与变更请求)。

-----

## 它做的是什么

| | 行为 |
|---|---|
| 位置 | 槽位 `conversation.session.panel.environment.row`，`id: forge-subagent-guard`，`order: 41`：紧跟 forge 的连接行（`forge.connection`，`order: 40） |
| 出现时机 | 只在**子智能体会话**：当前会话的快照带 `subagent` 地址、或会话列表行标着 `origin: 'subagent'` |
| 渲染内容 | 没有可见内容。子会话里它渲染一个 `hidden` 的零尺寸标记元素，只用来定位所在分区；普通会话整行渲染为空 |
| 效果 | 样式表按标记在**该分区**里隐藏 `[data-forge-connection]`：连接行与它的「重试」都不再出现，位置也不留白 |
| 其余行不动 | forge 的检出行与本地变更行、上游的项目行、`dsh-subagent-parent-nav` 的「主智能体」一栏照旧 |
| 无障碍 | 标记元素 `display: none` + `aria-hidden`，不占行、不进无障碍树；没有新增可读文本或可操作控件 |

-----

## 为什么子会话拿不到 Git 与变更请求

forge 面板需要一个 `Session` 参数，Host 通过普通会话路由把它解析成 Agent；这条路由对子智能体身份是硬拒绝：

| 上游行为 | 结果 |
|---|---|
| `hasApiSessionSubagentOwner()` 按 `header.origin === 'subagent'` 判定身份 | 子智能体会话被认出来 |
| 会话解析在拿到活 Agent 时也先查这条身份 | 即便子智能体正在运行，`follow` 同样被拒 |
| 没有活 Agent 时，已挂载的子会话身份返回 `session/agent-busy`，不代它恢复 Agent | 子智能体跑完后也一样 |
| 历史读取要求子会话「必须用它的持久父地址」 | 裸 `SessionId` 一律拒绝 |

所以客户端那次 `follow` 在第一帧状态之前就结束，面板把它记成「流已断开」——也就是上游那条
「状态已停止更新」。这不是本插件造成的，也不是本机能修好的：普通会话路由把子智能体身份留给
子智能体路由是**设计**，子智能体的 Git 与变更请求本来就不在这条通道上。要看这些信息，去父会话
的会话面板——两者通常在同一工作目录。

-----

## 为什么是这个方案

| 方案 | 结论 |
|---|---|
| 改上游 forge 包，让它识别子会话并不渲染连接行 | 改的是 npm 产物，升级即丢失；判定逻辑还要塞进一个不归我们管的服务里 |
| 只提 issue，自己什么都不做 | 理由成立，但那条不会成功、还会被反复点的「重试」要等上游修 |
| 在同一位置渲染一行说明（「这里不提供……」） | 信息更全，但用户要的是**不显示**：面板里不留任何 Git 相关痕迹 |
| **不可见标记元素 + 一条限范围的 CSS 规则（本实现）** | 用上游本就给插件留的行槽拿会话作用域与挂载点，用上游打的分区属性限定隐藏范围；界面上什么都不多 |

不提供「跳到父会话」：`dsh-subagent-parent-nav` 已经在同一个面板里提供上级导航。

-----

## 实现文件

| 文件 | 职责 |
|---|---|
| [`src/client.ts`](../dsh-subagent-forge-panel/src/client.ts) | 浏览器入口：挂样式、等行槽、注册守卫 |
| [`src/guard.tsx`](../dsh-subagent-forge-panel/src/guard.tsx) | 守卫组件：判定子会话，渲染不可见的标记元素并给分区打标记 |
| [`src/detect.ts`](../dsh-subagent-forge-panel/src/detect.ts) | 纯判定：快照地址（必须点名本会话）与会话列表行 `origin` 两条依据 |
| [`src/mark.ts`](../dsh-subagent-forge-panel/src/mark.ts) | 给最近的 `[data-session-panel-section]` 打标记，卸载时只摘一次 |
| [`src/styles.ts`](../dsh-subagent-forge-panel/src/styles.ts) | 唯一一条规则：在带标记的分区里隐藏 forge 连接行 |
| [`src/registration.ts`](../dsh-subagent-forge-panel/src/registration.ts) | 槽键 / 注册 id / `order` 与注册选项（纯模块，测试可直接 import） |
| [`index.ts`](../dsh-subagent-forge-panel/index.ts) | 宿主半部空实现 |
| [`check-css.mjs`](../dsh-subagent-forge-panel/check-css.mjs) + [`css-contract.json`](../dsh-subagent-forge-panel/css-contract.json) | 行槽 / 标准 props / 会话身份字段 / 面板锚点 / forge 锚点的静态契约（10 条） |

`dsh.client.platform = web`、`immediately: true`：页面加载即挂。
`inject = ['slots', 'forgeChanges']`：`forgeChanges` 是 forge 面板的公开面，也就是「forge 装着
没有」的开关——forge 不在时没有可隐藏的东西，守卫不注册；forge 被卸下时注册项随作用域收回。

-----

## 契约与静默失败

`pnpm --filter dsh-subagent-forge-panel check:css` 在上游改名时显式失败，而不是让隐藏规则在页面上
静默失效：

| 失效的上游事实 | 页面上的表现 |
|---|---|
| 行槽 `conversation.session.panel.environment.row` 不再声明 | 守卫无处挂载，隐藏完全不生效，子会话里又只剩那条「状态已停止更新」 |
| 标准 props 不再提供 `useSession` / `useSessions` | 认不出子会话，标记打不上 |
| 会话快照不再带 `subagent`、或列表行不再标 `origin` | 对应那条打开路径（从子会话打开 / 页面重开后从侧栏打开）上认不出子会话 |
| 分区锚点 `data-session-panel-section` 改名 | 标记找不到落点，隐藏规则整条失效 |
| `data-session-panel-row` / `data-row-part` 改名 | 不影响本插件（守卫不渲染行），但同一分栏里的行会失去排版，配置里仍会提示 |
| forge 的 `data-forge-connection` 改名 | 隐藏落空，连接行与「重试」重新出现 |
| `ctx.forgeChanges` 不再提供 | 本插件不激活，显式退化而非静默失效 |

-----

## 验证

```powershell
pnpm --filter dsh-subagent-forge-panel build
pnpm --filter dsh-subagent-forge-panel typecheck
pnpm --filter dsh-subagent-forge-panel test        # 判定 / 标记 / 产物装配 / 真 React 渲染
pnpm --filter dsh-subagent-forge-panel check:css   # 上游契约（10 条）
```

产物测试把 `lib/client.js` 当成浏览器里的独立 bundle 加载，断言插件声明、样式注入、行槽注册，
以及守卫在「快照带地址」「只有列表行依据」「普通会话」「残留地址指向别的会话」四种输入下的
元素树；真实 React 渲染断言子会话只输出那个不可见的标记元素、普通会话输出为空。**视觉确认**
需要挂进 profile 后在浏览器里开一个子智能体会话：面板「环境」分栏里不应再出现「状态已停止更新」
与「重试」。

-----

## 已知边界

- **判定绑定当前上游**：按「子智能体会话没有 Git 与变更请求通道」写死。上游若日后提供该通道，
  `[data-forge-connection]` 不再出现，隐藏规则自然失效；本插件届时应退役。
- **普通会话的那一行不归本插件管**：网络重置、Host 重启、页面长时间隐藏后回来重新打开失败时，
  普通会话也会出现 forge 连接行；那是真的瞬时断流，点「重试」能恢复，本插件不隐藏它。
- **只影响「环境」分栏**：子会话的「变更请求」分栏本来就渲染为空（面板流拿不到状态），不需要处理。
- **标记元素会占住分栏的「空」判定**：面板按「正文槽为空」隐藏整个分区；守卫的标记元素在该分区
  里时，分区不再算空。实际无影响——上游的项目行几乎总在；只有子会话连工作目录都未知（项目行也
  不渲染）时，「环境」分栏会留一个只有标题的空壳。要消掉它，删掉本插件即可。
