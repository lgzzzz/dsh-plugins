/**
 * 访问日志的纯逻辑测试：行解析、环形缓冲、查询与汇总。
 *
 * 样例全部取自真实 xray 26.11.9 的访问日志（见 src/access.ts 顶部注释），
 * 不依赖内核与文件系统。
 */

import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AccessLog, classifyOut, parseAccessLine, TRAFFIC_NOTE } from '../src/access.ts'
import { RingLog } from '../src/log.ts'
import { check, checkEqual, finish } from './helpers.mjs'

/** 造一个只用于查询的访问日志（不跟随文件）。 */
function makeAccess(options = {}) {
  return new AccessLog(new RingLog(), { path: '/tmp/dsh-proxy-access-test.log', enabled: true, ...options })
}

/** 查询时用的上下文。 */
function context(overrides = {}) {
  return { labels: {}, exits: ['proxy', 'direct', 'block', '01'], live: true, ...overrides }
}

/* --------------------------------------------------------------- 行格式 */

console.log('access: 行解析')

const tcp = parseAccessLine(
  '2026/11/26 09:32:47.495539 from tcp:127.0.0.1:56396 accepted tcp:127.0.0.1:18099 [socks -> direct]',
)
check(tcp !== null, 'TCP 行可解析')
checkEqual(tcp?.host, '127.0.0.1', 'TCP 目的 IP')
checkEqual(tcp?.port, 18099, 'TCP 目的端口')
checkEqual(tcp?.source, '127.0.0.1:56396', '来源去掉 tcp: 前缀')
checkEqual(tcp?.network, 'tcp', 'TCP 网络')
checkEqual(tcp?.inbound, 'socks', '入站 tag')
checkEqual(tcp?.out, 'direct', '出站 tag')
checkEqual(tcp?.proxyLabel, null, '解析结果不带节点快照')
checkEqual(tcp?.time, new Date(2026, 10, 26, 9, 32, 47, 495).getTime(), '毫秒精度时间')

const noFraction = parseAccessLine(
  '2026/11/26 09:32:47 from tcp:127.0.0.1:1 accepted tcp:example.com:443 [socks -> proxy]',
)
checkEqual(noFraction?.host, 'example.com', '域名目的')
checkEqual(noFraction?.port, 443, '域名目的端口')
checkEqual(noFraction?.time, new Date(2026, 10, 26, 9, 32, 47, 0).getTime(), '无小数秒按 0 毫秒')

const udp = parseAccessLine(
  '2026/11/26 09:34:54.691686 from udp:127.0.0.1:51067 accepted udp:127.0.0.1:18444 [socks -> proxy]',
)
checkEqual(udp?.network, 'udp', 'UDP 网络')
checkEqual(udp?.port, 18444, 'UDP 目的端口')

const v6 = parseAccessLine(
  '2026/11/26 09:36:34.633037 from tcp:127.0.0.1:56532 accepted tcp:[::1]:18099 [socks -> direct]',
)
checkEqual(v6?.host, '::1', 'IPv6 目的去掉方括号')
checkEqual(v6?.port, 18099, 'IPv6 目的端口')

const url = parseAccessLine(
  '2026/11/26 09:32:47.526721 from 127.0.0.1:56400 accepted http://localhost:18099/v1/chat?token=sekrit [http -> proxy]',
)
checkEqual(url?.host, 'localhost', '明文 HTTP URL 的主机')
checkEqual(url?.port, 18099, '明文 HTTP URL 的端口')
checkEqual(url?.path, '/v1/chat?***', '查询串被脱敏')
checkEqual(url?.inbound, 'http', 'HTTP 入站')
checkEqual(url?.network, 'tcp', 'URL 行没有网络前缀时按 tcp')

const connectUrl = parseAccessLine(
  '2026/11/26 09:36:34.554696 from 127.0.0.1:56527 accepted //localhost:18099 [http -> direct]',
)
checkEqual(connectUrl?.host, 'localhost', 'CONNECT 形式 //host:port 可解析')
checkEqual(connectUrl?.path, undefined, 'CONNECT 形式没有路径')

const userInfo = parseAccessLine(
  '2026/11/26 09:32:47.000000 from 127.0.0.1:1 accepted http://user:pass@example.com:80/x?q=1 [http -> direct]',
)
check(userInfo?.path === '/x?***', 'userinfo 被丢弃且查询串被脱敏')
check(!JSON.stringify(userInfo).includes('pass'), '解析结果不含 userinfo 密码')

