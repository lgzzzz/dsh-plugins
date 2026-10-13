/**
 * 宿主半部：把「通用技术文档与文案标准」技能作为插件自带资产分发。
 *
 * 技能正文的唯一来源是本插件资产 `assets/technical-doc-writing.md`；技能名、描述与调用策略在这里声明。
 * 候选的 `source` 记为 `bundled`、`rank` 取 `BUNDLED_SKILL_RANK`：技能注册表在同一层里按 rank 升序决胜，
 * rank 越小越优先，所以 bundled（600）是兜底档——只要 `.agents/skills/` 或 `$DSH_HOME/skills` 下存在同名技能
 * （工程 100/200、用户 400/500，见 `@deepseek-ai/dsh-skill-filesystem`），生效的就是那一份。
 *
 * 发现阶段(`list()`)不碰磁盘，只报这一条候选；正文在 `get()` 里按调用方给的 signal 按需读。
 * 挂载方式与验证命令见 docs/dsh-skill-technical-doc-writing.md。
 */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { BUNDLED_SKILL_RANK } from '@deepseek-ai/dsh-skill'
import type { Context } from '@deepseek-ai/cordis'
import type { SkillCandidate, SkillDefinition, SkillLookupOptions, SkillProvider } from '@deepseek-ai/dsh-skill'

/** 插件标识（日志名，与包名一致）。 */
export const name = 'dsh-skill-technical-doc-writing'

/** 依赖的宿主服务：技能注册表就绪前不挂载。 */
export const inject = ['skills']

/** 技能名：模型加载与用户显式调用都按它寻址。 */
const SKILL_NAME = 'technical-doc-writing'

/** 发现阶段给模型看的路由描述。 */
const SKILL_DESCRIPTION =
  '编写、审查、精简或恢复任意项目的技术文档与文案时使用——README、Markdown 文档、JSDoc 与代码/测试注释、提示词、工具与技能描述、诊断信息、CLI/UI 文案，不限于某个具体仓库。'

/** 正文资产与相对资源根：按模块 URL 解析，因此与进程 cwd 无关。 */
const SKILL_BODY_URL = new URL('./assets/technical-doc-writing.md', import.meta.url)
const RESOURCE_BASE = { kind: 'directory', path: fileURLToPath(new URL('./assets/', import.meta.url)) } as const

/** 唯一候选：这里只声明身份与调用策略，正文留在 `get()` 里读。 */
const CANDIDATE: SkillCandidate = {
  name: SKILL_NAME,
  description: SKILL_DESCRIPTION,
  invocation: { modelInvocable: true, userInvocable: true },
  provider: name,
  source: 'bundled',
  rank: BUNDLED_SKILL_RANK,
  resourceBase: RESOURCE_BASE,
  locator: SKILL_BODY_URL,
}

/** 自带技能的 provider；注册进调用上下文所在的层（宿主插件即全局层）。 */
export const provider: SkillProvider = {
  name,
  list: () => Promise.resolve([CANDIDATE]),
  async get(_candidate, options: SkillLookupOptions): Promise<SkillDefinition> {
    return {
      name: CANDIDATE.name,
      description: CANDIDATE.description,
      invocation: CANDIDATE.invocation,
      provider: CANDIDATE.provider,
      source: CANDIDATE.source,
      resourceBase: RESOURCE_BASE,
      content: await readFile(SKILL_BODY_URL, { encoding: 'utf8', signal: options.signal }),
    }
  },
}

/** 把自带技能注册到 `ctx.skills`；注册随 fiber 卸载自动注销。 */
export function apply(ctx: Context): void {
  ctx.skills.registerProvider(() => provider)
}

export default { name, inject, apply }
