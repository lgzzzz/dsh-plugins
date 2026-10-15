# dsh-skill-ste-zh

把上游 [lemonhall/asd-ste100-skill-zh](https://github.com/lemonhall/asd-ste100-skill-zh) 的「受控中文技术写作」技能作为插件自带资产分发：装上插件，宿主就有了 `ste-zh` 技能，模型按需加载、用户也可以用 `/ste-zh` 显式调用。技能正文的唯一来源是插件的 `assets/ste-zh.md`，随附的规则全集、前后对照例子与确定性 linter 放在同一个 `assets/` 下，因此每个安装者拿到的都是同一份内容，不需要再往 `.agents/skills/` 里放 `SKILL.md`。候选以 `source: bundled`、`rank: 600`（`BUNDLED_SKILL_RANK`）注册——这是兜底档：`.agents/skills/`（工程 100/200）或 `$DSH_HOME/skills`（用户 400/500）下只要存在同名技能，生效的就是那一份。运行期没有构建步骤，宿主半部 `index.ts` 由 Node Type Stripping 直接加载。

-----

## 目录

- [装与用](#装与用)
- [技能里有什么](#技能里有什么)
- [改内容与生效时机](#改内容与生效时机)
- [上游归属](#上游归属)
- [进一步探索](#进一步探索)

<details>
<summary>Dev Note</summary>

插件只有宿主半部：`index.ts` 在 `apply()` 时用 `ctx.skills.registerProvider()` 注册一个 provider，这条注册随 fiber 卸载自动注销。`list()` 不碰磁盘，只报一条候选；正文在 `get()` 里按调用方的 signal 读 `assets/ste-zh.md`（`signal` 直接透给 `readFile`，所以已中止的查询以 `AbortError` 收场）。`resourceBase` 指向 `assets/`，正文里的 `references/…`、`examples/…`、`scripts/…` 三类相对路径都以它为根解析。技能名、描述与调用策略写在 `index.ts`，正文放在资产里，两者的分工见[改内容与生效时机](#改内容与生效时机)。四条不看代码看不出来的约定（bundled 是兜底档、正文只有资产一处来源、正文引用的相对资源都能在 `resourceBase` 下解析到、signal 透传）钉在 `test/provider.test.mjs` 里。

</details>

-----

## 装与用

挂载命令与其余插件一致，目录换成新插件的路径：

```bash
dsh plugin --profile web add /path/to/dsh-plugins/dsh-skill-ste-zh
```

`./add-plugins.sh`（Windows：`./add-plugins.ps1`）已经把这个插件列进清单，整仓挂载时会被一起装进去。插件是宿主半部，**挂载后要重启 `dsh web` 才生效**，刷新页面不够——新插件没有热加载路径。

重启后：

- 模型侧：技能目录里出现 `ste-zh`，改写、审查或精简中文技术文本时按需加载；
- 用户侧：在自己的消息里写 `/ste-zh`，正文随后作为 instructions 形式的上下文注入。

调用是否成功的判断依据是技能正文里的规则（例如「动笔前先看情态」「原意一个字不能变」），而不是插件有没有出现在设置列表里。

## 技能里有什么

`assets/ste-zh.md` 是一份受控中文写作标准：把含糊、啰嗦、容易被误读的中文改写成一句一动作、主动语态、一词一义的句子。正文给出两档模式（Strict 用于程序步骤、报错、工具描述、agent 间指令；中文-顺用于 README、PR 描述、变更日志）、结构规则与词汇规则两张表、中文特有的六种机器味扫描清单、改写流程、默认输出格式与边界（不改情态、不加事实、不粉饰空内容）。

随附资源与正文引用它们的相对路径一一对应：

| 资产 | 内容 |
| --- | --- |
| `assets/ste-zh.md` | 技能正文；分发的唯一内容来源 |
| `assets/references/writing-rules.md` | 规则全集：结构规则、词汇规则、中文特有的坑，以及与上游 ASD-STE100 九节 53 条的对应关系 |
| `assets/examples/before-after.md` | 八组前后对照：工具描述、报错、agent 间指令、状态汇报、PR 描述、README |
| `assets/examples/after-only.md` | 改写列的 lint 夹具，硬违规 0（`python3 assets/scripts/ste-lint-zh.py assets/examples/after-only.md` 可复现） |
| `assets/scripts/ste-lint-zh.py` | 仅用标准库的确定性 linter：`--json`、`--baseline N`、`--disable 规则名`、`--list-rules`、`--selftest` |

## 改内容与生效时机

| 要改的东西 | 改哪里 | 生效时机 |
| --- | --- | --- |
| 正文（标准本身） | `assets/ste-zh.md` | 下一次加载技能即读到新字节，不需要重启：`get()` 每次调用都重新读文件 |
| 随附资源 | `assets/references/`、`assets/examples/`、`assets/scripts/` | 下一次读取该资源即生效；改动不要动正文引用的相对路径 |
| 技能名、路由描述、调用策略 | `index.ts` 顶部的 `SKILL_NAME` / `SKILL_DESCRIPTION` / `CANDIDATE` | 需要重启 `dsh web`：这些字段在插件模块加载时就定下来了 |
| 注册来源或兜底优先级 | `index.ts` 里候选的 `source` / `rank` | 需要重启 `dsh web` |

**同名覆盖**：技能注册表按 rank 升序决胜，越小的 rank 越优先。bundled 档（600）排在工程目录（100/200）与用户目录（400/500）之后，所以任何一处放着 `ste-zh`，加载到的都是那一份。要让插件这份成为唯一来源，就不能在 `.agents/skills/` 或 `$DSH_HOME/skills` 下再放同名技能。

从上游同步内容时，重新复制 `SKILL.md`（去掉 frontmatter 后写入 `assets/ste-zh.md`）、`references/`、`examples/`、`scripts/`、`LICENSE` 与 `NOTICE.md`，再跑下面的检查。

```bash
cd dsh-skill-ste-zh
node test/run-all.mjs   # 或 pnpm test
pnpm typecheck
pnpm check
```

## 上游归属

上游仓库 MIT 许可，Copyright (c) 2026 lemonhall；它的英文对应物是 [danyuchn/asd-ste100-skill](https://github.com/danyuchn/asd-ste100-skill)。上游与 ASD-STE100 标准正文、受控词表的差异说明随 `NOTICE.md` 一起放在插件根，两者都随本插件分发，改动资产时不要删。

## 进一步探索

- [docs/README.md](README.md) —— 本仓库的构建、挂载与校验命令，以及其余插件的入口。
- [技能正文资产](../dsh-skill-ste-zh/assets/ste-zh.md) —— 插件实际分发的标准全文。
- [dsh-skill-technical-doc-writing](dsh-skill-technical-doc-writing.md) —— 同一挂载方式的另一个技能插件（`technical-doc`）。
- [DSH 插件五种「名字」](plugin-naming.md) —— 包名 / patch `id` / patch `name` / 导出 `name` / provider 名各由哪台机器管。
- [provider 契约测试](../dsh-skill-ste-zh/test/provider.test.mjs) —— rank、正文来源、相对资源可解析与取消这四条约定的可执行版本。
- [上游仓库](https://github.com/lemonhall/asd-ste100-skill-zh) —— 技能的作者、更新与安装方式（Claude Code / Codex）。
