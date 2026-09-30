# DSH 插件：五种「名字」完整说明

> **一句话**：一个 DSH 插件身上最多会出现五个互不派生、只是习惯写成同一个字符串的名字——**包名**（包的身份）、**patch `id`**（定位是哪一行）、**patch `name`**（要 import 哪个模块）、**导出 `name`**（日志里的显示名）、**服务名**（注入用的键）。它们各归各的机器管，改了其中一个，其余四个不会跟着变。

## 分册目录

| 分册 | 内容 |
|---|---|
| [1. 五种名字速查表与最小示例](plugin-naming/01-overview-and-example.md) | 五者速查表；包名 / patch `id` / patch `name` / 导出 `name` / 服务名的完整最小示例 |
| [2. 每个名字逐个展开](plugin-naming/02-each-name-explained.md) | 每种名字的写入位置、语义、谁在读、写错会怎样 |
| [3. 完整数据流与三个易混点](plugin-naming/03-data-flow-and-pitfalls.md) | 从 patch 文件到名字落地；`id` ≠ `name`、default 导出压过 `export const name`、服务名与插件名无关；客户端半部的名字 |
| [4. 本仓库约定与术语速查表](plugin-naming/04-conventions-and-glossary.md) | 本仓库的命名 / 写法约定；术语表 |

> 阅读约定：各分册的章节号沿用拆分前的编号（第 1～8 节），跨册引用已改为指向对应分册的链接。
