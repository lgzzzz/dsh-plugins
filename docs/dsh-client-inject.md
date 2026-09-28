# `dsh.client.inject` 字段说明

## 是什么

`package.json` 里 `dsh.client.inject` 字段，声明"我这个 web 客户端插件在浏览器端还依赖哪些其它 Harness 客户端包"，值是一串 npm 包名。

```jsonc
"dsh": {
  "client": {
    "inject": ["@deepseek-ai/dsh-client-locale", "..."],
    "platform": "web"
  }
}
```

## 关键结论（3 条）

1. **它是信息性的包名依赖（加载/预取元数据），不是 Cordis 服务注入。**
2. **它不决定插件的 `apply()` 激活顺序，也不提供任何可 `ctx.get()` 的服务。**
3. **缺失不影响运行**：可选字段，缺了等价于空数组，插件照常加载、照常 `apply()`，只是少了"连带预加载"的优化提示。

## 和相邻字段的区别

| 字段 | 作用 |
|---|---|
| `platform` | 平台标识（`web`） |
| `inject` | 信息性包名依赖，仅预取/共同加载提示，无排序、无服务语义 |
| `external` | 真实模块依赖，决定加载顺序并做环检测 |
| `immediately` | 是否进入启动第一阶段批次 |

## 谁在用

- **Host 侧**：`dsh-client-modules` 扫描声明了 `dsh.client` 的包，把 `inject` 原样写进 `window.__DSH_BOOT__` 的入口图（`WebBootEntry.inject`）。
- **浏览器侧**：加载某个插件时，`arriveGraphRow()` 会顺带加载其 `inject` 列表里的包。

## 一句话

`inject` 只是"加载谁"的提示；真正保证"先加载谁 / 服务可等待"的是 `external` 和 Cordis 的 `inject`（服务注入）。
