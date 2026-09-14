/**
 * dsh-git-guard — 拦截经由 shell 工具发起的 git 敏感操作。
 *
 * 策略：
 * - `git commit`            → ask（交给用户审批，批准后才执行）
 * - `git push`（非 force）   → ask（交给用户审批，批准后才执行）
 * - `git push --force` 等   → deny（强制推送会改写远程历史，直接禁止）
 * - `git rebase`            → deny（改写历史，禁止）
 * - `git merge`             → deny（改写历史，禁止）
 * - `git cherry-pick`       → deny（改写历史，禁止）
 * - `git reset --hard` 等   → deny（破坏性重置会丢失工作区改动，禁止）
 * - 其余                    → 放行（交给后续监听器 / 默认允许）
 *
 * 例外：**完全权限**（`danger-full-access`）下本插件完全退出——既不拦截
 * （deny 与 ask 都不产生），也不通过系统提示词要求模型征求用户授权。判定依据是
 * `ctx.sandboxPolicy.resolve({ session })` 解析出的「本次调用实际生效的文件沙箱
 * 模式」：GUI 的「完全权限」预设写下的正是 `sandbox/mode: danger-full-access`
 * （该预设的另一档 approval=never 不参与判定——子代理的 approval 一律被上游钉为
 * `never` 以自动拒绝需审批的操作，若据此放行会让子代理绕过全部护栏）。这也是
 * dsh-tool-bash 在同一个 exec 上的同形取数，于是「本插件是否介入」与「命令实际在
 * 什么沙箱下执行」读到同一份裁决。服务缺席、无 `resolve` 或解析抛错一律按
 * 「非完全权限」处理（失败关闭：继续拦截）。
 *
 * 运行于 `tools/pre-execute` 瀑布钩子，返回 {@link PreToolDecision}：
 * `{kind:'allow'}` | `{kind:'deny', reason}` | `{kind:'ask', reason?}`。
 *
 * 检测设计（分两层，取代旧的「仅 bash 工具名 + 正则切词」方案）：
 *
 * 1. 入口门禁与工具名解耦：不再以 `exec.name === 'bash'` 为条件，改为
 *    只要工具参数里出现非空字符串 `command` 即进入检测。每个 shell 工具
 *    （bash、pwsh、cmd、persistent 变体、未来的新工具）都把脚本放在
 *    `command`；对非 shell 工具（无 `command` 字段）直接放行。因为只有
 *    在真正命中 git 敏感子命令时才产生决定，先宽后紧不会造成误拦截。
 *
 * 2. 引号感知的词法分析 + git 调用扫描：不再用 `\s+` 切词与
 *    `&&|\|\||[;|\n]` 正则拆分，而是一次引号感知的 tokenizer（把
 *    `"a b"` / `'a b'` 视为一个 token），再递归识别 git 调用：
 *    - 语句段按引号外的 `;`、`&&`、`||`、`|`、换行切分；
 *    - 剥掉前导环境赋值（`VAR=x`，值可含引号空格）、包装词
 *      （`sudo`/`command`/`env`/`nohup`/`&` 等）、以及 `git`/`bash`
 *      等命令自身的前置选项；
 *    - 识别 `bash -c '...'` / `cmd /c ...` / `pwsh -Command ...` 的负载并递归；
 *    - 扫描 `$(git push)`、反引号等命令替换内容并递归；
 *    - 命中 `git` 后取第一个非选项 token 作为子命令，连同其后参数交给策略表。
 *
 * 除拦截外，本插件还会（通过 `ctx.systemPrompt`）向系统提示词注入一条
 * 「Git Guard 提交推送策略」区段，预先告知大模型：`git commit` 与
 * `git push` 均须获得用户许可后才能执行；破坏性历史改写操作
 * （rebase/merge/cherry-pick/reset --hard/push --force）被禁止；若用户拒绝
 * 了某次提交或推送，不得再次尝试提交或推送，也不得改换间接形式绕过。
 * 区段文本在每次组装时按该会话的权限模式求值：完全权限下返回空串，
 * 于是既无该区段、也无「须征求用户许可」的要求。
 *
 * 本文件由 Node 22 内置的 Type Stripping 直接加载（可擦除语法，无 enum/
 * 命名空间/参数属性），无需编译步骤；package.json 需保持 `"type": "module"`。
 */
import type { Context } from '@deepseek-ai/cordis'

/** `tools/pre-execute` 瀑布钩子的决定类型（与 dsh-tools 的 PreToolDecision 一致）。 */
type PreToolDecision =
  | { kind: 'allow' }
  | { kind: 'deny'; reason: string }
  | { kind: 'ask'; reason?: string }

