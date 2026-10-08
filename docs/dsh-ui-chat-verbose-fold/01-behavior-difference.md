# 行为差异与影响面

> 本文件是 [dsh-ui-chat-verbose-fold 说明](../dsh-ui-chat-verbose-fold.md) 的第 1 册:需要改动的策略字段,以及它所在的位置。

-----

## 目标差异

需要的行为差异只有官方一个字段:`POLICIES.verbose.foldCompletedTurns`(官方为 `false`)。它定义在 `@deepseek-ai/dsh-client-ui-chat` 的 presentation policy 模块里(上游源码路径 `src/client/presentation-policy.ts`;安装产物里是 `lib/client.js` 的私有 `POLICIES` 表,类型契约见 `lib/types/client/presentation-policy.d.ts`)。

该字段不在任何扩展面上,无法用配置覆盖:

| 扩展面 | 现状 |
|---|---|
| Cordis 服务 | `ui-chat` 不提供策略服务;`POLICIES` 是模块私有 `const` |
| `transcriptView` 配置 | 只表达模式枚举(compact/standard/detailed/verbose),不含每个模式的策略表 |
| slot | 策略不是 slot,而是 `conversation.view#chat` 注册项**注入面**里的 `hooks.presentation` |

本插件不碰官方源码、不 disable / 不改名官方包,而是复用 slot 机制给出的**活对象**,在运行时补上这个字段。
