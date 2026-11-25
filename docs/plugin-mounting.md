# 插件挂载、卸载与生效

> **概述**：读完本主题，你能判断一次插件挂载或卸载是否需要重启 `dsh web`、是否要让浏览器刷新页面，以及改完插件代码后怎样让它生效。当前 DSH（0.2.3-alpha.2）的 web profile 默认启用 HMR：在「设置 → 插件」里启停行或组合包、安装与卸载组合包、重新构建客户端 bundle，都在运行中的宿主里完成，宿主进程不重启；已打开的页面跟随客户端插件图更新，不必刷新。仍有少数变更只能在下一次启动时生效（profile 未启用 HMR、改动落到 DSH 自身加载的模块、安装目录移动等），见[第 2 册](plugin-mounting/02-activation-and-reload.md)。

-----

## 分册目录

| 分册 | 内容 |
|---|---|
| [1. 挂载与卸载](plugin-mounting/01-mount-and-unmount.md) | 三条操作路径（插件页、仓库脚本、`dsh plugin`）；前置条件、挂载后的状态、关闭与移除的区别 |
| [2. 生效与重载](plugin-mounting/02-activation-and-reload.md) | 宿主与浏览器怎样应用变更；改代码后怎么生效；仍要重启进程或刷新页面的情况 |

## 进一步探索

- [docs/README.md](README.md) —— 构建命令、仓库脚本与全部插件入口。
- [`dsh.client.inject` 完整说明](dsh-client-inject.md) —— 客户端包在浏览器里的加载顺序与依赖。
- [dsh-changes-behavior：挂载与启用](dsh-changes-behavior.md#挂载与启用) —— 一个带宿主半部启动补丁的插件如何被替换、卸载与恢复。
- [DSH 插件五种「名字」](plugin-naming.md) —— 包名、patch id/name 与导出名在挂载链路里的分工。
