/**
 * 判定矩阵:commit / push / checkout / 破坏性操作 / 底层改写与暂存栈操作都要求用户许可,混合与多语句命令优先
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

// tokenize 的引号 / 反斜杠 / `$'...'` 语义:这些写法仍须解析出 git 子命令,不能借词法绕开判定。
for (const command of [
  'git "push" --force',
  '"git" push',
  'git "push"',
  "'git' push",
  "git 'commit' -m x",
  "git $'push'",
  'git $"push"',
  'C:\\Git\\bin\\git.exe push --force',
  '& "C:\\Program Files\\Git\\cmd\\git.exe" push --force',
  '"C:\\Program Files\\Git\\bin\\git.exe" push',
]) {
  const decision = await decide(command)
  assert.equal(decision?.kind, 'ask', `ask(引号/路径): ${command}`)
  assert.match(decision?.reason ?? '', /许可/, 'ask reason 告知需用户许可')
}

// 反斜杠 + 换行做行续接:续接出来的 --force 仍按强推告警(LF 与 CRLF 都覆盖)。
for (const command of [
  'git push \\\n--force',
  'git push "--for\\\nce"',
  'git push "--for\\\r\nce"',
]) {
  const decision = await decide(command)
  assert.equal(decision?.kind, 'ask', `ask(行续接): ${command}`)
  assert.match(decision?.reason ?? '', /--force/, '行续接后的强推仍给出破坏性文案')
}

for (const command of [
  'git checkout main',
  'git checkout -b feature/x',
  'git checkout --quiet main',
  'git checkout --force main',
  'git checkout -f',
  'git checkout -- src/index.ts',
  'git checkout -- .',
  'git checkout .',
  'git add . && git checkout main',
  'sudo git checkout main',
  'bash -c "git checkout main"',
  'git -C /repo checkout main',
]) {
  const decision = await decide(command)
  assert.equal(decision?.kind, 'ask', `ask(checkout): ${command}`)
  assert.match(decision?.reason ?? '', /许可/, 'ask reason 告知检出需用户许可')
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

// 底层改写与暂存栈操作:commit-tree / update-ref / stash / restore 都可能绕过 commit 与
// checkout 的常规路径改写历史或覆盖工作区,一律要求用户许可;唯一例外是只动索引、不碰
// 工作区的 `git restore --staged`(见下面的放行用例)。
for (const command of [
  'git commit-tree HEAD^{tree} -m reworded',
  'git -C /repo commit-tree 4b825dc -m x',
  'git update-ref refs/heads/main abc123',
  'git update-ref -d refs/heads/tmp',
  'git update-ref --stdin',
  'git restore src/index.ts',
  'git restore --worktree src/index.ts',
  'git restore -W .',
  'git restore --source=HEAD~1 --worktree file.txt',
  'git stash',
  'git stash push -u -m wip',
  'git stash -q',
  'git stash save wip',
  'git stash pop',
  'git stash apply',
  'git stash drop',
  'git stash clear',
  'git stash branch wip',
  'git -C /repo stash',
  'bash -c "git stash pop"',
  'git commit -m x && git update-ref -d refs/heads/tmp',
]) {
  const decision = await decide(command)
  assert.equal(decision?.kind, 'ask', `ask(底层改写/暂存栈): ${command}`)
  assert.match(decision?.reason ?? '', /许可/, 'ask reason 告知需用户许可')
}

// switch:与 checkout 对齐,所有形态都 ask;带强切/重置分支旗标时文案更具体。
for (const command of [
  'git switch main',
  'git switch -c feature/x',
  'git switch --detach HEAD',
  'git switch -',
  'git switch --force main',
  'git switch -f main',
  'git switch --discard-changes feature',
  'git switch -C main',
  'git switch -fC main',
  'bash -c "git switch -f main"',
]) {
  const decision = await decide(command)
  assert.equal(decision?.kind, 'ask', `ask(switch): ${command}`)
  assert.match(decision?.reason ?? '', /许可/, 'ask reason 告知需用户许可')
}
for (const command of [
  'git switch --force main',
  'git switch -f main',
  'git switch --discard-changes feature',
  'git switch -C main',
  'git switch -fC main',
]) {
  const decision = await decide(command)
  assert.equal(decision?.kind, 'ask', `ask(switch 破坏性): ${command}`)
  assert.match(decision?.reason ?? '', /丢弃工作区|重置分支/, 'switch 强切文案说明会丢弃工作区改动或重置分支')
}

// clean:默认删除未跟踪文件,一律 ask;只有 dry-run 放行。
for (const command of [
  'git clean',
  'git clean -f',
  'git clean -fd',
  'git clean -xdf',
  'git clean --force -d',
  'git clean -enode_modules',
  'git clean -en',
  'git clean -e -n',
  'git clean --exclude node_modules',
  'git -C /repo clean -fd',
  'bash -c "git clean -fd"',
]) {
  const decision = await decide(command)
  assert.equal(decision?.kind, 'ask', `ask(clean): ${command}`)
  assert.match(decision?.reason ?? '', /删除未跟踪|许可/, 'clean 文案说明会删除未跟踪文件')
}

// pull:仅 rebase 形态 ask;普通 pull 不拦也不放行(原样交给 next)。
for (const command of [
  'git pull --rebase',
  'git pull --rebase=interactive origin main',
  'git pull -r',
  'git pull -r origin main',
  'git pull -ur origin main',
  'bash -c "git pull --rebase"',
]) {
  const decision = await decide(command)
  assert.equal(decision?.kind, 'ask', `ask(pull --rebase): ${command}`)
  assert.match(decision?.reason ?? '', /rebase/, 'pull 文案说明会 rebase')
  assert.match(decision?.reason ?? '', /历史/, 'pull 文案说明会改写本地提交历史')
}

// branch / tag:删除、强制移动与覆盖引用一律 ask。
for (const command of [
  'git branch -d old',
  'git branch -D old',
  'git branch --delete old',
  'git branch -f feature main',
  'git branch --force feature main',
  'git branch -M main',
  'git branch -Df feature',
]) {
  const decision = await decide(command)
  assert.equal(decision?.kind, 'ask', `ask(branch): ${command}`)
  assert.match(decision?.reason ?? '', /删除|改写|许可/, 'branch 文案说明会删除或改写分支引用')
}
for (const command of [
  'git tag -d v1',
  'git tag --delete v1',
  'git tag -f v1',
  'git tag --force v1',
  'git tag -df v1',
]) {
  const decision = await decide(command)
  assert.equal(decision?.kind, 'ask', `ask(tag): ${command}`)
  assert.match(decision?.reason ?? '', /标签/, 'tag 文案说明会删除或覆盖标签引用')
}

// worktree remove:移除工作树目录 ask;带 --force 时文案更具体。
for (const command of [
  'git worktree remove ../wt',
  'git worktree remove --force ../wt',
  'git worktree remove -f ../wt',
]) {
  const decision = await decide(command)
  assert.equal(decision?.kind, 'ask', `ask(worktree remove): ${command}`)
  assert.match(decision?.reason ?? '', /工作树/, 'worktree remove 文案说明会移除工作树')
}

// 新增子命令的 destructive 标记要在混合命令里胜出,让用户先看到更危险的文案。
for (const [command, pattern] of [
  ['git push && git pull --rebase', /rebase/],
  ['git checkout main && git switch -f main', /丢弃工作区|重置分支/],
  ['git commit -m x && git clean -fd', /删除未跟踪/],
  ['git commit -m x && git branch -D old', /删除|改写/],
  ['git commit -m x && git tag -d v1', /标签/],
  ['git push && git worktree remove -f ../wt', /强制删除/],
]) {
  const decision = await decide(command)
  assert.equal(decision?.kind, 'ask', `ask(混合高危子命令): ${command}`)
  assert.match(decision?.reason ?? '', pattern, `混合命令优先提示破坏性操作: ${command}`)
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
  'git checkout main',
  'git commit-tree HEAD^{tree} -m x',
  'git update-ref refs/heads/main abc123',
  'git stash',
  'git restore --staged .',
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
{
  const decision = await decide('git commit -m x && git checkout --force main')
  assert.equal(decision?.kind, 'ask', '普通操作与强切 checkout 混合仍是 ask')
  assert.match(decision?.reason ?? '', /覆盖工作区/, '强切 checkout 的文案优先于普通操作')
}
{
  const decision = await decide('git commit -m x && git stash drop')
  assert.equal(decision?.kind, 'ask', '提交与丢弃暂存栈混合仍是 ask')
  assert.match(decision?.reason ?? '', /stash drop/, '丢弃暂存栈的破坏性文案优先于普通提交')
}
{
  const decision = await decide('git restore --staged . && git stash drop')
  assert.equal(decision?.kind, 'ask', '放行的暂存区操作与丢弃暂存栈混合仍是 ask')
  assert.match(decision?.reason ?? '', /stash drop/, '优先级落在破坏性的 stash drop 上')
}

for (const command of [
  'git status',
  'git log && echo done',
  'git add .',
  'git reset HEAD~1',
  'git stash list',
  'git stash show -p',
  'git stash --help',
  'git pull',
  'git pull origin main',
  'git pull --ff-only',
  'git clean -n',
  'git clean --dry-run',
  'git clean -nd',
  'git clean -ndx',
  'git clean -fn',
  'git clean -e node_modules -n',
  'git branch',
  'git branch -a',
  'git branch -vv',
  'git branch new-branch',
  'git branch -m old new',
  'git tag',
  'git tag v1',
  'git tag -a v1 -m msg',
  'git tag -l "v*"',
  'git worktree list',
  'git worktree add ../wt',
  'git worktree prune',
  'git restore --staged src/index.ts',
  'git restore --staged .',
  'git restore -S .',
  'git restore --source=HEAD~1 --staged file.txt',
  'sudo git restore --staged .',
  'git add . && git restore --staged .',
  'ls -la',
  'Get-ChildItem',
  'echo git commit',
]) {
  const decision = await decide(command)
  assert.equal(decision?.kind, 'allow', `allow: ${command}`)
  assert.equal(decision?.passthrough, true, `allow 由 next() 放行: ${command}`)
}

console.log('decision-matrix checks passed')
