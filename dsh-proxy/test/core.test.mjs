/**
 * 内核链路：真实 xray 的配置验收与启停、假内核的失败回滚、geo 数据目录的传递。
 *
 * 真实 xray 的部分在找不到可执行文件时自动跳过（规则引擎不依赖内核）；
 * 假内核（`fixtures/fake-xray.mjs`）覆盖「-test 通过但启动失败」这种真实 xray
 * 很难稳定制造的分支。
 */

import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer as createNetServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildXrayConfig } from '../src/compile.ts'
import { CoreManager, probePort } from '../src/core.ts'
import { RingLog } from '../src/log.ts'
import { check, checkEqual, checkNotEqual, finish } from './helpers.mjs'
import { localSubprocess } from './local-subprocess.mjs'
import { curlThroughSocks, echoServer, findOnPath, freePorts } from './net-utils.mjs'

/** 一份测试用的 ResolvedConfig。 */
function resolvedConfig(overrides) {
  return {
    coreBinary: '',
    socksPort: 0,
    httpPort: 0,
    dataDir: '',
    geoDir: '',
    ...overrides,
  }
}

/** 建 CoreManager + 替身 Context；`capture` 可截获 spawn 规格。 */
function makeCore(config) {
  const runtime = localSubprocess()
  const spawned = []
  const originalSpawn = runtime.spawn.bind(runtime)
  runtime.spawn = (spec) => {
    spawned.push(spec)
    return originalSpawn(spec)
  }
  const log = new RingLog()
  const ctx = { subprocess: runtime }
  return { core: new CoreManager(ctx, config, log), log, spawned }
}

/* --------------------------------------------------------------- 节点与规则 */

const UUID = '11111111-2222-3333-4444-555555555555'
// xray x25519 生成的一对密钥里的公钥（公开信息，仅用于让 -test 通过）。
const REALITY_PUBLIC_KEY = '7CWtjRkHUsocr0XgYsehQeypTuCNVycKlOWwy5ZZYB0'

/** 一条覆盖全部匹配字段的规则集；真实 xray 必须接受它编译出的配置。 */
const geoRouting = {
  default: 'direct',
  rules: [
    { id: 'ads', match: { domain: ['geosite:category-ads-all'] }, out: 'block' },
    { id: 'cn', match: { domain: ['geosite:cn'], ip: ['geoip:cn'] }, out: 'direct' },
    {
      id: 'ai',
      match: { domain: ['domain:openai.com'], port: ['443', '1000-2000'], network: ['tcp', 'udp'], protocol: ['tls'], source: ['192.168.0.0/16'], inboundTag: ['socks'] },
      out: 'direct',
    },
    { id: 'off', enabled: false, match: { port: ['22'] }, out: 'direct' },
  ],
}

const protocolNodes = [
  { id: 'ss', name: 'ss', tag: 'ss', protocol: 'shadowsocks', server: 'example.com', port: 8388, method: 'aes-128-gcm', password: 'pw', addedAt: 0 },
  {
    id: 'vmess',
    name: 'vmess',
    tag: 'vmess',
    protocol: 'vmess',
    server: 'example.com',
    port: 443,
    uuid: UUID,
    alterId: 0,
    security: 'auto',
    tls: { mode: 'tls', serverName: 'example.com' },
    transport: { network: 'ws', path: '/ws', host: 'example.com' },
    addedAt: 0,
  },
  {
    id: 'vless',
    name: 'vless',
    tag: 'vless',
    protocol: 'vless',
    server: 'example.com',
    port: 443,
    uuid: UUID,
    tls: { mode: 'tls', serverName: 'example.com', alpn: ['h2', 'http/1.1'] },
    transport: { network: 'ws', path: '/ws', host: 'example.com' },
    addedAt: 0,
  },
  {
    id: 'reality',
    name: 'reality',
    tag: 'reality',
    protocol: 'vless',
    server: 'example.com',
    port: 443,
    uuid: UUID,
    flow: 'xtls-rprx-vision',
    tls: { mode: 'reality', serverName: 'www.example.com', fingerprint: 'chrome', publicKey: REALITY_PUBLIC_KEY, shortId: '01234567' },
    addedAt: 0,
  },
  {
    id: 'trojan',
    name: 'trojan',
    tag: 'trojan',
    protocol: 'trojan',
    server: 'example.com',
    port: 443,
    password: 'pw',
    tls: { mode: 'tls', serverName: 'example.com' },
    transport: { network: 'grpc', serviceName: 'svc' },
    addedAt: 0,
  },
]

/* --------------------------------------------------------------- 开始 */

const workDir = mkdtempSync(join(tmpdir(), 'dsh-proxy-core-'))
const xrayBinary = findOnPath('xray')

console.log('core: 端口探测')

