/**
 * 测试共用的夹具：工作区快照、策略、忠实实现注册表 `insertBefore` 语义的假注册表，
 * 以及等待插件异步收敛的 `settle()`。
 *
 * 假注册表刻意复刻真注册表的四条行为：DOM insertBefore 语义、锚点/来源缺失即抛错、
 * 「顺序没变就一次写盘都不发生」，以及 `insertBefore` **不碰** 记录的 `updatedAt`
 * （真注册表的重排只写全局顺序单例）。最后一条是「按最近改动排序」不会自我追逐的原因，
 * 因此只有 `touch()` 模拟的实体变更才会推进 updatedAt。
 */

/** 一份注册表实体（只带插件读到的字段）。 */
export function ws(id, title, path = `C:\\work\\${id}`, createdAt = '2026-01-01T00:00:00.000Z', updatedAt = createdAt) {
  return { id, title, path, createdAt, updatedAt, sessionIds: [] }
}

/**
 * 测试用策略。默认给 `title-asc` 而不是插件默认值，好让这些用例专测机制：
 * 插件默认值由 cordis-integration 的「空配置」用例单独盯住。
 */
export function policy(overrides = {}) {
  return { order: 'title-asc', pinned: [], caseSensitive: false, ...overrides }
}

/**
 * 假 Workspace 注册表。
 *
 * `onChange` 给出时，每次真实写入把变更事件交给它（集成测试用它走真实的事件总线）；
 * 否则直接扇出给 `listeners`（假 ctx 用它模拟 domain/changed）。
 */
export class FakeRegistry {
  constructor(entries, onChange) {
    this.entities = new Map(entries.map((entry) => [entry.id, entry]))
    this.order = entries.map((entry) => entry.id)
    this.inserts = []
    this.listeners = []
    this.onChange = onChange
  }

  list() {
    return this.order.map((id) => this.entities.get(id))
  }

  /** DOM insertBefore 语义；刻意不写记录的 updatedAt（与真注册表一致）。 */
  async insertBefore(id, beforeId) {
    this.inserts.push(beforeId === undefined ? `${id}→末尾` : `${id}→${beforeId}前`)
    if (this.inserts.length > 64) throw new Error('reorder storm: 写入次数超出上限')
    if (!this.order.includes(id)) throw new Error(`unknown workspace ${id}`)
    if (beforeId !== undefined && !this.order.includes(beforeId)) throw new Error(`unknown anchor ${beforeId}`)
    if (beforeId === id) return this.order
    const without = this.order.filter((value) => value !== id)
    const at = beforeId === undefined ? without.length : without.indexOf(beforeId)
    const next = [...without.slice(0, at), id, ...without.slice(at)]
    if (next.join('\u0000') === this.order.join('\u0000')) return this.order
    this.order = next
    this.changed()
    return this.order
  }

  /** 模拟一次实体变更（改名 / 新会话落到该工作区）：推进 updatedAt 并发出事件。 */
  touch(id, updatedAt) {
    const entry = this.entities.get(id)
    if (entry === undefined) throw new Error(`unknown workspace ${id}`)
    this.entities.set(id, { ...entry, updatedAt })
    this.changed()
  }

  /** 模拟一次持久写入之后的 domain/changed。 */
  changed() {
    const change = { domain: 'workspace', table: '', key: '', operation: 'put', value: {} }
    if (this.onChange !== undefined) {
      this.onChange(change)
      return
    }
    for (const listener of this.listeners) listener(change)
  }

  /** 模拟新建工作区：注册表把新记录插到最前，然后发事件。 */
  add(entry) {
    this.entities.set(entry.id, entry)
    this.order = [entry.id, ...this.order]
    this.changed()
  }
}

/** 让插件的异步收敛跑完（它不把 promise 交给调用方）。 */
export async function settle(rounds = 12) {
  for (let index = 0; index < rounds; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}