/** 流水线传入的工具执行视图：只用到名称、（冻结的）参数与发起调用的 agent。 */
interface ToolExecutionView {
  readonly name: string
  readonly arguments?: unknown
  /** 代表其执行本次调用的 agent（由 agent loop 填入）；无 agent 的调用缺席。 */
  readonly agent?: AgentView
}

/** agent 视图：只需要其会话身份，用于解析该会话当前生效的权限。 */
interface AgentView {
  readonly session?: SessionRef
}

/** 会话身份：仅作为 `sandboxPolicy.resolve()` 的查询键透传，不依赖会话结构。 */
type SessionRef = unknown

/** shell 工具的参数形状：各 shell 工具（bash/pwsh/cmd）均把脚本放在 `command`。 */
interface ShellArguments {
  readonly command?: unknown
}

/** 文件沙箱模式（dsh-sandbox-policy 的闭集联合）。 */
type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access'

/**
 * `dsh-sandbox-policy` 服务的结构切片：只用 `resolve()`——沙箱策略的唯一所有者，
 * 按「会话覆盖 > 部署默认」解析出一次调用实际生效的模式。服务缺席时插件保持
 * 原有拦截行为（失败关闭），因此本切片不要求宿主一定提供该服务。
 */
interface SandboxPolicyService {
  resolve(request?: { readonly session?: SessionRef }): { readonly mode: SandboxMode }
}

/** 钩子链 continuation：放行给下一个监听器（链尾默认解析为 allow）。 */
type Next = () => Promise<PreToolDecision>

/**
 * `dsh-system-prompt` 服务的结构切片：只用 `section()`（注册有序区段）与
 * `getSectionOrder()`（解析仓库预留的区段排序槽位）。区段文本可以是静态字符串
 * 或「每次组装时求值」的提供者——后者让区段内容随当前会话的权限模式变化（完全
 * 权限下返回空串即不产生该区段）。按 DSH 插件惯用写法在本地声明，避免依赖
 * `@deepseek-ai/dsh-system-prompt` 包即可通过类型检查。
 */
interface SystemPromptService {
  section(section: {
    readonly name: string
    readonly order: number
    readonly text: string | ((context: AssembleContext) => string)
  }): () => void
  getSectionOrder(name: string): number
}

/**
 * 一次提示词组装的上下文切片：只需要 `agent`（由 agent loop 随 `scope` 一起填入，
 * 见 dsh-agent 的 `assembleContextFor`）——正是它让区段文本能按会话求值。
 */
interface AssembleContext {
  readonly agent?: AgentView
}

/** 注入系统提示词的「Git Guard 提交推送策略」区段内容（预先告知模型提交/推送及破坏性操作）。 */
const PUSH_POLICY_TEXT =
  '`git commit` 与 `git push` 均须获得用户许可后才能执行; ' +
  '破坏性历史改写与远程改写操作(如 `git rebase`、`git merge`、`git cherry-pick`、' +
  '`git reset --hard`、`git push --force`)被禁止, 未获明确指示不得执行. ' +
  '若用户拒绝了某次代码提交或代码推送, 请停止, 不得再次尝试提交或推送; ' +
  '也不要以命令替换、别名、脚本包装等任何间接形式绕过. ' +
  '如需继续, 请等待用户的明确指示.'

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * dsh-tools 的 `tools/pre-execute` 瀑布钩子：可扩展的 allow/deny/ask 门禁。
     *
     * 事件的权威定义在宿主内的 dsh-tools 里；此处按同形签名做本地声明合并，
     * 使插件不依赖 dsh-tools 包即可通过类型检查（DSH 插件的惯用写法）。
     * @mode waterfall
     */
    'tools/pre-execute'(
      exec: ToolExecutionView,
      next: Next,
    ): Promise<PreToolDecision> | PreToolDecision
  }

  interface Context {
    /** dsh-system-prompt 服务（运行时由宿主提供；此处仅做类型声明合并）。 */
    systemPrompt: SystemPromptService
    /**
     * dsh-sandbox-policy 服务（运行时由宿主提供；此处仅做类型声明合并）。
     * 只是为 `ctx.get('sandboxPolicy')` 提供类型，**不**声明为必需服务：
     * 插件用 `ctx.get` 机会式取用，缺席时照常拦截。
     */
    sandboxPolicy: SandboxPolicyService
  }
}

