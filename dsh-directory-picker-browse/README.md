# dsh-directory-picker-browse

把目录选择器固定为 **browse（浏览）** 交互，并关闭 `ui-deliverables` 产物行。

这是一个纯 **bundle patch** 插件：自身没有任何宿主或浏览器代码，只通过
`package.json` 的 `dsh.bundle.patch` 声明一个 `cordis.patch.yml` 覆盖层。
安装后它会被加入 web profile 的 `dsh.profile.bundles`，随每个 bundle 层一起
挂载，实现与原先手写在 `profiles/web/cordis.patch.yml` 里完全相同的效果：

- `disabled: true` 关闭默认的 `directory-picker`
  （`@deepseek-ai/dsh-host-directory-picker-auto`）与 `ui-deliverables`
  （`@deepseek-ai/dsh-client-ui-deliverables`）。
- `insert` 挂载 browse 变体：
  - 宿主半部 `@deepseek-ai/dsh-host-directory-picker-browse`（列表 / 新建原语）；
  - 浏览器半部 `@deepseek-ai/dsh-client-ui-directory-picker-browse`（浏览界面）。

两个 browse 包都是随部署内置的 in-box 包，由安装锚点解析，无需在 profile 里
额外声明依赖。

## 安装

```sh
dsh plugin --profile web add link:/Users/lz/dsh-plugins/dsh-directory-picker-browse
```

（或从插件目录内执行 `dsh plugin --profile web add link:.`，pnpm 会把相对路径
锚定到当前目录。）

安装完成后重启 App 生效。可在 profile 的
`$HOME/.dsh/profiles/web/package.json` 的 `dsh.profile.bundles` 里看到新增的
`dsh-directory-picker-browse`。

## 卸载

```sh
dsh plugin --profile web remove dsh-directory-picker-browse
```

## 说明

- 补丁内容与 `profiles/web/cordis.patch.yml` 完全一致；该文件本身若不再使用，
  可以清理，避免与插件补丁重复应用（幂等，但重复无害）。
- `dsh.profile.patchReload: live` 只热重载 profile 自身的 `cordis.patch.yml`；
  bundle 层是常驻挂载，改动本插件后需重启 App 生效。