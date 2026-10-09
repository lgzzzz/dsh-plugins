# DSH 插件：五种「名字」完整说明

> **概述**：读完本主题，你能分清一个 DSH 插件身上出现的五个「名字」各由哪台机器管、改错哪一个会出什么问题。一个插件身上最多会出现五个互不派生、只是习惯写成同一个字符串的名字——**包名**（包的身份）、**patch `id`**（定位是哪一行）、**patch `name`**（要 import 哪个模块）、**导出 `name`**（日志里的显示名）、**服务名**（注入用的键）：它们各归各的机器管，改了其中一个，其余四个不会跟着变。本仓库的约定是把前四者写成同一个字符串，提供服务时服务名也同名（见[第 4 册](plugin-naming/04-conventions-and-glossary.md)）。

-----

## 分册目录

| 分册 | 内容 |
|---|---|
| [1. 五种名字速查表与最小示例](plugin-naming/01-overview-and-example.md) | 五者速查表；包名 / patch `id` / patch `name` / 导出 `name` / 服务名的完整最小示例 |
| [2. 每个名字逐个展开](plugin-naming/02-each-name-explained.md) | 每种名字的写入位置、语义、谁在读、写错会怎样 |
| [3. 完整数据流与三个易混点](plugin-naming/03-data-flow-and-pitfalls.md) | 从 patch 文件到名字落地；`id` ≠ `name`、default 导出压过 `export const name`、服务名与插件名无关；客户端半部的名字 |
| [4. 本仓库约定与术语速查表](plugin-naming/04-conventions-and-glossary.md) | 本仓库的命名 / 写法约定；术语表 |

## 进一步探索

- [docs/README.md](README.md) —— 本仓库的构建、挂载与校验命令(含把插件挂进 profile 的 `add-plugins` 脚本)。
- [示例：函数式插件](../example/normal-plugin/index.ts) —— 最小示例：`export const name` + `export const inject` + `export function apply`。
- [示例：服务插件](../example/service-plugin/index.ts) —— 最小示例：`export default class X extends Service` 与服务名的落地。
- [`dsh.client.inject` 完整说明](dsh-client-inject.md) —— 客户端半部的加载顺序由 `external`（模块图）与 cordis 服务 `inject` 保证，与 patch 的 `name` 无关。
