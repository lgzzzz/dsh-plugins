/** dsh-git-guard — shell 工具中的 git 敏感操作门禁: 挂 `tools/pre-execute`, 返回 allow/ask。
 * 敏感操作(commit、push 含 force、rebase / merge / cherry-pick / reset --hard / revert / am / filter-branch / filter-repo)一律 ask, 不产生 deny。
 * 约束另经 `ctx.systemPrompt.section()` 注入; 完全权限 `danger-full-access` 时不拦截且区段文本为空串。
 * 判定取 `ctx.sandboxPolicy.resolve({ session })`; 服务缺席 / 无 `resolve` / 抛错一律按非完全权限处理(失败关闭)。 */
import type { Context } from '@deepseek-ai/cordis'

/** `tools/pre-execute` 决定类型(同 dsh-tools 的 PreToolDecision); `deny` 仅为与宿主签名同形而保留, 本插件不产生. */
type PreToolDecision =
  | { kind: 'allow' }
  | { kind: 'deny'; reason: string }
  | { kind: 'ask'; reason?: string }

/** 工具执行视图: 只用到名称、参数与 agent. */
interface ToolExecutionView {
  readonly name: string
  readonly arguments?: unknown
  /** 发起本次调用的 agent; 无 agent 的调用缺席. */
  readonly agent?: AgentView
}

interface AgentView {
  readonly session?: SessionRef
}

/** 会话身份: 仅作 `sandboxPolicy.resolve()` 的查询键. */
type SessionRef = unknown

/** shell 工具参数: bash/pwsh/cmd 均把脚本放在 `command`. */
interface ShellArguments {
  readonly command?: unknown
}

/** 文件沙箱模式(dsh-sandbox-policy 闭集联合). */
type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access'

/** `dsh-sandbox-policy` 服务切片: 只用 `resolve()`; 服务缺席时照常索取授权(失败关闭). */
interface SandboxPolicyService {
  resolve(request?: { readonly session?: SessionRef }): { readonly mode: SandboxMode }
}

/** 钩子链 continuation: 放行给下一个监听器(链尾默认 allow). */
type Next = () => Promise<PreToolDecision>

/** `dsh-system-prompt` 服务切片: 只用 `section()` 与 `getSectionOrder()`. */
interface SystemPromptService {
  section(section: {
    readonly name: string
    readonly order: number
    readonly text: string | ((context: AssembleContext) => string)
  }): () => void
  getSectionOrder(name: string): number
}

/** 提示词组装的上下文切片: 只用 `agent`, 它让区段文本可按会话求值. */
interface AssembleContext {
  readonly agent?: AgentView
}

/** 注入系统提示词的提交推送策略区段文本. */
const PUSH_POLICY_TEXT =
  '`git commit` 与 `git push` 均须获得用户许可后才能执行; ' +
  '破坏性历史改写与远程改写操作(如 `git rebase`、`git merge`、`git cherry-pick`、' +
  '`git revert`、`git reset --hard`、`git push --force`)同样须先获得用户许可, ' +
  '未获明确许可不得执行; 这些操作会以授权请求的形式征求你的用户同意, 不得自行绕过. ' +
  '若用户拒绝了某次代码提交或代码推送, 请停止, 不得再次尝试提交或推送; ' +
  '也不要以命令替换、别名、脚本包装等任何间接形式绕过. ' +
  '如需继续, 请等待用户的明确指示.'

declare module '@deepseek-ai/cordis' {
  interface Events {
    /** `tools/pre-execute` 瀑布钩子(权威定义在宿主 dsh-tools, 此处同形声明合并). @mode waterfall */
    'tools/pre-execute'(
      exec: ToolExecutionView,
      next: Next,
    ): Promise<PreToolDecision> | PreToolDecision
  }

  interface Context {
    /** dsh-system-prompt 服务(运行时由宿主提供). */
    systemPrompt: SystemPromptService
    /** dsh-sandbox-policy 服务; 仅为 `ctx.get` 提供类型, 属机会式取用, 缺席时照常索取授权. */
    sandboxPolicy: SandboxPolicyService
  }
}

// --- 权限判定(完全权限 = 不拦截、不索取授权) ---

/** GUI「完全权限」预设写入的文件沙箱模式. */
const FULL_ACCESS_MODE: SandboxMode = 'danger-full-access'

/** 解析本次调用实际生效的沙箱模式; 服务不可用 / 解析失败返回 undefined(调用方失败关闭). */
function effectiveSandboxMode(
  ctx: Context,
  session: SessionRef | undefined,
): SandboxMode | undefined {
  const policy = ctx.get('sandboxPolicy')
  if (policy === undefined || policy === null) return undefined
  if (typeof policy.resolve !== 'function') return undefined
  try {
    return policy.resolve({ session })?.mode
  } catch {
    // 服务异常不得让钩子抛出(会变成工具调用失败).
    return undefined
  }
}

