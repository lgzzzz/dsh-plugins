/**
 * 测试共用的夹具：假 Workspace 注册表、假 ctx（事件总线 + effect + logger），以及等待插件
 * 异步收敛的 `settle()`。
 *
 * 假注册表复刻注册表的四条行为：DOM insertBefore 语义、锚点/来源缺失即抛错、顺序没变就不
 * 写盘，以及两种持久写入各自的 `domain/changed` 形状——重排写全局顺序单例（`table` 为 `''`），
 * attach / 改名等实体变更写工作区表（`table` 为 `workspaces`）。
 */

/** 一份注册表实体：插件只读 `id` 与 `sessionIds`。 */
export function ws(id, sessionIds = [], title = id, path = `C:\\work\\${id}`) {
  return { id, title, path, sessionIds: [...sessionIds] }
}

/** `session/created` 的载荷：插件读 `id` 与 `header.origin`。 */
export function sessionFixture(id, { origin, createdAt = Date.now(), cwd = 'C:\\work' } = {}) {
  return { id, header: { id, createdAt, cwd, ...(origin === undefined ? {} : { origin }) } }
}

/** 假 Workspace 注册表；`onChange` 给出时每次真实写入都把它交给调用方。 */
export class FakeRegistry {
  constructor(entities = [], onChange) {
    this.entities = new Map(entities.map((entity) => [entity.id, { ...entity, sessionIds: [...entity.sessionIds] }]))
    this.order = entities.map((entity) => entity.id)
    this.inserts = []
    this.onChange = onChange
    this.failInserts = false
  }

  list() {
    return this.order.map((id) => this.entities.get(id))
  }

  /** 是否拒绝这次重排：`true` 拒绝全部，数组只拒绝列出的工作区。 */
  refuses(id) {
    return this.failInserts === true || (Array.isArray(this.failInserts) && this.failInserts.includes(id))
  }

  /** DOM insertBefore 语义；顺序没变时不写盘、不发事件。 */
  async insertBefore(id, beforeId) {
    if (this.refuses(id)) throw new Error(`registry refused to move ${id}`)
    if (!this.order.includes(id)) throw new Error(`unknown workspace ${id}`)
    if (beforeId !== undefined && !this.order.includes(beforeId)) throw new Error(`unknown anchor ${beforeId}`)
    if (beforeId === id) return this.order
    const without = this.order.filter((value) => value !== id)
    const at = beforeId === undefined ? without.length : without.indexOf(beforeId)
    const next = [...without.slice(0, at), id, ...without.slice(at)]
    if (next.join('\u0000') === this.order.join('\u0000')) return this.order
    this.inserts.push(beforeId === undefined ? `${id}→末尾` : `${id}→${beforeId}前`)
    if (this.inserts.length > 32) throw new Error('reorder storm: 写入次数超出上限')
    this.order = next
    this.globalChanged()
    return this.order
  }

  /** 模拟 attach：把新会话插到工作区账最前。 */
  attach(id, sessionId) {
    const entity = this.entities.get(id)
    if (entity === undefined) throw new Error(`unknown workspace ${id}`)
    if (entity.sessionIds.includes(sessionId)) return
    this.entities.set(id, { ...entity, sessionIds: [sessionId, ...entity.sessionIds] })
    this.tableChanged(id)
  }

  /** 模拟 detach：把会话从工作区账下移除。 */
  detach(id, sessionId) {
    const entity = this.entities.get(id)
    if (entity === undefined) throw new Error(`unknown workspace ${id}`)
    this.entities.set(id, { ...entity, sessionIds: entity.sessionIds.filter((value) => value !== sessionId) })
    this.tableChanged(id)
  }

  /** 模拟改名：只改标题，但仍是一次工作区表写入。 */
  rename(id, title) {
    const entity = this.entities.get(id)
    if (entity === undefined) throw new Error(`unknown workspace ${id}`)
    this.entities.set(id, { ...entity, title })
    this.tableChanged(id)
  }

  /** 模拟新建工作区：注册表把新记录插到最前，然后发工作区表事件。 */
  add(entity) {
    this.entities.set(entity.id, { ...entity, sessionIds: [...entity.sessionIds] })
    this.order = [entity.id, ...this.order]
    this.tableChanged(entity.id)
  }

  /** 模拟删除工作区：先改顺序，再发表事件。 */
  remove(id) {
    this.entities.delete(id)
    this.order = this.order.filter((value) => value !== id)
    this.globalChanged()
  }

  /** 模拟手动拖拽：走 insertBefore，只写全局顺序单例。 */
  drag(id, beforeId) {
    return this.insertBefore(id, beforeId)
  }

  /** 工作区表的持久写入（attach / detach / 改名 / 新建）。 */
  tableChanged(id) {
    this.changed({ domain: 'workspace', table: 'workspaces', key: id, operation: 'put', value: this.entities.get(id) })
  }

  /** 全局顺序单例的持久写入（重排）。 */
  globalChanged() {
    this.changed({ domain: 'workspace', table: '', key: '', operation: 'put', value: { workspaceIds: [...this.order] } })
  }

  changed(change) {
    if (this.onChange !== undefined) this.onChange(change)
  }
}

/**
 * 装配一套全新的假 ctx 并挂载插件。
 * `entities` 是初始工作区实体；`insertFails` 为 `true` 时注册表拒绝全部重排，为数组时只拒绝列出的工作区。
 */
export function createHarness({ entities = [], insertFails = false } = {}) {
  const listeners = new Map()
  const disposers = []
  const logs = { info: [], debug: [], warn: [] }
  const emit = (event, ...args) => {
    for (const listener of listeners.get(event) ?? []) listener(...args)
  }
  const registry = new FakeRegistry(entities, (change) => emit('domain/changed', change))
  registry.failInserts = insertFails
  const ctx = {
    workspaceRegistry: registry,
    logger: {
      info: (message) => logs.info.push(String(message)),
      debug: (message) => logs.debug.push(String(message)),
      warn: (message) => logs.warn.push(String(message)),
      error: (message) => logs.warn.push(String(message)),
    },
    effect: (callback) => {
      const dispose = callback()
      if (typeof dispose === 'function') disposers.push(dispose)
      return dispose
    },
    on: (event, listener) => {
      const bucket = listeners.get(event) ?? []
      bucket.push(listener)
      listeners.set(event, bucket)
      return () => {}
    },
  }

  return {
    ctx,
    registry,
    logs,
    listeners,
    emit,
    /** 一条用户消息提交。 */
    activity: (sessionId) => emit('api-session/activity', sessionId, Date.now()),
    /** 会话被创建 / 被重新打开（resume 也走这一条）。 */
    created: (session) => emit('session/created', session),
    disposed: (session) => emit('session/disposed', session),
    apply: (plugin) => plugin.apply(ctx),
    dispose: () => {
      for (const dispose of disposers) dispose()
      disposers.length = 0
    },
  }
}

/** 让插件的异步收敛跑完（它不把 promise 交给调用方）。 */
export async function settle(rounds = 12) {
  for (let index = 0; index < rounds; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}
