/**
 * A 插件形状与系统提示词区段:name / apply / guard 形状、tools/pre-execute
 * hook、区段注册与 order、区段文本的四种断言,以及完全权限会话的空文本。
 *
 * 运行:`node test/plugin-shape.test.mjs`(或 pnpm test 跑全部)。
 */
import assert from 'node:assert/strict'
import guard, { name, apply } from '../index.ts'
import { createHarness, fullAccessSession, workspaceSession } from './helpers.mjs'

assert.equal(name, 'dsh-git-guard')
assert.equal(typeof apply, 'function')
assert.equal(guard.name, name)
assert.equal(guard.apply, apply)

const harness = createHarness({
  onInject: (deps) => assert.ok(deps.includes('systemPrompt'), 'inject 请求 systemPrompt 服务'),
})
const { hook, sections, sectionText } = harness

assert.ok(hook, 'tools/pre-execute hook registered')

assert.equal(sections.length, 1, '恰注册一个系统提示词区段')
const [policySection] = sections
assert.equal(policySection.name, 'git-guard:push-policy')
assert.equal(policySection.order, 600, '区段位于 TEAM_POLICY 槽位')
assert.equal(typeof policySection.text, 'function', '区段文本按组装上下文求值')

for (const [label, text] of [
  ['无 agent 的组装', sectionText()],
  ['workspace-write 会话', sectionText(workspaceSession)],
]) {
  assert.match(text, /git push/, `${label}：区段提及 git push`)
  assert.match(text, /git commit/, `${label}：区段提及 git commit`)
  assert.match(text, /用户许可/, `${label}：区段声明需要用户许可`)
  assert.match(text, /git push --force|rebase/, `${label}：区段提及破坏性操作同样须获许可`)
}
assert.equal(sectionText(fullAccessSession), '', '完全权限会话：区段文本为空，不向模型提出授权要求')

console.log('plugin-shape checks passed')
