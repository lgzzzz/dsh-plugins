# dsh-fullwidth-chat

本地持久化 Web UI 补丁：让**对话 / 消息列全宽**展示（铺满中间列）。

纯 JavaScript 插件（`lib/*.js` 即源码，无 `build` 脚本，属强制规范第 2 条的既有例外）：

- 浏览器半部 `lib/client.js` 注入一条样式：
  `[data-slot="main.conversation"] [data-phase] { --dsh-chat-content-width: 100%; }`
  ——wrapper 是 `display:contents`，属性须打在 `[data-phase]` 节点上；两个属性选择器
  (0,2,0) 压过上游 `.wSkVaR_root` (0,1,0)。composer 卡片宽度经
  `calc(卡片宽 + 2×--dsh-composer-side-clearance(16px))` 跟随，`[data-width-handle]` 负责收起。
- 样式带 `data-plugin="dsh-fullwidth-chat"` 标记，Loader 卸载 / `ctx.effect` disposer 会回收。
- 宿主半部 `lib/index.js` 为空桩，仅供组合行解析与 `dsh-client-modules` 扫描。

## 加载（用户操作）

```sh
cd <仓库根>/dsh-fullwidth-chat
dsh plugin --profile web add link:.
# 重启 App 生效
dsh plugin --profile web remove dsh-fullwidth-chat   # 卸载
```

改样式直接编辑 `lib/client.js`（本插件无构建步骤）；挂载后产物变化由 client-hmr 在 500ms
内热推送，无需重启 / 刷新。
