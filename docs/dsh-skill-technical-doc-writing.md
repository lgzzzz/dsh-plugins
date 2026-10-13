# dsh-skill-technical-doc-writing

把「通用技术文档与文案标准」技能作为插件自带资产分发：装上插件，宿主就有了 `technical-doc-writing` 技能，模型按需加载、用户也可以用 `/technical-doc-writing` 显式调用。技能正文的唯一来源是插件的 `assets/technical-doc-writing.md`，因此每个安装者拿到的都是同一份内容，不需要再往 `.agents/skills/` 里放 `SKILL.md`。候选以 `source: bundled`、`rank: 600`（`BUNDLED_SKILL_RANK`）注册——注册表按 rank 升序决胜、rank 越小越优先，所以这是兜底档：`.agents/skills/`（工程 100/200）或 `$DSH_HOME/skills`（用户 400/500）下只要存在同名技能，生效的就是那一份，插件这份只在别处都没有该名字时被选中。运行期没有构建步骤，宿主半部 `index.ts` 由 Node Type Stripping 直接加载。

-----

## 目录

- [装与用](#装与用)
- [技能里有什么](#技能里有什么)
- [改内容与生效时机](#改内容与生效时机)
- [进一步探索](#进一步探索)

<details>
<summary>Dev Note</summary>

插件只有宿主半部：`index.ts` 在 `apply()` 时用 `ctx.skills.registerProvider()` 注册一个 provider，这条注册随 fiber 卸载自动注销。`list()` 不碰磁盘，只报一条候选；正文在 `get()` 里按调用方的 signal 读 `assets/technical-doc-writing.md`（`signal` 直接透给 `readFile`，所以已中止的查询以 `AbortError` 收场）。技能名、描述与调用策略写在 `index.ts`，正文放在资产里，两者的分工见[改内容与生效时机](#改内容与生效时机)。三件不看代码看不出来的约定（bundled 是兜底档、正文只有资产一处来源、signal 透传）钉在 `test/provider.test.mjs` 里。

</details>

-----

## 装与用

挂载命令与其余插件一致，目录换成新插件的路径：

```bash
dsh plugin --profile web add /path/to/dsh-plugins/dsh-skill-technical-doc-writing
```

`./add-plugins.sh`（Windows：`./add-plugins.ps1`）已经把这个插件列进清单，整仓挂载时会被一起装进去。插件是宿主半部，**挂载后要重启 `dsh web` 才生效**，刷新页面不够——新插件没有热加载路径。

重启后：

- 模型侧：技能目录里出现 `technical-doc-writing`，涉及 README、Markdown、代码注释、提示词、CLI/UI 文案的编写与审查时按需加载；
- 用户侧：在自己的消息里写 `/technical-doc-writing`，正文随后作为 instructions 形式的上下文注入。

调用是否成功的判断依据是技能正文里的标准（例如「删减前先数事实主张」「只写当前状态」），而不是插件有没有出现在设置列表里。

## 技能里有什么

`assets/technical-doc-writing.md` 是一份通用标准，回答「一段文字该不该写、写多少、怎么写才清楚」，覆盖三类判断：事实主张要保全、每条事实只有一个权威来源、只描述当前状态而不写改动史。技能同时给出页面顺序、摘要写法、清晰度纪律、证据审查与思维链泄漏的分类，以及自动 / 交互两种模式与排除项（生成物、夹具、第三方代码、归档快照）。

技能的调用范围不绑定本仓库：任何项目的技术文档与文案都在范围内。

## 改内容与生效时机

| 要改的东西 | 改哪里 | 生效时机 |
| --- | --- | --- |
| 正文（标准本身） | `assets/technical-doc-writing.md` | 下一次加载技能即读到新字节，不需要重启：`get()` 每次调用都重新读文件 |
| 技能名、路由描述、调用策略 | `index.ts` 顶部的 `SKILL_NAME` / `SKILL_DESCRIPTION` / `CANDIDATE` | 需要重启 `dsh web`：这些字段在插件模块加载时就定下来了 |
| 注册来源或兜底优先级 | `index.ts` 里候选的 `source` / `rank` | 需要重启 `dsh web` |

**同名覆盖**：技能注册表按 rank 升序决胜，越小的 rank 越优先。bundled 档（600）排在工程目录（100/200）与用户目录（400/500）之后，所以任何一处放着 `technical-doc-writing`，加载到的都是那一份，插件的正文只在名字没有本地来源时生效。要让插件这份成为唯一来源，就不能在 `.agents/skills/` 或 `$DSH_HOME/skills` 下再放同名技能。

改完跑该插件自己的检查：

```bash
cd dsh-skill-technical-doc-writing
node test/run-all.mjs   # 或 pnpm test
pnpm typecheck
pnpm check
```

-----

## 进一步探索

- [docs/README.md](README.md) —— 本仓库的构建、挂载与校验命令，以及其余插件的入口。
- [技能正文资产](../dsh-skill-technical-doc-writing/assets/technical-doc-writing.md) —— 插件实际分发的标准全文。
- [DSH 插件五种「名字」](plugin-naming.md) —— 包名 / patch `id` / patch `name` / 导出 `name` / provider 名各由哪台机器管。
- [provider 契约测试](../dsh-skill-technical-doc-writing/test/provider.test.mjs) —— rank、正文来源与取消这三条约定的可执行版本。
- [add-plugins.sh](../add-plugins.sh) —— 整仓挂载脚本，新插件已列入清单。
