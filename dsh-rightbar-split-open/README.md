# dsh-rightbar-split-open

在**右侧侧边栏的文件浏览器**里点开一个文件时,把该文件开在文件树**旁边的另一个分栏**
里,并且让「文件树 : 文件」的宽度比成为 **1 : 4**(树 20%、文件 80%)。

- 形态:Client only(TypeScript;宿主半部为空宿主)
- 依赖服务:`uiSession`、`slots`、`sidebarRight`
- 零 DOM、零猴子补丁、零轮询:全部走上游公开服务面与公开 store 写集

## 为什么需要这个插件

上游把「树里点开的文件」落进**当前停靠面板**——也就是文件树自己所在的那一格:

1. `dsh-client-ui-sidebar-files/lib/client.js` 的行点击是
   `tabActions.openResource(fileAddressFor(sessionId, root, path))`;
2. 轨道侧(`dsh-client-ui-sidebar-right/lib/client.js` 的 `TabDomain.hold()`)把标签自身
   的动作接到 `navigator.openResourceIn(sessionId, address, place(options))`,而
   `place()` 给出的 `paneId` 是**该标签所在面板**;
3. store 的 `openContent` 只在 `intent.paneId` 缺省时才退到 `activeDockPaneId` —— 两条
   路都指向同一个面板。

因此「开在另一个分栏」不可能靠配置得到,必须在**打开之后**把这次打开改造成分栏形态。
这也是本插件不包装任何上游方法的原因:它只**观察**布局变化,再用上游自己的动作把它写成
分栏。

## 实现

```
浏览器半部(src/client.ts)
  └─ 包装一次 uiSession.resolve ──── 上游唯一能观察到「某会话右栏 store 何时可解析」的公开信号
        └─ slots.entries('rightbar.session') → uiSession.resolve(sid) → slots.resolveStore(handle, binding)
              └─ 订阅该会话右栏 store 的提交(defineStore 实例面)
                    │
                    ├─ 与上一份快照比对:文件树面板里是否**刚多出**一个 dsh-resource://file/… 标签
                    │   (src/split-open.ts 的 planSplitOpen;纯函数,可单测)
                    │
                    └─ 改造(src/session-split.ts):
                         ① sidebarRight.split(树面板)          ← 标签条「分栏」控件同一入口
                         ② store placeTab(sid, 文件标签, 新格, 0) ← 标签拖拽同一入口(跨格 = moveTab)
                         ③ store closeTab(sid, seed 标签)       ← 收掉上游给新格 seed 的默认页
                         ④ store resizeSplit(sid, 分栏, [0.2, 0.8]) ← 分隔条拖拽同一落点
                         ⑤ store focusTab(sid, 树标签)          ← 把活跃标签还给文件树
```

要点:

- **分栏一定先问上游**:`sidebarRight.split(paneId?)` 是唯一带**实测可行性判定**的入口
  (面板宽度不够两个格 / 面板预算已满 / 目标面板为空 → 返回 `undefined`)。返回 `undefined`
  时本插件**不动作**,文件照上游默认行为留在树面板里 —— 不会制造一个放不下的分栏,也不会
  把文件树压成死格。
- **搬移用 `placeTab` 而不是再开一次**:dockkit 跨面板时落地为 `moveTab`,标签不销毁、正文
  不重挂载;而再调一次 `openResource({paneId})` 会因为默认 `revealIfOpened: true` 而**跨分栏
  揭示**同一个文件已开的那个标签,反而把焦点带走。
- **落点用兄弟格,不用内容判定**:上游给新分栏 seed 的默认页在「只有一个引导入口」时恰好
  就是文件树本身(`dsh-client-ui-sidebar-right` 的 `defaultSeed`),所以「哪个格是文件面板」
  不能靠「格子里有没有文件树」来判断。分栏存在时一律取树面板的**兄弟格**
  (`split-open.ts` 的 `siblingPaneOf`),只有在用户用别的格当过文件面板时才回退到内容判定。
- **基线**:store 的 `subscribe` **不会**为当前快照回调一次(`defineStore` 只在下一次提交时
  通知),所以订阅后**立刻主动读一次**建立基线。否则「插件装载瞬间的布局」会被当成第一次
  提交、真正的第一次提交反倒成了基线,点开文件就永远不触发。

