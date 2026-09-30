/**
 * D 失败模式:sandboxPolicy 服务缺席 / 无 resolve / resolve 抛错时仍 ask,
 * resolve 抛错时区段仍保留,以及非 shell 工具直接放行。
 *
 * 运行:`node test/failure-modes.test.mjs`(或 pnpm test 跑全部)。
 */
import assert from 'node:assert/strict'
import { createHarness, fullAccessSession } from './helpers.mjs'

const harness = createHarness()
const { hook, decide, sectionText, state } = harness

state.policyMounted = false
assert.equal((await decide('git commit -m x', { session: fullAccessSession }))?.kind, 'ask', '服务缺席仍 ask')
assert.equal((await decide('git push --force', { session: fullAccessSession }))?.kind, 'ask', '服务缺席仍 ask(force push)')
state.policyMounted = true

state.policyHasResolve = false
assert.equal((await decide('git commit -m x', { session: fullAccessSession }))?.kind, 'ask', '服务无 resolve 仍 ask')
state.policyHasResolve = true

state.policyFails = true
assert.equal((await decide('git commit -m x', { session: fullAccessSession }))?.kind, 'ask', 'resolve 抛错仍 ask')
assert.equal((await decide('git rebase', { session: fullAccessSession }))?.kind, 'ask', 'resolve 抛错仍 ask(破坏性操作)')
assert.notEqual(sectionText(fullAccessSession), '', 'resolve 抛错时区段仍保留（不误判为完全权限）')
state.policyFails = false

assert.equal((await hook({ name: 'read', arguments: { file: 'x' } }, async () => ({ kind: 'allow', passthrough: true })))?.passthrough, true)

console.log('failure-modes checks passed')