/** 是否完全权限: 只认沙箱模式, 不认 approval(子代理的 approval 恒为 never). */
function isFullAccess(ctx: Context, session: SessionRef | undefined): boolean {
  return effectiveSandboxMode(ctx, session) === FULL_ACCESS_MODE
}

// --- 词法分析 ---

/** 引号感知切段: 引号外的 `;`、`&&`、`||`、`|` 与换行断开, 单个 `&` 保留在段内. */
function splitSegments(command: string): string[] {
  const segments: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  const n = command.length
  let i = 0
  while (i < n) {
    const ch = command[i]!
    if (quote !== null) {
      // 只有双引号内反斜杠转义, 单引号内为字面量.
      if (ch === '\\' && quote === '"' && i + 1 < n) {
        current += ch + command[i + 1]!
        i += 2
        continue
      }
      current += ch
      if (ch === quote) quote = null
      i += 1
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      current += ch
      i += 1
      continue
    }
    if (ch === '\\' && i + 1 < n) {
      current += ch + command[i + 1]!
      i += 2
      continue
    }
    if (ch === ';' || ch === '\n') {
      if (current.trim().length > 0) segments.push(current)
      current = ''
      i += 1
      continue
    }
    if (ch === '&' && command[i + 1] === '&') {
      if (current.trim().length > 0) segments.push(current)
      current = ''
      i += 2
      continue
    }
    if (ch === '|') {
      if (current.trim().length > 0) segments.push(current)
      current = ''
      if (command[i + 1] === '|') i += 2
      else i += 1
      continue
    }
    current += ch
    i += 1
  }
  if (current.trim().length > 0) segments.push(current)
  return segments
}

/** 引号感知切词: 引号内空格算一个 token; 未闭合引号并入当前 token. */
function tokenize(command: string): string[] {
  const tokens: string[] = []
  let current = ''
  let hasCurrent = false
  let quote: '"' | "'" | null = null
  const n = command.length
  let i = 0
  while (i < n) {
    const ch = command[i]!
    if (quote !== null) {
      if (ch === '\\' && quote === '"' && i + 1 < n) {
        current += command[i + 1]!
        hasCurrent = true
        i += 2
        continue
      }
      current += ch
      hasCurrent = true
      if (ch === quote) quote = null
      i += 1
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      i += 1
      continue
    }
    if (ch === '\\' && i + 1 < n) {
      current += command[i + 1]!
      hasCurrent = true
      i += 2
      continue
    }
    if (/\s/.test(ch)) {
      if (hasCurrent) {
        tokens.push(current)
        current = ''
        hasCurrent = false
      }
      i += 1
      continue
    }
    current += ch
    hasCurrent = true
    i += 1
  }
  if (hasCurrent) tokens.push(current)
  return tokens
}

/** 去掉 Windows 可执行文件后缀 `.exe`(大小写不敏感). */
function stripExe(token: string): string {
  return /\.exe$/i.test(token) ? token.slice(0, -4) : token
}

/** 是否 shell 解释器(`bash`/`sh`/`pwsh`/`cmd` 等, 含 `.exe` 变体). */
function isShellCommand(token: string): boolean {
  const name = stripExe(token).toLowerCase()
  return (
    name === 'bash' ||
    name === 'sh' ||
    name === 'zsh' ||
    name === 'dash' ||
    name === 'ksh' ||
    name === 'pwsh' ||
    name === 'powershell' ||
    name === 'cmd' ||
    name === 'busybox'
  )
}

/** 是否 git 可执行文件(`git`、`/usr/bin/git`、`git.exe` 等). */
function isGitCommand(token: string): boolean {
  const name = stripExe(token).toLowerCase()
  return name === 'git' || name.endsWith('/git') || name.endsWith('\\git')
}

/** 前导环境变量赋值: `VAR=value`(值可含引号空格). */
const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/

/** 直接作用于其后命令的包装词(不含 shell 解释器). */
const WRAPPER_WORDS = new Set([
  'sudo',
  'doas',
  'command',
  'env',
  'nohup',
  'time',
  'nice',
  'stdbuf',
  'script',
  'builtin',
  'exec',
  '&',
])

/** 包装词后带独立值的选项(如 `sudo -u user`), 值一并跳过. */
const PREFIX_FLAGS_WITH_VALUE = new Set([
  '-u',
  '--user',
  '-g',
  '--group',
  '-p',
  '--prompt',
])