## 为什么是 1 : 4

上游把最小分栏比例固定为 `0.2`:

- sidebar-right 的 store 写比例时调 `planResizeSplit(splitId, sizes, .2)`;
- `DockSurface` 的 `minPaneFraction: .2`;
- 拖动分隔条同样走 `es(sizes, 0.2)`(dockkit 的归一化:低于下界的项抬到下界后按比例重分)。

`1 : 4 = 20% : 80%` 恰在这个边界上,所以:

- 它是**上游契约内**的取值(用户手拖分隔条也能拖到这里),不是越界状态,不需要任何私有
  实现或样式注入;
- 本插件仍留 `RATIO_EPSILON = 1e-3` 的微量余量,把浮点边界变成严格不等式;渲染端直接
  把 `sizes` 当 `flexGrow` 用,因此实际宽度比与 1 : 4 的偏差在千分之几。

## 为什么新分栏里会冒出一个 file 标签(以及本插件怎么处理)

现象:第一次展开右栏、点开文件后,新建的那一格标签条上除了你点开的文件,还多出一枚
**文件浏览器(file)** 标签。

根因在上游,与本插件无关,但由本插件的分栏动作**暴露**出来:

1. store 的每个动作都经 `advance()` → dockkit `planSettle()`;
2. `planSettle` 会给「展开态下**空着的**停靠格」补一个默认页(`openTab` 到根格);
3. 默认页由 `defaultSeed(tabs)` 决定 —— 它取「唯一的引导入口」,而当前组合里
   `dsh-client-ui-sidebar-files` 恰好只贡献一个入口(`files`),于是**默认页就是文件树
   本身**;
4. 所以 `split()` 一落地,新格就被 seed 了一枚文件树标签。上游自己的「分栏」控件
   (标签条上的分栏按钮 / 把标签拖到格子边缘)也会产生同样的结果。

本插件的处理:把文件搬进这一格之后,调用同一份 store 的 `closeTab` 关掉**这一格里
的**seed 标签(与标签菜单里的「关闭」同一入口,`session-split.ts` 的
`closeSeededPage`)。边界很清楚:

- 只对**本插件这次新建的格**做清理(执行 `placeTab` 时带 `closeSeed` 标记),
  用户自己分的栏、自己放的标签一律不碰;
- 只关**页类型**标签(kind 或页地址命中文件树),且该格此刻**已持有文件标签**
  (搬移成功才走到这里),不会把一格关空;
- 上游 `closeTab` 自己还有 `canCloseTab` / `soleDockedTab` 守卫;它拒绝时本插件
  静默接受,不绕道别的入口。

因此正常路径下右格只剩你打开的文件;若你的现场里右格仍有文件树标签,说明那一格不是
本插件建的(例如分栏是你手动分的,或插件是后加载进一个已有分栏的现场)。

## 硬约束:右栏得够宽

分栏可行性是**实测**的(dockkit 用 `getBoundingClientRect` 计算):

```
分栏被允许 ⇔ (面板宽 - 分隔条) / 2 - (面板宽 - 标签条宽) ≥ 固定 chrome + 胶囊宽(≥100px)
```

关键在 `(面板宽 - 分隔条) / 2`:上游按「对半分」评估可行性,与你要的比例无关。化简后大致
要求**面板实测宽 ≳ 540px**。右栏首次打开时的默认宽度是视口的 45%(受 `center ≥ 400` 挤压),
所以:

| 视口 | 右栏默认宽(左栏展开时) | 能否分栏 |
| --- | --- | --- |
| 1920px | 864px | 可以(树获 ≈173px) |
| 1440px | 648px | 勉强可以(树获 ≈130px) |
| 1280px | 600px | 边界附近,可能出现「点文件不分栏」 |

分栏不可行时本插件**安静地退回上游默认行为**(文件就地开在树那一格),不会报错、也不会
把文件树挤没。若希望 1 : 4 下文件树仍有可用宽度,请把右栏拖宽一些(面板宽 ≈ 800px 时树获
约 160px)。

## 已知限制与行为

