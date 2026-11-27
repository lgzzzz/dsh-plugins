/**
 * 宿主半部的替身 Context：存储域、子进程、HTTP、工具注册都是假的，
 * 但插件真实的装配（`apply`）与业务代码路径不变。
 *
 * `host.test.mjs` 与 `e2e.test.mjs` 共用；后者传入真实的本地子进程运行时。
 */

function fakeDomain(spec) {
  let globalValue = spec.global.initial
  const tables = new Map()
  const table = (name) => {
    if (!tables.has(name)) tables.set(name, new Map())
    const records = tables.get(name)
    return {
      get: (key) => records.get(key),
      put: async (key, value) => {
        records.set(key, value)
      },
      delete: async (key) => records.delete(key),
      deleteMany: async (keys) => keys.filter((key) => records.delete(key)).length,
      update: async (key, fn) => {
        const next = fn(records.get(key))
        records.set(key, next)
        return next
      },
      entries: () => records.entries(),
      keys: () => records.keys(),
      get size() {
        return records.size
      },
    }
  }
  return {
    name: spec.name,
    global: { get: () => globalValue, set: async (value) => { globalValue = value } },
    table,
    close: async () => {},
  }
}

/**
 * 建一套跨多次 `open()` 复用的替身存储：同名域返回同一份数据，模拟真实存储在
 * 插件重载后仍然保留。`createFakeHost` 默认每次新建一套，测试要验证「重新加载」时
 * 显式传进来。
 */
export function createFakeStorageDomain() {
  const domains = new Map()
  return {
    async open(spec) {
      if (!domains.has(spec.name)) domains.set(spec.name, fakeDomain(spec))
      return domains.get(spec.name)
    },
  }
}

function makeRequest(method, url, body) {
  const handlers = { data: [], end: [], error: [] }
  const req = {
    method,
    url,
    headers: {},
    on(event, listener) {
      handlers[event]?.push(listener)
      return req
    },
  }
  queueMicrotask(() => {
    if (body !== undefined) {
      const text = Buffer.from(JSON.stringify(body))
      for (const listener of handlers.data) listener(text)
    }
    for (const listener of handlers.end) listener()
  })
  return req
}

function makeResponse() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(name, value) {
      this.headers[name] = value
    },
    end(text) {
      this.body = text ?? ''
    },
  }
}

/**
 * 建一套替身宿主。
 * @param options - `subprocess` 可替换成真实本地运行时；省略时任何进程操作都会抛错。
 *   `storageDomain` 可换成跨加载复用的替身存储（见 `createFakeStorageDomain`）。
 */
export function createFakeHost(options = {}) {
  const routes = []
  const tools = new Map()
  const toolOptions = new Map()
  const skills = []
  const disposers = []
  const listeners = new Map()
  const agents = new Map()
  const ctx = {
    // cordis 的 effect 会立刻执行回调并记住返回的 disposer。
    effect(callback) {
      disposers.push(callback())
    },
    // 只实现插件用到的 `emit` 形态：`ctx.on(name, listener)` 返回退订函数。
    on(name, listener) {
      if (!listeners.has(name)) listeners.set(name, new Set())
      listeners.get(name).add(listener)
      return () => listeners.get(name)?.delete(listener)
    },
    get(name) {
      return name === 'agents' ? agents : undefined
    },
    tools: {
      register(definition, registrationOptions) {
        tools.set(definition.name, definition)
        if (registrationOptions !== undefined) toolOptions.set(definition.name, registrationOptions)
        return () => {
          tools.delete(definition.name)
          toolOptions.delete(definition.name)
        }
      },
    },
    webServer: {
      register(route) {
        routes.push(route)
        return () => {}
      },
    },
    skills: {
      register(skill) {
        skills.push(skill)
        return () => {}
      },
    },
    storageDomain: options.storageDomain ?? createFakeStorageDomain(),
    subprocess: options.subprocess ?? {
      async resolveExecutable() {
        throw new Error('xray 不在 PATH 上')
      },
      spawn() {
        throw new Error('测试里不应该启动进程')
      },
    },
  }

  /** 打一次 `/proxy-api/*`，返回 { status, json }。 */
  const call = async (method, path, body) => {
    const route = routes[0]
    if (route === undefined) throw new Error('apply() 还没注册 /proxy-api')
    const res = makeResponse()
    await route.handler(makeRequest(method, `/proxy-api${path}`, body), res)
    return { status: res.statusCode, json: res.body === '' ? undefined : JSON.parse(res.body) }
  }

  /** 同步触发一个事件；监听器抛错时原样冒出来，和 cordis 的 emit 一样。 */
  const emit = (name, ...args) => {
    for (const listener of listeners.get(name) ?? []) listener(...args)
  }

  return { ctx, routes, tools, toolOptions, skills, disposers, listeners, agents, call, emit }
}