// ---------------------------------------------------------------------------
// 权限判定（完全权限 = 不拦截、不索取授权）
// ---------------------------------------------------------------------------

/** 完全权限档位：GUI「完全权限」预设写入的文件沙箱模式。 */
const FULL_ACCESS_MODE: SandboxMode = 'danger-full-access'

/**
 * 解析一次调用实际生效的文件沙箱模式（会话覆盖 > 部署默认），由沙箱策略服务
 * 裁决；服务不可用或解析失败一律返回 undefined（调用方据此失败关闭）。
 *
 * @param ctx - 插件上下文（服务经 `ctx.get` 机会式取用，无需 inject 声明）。
 * @param session - 本次调用所属会话；无 agent 的调用缺席，此时 resolve 回落到部署默认。
 */
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
    // 策略服务自身异常不得让钩子抛出（那会变成工具调用失败）：按未知模式处理。
    return undefined
  }
}

/**
 * 当前权限是否为「完全权限」：实际生效的文件沙箱模式为 `danger-full-access`。
 *
 * 只认沙箱模式，不认 approval 策略：上游把委派给子代理的 approval 一律钉为
 * `never`（自动拒绝一切需审批操作），若把 approval=never 也当作完全权限，
 * 子代理就会绕过本插件的全部护栏。
 *
 * @param ctx - 插件上下文。
 * @param session - 本次调用所属会话；缺席时只反映部署默认模式。
 */
function isFullAccess(ctx: Context, session: SessionRef | undefined): boolean {
  return effectiveSandboxMode(ctx, session) === FULL_ACCESS_MODE
}

// ---------------------------------------------------------------------------
// 词法分析
// ---------------------------------------------------------------------------

/**
 * 引号感知地把命令切成独立「语句段」：在引号外的 `;`、`&&`、`||`、`|`、
 * 换行处断开；单个 `&`（PowerShell 调用符 / bash 后台符）保留在段内。
 * 引号内的分隔符不会切段，如 `git commit -m "a;b"` 保持为一段。
 */