1. **图片 / PDF 不搬动。** 本插件只认 `dsh-resource://file/**`,而图片 / PDF 由
   `dsh-client-ui-sidebar-documentpreview` 以 `fallback` 档接管;严格说它们也是
   `dsh-resource://file/…`,但本插件按「是不是文件树面板里新出现的文件资源标签」来判定,
   与文档预览的接管域无关 —— 若希望它们也搬到旁边分栏,可把判定放宽到全部
   `dsh-resource://` 地址(见 `split-open.ts` 的 `FILE_ADDRESS_PREFIX`)。
2. **手动拖动分隔条会覆盖比例。** 比例写进布局后就是普通状态;用户把分隔条拖到别处,
   下一次从树里点开文件时不会重新纠正(本插件只在与文件树面板同类的那次打开里写比例)。
3. **在右格连续打开多个文件会堆标签。** 本插件不替换右格已有的文件标签(不猜用户的意图);
   需要「只留一个」请自行关标签,或用右格的标签菜单。
4. **比例对「手动建好的分栏」不强制。** 如果分栏已存在(用户自己分的),本插件只搬文件、
   不重写比例 —— 那是用户自己设定的布局。
5. **新分栏的 seed 标签由本插件收掉,但只在它自己建的那一格。** 上游 `planSettle` 会给
   展开态下空着的停靠格补一个默认页,而当前组合的默认页就是**文件树本身**
   (`defaultSeed` 只有一个引导入口时选它)——所以新分栏落地时自带一枚 file 标签。
   本插件在把文件搬进这一格之后调用 store 的 `closeTab` 关掉它(与标签菜单里的关闭
   同一入口),因此**第一枚** seed 不会残留;但如果分栏是用户自己分的、或那一格里已有
   用户放的标签,本插件一律不碰(只关自己这次新建的格里的 seed)。若你看到右格仍有
   文件树标签,那是这类「不属于本次打开」的现场。
6. **纯内存态**:右栏布局不持久化,刷新后回到折叠的单格;本插件每次会话物化时重新建立观察。
7. **多会话**:按会话分别接线,每个会话一份基线;切换会话不串场。

## 加载

本插件是 `link:` 依赖,由用户执行(代理不代为加载):

```sh
cd <仓库根>/dsh-rightbar-split-open
dsh plugin --profile web add link:.
# 重启 App 生效(宿主半部为空宿主,但挂载行需要重启)
```

浏览器半部(`lib/client.js`)重新构建后由 `dsh-client-hmr` 热推送,不需要重启;宿主半部与
组合行的变更需要重启 App。

## 构建与验证

```sh
npm install            # 首次(受限沙箱下可加 --ignore-scripts)
npm run typecheck      # tsc --noEmit
node test-split-open.mjs   # 纯判定 + 比例 + 端到端(桩 store)+ 守卫/降级,~40 项断言
npm run build          # esbuild → lib/client.js(入仓)
npm run check          # node --check 产物与宿主
```

`test-split-open.mjs` 以 Type Stripping 直载 `src/*.ts`,用桩 store / 桩 `uiSession` /
桩 `slots` 断言:树面板里新开文件才触发、基线只记不动作、已分栏时只搬不重分、比例恰为
`[0.2, 0.8]`、树侧不在首位不写比例、分栏被上游拒绝时不搬不写、文件标签已被关掉时不误搬、
缺动作面时静默跳过、`resolveStore` 各条不可用路径一律 no-op、`resolve` 只包装一次且
`dispose` 可还原、store 句柄晚注册时有界重试能接上。

## 文件

| 路径 | 内容 |
| --- | --- |
| `src/client.ts` | 浏览器半部入口:解析三个服务 → 安装接线 → 卸载还原 |
| `src/rightbar.ts` | 右栏会话级 store 的取数(slot store 三步范式)与提交观察、`uiSession.resolve` 包装 |
| `src/split-open.ts` | 纯判定层:布局切片、文件树面板 / 兄弟格 / 新标签判定、比例策略(可单测) |
| `src/session-split.ts` | 执行层:分栏 → 搬移 → 调比例 → 回焦树 |
| `src/types.ts` | 上游 dockkit / sidebar-right 的最小结构类型切片 |
| `lib/client.js` | 浏览器半部构建产物(禁手改,入仓) |
| `index.ts` | 空宿主(Node Type Stripping 直载) |
| `cordis.patch.yml` | web bundle 挂载行 |
| `test-split-open.mjs` | 断言脚本(`node test-split-open.mjs`) |
