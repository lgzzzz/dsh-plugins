# dsh-desktop-notify

DSH Web 的**桌面通知**插件:在**设置 → 通用**里放一行「桌面通知」开关,打开即请求浏览器的通知权限
(该调用发生在点击这个用户手势里);开启后,页面**开着但不在前台**时,回合结束或 Agent 开始等你处理
都会弹出系统通知(Windows 通知中心 / macOS 通知中心)。通知由**浏览器**发出,两个平台共用同一条代码
路径,平台差异只落在**权限引导**与**系统层放行**两处 —— 见「前置条件」。

纯浏览器半部 + 空宿主占位:宿主侧没有任何改动,不写 `~/.dsh/`,不改 Profile。

## 功能

- **开关行**:注册进设置 →「通用」的条目区 `settings.general.item`(语言、聊天等设置条目同区);
  一个 switch 同时承担授权与开关(外观与上游 `Switch` 一致:几何与令牌相同,状态由 `aria-checked` 表达):
  - 未授权:switch 关着,点击 → 浏览器授权框,授权通过后立即开启;
  - 已授权:点击即开 / 关;
  - 已被拒绝:switch 置灰不可点,行描述提示去 Chrome 站点设置里改。
  - 环境完全没有 `Notification` API 时不占位(渲染 `null`)。
- **通知**:页面不在前台(`document.visibilityState !== 'visible'` 或 `!document.hasFocus()`)时发两条链路:
  - **回合完成**:顶层会话 `running` 由 true 翻到 false;
  - **需要你处理**:待审批 / 待回答 / 计划待确认(`pendingInteraction` 出现,或换成新的 `key`)。
- 子代理会话(`origin === 'subagent'`)与列表里查不到的行一律不打扰。
- 通知正文取会话 `displayTitle`,同一会话同一原因共用一个 `tag`(`renotify: true`,不会静默替换掉第二条),
  点击通知回焦页面并关掉该通知。
- 开关持久化在同源 localStorage(`dsh.desktop-notify.enabled`,默认开启)。

## 判定规则

只认 **相邻两帧的差异**,不认当前值:

1. 第一帧只建基线 —— 插件挂载 / client-hmr 重建时**已经**跑着的回合、**已经**等着的卡片都不补发;
2. 判定始终推进(即使开关关着或权限没给),因此中途开启开关不会把历史状态补发一遍。

## 取数面(以上游源码为准)

| 上游面 | 用途 |
| --- | --- |
| `ctx.uiSession.sessionStatus`(`HostObservable<Map<SessionId, { running, pendingInteraction, completionUnread }>>`) | 全部判定输入。由 `dsh-client-ui-session` 在 client 根上下文提供,只在状态真变化时通知订阅者 |
| `ctx.sessions.list` 快照的 `byId[id]` | `displayTitle` 作通知正文;`origin === 'subagent'` 用于过滤子代理 |
| `ctx.slots.inject/register` | 落点 `settings.general.item`(list / root 作用域),`id: 'desktop-notify'`,`order: 100` |
| `window.Notification` + `localStorage` | 授权、开关、真正弹出通知 |

浏览器 bundle 里的 `require('react')` 是**唯一的外部依赖**:`react` 是上游 ModuleLoader 的平台 seed 词
(`window.__DSH_BOOT__` 引导的 `staticModules` 含 `react` / `react/jsx-runtime`),因此打包时 `--external:react`,
产物直接复用宿主那一份实例。`@types/react` 不在 dsh 内置 bundle 里,故 `src/react.d.ts` 自声明最小的
`createElement` / `useState` / `useEffect` 三个 API。

## 前置条件(Chrome;Windows / macOS)

浏览器侧(两个平台一致):

1. 页面是 `http://127.0.0.1:3080`。loopback 属「安全上下文」,`Notification` API 可用,**不需要 https**。
2. 在设置 →「通用」里点这个开关 → 浏览器弹授权框 → 允许。**若曾误点拒绝**:`requestPermission()` 不会再弹,必须到
   `chrome://settings/content/notifications`(Chrome「设置 → 隐私和安全 → 网站设置 → 通知」)手动允许
   `127.0.0.1:3080`(开关行的描述与 tooltip 会这么提示);插件在窗口重新获得焦点时(`focus` 事件)会重读权限,
   不必刷新页面。
3. 通知**只在页面打开时**送达(见「已知限制」)。

系统侧还有一道闸门,位置按平台不同:

### macOS

