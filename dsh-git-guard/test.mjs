/**
 * dsh-git-guard 行为冒烟测试。
 *
 * 直接用支持 Type Stripping 的运行时加载 index.ts（Node 22.18+ / 23.6+ / 24+，
 * 或 App 内置运行时）：
 *
 *   node test.mjs
 *   ELECTRON_RUN_AS_NODE=1 "/path/to/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness" test.mjs
 */
import assert from 'node:assert/strict'
import guard, { name, apply } from './index.ts'

assert.equal(name, 'dsh-git-guard')
assert.equal(typeof apply, 'function')
assert.equal(guard.name, name)
assert.equal(guard.apply, apply)

// 最小 ctx 桩：实现钩子注册与 systemPrompt 注入。
const listeners = new Map()
const sections = []
const ctx = {
  on(eventName, callback) {
    listeners.set(eventName, callback)
    return () => true
  },
  inject(deps, callback) {
    assert.ok(deps.includes('systemPrompt'), 'inject 请求 systemPrompt 服务')
    callback({
      systemPrompt: {
        section(section) {
          sections.push(section)
          return () => true
        },
        getSectionOrder(slotName) {
          // 仅解析仓库预留槽位 TEAM_POLICY(=600)，其余返回 0。
          return slotName === 'TEAM_POLICY' ? 600 : 0
        },
      },
    })
    return () => true
  },
}
guard.apply(ctx)
const hook = listeners.get('tools/pre-execute')
assert.ok(hook, 'tools/pre-execute hook registered')

// --- 系统提示词注入：提交推送策略区段 ---
assert.equal(sections.length, 1, '恰注册一个系统提示词区段')
const [policySection] = sections
assert.equal(policySection.name, 'git-guard:push-policy')
assert.equal(policySection.order, 600, '区段位于 TEAM_POLICY 槽位')
assert.match(policySection.text, /git push/, '区段提及 git push')
assert.match(policySection.text, /git commit/, '区段提及 git commit')
assert.match(policySection.text, /用户许可/, '区段声明需要用户许可')
assert.doesNotMatch(policySection.text, /不要修改/, '区段不再包含「不要修改」的分析限制')

// 模拟流水线：next() 落到链尾的默认 allow。
function decide(command, toolName = 'bash') {
  return hook({ name: toolName, arguments: { command } }, async () => ({ kind: 'allow' }))
}

// --- ask：git push 及其各种包装（均需用户许可）---
for (const command of [
  'git push',
  'git push origin main',
  'GIT_SSH_COMMAND="ssh -i k" git push',
  "bash -c 'git push'",
  'git -C /repo push',
  'git add . && git push',
]) {
  const decision = await decide(command)
  assert.equal(decision?.kind, 'ask', `ask: ${command}`)
  assert.match(decision?.reason ?? '', /许可/, 'ask reason 告知推送需用户许可')
}

// --- ask：git commit ---
for (const command of ['git commit -m x', 'git add . && git commit']) {
  const decision = await decide(command)
  assert.equal(decision?.kind, 'ask', `ask: ${command}`)
  assert.match(decision?.reason ?? '', /许可/, 'ask reason 告知提交需用户许可')
}

// --- 放行：其他命令走 next() ---
assert.equal((await decide('git status'))?.kind, 'allow')
assert.equal((await decide('ls -la'))?.kind, 'allow')
assert.equal((await decide('git log && echo done'))?.kind, 'allow')
// 非 bash 工具不拦截
assert.equal((await decide('git push', 'read'))?.kind, 'allow')

console.log('all behavioral checks passed')