function splitSegments(command: string): string[] {
  const segments: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  const n = command.length
  let i = 0
  while (i < n) {
    const ch = command[i]!
    if (quote !== null) {
      // 双引号内允许反斜杠转义；单引号内反斜杠为字面量。
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
      // 处理 ||：两个竖线都作为分隔符一并消费。
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

/**
 * 引号感知地把一段命令切成 token：引号内容（`"a b"` / `'a b'`）合并为单个 token，
 * 反斜杠转义下一个字符，空白（引号外）作为 token 边界。未闭合引号不崩溃，
 * 剩余部分并入当前 token。
 */
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

/** 去掉 Windows 可执行文件后缀 `.exe`（大小写不敏感）。 */
function stripExe(token: string): string {
  return /\.exe$/i.test(token) ? token.slice(0, -4) : token
}

/** 判断 token 是否为 shell 解释器（`bash`/`sh`/`pwsh`/`cmd` 等，含 `.exe` 变体）。 */
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

/** 判断 token 是否为 git 可执行文件（`git`、`/usr/bin/git`、`C:\...\git.exe` 等）。 */
function isGitCommand(token: string): boolean {
  const name = stripExe(token).toLowerCase()
  return name === 'git' || name.endsWith('/git') || name.endsWith('\\git')
}

/** 前导环境变量赋值：`VAR=value`（值可为任意非序列内容，含引号空格）。 */
const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/

/** 直接作用于其后命令的包装词（不含 shell 解释器本身）。 */
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

/** 包装词后「带独立值」的选项（如 `sudo -u user`），值会被一并跳过。 */
const PREFIX_FLAGS_WITH_VALUE = new Set([
  '-u',
  '--user',
  '-g',
  '--group',
  '-p',
  '--prompt',
])

/**
 * 在一段 token 中定位「真正要执行的命令」的下标：先跳过前导环境赋值，再跳过
 * 包装词与其后带值选项，返回第一个既非包装词也非选项的 token 下标。
 *
 * 例：`sudo -u user git push` → 3；`VAR="a b" git push` → 1；`& git push` → 1。
 */
function findMainCommandIndex(tokens: string[]): number {
  let i = 0
  // 前导环境变量赋值：VAR=value（含带引号空格的 value）。
  while (i < tokens.length && ENV_ASSIGNMENT.test(tokens[i]!)) i += 1
  while (i < tokens.length) {
    const t = tokens[i]!
    if (WRAPPER_WORDS.has(t)) {
      i += 1
      continue
    }
    if (t.startsWith('-')) {
      // 已知带值选项跳过其值；未知选项保守不跳值，避免把第二个 token 误判为主命令。
      if (PREFIX_FLAGS_WITH_VALUE.has(t)) i += 2
      else i += 1
      continue
    }
    break
  }
  return i
}

/** git 全局选项中「带独立值」的项（如 `git -C path status`）。 */
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

/** 从 `git` 之后的 token 流里解析出子命令名与其余参数。 */
function gitSubcommandOf(
  tokens: string[],
  start: number,
): { subcommand: string; args: string[] } | undefined {
  let subIdx = -1
  for (let i = start; i < tokens.length; i += 1) {
    const tok = tokens[i]!
    if (tok.startsWith('-')) {
      // `git -C path` 这类带值选项连同值一起跳过；`--git-dir=path` 自含值。
      if (GIT_FLAGS_WITH_VALUE.has(tok) && i + 1 < tokens.length) i += 1
      continue
    }
    subIdx = i
    break
  }
  if (subIdx < 0) return undefined
  return { subcommand: tokens[subIdx]!, args: tokens.slice(subIdx + 1) }
}

/** 剥掉整段被成对括号/花括号包裹的部分：`( git push )` → `git push`。 */
function stripBalancedWrap(segment: string): string {
  let s = segment
  while (s.startsWith('(') && s.endsWith(')')) s = s.slice(1, -1).trim()
  while (s.startsWith('{') && s.endsWith('}')) s = s.slice(1, -1).trim()
  return s
}

/** 若该段是 shell 解释器带 `-c`/`/c`/`-Command` 的调用，返回其负载命令字符串。 */
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

/** 提取命令替换内容：`$(...)` 与反引号。 */
function extractSubstitutions(command: string): string[] {
  const out: string[] = []
  const dollarParen = /\$\(([^()]*)\)/g
  let match: RegExpExecArray | null
  while ((match = dollarParen.exec(command)) !== null) out.push(match[1]!)
  const backtick = /`([^`]*)`/g
  while ((match = backtick.exec(command)) !== null) out.push(match[1]!)
  return out
}

// ---------------------------------------------------------------------------
// 策略
// ---------------------------------------------------------------------------

/** `push` 的强制标志集：出现即 deny（改写远程历史）。 */
const FORCE_FLAGS = new Set(['--force', '-f', '--force-with-lease', '--force-if-includes'])

/** `reset` 的破坏性模式标志集：出现即 deny（可能丢失工作区改动）。 */
const RESET_DESTRUCTIVE = new Set(['--hard', '--merge', '--keep'])

/** 直接 deny 的子命令（历史改写 / 危险操作），理由给出禁止原因。 */
const DENY_SUBCOMMANDS: Record<string, string> = {
  rebase: 'git rebase 会改写提交历史, 已被 Git Guard 禁止. 请与用户确认后再执行.',
  merge: 'git merge 会改写提交历史, 已被 Git Guard 禁止. 请与用户确认后再执行.',
  'cherry-pick': 'git cherry-pick 会改写提交历史, 已被 Git Guard 禁止. 请与用户确认后再执行.',
  revert: 'git revert 操作已被 Git Guard 禁止. 请与用户确认后再执行.',
  am: 'git am 操作已被 Git Guard 禁止. 请与用户确认后再执行.',
  'filter-branch': 'git filter-branch 会改写历史, 已被 Git Guard 禁止. 请与用户确认后再执行.',
  'filter-repo': 'git filter-repo 会改写历史, 已被 Git Guard 禁止. 请与用户确认后再执行.',
}

/**
 * 对解析出的 git 子命令与参数求策略：deny 优先于 ask；未命中返回 undefined。
 * - `commit` → ask
 * - `push`（含 force 标志）→ deny，否则 ask
 * - `reset`（含破坏性模式）→ deny，普通 mixed/soft 放行
 * - 其余列入 DENY_SUBCOMMANDS → deny
 */
function decideGit(subcommand: string, args: string[]): PreToolDecision | undefined {
  if (subcommand === 'push') {
    if (args.some(flag => FORCE_FLAGS.has(flag))) {
      return {
        kind: 'deny',
        reason: 'git push --force 等强制推送会改写远程历史, 已被 Git Guard 禁止. 请与用户确认后再执行.',
      }
    }
    return { kind: 'ask', reason: 'git push 需要你的许可。请审核后批准或拒绝.' }
  }
  if (subcommand === 'commit') {
    return { kind: 'ask', reason: 'git commit 需要你的许可。请审核后批准或拒绝.' }
  }
  if (subcommand === 'reset') {
    if (args.some(flag => RESET_DESTRUCTIVE.has(flag))) {
      return {
        kind: 'deny',
        reason: 'git reset --hard 等破坏性重置会丢失工作区改动, 已被 Git Guard 禁止. 请与用户确认后再执行.',
      }
    }
    return undefined
  }
  const denyReason = DENY_SUBCOMMANDS[subcommand]
  if (denyReason !== undefined) return { kind: 'deny', reason: denyReason }
  return undefined
}

/** 递归深度上限，防御 `bash -c "bash -c ..."` 与嵌套命令替换。 */
const MAX_DEPTH = 5

/** 对单个语句段求策略。 */
function decideSegment(segment: string, depth: number): PreToolDecision | undefined {
  const stripped = stripBalancedWrap(segment.trim())
  if (stripped.length === 0) return undefined
  const tokens = tokenize(stripped)
  if (tokens.length === 0) return undefined

  const mainIdx = findMainCommandIndex(tokens)
  if (mainIdx >= tokens.length) return undefined
  const main = tokens[mainIdx]!

  // shell 解释器：`bash -c '…'` / `cmd /c …` / `pwsh -Command …` → 递归其负载。
  if (isShellCommand(main)) {
    const payload = shellPayload(tokens, mainIdx)
    if (payload === undefined) return undefined
    return decide(payload, depth + 1)
  }

  // 非 git 可执行：放行（例如 `echo git commit` 不会被误判）。
  if (!isGitCommand(main)) return undefined

  const found = gitSubcommandOf(tokens, mainIdx + 1)
  if (found === undefined) return undefined
  return decideGit(found.subcommand, found.args)
}

/**
 * 对整个命令求策略：deny 优先于 ask。先递归扫描命令替换内容，再逐段审查；
 * shell `-c` 包装在 decideSegment 内解包后递归。
 */
function decide(command: string, depth = 0): PreToolDecision | undefined {
  if (depth > MAX_DEPTH) return undefined
  let askDecision: PreToolDecision | undefined
  for (const inner of extractSubstitutions(command)) {
    const decision = decide(inner, depth + 1)
    if (decision?.kind === 'deny') return decision
    askDecision ??= decision
  }
  for (const segment of splitSegments(command)) {
    const decision = decideSegment(segment, depth)
    if (decision?.kind === 'deny') return decision
    askDecision ??= decision
  }
  return askDecision
}

export const name = 'dsh-git-guard'

export function apply(ctx: Context): void {
  // 向系统的提示词组装注入「推送策略」区段：这是常驻声明，每次组装系统提示词时
  // 求值一次（order 位于部署策略槽位 TEAM_POLICY，紧跟 PLAN_POLICY 之后、
  // 各工具说明之前）。文本按当次组装所属会话的权限模式求值：完全权限返回空串，
  // 于是该区段整体缺席——插件不再向模型提出任何授权要求。
  // 若宿主未提供 systemPrompt 服务，inject 永不回调，拦截逻辑不受影响。
  ctx.inject(['systemPrompt'], promptCtx => {
    promptCtx.systemPrompt.section({
      name: 'git-guard:push-policy',
      order: promptCtx.systemPrompt.getSectionOrder('TEAM_POLICY'),
      text: assembleContext =>
        isFullAccess(promptCtx, assembleContext.agent?.session) ? '' : PUSH_POLICY_TEXT,
    })
  })

  ctx.on('tools/pre-execute', (exec: ToolExecutionView, next: Next) => {
    // 门禁与工具名解耦：只要参数里有非空字符串 `command`（各 shell 工具的
    // 统一字段）即进入检测；否则放行。这使得 bash / pwsh / cmd 乃至未来的
    // shell 工具都被覆盖，且不因工具名变化而失效。
    const args = exec.arguments as ShellArguments | undefined
    const command = typeof args?.command === 'string' ? args.command : undefined
    if (command === undefined || command.trim().length === 0) return next()
    // 先算决定再判权限：绝大多数命令（git status / ls …）本就不产生决定，
    // 无需为它们解析权限。只有本插件将要介入时才问一次当前权限。
    const decision = decide(command)
    if (decision === undefined) return next()
    // 完全权限（danger-full-access）：本插件完全退出——deny 与 ask 都不产生，
    // 既不做任何拦截，也不要求用户授权；后续监听器（若有）照常收到链上请求。
    if (isFullAccess(ctx, exec.agent?.session)) return next()
    return decision
  })
}

export default { name, apply }
