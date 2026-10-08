# `dsh.client.inject` 字段完整说明

> **概述**:读完本主题,你能判断一个客户端包的加载顺序与依赖究竟由谁保证。`package.json` 里的 `dsh.client.inject` 是一串「包名」,它的全部作用是**在浏览器里、在加载声明这个字段的包自身之前,把列表里那些包的 bundle 也顺手取回来并注册好工厂**(预热 / 预取):它**不参与排序、不做环检测、不校验目标是否存在、不提供任何 cordis 服务、也不决定 `apply()` 的激活顺序**,所以删掉它不影响可运行性,只损失一次预热。真正能保证「必须先加载谁 / 服务可等待」的是另外两套互不相干的机制:`dsh.client.external`(模块图硬依赖)和 cordis 的服务 `inject`(`export const inject` / `ctx.inject` / `ctx.get`)。

## 分册目录

| 分册 | 内容 |
|---|---|
| [1. 字段形状与语义](dsh-client-inject/01-fields-and-semantics.md) | 写在哪里、长什么样;三个同名 `inject` 的区别;`dsh.client` 四个字段各自的作用 |
| [2. 完整数据流](dsh-client-inject/02-data-flow.md) | 宿主半部 → 线上传输 → 浏览器半部;`inject` 到底「得到什么 / 失去什么」 |
| [3. 同步 `require` 的边界与失败表现](dsh-client-inject/03-require-and-failure-modes.md) | 构建期纯度门与同步 `require` 的真实边界;三种依赖在目标缺失 / 被禁用时的表现 |
| [4. 术语速查表](dsh-client-inject/04-glossary.md) | 术语表 |
