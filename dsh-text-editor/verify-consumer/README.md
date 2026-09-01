# dsh-te-verify — 动态验证插件

用来在**不重启 `dsh web`、不改 web profile** 的前提下，验证改造后的
`dsh-text-editor` 已正确提供两个能力服务（`ctx.provide('dsh-text-editor', …)`）：

- `openFile({ path, cwd?, sessionId? })` → 「文件」tab（可编辑/保存）
- `showDiff({ files: [{ label?, path?, before, after }], sessionId? })` → 「差异」tab

## 运行方式（动态，推荐）

1. 在浏览器里**刷新页面**（Ctrl+Shift+R），确保加载最新 `lib/client.js`。
2. 在会话里请**当前会话的 agent** 执行两个工具（或你在 HARNESS/Cordis 面板操作）：
   - `cordis_define`，参数：`name` / `purpose` / `code.client` = [client-body.js](client-body.js) 的**全部内容**（`code.host` 留空 → 纯客户端插件）
   - `cordis_run`，参数：`pluginId` = 定义时生成的 id（通常是 `dsh-te-verify`）
3. 在出现的**审批弹窗里批准**（approve）。
4. 插件运行后：左侧/上方出现两个 tab —— 一个是已打开
   `C:/Users/LGZ/.dsh/dsh-text-editor/package.json` 的「文件」tab，另一个是激活中的
   「差异 · 2」tab，展示两个示例文件的 Monaco 双栏 diff；顶部「上一个 / 下一个」
   按钮手动切换。
5. 验证完毕可让 agent 执行 `cordis_stop`（停止）与 `cordis_undefine`（移除），
   或在 HARNESS/Cordis 面板里点 stop / remove。

> 前置条件：先 `cd ~/.dsh/dsh-text-editor && npm run build`（本次已构建），
> 并刷新页面加载新 bundle。若 `dsh-text-editor` 服务不可用，控制台会打印
> `[dsh-te-verify] dsh-text-editor 服务不可用…`。

## 如果动态流程不可用（备选）

把本目录升级为一个正式插件挂到 web profile（需要重启一次 `dsh web`）：

```sh
dsh plugin --profile web add link:<仓库根>/dsh-text-editor/verify-consumer
```

`dsh plugin` 会自动登记 `dependencies` 与 `dsh.profile.bundles`，重启后生效。
验证完用 `dsh plugin --profile web remove <name>` 移除。

## 参考：dsh-text-editor 对外服务契约

```ts
interface TextEditorService {
  openFile(request: { path: string; cwd?: string; sessionId?: string }): void
  showDiff(request: {
    files: { label?: string; path?: string; before: string; after: string }[]
    sessionId?: string
  }): void
}
// 消费方：export const inject = ['slots', 'dsh-text-editor']，然后 ctx.get('dsh-text-editor')
```

类型权威定义见 `../src/api.ts`。
