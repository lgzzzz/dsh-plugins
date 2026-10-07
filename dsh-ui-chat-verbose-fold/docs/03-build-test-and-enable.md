# 构建、测试与启用

> 本文件是 [dsh-ui-chat-verbose-fold 说明](../README.md) 的第 3 册:构建 / 测试命令、`test/` 分组与启用方式。

---

## 构建与测试

```bash
cd dsh-ui-chat-verbose-fold
../node_modules/.bin/tsdown          # 或 pnpm build
node test/run-all.mjs                # 跑测试(或 pnpm test)
node test/inject-wrap.test.mjs       # 只跑某一组
../node_modules/.bin/tsc --noEmit    # 或 pnpm typecheck
```

`test/` 下按主题分散(共享装置在 `test/helpers.mjs`,runner 是 `test/run-all.mjs`):

- **纯投影与定位**(`test/projection.test.mjs`):策略投影(含身份透传)、注入面形状判定、注册项定位
- **包装与装配**(`test/inject-wrap.test.mjs`):原地包装生效、幂等、晚到注册、目标缺席自检(有界窗口内到齐不告警 / 走满窗口才告警一次)、形状变化告警、服务缺席 / 抛错 / 无 `inject` 的 no-op
- **产物**(`test/artifact-client.test.mjs`):`lib/client.js` 的模块 id / 插件名 / `inject` 声明与端到端装配

## 启用

本插件对官方 `ui-chat` 的 `conversation.view` id `chat` 注册项生效,装上即生效:

```bash
dsh plugin --profile web add <本仓库路径>/dsh-ui-chat-verbose-fold
```

之后重启 / 刷新 GUI 验证:Verbose 模式下已完成的轮次应折叠。

`add-plugins.sh` / `add-plugins.ps1` 已包含本插件。
