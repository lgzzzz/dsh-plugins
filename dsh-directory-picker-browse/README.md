# dsh-directory-picker-browse

把目录选择器固定为 **browse（浏览）** 交互。

纯 **bundle patch** 插件：自身没有宿主 / 浏览器代码，只通过 `package.json` 的
`dsh.bundle.patch` 声明一个 `cordis.patch.yml` 覆盖层，随 bundle 层挂载：

- `disabled: true` 关闭默认的 `directory-picker`
  （`@deepseek-ai/dsh-host-directory-picker-auto`）；
- `insert` 挂载 browse 变体：宿主半部 `@deepseek-ai/dsh-host-directory-picker-browse`
  （列表 / 新建原语）与浏览器半部 `@deepseek-ai/dsh-client-ui-directory-picker-browse`
  （浏览界面）。两个都是随部署内置的 in-box 包，由安装锚点解析，无需在 Profile 里额外声明。

**不要停用上游 `ui-deliverables`**（`@deepseek-ai/dsh-client-ui-deliverables`）：它承载整个
turn-tail 产物面——回合改动文件卡片、`present` 交付卡片、收尾正文里可点击的文件路径、
`changes-review` 右栏 tab 类型，以及其 Node 半部注册的 `ui:deliverable-file-references`
系统提示词段。本插件只换目录选择器，不触碰 deliverables 面。

## 安装 / 卸载（用户操作）

```sh
dsh plugin --profile web add link:<仓库根>/dsh-directory-picker-browse   # 重启 App 生效
dsh plugin --profile web remove dsh-directory-picker-browse
```

`dsh plugin` 是 pnpm 转发器：执行 `pnpm add` 后会自动把本插件并入
`dsh.profile.bundles`，无需手改 Profile 清单。覆盖层只由本插件的 `cordis.patch.yml` 提供，
Profile 自身的 `cordis.patch.yml` 无需重复声明。`patchReload: live` 只热重载 Profile 自身的
补丁；bundle 层是常驻挂载，改动本插件后需重启 App 生效。