macOS 比 Windows 多一层**操作系统级**放行,而这一层在浏览器侧**完全不可见**:站点权限已给、
`new Notification(...)` 也构造成功,系统仍可以一条横幅都不弹,页面拿不到任何失败信号。
所以「开关已经打开但没通知」时,按下面三层从上往下核对:

1. **Chrome 站点层**:`chrome://settings/content/notifications` 允许 `http://127.0.0.1:3080`(同上)。
2. **macOS 应用层**:系统设置 → 通知 → 「Google Chrome」→ 打开「允许通知」。同一面板里还要看:
   - **提醒样式(临时 / 持久)**:通知是自动消失还是留在屏幕上,由这里的用户设置决定,**网页无法控制** ——
     归因生效(装成 PWA,见下)后,Chrome 在 macOS 上也不再遵循 `requireInteraction`(本插件没传该选项);
   - 「在锁定屏幕上显示」「在通知中心显示」;
   - 「播放通知声音」:插件传的 `silent: false` 只表达意图,是否真的响由这里决定。
3. **专注模式**:系统设置 → 专注模式(旧系统叫「勿扰模式」)。任一专注模式开启,或「屏幕共享时勿扰」
   生效期间,通知会被静音或直接收进通知中心 —— 网页无从探测,插件也不会因此重试或稍后补发。

把「插件没发」和「系统没放行」分开:开关打到「已开启」后在页面 DevTools 控制台直接发一条

```js
new Notification('DSH 测试通知', { body: '看到这条横幅 = macOS 侧已放行', tag: 'dsh-test' })
```

能弹 → 问题在插件判定 / 开关(对照上文「判定规则」);不弹 → 就是上面第 2 / 3 层。

#### 可选:装成 PWA 后,通知归因为独立应用(Chrome 152+ / macOS)

本应用自带 `manifest.webmanifest`(`name: DeepSeek Harness`,`short_name: DSH`),因此可以用 Chrome 的
「安装页面 / 将页面作为应用安装」(⋮ 菜单 → 投放、保存和共享 → 安装页面;部分版本在地址栏右侧给安装图标)
把它装成一个独立应用。macOS 上从此**通知不再归因于「Google Chrome」**,而是以应用自己的名字与图标出现在
通知中心和横幅里,并在「系统设置 → 通知」与「专注模式」中**各自独立成项** —— 可以只给 DSH 设「持久」提醒
样式,或在某个专注模式里单独放行。代价与注意点:

- 需要**再给一次 macOS 系统级授权**(系统弹「"DSH"想给您发送通知」);此时 Chrome 会**跳过**浏览器级
  权限提示,直接弹系统框;
- 若当时点了「不允许」、或之后在系统设置里关掉,通知会**静默消失**,必须到「系统设置 → 通知 → DSH」手动打开;
- 不影响本插件:`127.0.0.1:3080` 同源,开关(`localStorage`)与判定链路都不变。

