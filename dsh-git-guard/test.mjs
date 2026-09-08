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
assert.match(policySection.text, /git push --force|rebase/, '区段提及破坏性操作被禁止')

// 模拟流水线：next() 落到链尾的默认 allow。
// 门禁与工具名解耦：命令经由任何 shell 工具（bash / pwsh / cmd …）都应被审查。
function decide(command, toolName = 'pwsh') {
  return hook({ name: toolName, arguments: { command } }, async () => ({ kind: 'allow' }))
}

// --- ask：git commit / git push（非 force）---
for (const command of [
  'git commit -m x',
  'git add . && git commit',
  'git add .; git commit -m "msg"',
  // 本次实际漏拦截的命令（经 pwsh 工具）：
  'git add dsh-git-guard; git commit -m "refactor(dsh-git-guard): git push 由 deny 改为 ask"',
]) {
  const decision = await decide(command)
  assert.equal(decision?.kind, 'ask', `ask(commit): ${command}`)
  assert.match(decision?.reason ?? '', /许可/, 'ask reason 告知提交需用户许可')
}

for (const command of [
  'git push',
  'git push origin main',
  'GIT_SSH_COMMAND="ssh -i k" git push',
  'git -C /repo push',
  'git -C "C:/some path with space/my repo" push',
  '& git push',
  'VAR="a b" git push',
  'sudo git push',
  'sudo -u user git push',
  'env git push',
  'command git push',
  'bash -c \'git push\'',
  'bash -c "git push"',
  'cmd /c git push',
  'pwsh -Command "git push"',
  '( git push )',
]) {
  const decision = await decide(command)
  assert.equal(decision?.kind, 'ask', `ask(push): ${command}`)
  assert.match(decision?.reason ?? '', /许可/, 'ask reason 告知推送需用户许可')
}

// --- deny：破坏性 / 历史改写操作 ---
for (const command of [
  'git push --force',
  'git push -f',
  'git push --force-with-lease',
  'git rebase',
  'git rebase -i HEAD~3',
  'git merge feature',
  'git cherry-pick abc123',
  'git reset --hard HEAD~1',
  'git reset --keep',
  'git revert abc123',
  'git filter-branch -- --all',
]) {
  const decision = await decide(command)
  assert.equal(decision?.kind, 'deny', `deny: ${command}`)
  assert.equal(typeof decision?.reason, 'string', 'deny 附禁止原因')
}

// --- 放行：安全 git 子命令与非 git 命令 ---
for (const command of [
  'git status',
  'git log && echo done',
  'git add .',
  'git reset HEAD~1', // 普通 mixed/smooth 重置放行
  'ls -la',
  'Get-ChildItem',
  'echo git commit', // git 不在命令位 → 不应误拦截
]) {
  const decision = await decide(command)
  assert.equal(decision?.kind, 'allow', `allow: ${command}`)
}

// --- 非 shell 工具（无 command 字段）不拦截 ---
assert.equal((await hook({ name: 'read', arguments: { file: 'x' } }, async () => ({ kind: 'allow' })))?.kind, 'allow')

console.log('all behavioral checks passed')