const probePorts = await freePorts(1)
const closedPort = probePorts[0]
checkEqual(await probePort(closedPort), false, '没人监听时探测为 false')
const openServer = createNetServer((socket) => socket.destroy())
await new Promise((resolve) => openServer.listen(0, '127.0.0.1', resolve))
const openPort = openServer.address().port
checkEqual(await probePort(openPort), true, '有监听时探测为 true')
await new Promise((resolve) => openServer.close(resolve))

if (xrayBinary === null) {
  console.log('core: 跳过真实 xray（PATH 上没有 xray；可用 XRAY_BIN 指定）')
} else {
  console.log(`core: 真实 xray 配置验收（${xrayBinary}）`)
  const [socksPort, httpPort] = await freePorts(2)
  const dataDir = join(workDir, 'xray-real')
  const geoDir = join(workDir, 'xray-real-geo')
  mkdirSync(dataDir, { recursive: true })
  mkdirSync(geoDir, { recursive: true })
  const { core, log } = makeCore(resolvedConfig({ coreBinary: xrayBinary, socksPort, httpPort, dataDir, geoDir }))

  const resolved = await core.resolveBinary()
  checkEqual(resolved.path, xrayBinary, 'resolveBinary 使用配置里的 coreBinary')
  checkEqual(resolved.source, 'config', '二进制来源标记为 config')
  check(typeof core.status().version === 'string' && /^\d/.test(core.status().version), `读到 xray 版本（${core.status().version}）`)

  for (const node of protocolNodes) {
    const built = buildXrayConfig({ routing: geoRouting, nodes: [node], selectedNode: node.id, socksPort, httpPort })
    const outcome = await core.test(built.config)
    check(outcome.ok, `xray -test 接受 ${node.tag} 的配置${outcome.ok ? '' : `：${outcome.output.slice(0, 400)}`}`)
  }

  const brokenRouting = {
    default: 'direct',
    rules: [{ id: 'ext', match: { domain: ['ext:__missing_for_test__.dat:tag'] }, out: 'direct' }],
  }
  const broken = buildXrayConfig({ routing: brokenRouting, nodes: [protocolNodes[0]], selectedNode: 'ss', socksPort, httpPort })
  const brokenResult = await core.test(broken.config)
  checkEqual(brokenResult.ok, false, 'xray -test 拒绝引用不存在 ext 文件的配置')
  check(brokenResult.output.includes('__missing_for_test__.dat'), '校验输出点名缺失的文件')

  console.log('core: 真实 xray 生命周期与数据面')
  const routing = {
    default: 'direct',
    rules: [{ id: 'ads', match: { domain: ['geosite:category-ads-all'] }, out: 'block' }],
  }
  const built = buildXrayConfig({ routing, nodes: [protocolNodes[0]], selectedNode: 'ss', socksPort, httpPort })
  const target = await echoServer('hello-through-xray')
  try {
    await core.start(built.config)
    checkEqual(core.status().state, 'running', '内核启动后状态为 running')
    checkEqual(await probePort(socksPort), true, 'SOCKS 端口已就绪')
    checkEqual(await probePort(httpPort), true, 'HTTP 端口已就绪')
    checkEqual(await curlThroughSocks(socksPort, target.port), 'hello-through-xray', '真实流量穿过 SOCKS 到达本机服务')

    const next = buildXrayConfig({
      routing: { default: 'direct', rules: [{ id: 'corp', match: { domain: ['domain:corp.example'] }, out: 'direct' }] },
      nodes: [protocolNodes[0]],
      selectedNode: 'ss',
      socksPort,
      httpPort,
    })
    const applied = await core.apply(next.config)
    checkEqual(applied.applied, true, 'apply 一份合法配置成功')
    checkEqual(applied.tested, true, 'apply 先过了 -test')
    checkEqual(core.status().state, 'running', 'apply 后内核仍在运行')
    checkEqual(await curlThroughSocks(socksPort, target.port), 'hello-through-xray', 'apply 后流量仍然可用')

    const rejected = buildXrayConfig({ routing: brokenRouting, nodes: [protocolNodes[0]], selectedNode: 'ss', socksPort, httpPort })
    const bad = await core.apply(rejected.config)
    checkEqual(bad.applied, false, 'apply 一份坏配置被拒绝')
    checkEqual(bad.tested, false, '-test 阶段就失败')
    check(typeof bad.error === 'string' && bad.error.length > 0, '拒绝时带 xray 的错误输出')
    checkEqual(core.status().state, 'running', '拒绝后内核保持运行')
    checkEqual(await curlThroughSocks(socksPort, target.port), 'hello-through-xray', '拒绝后流量仍然可用')
  } finally {
    await target.close()
    await core.stop()
  }
  checkEqual(core.status().state, 'stopped', 'stop 后状态为 stopped')

  console.log('core: geo 数据目录传给内核')
  const geoProbeDir = join(workDir, 'geo-probe')
  const geoDataDir = join(workDir, 'geo-data')
  mkdirSync(geoProbeDir, { recursive: true })
  mkdirSync(geoDataDir, { recursive: true })
  const { core: geoCore, spawned } = makeCore(
    resolvedConfig({ coreBinary: xrayBinary, socksPort, httpPort, dataDir: geoDataDir, geoDir: geoProbeDir }),
  )
  const geoBuilt = buildXrayConfig({ routing: { default: 'direct', rules: [] }, nodes: [], selectedNode: null, socksPort, httpPort })
  // 先预热二进制定位，避免把 `xray version` 的 spawn 混进断言。
  await geoCore.resolveBinary()
  spawned.length = 0
  await geoCore.test(geoBuilt.config)
  const emptySpec = spawned.find((spec) => spec.argv.includes('-test'))
  check(emptySpec !== undefined && emptySpec.env === undefined, 'geo 目录没有数据时不覆盖内核的 asset 路径')
  writeFileSync(join(geoProbeDir, 'geosite.dat'), '')
  spawned.length = 0
  await geoCore.test(geoBuilt.config)
  const geoSpec = spawned.find((spec) => spec.argv.includes('-test'))
  checkEqual(geoSpec?.env?.XRAY_LOCATION_ASSET, geoProbeDir, 'geo 目录有 .dat 时通过环境变量指给内核')
}

