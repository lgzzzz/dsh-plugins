# dsh-subagent-parent-nav

在**子智能体会话**的会话面板里加一栏「主智能体」：按从上到下的上级链列出主智能体与各级上级，
点一行把主视图切到那个会话。纯客户端插件，上游产物一行未改，从 profile 移除即恢复。

> 与它成对的是上游自带的「子智能体」一栏：那一栏往**下**看当前会话的子代理，这一栏往**上**
> 看当前会话的上级。会话标题栏的血缘面包屑也能回到上级，但它只在标题栏；这一栏让人留在
> 面板里就能挑要回到哪一级。

-----

## 它加的是什么

| | 行为 |
|---|---|
| 位置 | 槽位 `conversation.session.panel.section`，`id: subagent-parent`，`order: 190`：排在「改动请求」(100) 之后、上游「子智能体」(200) 之前 |
| 出现时机 | 只在**子智能体会话**：当前会话能认出父会话时。根会话没有任何上级，整节渲染为空——面板会连标题一起隐藏，所以根会话的面板与装上之前完全一样 |
| 内容 | 上级链从上到下的每一级一行：6px 状态点（运行中 / 空闲）、会话标题（过长省略）、跳转箭头 |
| 多级时 | 链首是最顶层的主智能体（分区标题已经说明，不再加标签），其余每一级带「上级智能体」小标签 |
| 点击 | 把主视图切到该上级会话，与点「子智能体」一行、点标题栏血缘面包屑同一条导航；面板是浮层时随后收起浮层。目标会话打不开时走它自己的错误 / 空状态；只有捕获到同步异常才只在 Console 告警、面板不收起 |
| 状态点 | 运行中用 `--dsw-alias-state-business-primary`，空闲用 `--dsw-alias-state-idle-primary`；会话列表里没有它的行时按空闲显示 |
| 读屏 | 每行 `aria-label` 是「跳转到 {标题}」，运行中追加「（正在运行）」；状态点与箭头对辅助技术隐藏 |

三处取父会话的依据（与上游标题栏的血缘切换器一致），按可信度依次尝试：

1. 当前会话自己的 `subagent` 地址——从子会话打开时由会话历史带上；
2. 任一已持有会话的 `subagentCatalog` 投影里点名本会话——父会话的目录事件；
3. Host 会话列表行上的 `origin: 'subagent'` 与 `parentId`——页面重开后只剩这一条。

三条都不成立就不显示这一栏：不猜一个会跳错的会话。会话列表里查不到某一级时，那一行仍可点，
标题退回会话 id，状态按空闲。向上最多追 16 级，并跳过重复的 id，脏数据成环也不会转圈。

-----

## 为什么是这个方案

| 方案 | 结论 |
|---|---|
| 改上游 `ui-subagent` 包，把父会话加进「子智能体」一栏 | 语义拧着：那一栏的契约是「当前会话的子代理」；且改的是 npm 产物，升级即丢失 |
| 只靠标题栏血缘面包屑 | 已有，但不在会话面板里；用户要的是「面板里能看到、点一下就回去」 |
| **新增会话面板分区（本实现）** | 上游槽位本来就为插件分区留了位置；自带标题、可拖动排序、正文为空自动隐藏，不改上游一行 |

-----

## 实现文件

| 文件 | 职责 |
|---|---|
| [`src/client.ts`](../dsh-subagent-parent-nav/src/client.ts) | 浏览器入口：注册字典、挂样式、等分区槽、注册分区；跳转失败只告警 |
| [`src/component.tsx`](../dsh-subagent-parent-nav/src/component.tsx) | 分区组件：读标准 props 的 `useSession` / `useSessions`，渲染上级行，点击切主视图 |
| [`src/lineage.ts`](../dsh-subagent-parent-nav/src/lineage.ts) | 纯逻辑：三条取父依据的优先级、逐级向上、成环与深度上限 |
| [`src/registration.ts`](../dsh-subagent-parent-nav/src/registration.ts) | 槽键 / 注册 id / `order` 与注册选项（纯模块，测试可直接 import） |
| [`src/styles.ts`](../dsh-subagent-parent-nav/src/styles.ts) | 插件前缀的行样式（挂一张 `<style>`，不依赖上游 primitives） |
| [`src/locales.ts`](../dsh-subagent-parent-nav/src/locales.ts) | 本插件字典（zh / en），标题按当前语言现取 |
| [`index.ts`](../dsh-subagent-parent-nav/index.ts) | 宿主半部空实现 |
| [`check-css.mjs`](../dsh-subagent-parent-nav/check-css.mjs) + [`css-contract.json`](../dsh-subagent-parent-nav/css-contract.json) | 上游分区槽 / 标准 props / 导航方法 / 令牌的静态契约 |

`dsh.client.platform = web`、`immediately: true`：页面加载即挂，不等某个页面打开。
`inject = ['slots', 'locale', 'uiWorkspace']`：三个服务任一缺席时整项不注册，不会抛出。

-----

## 契约与静默失败

`pnpm --filter dsh-subagent-parent-nav check:css` 在上游改名时显式失败，而不是让这一栏在页面上
静默消失或点了没反应：

| 失效的上游事实 | 页面上的表现 |
|---|---|
| 分区槽 `conversation.session.panel.section` 不再声明 / 渲染 | 整栏消失 |
| 标准 props 不再提供 `useSessions` | 算不出上级链，整节渲染为空 |
| `uiWorkspace.openSession` 改名 | 行还在，点了不跳转 |
| `--dsw-*` 令牌改名 | 状态点、悬停 / 按下底色、焦点环静默失效 |

## 验证

```powershell
pnpm --filter dsh-subagent-parent-nav build
pnpm --filter dsh-subagent-parent-nav typecheck
pnpm --filter dsh-subagent-parent-nav test        # 纯逻辑 + 产物装配
pnpm --filter dsh-subagent-parent-nav check:css   # 上游契约
```

产物测试把 `lib/client.js` 当成浏览器里的独立 bundle 加载，断言分区注册与组件在
根会话 / 一级 / 多级 / 列表缺行 / 目录投影兜底时的元素树与点击动作。

## 已知边界

- 只处理「从子会话往上看」：根会话、以及本机认不出父会话的孤立会话，都不显示这一栏。
- 上级会话若不在当前 Client 的会话列表里（比如已归档且未被保留），行标题显示它的会话 id。
- 跳转是**主视图切换**，不在右栏打开。要在右栏并排看上级会话，从左栏把该会话行**拖进右栏**
  （标题栏血缘面包屑与左栏点击都只切主视图）。
- **回到子会话没有左侧栏入口**：会话列表与会话搜索都不列 `origin === 'subagent'` 的子会话，
  标题栏血缘面包屑只向上（根会话上不渲染）。常规做法是在上级会话的面板「子智能体」一栏点它；
  另一种是先把子会话开在右栏，回来时从右栏点。这是 Product 的既有行为，不是本插件造成的，
  但这一栏让「切走」更常用，所以写在这里。
- 点击后当前会话的对话被替换，页面焦点随按钮卸载还给文档；键盘用户用面板开关（或会话列表）
  继续操作。
- 跳转本身是同步的：目标会话打不开时不会抛错，用户看到的是该会话自己的错误 / 空状态。
  代码里捕获的只是极端的同步异常（比如导航服务已销毁），那时只在 Console 告警、面板不收起。
