/**
 * dsh-git-guard 行为测试的共享装置。
 *
 * 这里只放与"测什么"无关的东西:原来的假 ctx(listeners / sections /
 * sessionModes / 权限开关 / requestedServices)、`guard.apply(ctx)` 装配、
 * `sectionText()` 与 `decide()`。原 test.mjs 是一条顶层脚本,可变状态按顺序
 * 共享;这里改成"每次调用返回一套全新场景"的工厂 `createHarness()`,各测试
 * 文件各自装配,互不影响:
 *
 *   node test/plugin-shape.test.mjs
 *
 * 跑全部请用 `node test/run-all.mjs`(或 pnpm test)。
 * 依赖 Node 22+ 的 Type Stripping 直接 import .ts。
 */
import guard from '../index.ts'

/** workspace-write 会话:默认模式下仍会介入。 */
export const workspaceSession = { id: 'session-workspace-write' }
/** danger-full-access 会话:插件完全放行(区段文本为空)。 */
export const fullAccessSession = { id: 'session-full-access' }

// ---------------------------------------------------------------- 假场景

/**
 * 装配一套全新的假 ctx 与插件实例,返回各部件与判定入口。
 *
 * @param {object} [options]
 * @param {(deps: string[]) => void} [options.onInject]
 *   每次 `ctx.inject` 时回调,供形状测试断言请求了 `systemPrompt` 服务;
 *   其余文件不传,避免同一断言在多份场景里重复计数。
 */
export function createHarness({ onInject } = {}) {
  const listeners = new Map()
  const sections = []
  const sessionModes = new Map()
  const requestedServices = []
  const state = {
    defaultMode: 'workspace-write',
    policyMounted: true,
    policyHasResolve: true,
    policyFails: false,
    resolveCalls: 0,
    lastResolvedSession: undefined,
  }
  sessionModes.set(fullAccessSession, 'danger-full-access')

  const ctx = {
    on(eventName, callback) {
      listeners.set(eventName, callback)
      return () => true
    },
    inject(deps, callback) {
      if (onInject !== undefined) onInject(deps)
      callback({
        systemPrompt: {
          section(section) {
            sections.push(section)
            return () => true
          },
          getSectionOrder(slotName) {
            return slotName === 'TEAM_POLICY' ? 600 : 0
          },
        },
        get: ctx.get,
      })
      return () => true
    },
    get(serviceName) {
      requestedServices.push(serviceName)
      if (serviceName !== 'sandboxPolicy' || !state.policyMounted) return undefined
      if (!state.policyHasResolve) return {}
      return {
        resolve(request = {}) {
          state.resolveCalls += 1
          state.lastResolvedSession = request.session
          if (state.policyFails) throw new Error('sandbox policy exploded')
          const session = request.session
          const override = session === undefined ? undefined : sessionModes.get(session)
          return { mode: override ?? state.defaultMode }
        },
      }
    },
  }

  guard.apply(ctx)
  const hook = listeners.get('tools/pre-execute')
  const [policySection] = sections

  function sectionText(session) {
    return policySection.text({ agent: session === undefined ? undefined : { session } })
  }

  function decide(command, options = {}) {
    const { toolName = 'pwsh', session } = options
    const exec = { name: toolName, arguments: { command } }
    if (session !== undefined) exec.agent = { session }
    return hook(exec, async () => ({ kind: 'allow', passthrough: true }))
  }

  return {
    ctx,
    hook,
    listeners,
    sections,
    policySection,
    sessionModes,
    requestedServices,
    state,
    sectionText,
    decide,
  }
}
