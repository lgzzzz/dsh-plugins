# dsh-desktop-notify

DSH Web 的**桌面通知**插件:在会话标题栏放一个铃铛按钮(「开启通知」),点击即请求浏览器的通知权限
(该调用发生在点击这个用户手势里);开启后,页面**开着但不在前台**时,回合结束或 Agent 开始等你处理
都会弹出 Windows 系统通知。

纯浏览器半部 + 空宿主占位:宿主侧没有任何改动,不写 `~/.dsh/`,不改 Profile。

## 功能

- **按钮**:注册进会话标题栏动作区 `conversation.session.header.actions`(上游 jobs、终端恢复同区),
  三态:
  - 未授权:铃铛 + 右上角小点,点击 → 浏览器授权框;
  - 已授权且开启:实心铃铛,点击 = 关闭;
  - 已授权但关闭 / 已被拒绝:置灰铃铛(拒绝时提示去 Chrome 站点设置里改)。
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
| `ctx.slots.inject/register` | 落点 `conversation.session.header.actions`(list / session 作用域),`id: 'desktop-notify'`,`order: 120` |
| `window.Notification` + `localStorage` | 授权、开关、真正弹出通知 |

浏览器 bundle 里的 `require('react')` 是**唯一的外部依赖**:`react` 是上游 ModuleLoader 的平台 seed 词
(`window.__DSH_BOOT__` 引导的 `staticModules` 含 `react` / `react/jsx-runtime`),因此打包时 `--external:react`,
产物直接复用宿主那一份实例。`@types/react` 不在 dsh 内置 bundle 里,故 `src/react.d.ts` 自声明最小的
`createElement` / `useState` / `useEffect` 三个 API。

## Chrome / Windows 侧前置条件

1. 页面是 `http://127.0.0.1:3080`。loopback 属「安全上下文」,`Notification` API 可用,**不需要 https**。
2. 点铃铛 → 浏览器弹授权框 → 允许。**若曾误点拒绝**:`requestPermission()` 不会再弹,必须到
   `chrome://settings/content/notifications` 手动允许 `127.0.0.1:3080`(按钮的 tooltip 会这么提示);
   插件在窗口重新获得焦点时(`focus` 事件)会重读权限,不必刷新页面。
3. 系统层还要放行:Chrome 自身的通知开关,以及 Windows 的「专注助手 / 勿扰」。
4. 通知**只在页面打开时**送达(见下)。

## 已知限制

- **关掉标签页或浏览器后收不到通知**:没有 Service Worker + Push 服务端,页面进程不在了就没有触发者。
  本插件不做推送服务(那需要宿主侧与外部推送基础设施)。
- 页面在前台(可见且聚焦)时**刻意不发**通知:人就在看,不需要打扰;在此期间发生的状态变化不补发。
- Chrome 的「内存节省程序」可能冻结长时间处于后台的标签页,冻结期间页面 JS 暂停 → 这段窗口里的状态变化会漏。
  可在 Chrome 里把该站点加入排除项。
- 只覆盖顶层会话;子代理会话的结束 / 提问不通知。
- 通知文案(含按钮 tooltip)是中文硬编码:插件不注册 `locale` 命名空间,不做多语言。
- 判定完全依赖 `uiSession.sessionStatus`;该服务面缺席即整体 no-op,**不降级**为 DOM 观测或其他取数。

## 源码结构

| 文件 | 职责 |
| --- | --- |
| `src/types.ts` | 运行时服务 / 上下文的最小结构类型切片(只含本插件消费的字段) |
| `src/notify-policy.ts` | 纯判定:相邻两帧差异 → 待发通知计划(无 DOM、无 cordis) |
| `src/notify-store.ts` | 权限 + 开关的共享状态(环境全部经 `NotifyStoreEnv` 缝注入) |
| `src/notify-env.ts` | 浏览器环境缝:`Notification` 权限 / 授权 / localStorage |
| `src/notify-runtime.ts` | 订阅 `uiSession.sessionStatus`,把判定结果交给 delivery |
| `src/notify-delivery.ts` | 页面是否前台 + 真正构造系统通知 |
| `src/notify-action.ts` | 标题栏铃铛按钮(React,`require('react')` 为 external) |
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
载入构建产物,校验包名 / `inject` / 外部依赖只有 `react` / 槽位注册参数 / 按钮三态,以及
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