console.log('core: 假内核的失败与回滚')

const fakeBinary = join(workDir, 'fake-xray')
copyFileSync(new URL('./fixtures/fake-xray.mjs', import.meta.url), fakeBinary)
chmodSync(fakeBinary, 0o755)
const [fakeSocks, fakeHttp] = await freePorts(2)
const fakeDataDir = join(workDir, 'fake-data')
const fakeGeoDir = join(workDir, 'fake-geo')
mkdirSync(fakeDataDir, { recursive: true })
mkdirSync(fakeGeoDir, { recursive: true })
const fakeConfig = resolvedConfig({ coreBinary: fakeBinary, socksPort: fakeSocks, httpPort: fakeHttp, dataDir: fakeDataDir, geoDir: fakeGeoDir })
const { core: fakeCore, log: fakeLog } = makeCore(fakeConfig)

const first = buildXrayConfig({ routing: { default: 'direct', rules: [] }, nodes: [], selectedNode: null, socksPort: fakeSocks, httpPort: fakeHttp })
const second = buildXrayConfig({
  routing: { default: 'direct', rules: [{ id: 'corp', match: { domain: ['domain:corp.example'] }, out: 'direct' }] },
  nodes: [],
  selectedNode: null,
  socksPort: fakeSocks,
  httpPort: fakeHttp,
})
const failStart = buildXrayConfig({
  routing: { default: 'direct', rules: [] },
  nodes: [],
  selectedNode: null,
  socksPort: fakeSocks,
  httpPort: fakeHttp,
})
failStart.config.__fake = { failStart: true, reason: 'synthetic start failure' }
const failTest = buildXrayConfig({
  routing: { default: 'direct', rules: [] },
  nodes: [],
  selectedNode: null,
  socksPort: fakeSocks,
  httpPort: fakeHttp,
})
failTest.config.__fake = { failTest: true, reason: 'synthetic test failure' }

try {
  await fakeCore.start(first.config)
  checkEqual(fakeCore.status().state, 'running', '假内核启动成功')

  const applied = await fakeCore.apply(second.config)
  checkEqual(applied.applied, true, '假内核 apply 合法配置成功')

  const rolled = await fakeCore.apply(failStart.config)
  checkEqual(rolled.applied, false, '-test 通过但启动失败时 applied=false')
  checkEqual(rolled.rolledBack, true, '启动失败后回滚到上一份配置')
  checkEqual(fakeCore.status().state, 'running', '回滚后内核重新运行')
  checkEqual(await probePort(fakeSocks), true, '回滚后端口可用')
  const lastGood = JSON.parse(readFileSync(join(fakeDataDir, 'config.last-good.json'), 'utf8'))
  const lastGoodRules = JSON.stringify(lastGood.routing.rules)
  check(lastGoodRules.includes('domain:corp.example'), 'last-good 是回滚后仍在跑的那份配置')

  const tested = await fakeCore.apply(failTest.config)
  checkEqual(tested.applied, false, '-test 失败时 applied=false')
  checkEqual(tested.tested, false, '-test 失败时 tested=false')
  check(typeof tested.error === 'string' && tested.error.includes('synthetic test failure'), '-test 失败时返回内核输出')
  checkEqual(fakeCore.status().state, 'running', '-test 失败不会打断正在运行的内核')
} finally {
  await fakeCore.stop()
  rmSync(workDir, { recursive: true, force: true })
}

checkNotEqual(fakeLog.tailText(3), '', '日志里记录了内核动作')
finish('core')
