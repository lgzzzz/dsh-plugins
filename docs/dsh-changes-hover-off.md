# dsh-changes-hover-off

关掉**改动文件卡片里 500ms 悬停弹出的单列 diff 浮层**。纯客户端插件:不注册服务、不占 slot、没有配置项——装上就生效,从 profile 移除即恢复。

## 它关掉的是什么

上游 `@deepseek-ai/dsh-client-ui-deliverables` 让每个完成轮次以「改动文件卡片」收尾。指针在卡片里的文件行(单文件时是卡片标题行)上停留 **500ms** 后,会在 `<body>` 上弹出一个可滚动的单列改动浮层:

- 触发器:`lib/client.js` 1394-1428,即 `$DSH_ROOT/node_modules/@deepseek-ai/dsh-client-ui-deliverables/lib/client.js`(`$DSH_ROOT` = DSH 安装根,解析顺序见各插件的 `check-css.mjs`),两处 `HoverCard` + `openDelayMs: 500`;
- 浮层内容:`ChangedFilePreview`,带 `data-changes-hover-preview`,**只在打开时挂载**——即「读取该文件对比」这个动作也只在打开时发生;
- 上游没有暴露任何开关(`lib/` 里没有 Schema/Config),`HoverCard` 自带的 `disabled` 也没有被传。

## 它怎么做到的

不改上游产物,也不做 CSS 隐藏,而是**抢在 React 之前处理手势**:

1. `HoverCard` 的打开逻辑挂在 `onPointerEnter` 上,命中后 `setTimeout(..., openDelayMs)`(ui-primitives 的 `HoverCard`,`onPointerEnter` → 500ms 定时器);
2. React 18+ 把 `onPointerEnter` 由冒泡的 `pointerover` 合成,委派监听挂在应用根 `<div id="root">` 上(外壳见 `dsh-web-frontend/dist/index.html`);
3. 本插件在 **`document` 捕获阶段**监听 `pointerover` / `pointerenter` / `mouseover` / `mouseenter`,只处理目标落在 `[data-changed-files]` 内的事件,并调用 `stopPropagation()`。

于是 `#root` 上的合成派发永远收不到该手势 → `onPointerEnter` 不触发 → 定时器根本不建立 → **浮层不出现,对比也不会被读取**(不是「渲染出来再隐藏」)。

`document` 是 `#root` 的祖先,捕获阶段必然先于 `#root` 上的任何监听;这条路径与 `dsh-focus-free-shortcuts` 的审批捕获桥(`approval-keys.ts` 在 window 捕获阶段抢在卡片自身 React 处理器之前)是同一手法。

**第 2 层(网兜)**:万一浮层仍被打开(闸门失效,或上游改走别的打开路径),`body` 上的 `MutationObserver` 会在 portal 外壳进入 DOM 的那个微任务里把它置为 `display:none`;MutationObserver 回调早于绘制,所以它不会可见。网兜只隐藏、不删除 React 拥有的节点,卸载时还原。代价:走这条路时对比仍会被读取一次,只是不可见。

## 怎么确认它真的生效

装上闸门后,文档根元素会带一个标记:

```js
// DevTools Console
document.documentElement.hasAttribute('data-dsh-changes-hover-off')   // true = 已加载且已装上
```

- 返回 `false` → 浏览器这一页没有加载到本插件(客户端 roster 在页面加载时由 Host 的 `window.__DSH_BOOT__` 注入),先硬刷新;仍为 `false` 则说明 Host 尚未重新合成,需要重启 `dsh web`(或在「设置 → 插件」里关掉再打开本插件)。
- 返回 `true` 但浮层还在 → 是闸门层的问题,网兜应当已经把它藏住;若仍未藏住,说明浮层的 DOM 锚点变了,对照 `contract.json` 的 `hover-preview-attr` 检查。

## 作用域与不受影响的部分

| | 结果 |
|---|---|
| 改动文件卡片(`[data-changed-files]`)内的悬停预览 | **关闭**(单文件标题行与多文件行都是) |
| 行的 hover 底色 | 不受影响(纯 CSS `:hover`) |
| 点击文件行 / 卡片标题 | 不受影响(走 `click`,照旧打开右栏 `changes-review` tab) |
| 右栏 review tab 及其工具栏 tooltip | 不受影响(`[data-changes-review]`,另一条路径) |
| 卡片外的 `HoverCard`(正文图片 / 文件链接的悬停缩略图) | 不受影响,按 `[data-changed-files]` 精确排除 |

副作用:悬停时行内统计仍会按上游 CSS 换成「在侧边栏预览」文案——那是卡片自己的后缀提示,与浮层无关。

## 挂载与启用

```powershell
# 仓库根:把新包记进 lockfile
pnpm install

# 构建浏览器半部(tsdown → lib/client.js)+ 校验上游契约
pnpm --filter dsh-changes-hover-off build

# 挂进 web profile(宿主半部为空 apply,客户端半部随 immediately 注册)
dsh plugin --profile web add C:\Users\LGZ\dsh-plugins\dsh-changes-hover-off
```

刷新 GUI 页面后生效。**恢复浮层**:从 profile 的 `dsh.profile.bundles` 里移除本包(或用 `dsh plugin --profile web remove dsh-changes-hover-off`),刷新页面即可,上游产物一行未改。

> 改完客户端半部要记得让 Host 重新合成:Host 在合成那一刻就把 `lib/client.js` 的字节读进快照(`dsh-client-modules` 的 `initialBundleSnapshot`)。所以**重新构建后,仅刷新页面可能仍拿到旧字节**——重启 `dsh web`,或在「设置 → 插件」里关掉再打开本插件,然后刷新页面。

## 契约校验与测试

- `contract.json`:声明依赖的三条上游事实(`data-changed-files`、`openDelayMs: 500`、`data-changes-hover-preview`),由 `dsh-ui-css-patches/check-css.mjs --manifest contract.json` 在**每次 `build` 后**静态校验。上游改名/删 token 时会报错,而不是让闸门静默落空。
- `pnpm test`(即 `node test/run-all.mjs`):
  - `hover-gate.test.mjs` —— 归属判定、消费与放行、捕获阶段安装/卸载、网兜(含降级路径)、生效标记;
  - `artifact-client.test.mjs` —— 加载 `lib/client.js`,断言模块 id / 插件名 / `effect` 标签 / 三个标记 token,并在假文档上验证:拦停卡片内手势、放行卡片外手势、网兜隐藏 portal 外壳、卸载后全部还原。

## 已知边界

- **只在下一次页面加载后完整生效**:插件已加载但浮层已经打开时,那条浮层会留到指针离开为止。
- **网兜路径仍会读取对比**:闸门失效而由网兜兜住时,上游照旧读取一次文件对比(只是不可见);主路径成功时不会读取。
- **依赖 React 的事件委派模型(仅主路径)**:上游若改用原生 `pointerenter`,本插件已把该类型一并纳入;若改成点击或聚焦打开,主路径落空但网兜仍会隐藏浮层,此时 `contract.json` 的 `hover-open-delay` 检查会提示上游已改。
- **该卡片子树内的其它 React 悬停行为会一并关闭**:目前这张卡片只有这一条悬停行为,故实际是精确命中;将来若卡片新增悬停交互,需要把闸门收窄到行级选择器。