依据:[macOS 上 Web 应用的原生通知归因](https://developer.chrome.com/blog/notification-attribution-macos)
(Chrome for Developers)。

### Windows

1. Chrome 站点层同上。
2. 系统层放行:Windows 设置 → 系统 → 通知 → 「Google Chrome」允许通知;并注意「专注助手」
   (Win 11 称「请勿打扰」)不要拦下横幅。

## 排查:「开关已开启但没通知」

按 macOS 三层从上往下核对时,可用页面 DevTools 控制台把「插件没发」与「系统没放行」分开。
**最有效的一条对照**是绕开插件、直接用插件相同的参数构造通知:

```js
Notification.permission                                  // 'granted' 只代表浏览器站点层已允许
new Notification('对照测试', { body: 'b', tag: 't', renotify: true, silent: false })
```

- 这条**不弹横幅** → 确定是系统层(「前置条件」第 2 / 3 层),与插件无关:插件构造的是同一个 API,
  返回值、异常、`Notification.permission` 都不区分这两种情况。
  - 特别是**系统设置 → 通知里根本没有「Google Chrome」这一项**时:macOS 从未给 Chrome 注册通知权限,
    此时站点层给得再足也不会弹。先让 Chrome 发一次通知(就上面这句),再回系统设置看它是否出现并打开。
- 这条**能弹** → 问题在插件判定 / 开关:时间点是否真在后台(窗口失焦或标签页不可见)、
  设置里的 switch 是否是「已开启」(已授权时点一下就是关闭)、以及该会话是否为子代理。

> 插件对**前台页面刻意不发**通知:`visibilityState` 为 `visible` 但 `hasFocus()` 为 false(窗口在屏幕上、
> 焦点在别的应用)时**属于后台,会发**;真正可见且有焦点时不发,这是设计而非故障。

## 已知限制

- **关掉标签页或浏览器后收不到通知**:没有 Service Worker + Push 服务端,页面进程不在了就没有触发者。
  本插件不做推送服务(那需要宿主侧与外部推送基础设施)。
- 页面在前台(可见且聚焦)时**刻意不发**通知:人就在看,不需要打扰;在此期间发生的状态变化不补发。
- Chrome 的「内存节省程序」可能冻结长时间处于后台的标签页,冻结期间页面 JS 暂停 → 这段窗口里的状态变化会漏。
  可在 Chrome 里把该站点加入排除项。
- 只覆盖顶层会话;子代理会话的结束 / 提问不通知。
- 通知文案与开关行的标题 / 描述 / tooltip 都是中文硬编码:插件不注册 `locale` 命名空间,不做多语言。
- 判定完全依赖 `uiSession.sessionStatus`;该服务面缺席即整体 no-op,**不降级**为 DOM 观测或其他取数。
- **系统级开关关掉时,插件无从察觉**:系统设置里禁掉浏览器(或 PWA)的通知后,`Notification.permission`
  仍是 `granted`,构造通知也不抛错,只是横幅不出现 —— 插件不猜、不做探测,只由本文档「前置条件」指路
  (开关行描述与 tooltip 只覆盖到 Chrome 站点层那一层)。
- **macOS 上通知的持久性 / 声音 / 是否进通知中心,全由系统设置决定**:插件传的 `renotify: true`
  (同 tag 重新提醒)与 `silent: false` 只是意图;想让通知停在屏幕上,请在「系统设置 → 通知」里把对应应用
  (Google Chrome,或装成 PWA 后的 DSH)的提醒样式设为「持久」。通知归因为独立应用后,`requireInteraction`
  在 macOS 上也不再被 Chrome 遵循,故插件**不传**该选项。
- **开关行文案里的来源地址与浏览器路径是硬编码的**:文案写死 `127.0.0.1:3080` 与 Chrome 站点设置,
  换端口、或改用 Safari / Firefox 时不再准确;描述与 tooltip 也**不会**提到 macOS 系统设置那一层,
  macOS 上「授权了却收不到」以本文档「前置条件」为准。

## 源码结构

| 文件 | 职责 |
| --- | --- |
| `src/types.ts` | 运行时服务 / 上下文的最小结构类型切片(只含本插件消费的字段) |
| `src/notify-policy.ts` | 纯判定:相邻两帧差异 → 待发通知计划(无 DOM、无 cordis) |
| `src/notify-store.ts` | 权限 + 开关的共享状态(环境全部经 `NotifyStoreEnv` 缝注入) |
| `src/notify-env.ts` | 浏览器环境缝:`Notification` 权限 / 授权 / localStorage |
| `src/notify-runtime.ts` | 订阅 `uiSession.sessionStatus`,把判定结果交给 delivery |
| `src/notify-delivery.ts` | 页面是否前台 + 真正构造系统通知 |
| `src/notify-settings.ts` | 设置 →「通用」的通知开关行(React,`require('react')` 为 external) |
| `src/react.d.ts` | 自声明的 react 最小切片 |
| `src/client.ts` | 浏览器半部入口:`inject` + `apply` 装配 |

## 构建与验证

```sh
npm install                  # 或直接用全局 tsc + 已装的 esbuild
npm run typecheck            # tsc --noEmit
npm run build                # src/client.ts → lib/client.js(入仓产物,禁止手改)
npm run check                # node --check 产物与宿主入口
node test-notify.mjs         # 纯 Node,无需浏览器(需先 build)
```

`test-notify.mjs` 四部分:A 判定器全部分支;B 授权 / 开关 / 拒绝 / 重读权限;C 订阅驱动、前台抑制、
开关关闭时基线仍推进、dispose 退订、发送侧(含构造抛错与无 API);D 用 `window.__ModuleLoader__` 桩
载入构建产物,校验包名 / `inject` / 外部依赖只有 `react` / 槽位注册参数 / 设置开关行三态,以及
「后台回合结束 → 真发一条系统通知」的端到端装配。

## 加载(由用户执行)

```sh
cd <仓库根>/dsh-desktop-notify && dsh plugin --profile web add link:.   # 或在任意目录用绝对路径
# 重启 App 生效
```

装入后:浏览器半部改动重新 `npm run build` 即由 client-hmr 在 500ms 内热推送;宿主半部 / 组合变更需重启 App。

卸载:

```sh
dsh plugin --profile web remove dsh-desktop-notify
# 重启 App 生效
```
