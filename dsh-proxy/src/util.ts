/** 小工具：类型判定、克隆、地址与端口的解析。 */

/** 是否为普通对象（非 null、非数组）。 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 深拷贝；`undefined` 原样返回。 */
export function deepClone<T>(value: T): T {
  return value === undefined ? value : structuredClone(value)
}

/** 由名字生成 id / tag：小写 ASCII，非 ASCII 字符折成连字符。 */
export function slugify(name: unknown, fallback = 'item'): string {
  const slug = String(name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
  return slug === '' ? fallback : slug
}

/** `"80"` / `"1000-2000"` → 闭区间；其它形态 → undefined。 */
export function parsePortRange(value: unknown): { from: number; to: number } | undefined {
  const match = /^(\d{1,5})(?:-(\d{1,5}))?$/.exec(String(value).trim())
  if (match === null) return undefined
  const from = Number(match[1])
  const to = match[2] === undefined ? from : Number(match[2])
  if (from < 1 || to > 65535 || from > to) return undefined
  return { from, to }
}

/** IPv4 字面量 → 32 位整数；不是 IPv4 → undefined。 */
function parseIPv4(text: string): number | undefined {
  const parts = text.split('.')
  if (parts.length !== 4) return undefined
  let value = 0
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return undefined
    const byte = Number(part)
    if (byte > 255) return undefined
    value = value * 256 + byte
  }
  return value
}

/** 是否为 IPv4 / IPv6 字面量或带前缀长度的 CIDR。 */
export function isIpOrCidr(value: unknown): boolean {
  const text = String(value).trim()
  const slash = text.indexOf('/')
  const address = slash === -1 ? text : text.slice(0, slash)
  const v4 = parseIPv4(address)
  if (slash !== -1) {
    const prefix = Number(text.slice(slash + 1))
    if (!Number.isInteger(prefix) || prefix < 0) return false
    if (v4 !== undefined && prefix > 32) return false
    if (v4 === undefined && prefix > 128) return false
  }
  if (v4 !== undefined) return true
  return /^[0-9a-fA-F:]+$/.test(address) && address.includes(':') && address.length <= 45
}

/** IPv4 是否落在该 CIDR 内；非 IPv4 形态返回 undefined（不做猜测）。 */
export function ipInCidr(ip: unknown, cidr: unknown): boolean | undefined {
  const address = parseIPv4(String(ip).trim())
  if (address === undefined) return undefined
  const text = String(cidr).trim()
  const slash = text.indexOf('/')
  const network = parseIPv4(slash === -1 ? text : text.slice(0, slash))
  if (network === undefined) return undefined
  const prefix = slash === -1 ? 32 : Number(text.slice(slash + 1))
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return undefined
  if (prefix === 0) return true
  const mask = prefix === 32 ? 0xffffffff : (0xffffffff << (32 - prefix)) >>> 0
  return ((address & mask) >>> 0) === ((network & mask) >>> 0)
}

/** 按逗号 / 空白切分，去掉空项。 */
export function splitValues(text: unknown): string[] {
  return String(text ?? '')
    .split(/[\s,]+/)
    .map((part) => part.trim())
    .filter((part) => part !== '')
}

/** 截断文本用于诊断与日志。 */
export function clip(text: string, limit = 400): string {
  const value = String(text ?? '')
  return value.length <= limit ? value : `${value.slice(0, limit)}…`
}