const legacyArrow = parseAccessLine(
  '2026/11/26 09:32:47.000000 from tcp:127.0.0.1:1 accepted tcp:a.com:80 [socks >> proxy]',
)
checkEqual(legacyArrow?.out, 'proxy', '兼容旧式 >> 箭头')

checkEqual(parseAccessLine(''), null, '空行不可解析')
checkEqual(parseAccessLine('garbage'), null, '垃圾行不可解析')
checkEqual(
  parseAccessLine('2026/11/26 09:32:47.000000 from tcp:127.0.0.1:1 accepted tcp:a.com:80'),
  null,
  '缺少出站方括号的行不可解析',
)

checkEqual(classifyOut('proxy'), 'proxy', 'proxy 归类为代理')
checkEqual(classifyOut('01'), 'proxy', '节点 tag 归类为代理')
checkEqual(classifyOut('direct'), 'direct', 'direct 归类为直连')
checkEqual(classifyOut('block'), 'block', 'block 归类为拦截')
check(TRAFFIC_NOTE.includes('HTTPS'), '边界说明提到 HTTPS')

/* --------------------------------------------------------------- 环形缓冲 */

console.log('access: 环形缓冲')

const ring = makeAccess({ capacity: 3 })
const lineFor = (index, host, out = 'direct') =>
  `2026/11/26 09:32:47.0000${index} from tcp:127.0.0.1:${100 + index} accepted tcp:${host}:443 [socks -> ${out}]`

// 真实访问日志每行都以换行结尾；最后一行没有换行时实现会留在半行缓冲里（下面单独测）。
ring.ingest([
  lineFor(1, 'a.com'),
  lineFor(2, 'b.com'),
  '',
  lineFor(3, 'c.com'),
  lineFor(4, 'd.com'),
  lineFor(5, 'e.com'),
].join('\n') + '\n')
checkEqual(ring.stats().kept, 3, '容量为 3 时只保留最近 3 条')
checkEqual(ring.stats().dropped, 2, '超出的条数计入 dropped')
checkEqual(ring.query({}, context()).summary.matched, 3, '窗口里只剩 3 条')
checkEqual(ring.query({}, context()).entries[0]?.host, 'e.com', '最新在前')

const partial = makeAccess()
partial.ingest('2026/11/26 09:32:47.000000 from tcp:127.0.0.1:1 accepted tcp:partial.com:80 [socks -> direct]')
checkEqual(partial.query({}, context()).entries.length, 0, '没有换行时先留在半行缓冲里')
partial.ingest('\n')
checkEqual(partial.query({}, context()).entries[0]?.host, 'partial.com', '补齐换行后入队')

const broken = makeAccess()
broken.ingest('not a log line\n')
broken.ingest('another broken line\n')
checkEqual(broken.stats().parseErrors, 2, '畸形行计数')
checkEqual(broken.query({}, context()).entries.length, 0, '畸形行不进入结果')

/* --------------------------------------------------------------- 查询 */

console.log('access: 查询与汇总')

const access = makeAccess()
access.bindProxy('🇭🇰 香港01')
access.ingest([
  lineFor(1, 'api.openai.com', 'proxy'),
  lineFor(2, 'api.openai.com', 'proxy'),
  lineFor(3, 'www.example.com', 'direct'),
  lineFor(4, 'ads.example.com', 'block'),
  lineFor(5, '1.2.3.4', '01'),
].join('\n') + '\n')

const all = access.query({}, context())
checkEqual(all.summary.matched, 5, '不带过滤时命中全部')
checkEqual(all.entries.length, 5, 'limit 默认 50 足以放下 5 条')
checkEqual(all.summary.proxied, 3, '代理计数')
checkEqual(all.summary.direct, 1, '直连计数')
checkEqual(all.summary.blocked, 1, '拦截计数')
checkEqual(all.summary.byOut['proxy'], 2, '按出口统计 proxy')
checkEqual(all.summary.byOut['01'], 1, '按出口统计节点 tag')
checkEqual(all.entries[0]?.host, '1.2.3.4', '查询结果最新在前')
checkEqual(all.entries[0]?.verdict, 'proxy', '节点出口归一化为代理')
checkEqual(all.entries[0]?.outLabel, '01', '节点出口没有 label 时退回出口名')
check(all.warnings.length === 0, '合法参数没有 warning')