/** 定位真正要执行的命令下标: 跳过前导赋值、包装词与选项. */
function findMainCommandIndex(tokens: string[]): number {
  let i = 0
  while (i < tokens.length && ENV_ASSIGNMENT.test(tokens[i]!)) i += 1
  while (i < tokens.length) {
    const t = tokens[i]!
    if (WRAPPER_WORDS.has(t)) {
      i += 1
      continue
    }
    if (t.startsWith('-')) {
      // 未知选项不跳值, 免得把其值误判成主命令.
      if (PREFIX_FLAGS_WITH_VALUE.has(t)) i += 2
      else i += 1
      continue
    }
    break
  }
  return i
}

/** git 全局选项中带独立值的项(如 `git -C path`). */
const GIT_FLAGS_WITH_VALUE = new Set([
  '-C',
  '--git-dir',
  '--work-tree',
  '-c',
  '--config-env',
  '--namespace',
  '--exec-path',
  '--git-path',
])

/** 从 `git` 之后的 token 里解析子命令与其余参数. */
function gitSubcommandOf(
  tokens: string[],
  start: number,
): { subcommand: string; args: string[] } | undefined {
  let subIdx = -1
  for (let i = start; i < tokens.length; i += 1) {
    const tok = tokens[i]!
    if (tok.startsWith('-')) {
      if (GIT_FLAGS_WITH_VALUE.has(tok) && i + 1 < tokens.length) i += 1
      continue
    }
    subIdx = i
    break
  }
  if (subIdx < 0) return undefined
  return { subcommand: tokens[subIdx]!, args: tokens.slice(subIdx + 1) }
}

/** 剥掉整段成对包裹的括号 / 花括号: `( git push )` → `git push`. */
function stripBalancedWrap(segment: string): string {
  let s = segment
  while (s.startsWith('(') && s.endsWith(')')) s = s.slice(1, -1).trim()
  while (s.startsWith('{') && s.endsWith('}')) s = s.slice(1, -1).trim()
  return s
}

/** 若该段是 shell 解释器带 `-c`/`/c`/`-Command` 的调用, 返回其负载命令. */
function shellPayload(tokens: string[], mainIdx: number): string | undefined {
  for (let i = mainIdx + 1; i < tokens.length; i += 1) {
    const flag = tokens[i]!
    if (flag === '-c' || flag === '/c' || flag === '-Command' || flag === '--command') {
      const payloadTokens = tokens.slice(i + 1)
      if (payloadTokens.length === 0) return undefined
      return payloadTokens.join(' ')
    }
  }
  return undefined
}

