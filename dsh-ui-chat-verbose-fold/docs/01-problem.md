# 背景与动机

> 本文件是 [dsh-ui-chat-verbose-fold 说明](../README.md) 的第 1 册：要改的是哪一行、为什么配置覆盖不到。

---

## 它解决的问题

需要的行为差异只有官方 `src/client/presentation-policy.ts` 里的一行（`POLICIES.verbose.foldCompletedTurns`，官方 `false`）。

那一行无法用配置覆盖，原因是它不在任何扩展面上：

| 可能的扩展面 | 现状 |
|---|---|
| Cordis 服务 | `ui-chat` 不提供策略服务；`POLICIES` 是模块私有 `const` |
| `transcriptView` 配置 | 只表达模式枚举（compact/standard/detailed/verbose），不含每个模式的策略表 |
| slot | 策略不是 slot，而是 `conversation.view#chat` 注册项**注入面**里的 `hooks.presentation` |

本插件不碰源码、不 disable/改名官方包，而是复用 slot 机制给出的**活对象**，把那一行在运行时补上。