const byHost = access.query({ host: 'OPENAI' }, context())
checkEqual(byHost.summary.matched, 2, '域名子串大小写不敏感')
checkEqual(byHost.summary.proxied, 2, '命中项全是代理')
checkEqual(all.entries.find((entry) => entry.host === 'api.openai.com')?.outLabel, '🇭🇰 香港01', 'proxy 出口用入队时的节点名')

const byIp = access.query({ host: '1.2.3' }, context())
checkEqual(byIp.summary.matched, 1, 'IP 子串匹配')

const byVerdict = access.query({ verdict: 'block' }, context())
checkEqual(byVerdict.summary.matched, 1, '按分类过滤')
checkEqual(byVerdict.entries[0]?.host, 'ads.example.com', '拦截记录')

const byOut = access.query({ out: 'proxy' }, context())
checkEqual(byOut.summary.matched, 2, '按出口名精确过滤')

const unknownOut = access.query({ out: 'nope' }, context())
checkEqual(unknownOut.summary.matched, 0, '不存在的出口名没有命中')
checkEqual(unknownOut.warnings.length, 1, '不存在的出口名给出 warning')

const limited = access.query({ limit: 2 }, context())
checkEqual(limited.entries.length, 2, 'limit 限制返回条数')
checkEqual(limited.summary.matched, 5, 'summary 仍覆盖全部命中项')
checkEqual(limited.summary.first, all.summary.first, 'summary.first 取最早一条')
checkEqual(limited.summary.last, all.summary.last, 'summary.last 取最晚一条')

const clamped = access.query({ limit: 9999 }, context())
checkEqual(clamped.entries.length, 5, 'limit 超过上限被钳到 200，仍能放下 5 条')

const pathQuery = makeAccess()
pathQuery.ingest(
  '2026/11/26 09:32:47.000000 from 127.0.0.1:1 accepted http://example.com/v1/models?key=x [http -> direct]\n',
)
checkEqual(pathQuery.query({ host: '/v1/models' }, context()).summary.matched, 1, '路径子串可匹配（明文 HTTP）')

const offline = access.query({}, context({ live: false, reason: '内核未运行' }))
checkEqual(offline.live, false, 'live 透传')
checkEqual(offline.reason, '内核未运行', '原因透传')
checkEqual(offline.file, '/tmp/dsh-proxy-access-test.log', '文件路径透传')
checkEqual(offline.window.capacity, 1000, '默认容量')



/* --------------------------------------------------------------- 文件尾随 */

console.log('access: 文件尾随')

/** 轮询等待条件成立。 */
async function waitFor(predicate, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return true
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  return predicate()
}

const followDir = mkdtempSync(join(tmpdir(), 'dsh-proxy-access-'))
const followPath = join(followDir, 'access.log')
const followed = new AccessLog(new RingLog(), { path: followPath, enabled: true, pollMs: 20, fileCapBytes: 1024 })
try {
  writeFileSync(followPath, '')
  followed.prepare()
  followed.follow()

  appendFileSync(followPath, `${lineFor(1, 'follow.example.com')}\n${lineFor(2, 'second.example.com')}\n`)
  check(await waitFor(() => followed.query({}, context()).entries.length === 2), '尾随读到追加的两行')
  checkEqual(followed.query({}, context()).entries[0]?.host, 'second.example.com', '尾随结果最新在前')

  // 截断/重建：文件比已读偏移还小，应从头部重读。
  writeFileSync(followPath, '2026/11/26 09:32:47.000000 from tcp:127.0.0.1:1 accepted tcp:r.co:1 [socks -> direct]\n')
  check(
    await waitFor(() => followed.query({}, context()).entries.some((entry) => entry.host === 'r.co')),
    '文件被截断后从头部重读',
  )

  followed.unfollow()
  checkEqual(followed.stats().following, false, 'unfollow 后不再跟随')

  // 超过大小上限：prepare 直接截断，旧内容不再增长。
  writeFileSync(followPath, 'x'.repeat(2048))
  followed.prepare()
  checkEqual(readFileSync(followPath, 'utf8'), '', '超过上限时 prepare 截断文件')
} finally {
  followed.unfollow()
  rmSync(followDir, { recursive: true, force: true })
}

finish('访问日志')
