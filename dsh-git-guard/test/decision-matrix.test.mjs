/**
 * 判定矩阵:commit / push / 破坏性操作都要求用户许可,混合与多语句命令优先
 * 提示破坏性操作,不产生 deny,其余命令放行。
 *
 * 运行:`node test/decision-matrix.test.mjs`(或 pnpm test 跑全部)。
 */
import assert from 'node:assert/strict'
import { createHarness } from './helpers.mjs'

const harness = createHarness()
const { decide } = harness

for (const command of [
  'git commit -m x',
  'git add . && git commit',
  'git add .; git commit -m "msg"',
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

for (const command of [
  'git push --force',
  'git push -f',
  'git push --force-with-lease',
  'git push --force-if-includes',
  'git rebase',
  'git rebase -i HEAD~3',
  'git merge feature',
  'git cherry-pick abc123',
  'git reset --hard HEAD~1',
  'git reset --keep',
  'git reset --merge',
  'git revert abc123',
  'git am < patch.diff',
  'git filter-branch -- --all',
  'git filter-repo --force',
  'git add . && git push --force',
  'bash -c "git rebase -i HEAD~3"',
  'sudo git reset --hard HEAD~1',
]) {
  const decision = await decide(command)
  assert.equal(decision?.kind, 'ask', `ask(破坏性): ${command}`)
  assert.match(decision?.reason ?? '', /许可/, 'ask reason 告知需用户许可')
  assert.match(decision?.reason ?? '', /批准或拒绝/, 'ask reason 交给用户裁决')
}

for (const command of [
  'git commit -m x',
  'git push',
  'git push --force',
  'git rebase -i HEAD~3',
  'git merge feature',
  'git cherry-pick abc123',
  'git reset --hard HEAD~1',
  'git revert abc123',
  'git filter-branch -- --all',
]) {
  const decision = await decide(command)
  assert.notEqual(decision?.kind, 'deny', `不再产生 deny: ${command}`)
}

{
  const decision = await decide('git commit -m x && git push --force')
  assert.equal(decision?.kind, 'ask', '混合命令仍是 ask')
  assert.match(decision?.reason ?? '', /--force/, '混合命令优先提示破坏性操作')
  assert.deepEqual(Object.keys(decision).sort(), ['kind', 'reason'], '交出的决定只含 kind / reason（内部标记已剥掉）')
}

{
  const decision = await decide('git add .; git commit -m x; git reset --hard HEAD~1')
  assert.equal(decision?.kind, 'ask')
  assert.match(decision?.reason ?? '', /reset --hard/, '后续语句段里的破坏性操作仍优先提示')
}
{
  const decision = await decide('bash -c "git push --force"')
  assert.equal(decision?.kind, 'ask')
  assert.match(decision?.reason ?? '', /--force/, 'shell 负载内的破坏性操作同样优先提示')
}

for (const command of [
  'git status',
  'git log && echo done',
  'git add .',
  'git reset HEAD~1',
  'ls -la',
  'Get-ChildItem',
  'echo git commit',
]) {
  const decision = await decide(command)
  assert.equal(decision?.kind, 'allow', `allow: ${command}`)
  assert.equal(decision?.passthrough, true, `allow 由 next() 放行: ${command}`)
}

console.log('decision-matrix checks passed')
