/**
 * provider 契约测试：直接调用 index.ts 导出的 provider，不经过技能注册表。
 *
 * 锁住三件不看代码就看不出来的事：候选的 rank 必须落在 bundled 兜底档（同名技能被工程 / 用户目录覆盖），
 * 正文只有资产这一处来源（取回的字节与资产逐字相同、且不含 frontmatter），
 * 以及 `get()` 会把调用方的 signal 透给磁盘读取（已中止的查询以 AbortError 收场，而不是照读）。
 *
 * 运行：`node test/provider.test.mjs`。
 */
import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { BUNDLED_SKILL_RANK } from '@deepseek-ai/dsh-skill'
import * as plugin from '../index.ts'

const { apply, inject, name, provider } = plugin

// 插件形状

assert.equal(name, 'dsh-skill-technical-doc-writing', '导出 name 与包名一致')
assert.deepEqual(inject, ['skills'], '声明依赖技能注册表')
assert.equal(typeof apply, 'function', '导出 apply')
assert.equal(plugin.default.name, name, '默认导出的 name 与具名导出一致')
assert.equal(plugin.default.apply, apply, '默认导出的 apply 与具名导出一致')
assert.deepEqual(plugin.default.inject, inject, '默认导出带 inject')

// 候选身份

assert.equal(provider.name, name, 'provider 名与插件名一致（注册表按它查重）')

const candidates = await provider.list({})
assert.equal(candidates.length, 1, '只提供一条候选')
const [candidate] = candidates
assert.equal(candidate.name, 'technical-doc', '技能名保持 kebab-case')
assert.equal(candidate.provider, provider.name, '候选的 provider 字段必须等于 provider 名，否则注册表拒收')
assert.equal(candidate.source, 'bundled', '来源记为 bundled')
assert.deepEqual(candidate.invocation, { modelInvocable: true, userInvocable: true }, '模型与用户都可调用')
assert.ok(candidate.description.length > 0, '描述非空：注册表把空描述当错误')
assert.equal(candidate.rank, BUNDLED_SKILL_RANK, 'rank 取 BUNDLED_SKILL_RANK，不自己编数字')
assert.ok(candidate.rank > 500, 'rank 大于文件系统 provider 的工程 200 / 用户 500 档：同名技能若出现在这些目录，由那一份胜出，插件这份是兜底')

// 正文只有资产一处来源

const assetPath = fileURLToPath(new URL('../assets/technical-doc-writing.md', import.meta.url))
const assetBytes = await readFile(assetPath, 'utf8')
assert.ok((await stat(assetPath)).size > 0, '正文资产存在且非空')

const skill = await provider.get(candidate, {})
assert.equal(skill.name, candidate.name, '取回的技能名与候选一致')
assert.equal(skill.provider, provider.name, '取回的 provider 名与候选一致')
assert.equal(skill.content, assetBytes, '正文逐字来自资产，没有第二份副本')
assert.ok(skill.content.startsWith('# 通用技术文档与文案标准'), '正文从正文标题开始，不带 frontmatter')
assert.equal(skill.content.includes('name: technical-doc'), false, 'frontmatter 的 name 没有漏进正文')
assert.equal(skill.resourceBase?.kind, 'directory', '相对资源指向插件自带的 assets/ 目录')

// 取消

await assert.rejects(
  provider.get(candidate, { signal: AbortSignal.abort() }),
  { name: 'AbortError' },
  '已中止的查询中止在磁盘读取上，不照常返回正文',
)

// 挂载

{
  const factories = []
  apply({ skills: { registerProvider: (create) => factories.push(create) } })
  assert.equal(factories.length, 1, 'apply 恰好注册一个 provider')
  assert.equal(factories[0]({}), provider, '注册的是本插件的 provider')
}