/** 提取命令替换内容: `$(...)` 与反引号. */
function extractSubstitutions(command: string): string[] {
  const out: string[] = []
  const dollarParen = /\$\(([^()]*)\)/g
  let match: RegExpExecArray | null
  while ((match = dollarParen.exec(command)) !== null) out.push(match[1]!)
  const backtick = /`([^`]*)`/g
  while ((match = backtick.exec(command)) !== null) out.push(match[1]!)
  return out
}

// --- 策略: 一律向用户请求授权, 不产生 deny ---

/** `push` 的强制标志集: 出现即按「远程改写」措辞请求授权. */
const FORCE_FLAGS = new Set(['--force', '-f', '--force-with-lease', '--force-if-includes'])

/** `reset` 的破坏性模式标志集: 出现即按「破坏性重置」措辞请求授权. */
const RESET_DESTRUCTIVE = new Set(['--hard', '--merge', '--keep'])

/** 授权请求的统一尾句: 把决定权交回用户(批准或拒绝). */
const ASK_SUFFIX = '需要你的许可。请审核后批准或拒绝.'

/** 各敏感子命令的授权理由(历史改写 / 危险操作). */
const ASK_SUBCOMMANDS: Record<string, string> = {
  rebase: `git rebase 会改写提交历史, ${ASK_SUFFIX}`,
  merge: `git merge 会改写提交历史, ${ASK_SUFFIX}`,
  'cherry-pick': `git cherry-pick 会改写提交历史, ${ASK_SUFFIX}`,
  revert: `git revert 操作, ${ASK_SUFFIX}`,
  am: `git am 操作, ${ASK_SUFFIX}`,
  'filter-branch': `git filter-branch 会改写历史, ${ASK_SUFFIX}`,
  'filter-repo': `git filter-repo 会改写历史, ${ASK_SUFFIX}`,
}

/** 内部 ask 决定: 多带「破坏性」标记用于择优措辞; 宿主只看 kind / reason, 出口剥掉该标记. */
interface AskDecision {
  readonly kind: 'ask'
  readonly reason: string
  /** 破坏性历史改写 / 危险操作(措辞优先). */
  readonly destructive: boolean
}

/** 同一条命令里的多个敏感操作: 破坏性措辞优先, 同级取先命中者. */
function preferAsk(current: AskDecision | undefined, candidate: AskDecision | undefined): AskDecision | undefined {
  if (candidate === undefined) return current
  if (current === undefined) return candidate
  if (candidate.destructive && !current.destructive) return candidate
  return current
}

/** 对 git 子命令求策略: 命中敏感操作即请求用户授权, 未命中返回 undefined. */
function decideGit(subcommand: string, args: string[]): AskDecision | undefined {
  if (subcommand === 'push') {
    if (args.some(flag => FORCE_FLAGS.has(flag))) {
      return {
        kind: 'ask',
        reason: `git push --force 等强制推送会改写远程历史, ${ASK_SUFFIX}`,
        destructive: true,
      }
    }
    return { kind: 'ask', reason: `git push ${ASK_SUFFIX}`, destructive: false }
  }
  if (subcommand === 'commit') {
    return { kind: 'ask', reason: `git commit ${ASK_SUFFIX}`, destructive: false }
  }
  if (subcommand === 'reset') {
    if (args.some(flag => RESET_DESTRUCTIVE.has(flag))) {
      return {
        kind: 'ask',
        reason: `git reset --hard 等破坏性重置可能丢失工作区改动, ${ASK_SUFFIX}`,
        destructive: true,
      }
    }
    return undefined
  }
  const askReason = ASK_SUBCOMMANDS[subcommand]
  if (askReason !== undefined) return { kind: 'ask', reason: askReason, destructive: true }
  return undefined
}

/** 递归深度上限, 防 `bash -c "bash -c ..."` 与嵌套命令替换. */
const MAX_DEPTH = 5

function decideSegment(segment: string, depth: number): AskDecision | undefined {
  const stripped = stripBalancedWrap(segment.trim())
  if (stripped.length === 0) return undefined
  const tokens = tokenize(stripped)
  if (tokens.length === 0) return undefined

  const mainIdx = findMainCommandIndex(tokens)
  if (mainIdx >= tokens.length) return undefined
  const main = tokens[mainIdx]!

  // shell 包装: 解包其负载后递归.
  if (isShellCommand(main)) {
    const payload = shellPayload(tokens, mainIdx)
    if (payload === undefined) return undefined
    return decide(payload, depth + 1)
  }

  if (!isGitCommand(main)) return undefined

  const found = gitSubcommandOf(tokens, mainIdx + 1)
  if (found === undefined) return undefined
  return decideGit(found.subcommand, found.args)
}

/** 对整个命令求策略: 命令替换与各语句段递归审查, 多处命中时破坏性措辞优先. */
function decide(command: string, depth = 0): AskDecision | undefined {
  if (depth > MAX_DEPTH) return undefined
  let best: AskDecision | undefined
  for (const inner of extractSubstitutions(command)) {
    best = preferAsk(best, decide(inner, depth + 1))
  }
  for (const segment of splitSegments(command)) {
    best = preferAsk(best, decideSegment(segment, depth))
  }
  return best
}

export const name = 'dsh-git-guard'

export function apply(ctx: Context): void {
  // 常驻注入策略区段; 文本按当次会话权限求值, 完全权限下为空串.
  // systemPrompt 缺席时 inject 不回调, 拦截逻辑不受影响.
  ctx.inject(['systemPrompt'], promptCtx => {
    promptCtx.systemPrompt.section({
      name: 'git-guard:push-policy',
      order: promptCtx.systemPrompt.getSectionOrder('TEAM_POLICY'),
      text: assembleContext =>
        isFullAccess(promptCtx, assembleContext.agent?.session) ? '' : PUSH_POLICY_TEXT,
    })
  })

  ctx.on('tools/pre-execute', (exec: ToolExecutionView, next: Next) => {
    // 门禁与工具名解耦: 参数里有非空 `command` 即检测.
    const args = exec.arguments as ShellArguments | undefined
    const command = typeof args?.command === 'string' ? args.command : undefined
    if (command === undefined || command.trim().length === 0) return next()
    // 先算决定再查权限: 不产生决定的命令无需解析权限.
    const decision = decide(command)
    if (decision === undefined) return next()
    // 完全权限: 本插件整体退出, 授权请求不产生.
    if (isFullAccess(ctx, exec.agent?.session)) return next()
    // 剥掉内部标记, 只交出宿主的 ask 面; 落地由宿主裁决: approval=never 且非完全权限时确定性拒绝(非本插件 deny).
    return { kind: 'ask', reason: decision.reason }
  })
}

export default { name, apply }
