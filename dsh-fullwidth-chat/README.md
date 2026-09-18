# dsh-fullwidth-chat

本地持久化 Web UI 补丁：让**对话 / 消息列全宽**展示（铺满中间列）。

纯 JavaScript 插件（`lib/*.js` 即源码，无 `build` 脚本，属强制规范第 2 条的既有例外）：

- 浏览器半部 `lib/client.js` 注入一条样式：
  `[data-slot="main.conversation"] [data-conversation-content] { --dsh-chat-content-width: 100%; }`
- **锚点必须在会话内容节点自身**，不能是祖先。层级：
  `[data-slot="main.conversation"]`（`display:contents` 的 SlotOutlet 锚点）→
  `.wSkVaW_root[data-phase]`（祖先，不声明该变量）→
  `.wSkVaW_body[data-conversation-content]`（上游在此声明，须打在这里）。
  上游在这个节点上声明 `--dsh-chat-content-width`（派生自其父元素的行内
  `--dsh-chat-user-width` / `--dsh-conversation-column-width`），元素自身的声明胜过继承值，
  与特异性无关；本规则 (0,2,0) 压过同元素上的 `.wSkVaW_body` / `.wSkVaW_embeddedBody` (0,1,0)。
  消费点（`.EvIC1a_column`、composer 卡片、approval / user-questions 卡片、气泡堆栈、
  `[data-width-handle]`）都在该节点之内。
- 已知限制：内容宽度 100% 时拖拽手柄归零，拖拽 / localStorage 的宽度偏好不再影响内容列
  ——全宽与可拖宽在该轴上互斥，删除本规则即恢复。
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
