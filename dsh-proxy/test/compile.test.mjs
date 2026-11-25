/**
 * 语义检查与编译：出口存在性、geo 数据、ext 逃逸、顺序遮蔽、xray 字段映射。
 */

import { buildXrayConfig, compileRouting } from '../src/compile.ts'
import { checkSemantics, matchCovers } from '../src/ir.ts'
import { check, checkEqual, checkHasCode, checkNoError, finish } from './helpers.mjs'

const routing = {
  default: 'proxy',
  rules: [
    { id: 'ads', match: { domain: ['geosite:category-ads-all'] }, out: 'block' },
    { id: 'cn', match: { domain: ['geosite:cn'] }, out: 'direct' },
    { id: 'ai', match: { domain: ['geosite:openai'], port: ['443'], network: ['tcp', 'udp'] }, out: 'us' },
    { id: 'off', enabled: false, match: { port: ['22'] }, out: 'direct' },
  ],
}

const geoReady = { hasGeosite: true, hasGeoip: true, dir: '/geo', extFile: () => 'ok' }
const noGeo = { hasGeosite: false, hasGeoip: false, dir: '/geo' }

console.log('compile: 语义检查')

checkNoError(checkSemantics(routing, { exits: ['proxy', 'direct', 'block', 'us'], geo: geoReady }), '出口都存在时没有问题')
checkHasCode(checkSemantics(routing, { exits: ['proxy', 'direct', 'block'], geo: geoReady }), 'rule/exit-unknown', '引用不存在的出口')
checkHasCode(
  checkSemantics({ ...routing, default: 'nope' }, { exits: ['proxy', 'direct'], geo: geoReady }),
  'routing/exit-unknown',
  'default 指向不存在的出口',
)
const missingGeo = checkSemantics(routing, { exits: ['proxy', 'direct', 'block', 'us'], geo: noGeo })
checkHasCode(missingGeo, 'rule/geo-data-missing', '缺 geosite.dat 时给出提示')
checkNoError(missingGeo, '缺 geosite.dat 不阻止保存（真正的裁决是 xray -test）')
check(missingGeo.every((entry) => entry.severity === 'warning'), '缺 geo 数据的诊断都是 warning')
checkNoError(checkSemantics(routing, { exits: ['proxy', 'direct', 'block', 'us'], geo: geoReady }), 'geo 就位时不再报警')

const extRouting = { default: 'proxy', rules: [{ id: 'x', match: { domain: ['ext:custom.dat:tag'] }, out: 'direct' }] }
checkHasCode(
  checkSemantics(extRouting, { exits: ['proxy', 'direct'], geo: { ...geoReady, extFile: () => 'outside' } }),
  'rule/ext-path-escape',
  'ext: 指向数据目录之外被拒',
)
checkHasCode(
  checkSemantics(extRouting, { exits: ['proxy', 'direct'], geo: { ...geoReady, extFile: () => 'missing' } }),
  'rule/ext-file-missing',
  'ext: 文件不存在时警告',
)

const shadow = {
  default: 'proxy',
  rules: [
    { id: 'wide', match: { domain: ['geosite:ads'] }, out: 'block' },
    { id: 'narrow', match: { domain: ['geosite:ads'], port: ['443'] }, out: 'proxy' },
  ],
}
checkHasCode(checkSemantics(shadow, { exits: ['proxy', 'block'], geo: geoReady }), 'rule/unreachable', '被前序规则完全覆盖时警告')

const sameOut = {
  default: 'proxy',
  rules: [
    { id: 'wide', match: { domain: ['geosite:ads'] }, out: 'block' },
    { id: 'narrow', match: { domain: ['geosite:ads'], port: ['443'] }, out: 'block' },
  ],
}
check(
  !checkSemantics(sameOut, { exits: ['proxy', 'block'], geo: geoReady }).some((entry) => entry.code === 'rule/unreachable'),
  '同一个出口的覆盖不算遮蔽',
)

check(matchCovers({ port: ['80', '443'] }, { port: ['80'] }), '字面子集判定为覆盖')
check(!matchCovers({ port: ['80'] }, { port: ['80', '443'] }), '更宽的条件不被覆盖')
check(!matchCovers({ domain: ['geosite:cn'] }, { domain: ['domain:baidu.com'] }), 'geosite 不被判为覆盖具体域名')
check(!matchCovers({}, { port: ['80'] }), '空条件不声明覆盖')

console.log('compile: xray 字段映射')

const compiled = compileRouting(
  {
    default: 'proxy',
    rules: [
      { id: 'a', match: { port: ['80', '443', '1000-2000'], network: ['tcp', 'udp'] }, out: 'direct' },
      { id: 'b', match: { domain: ['geosite:cn'], ip: ['10.0.0.0/8'], protocol: ['tls'], source: ['192.168.0.0/16'], inboundTag: ['socks'] }, out: 'us' },
      { id: 'off', enabled: false, match: { port: ['22'] }, out: 'block' },
    ],
  },
  { nodes: [{ server: '1.2.3.4' }, { server: 'example.net' }], inboundTags: ['socks', 'http'] },
)

checkEqual(compiled.rules[0].ip, ['1.2.3.4'], '服务器 IP 注入为第一条直连规则')
checkEqual(compiled.rules[1].domain, ['full:example.net'], '服务器域名注入为 full: 值')
checkEqual(compiled.rules[2].domain, ['domain:push-apple.com.akadns.net', 'domain:push.apple.com'], 'Apple Push 直连规则')
checkEqual(compiled.rules[2].inboundTag, ['socks', 'http'], '注入规则限定在本插件的入站')
checkEqual(compiled.rules[3].port, '80,443,1000-2000', 'port 数组用逗号连接')
checkEqual(compiled.rules[3].network, 'tcp,udp', 'network 数组用逗号连接')
checkEqual(compiled.rules[4].protocol, ['tls'], 'protocol 保持数组')
checkEqual(compiled.rules[4].outboundTag, 'us', 'out 映射成 outboundTag')
checkEqual(compiled.rules[compiled.rules.length - 1], { type: 'field', network: 'tcp,udp', outboundTag: 'proxy' }, '末尾是默认出口规则（带匹配字段，xray 不接受裸 outboundTag）')
checkEqual(compiled.skipped.map((entry) => entry.id), ['off'], '禁用规则不进产物但记录在 skipped')
checkEqual(compiled.stats.enabled, 2, '统计启用的规则数')
check(!compiled.rules.some((rule) => rule.outboundTag === 'block'), '禁用规则没有进产物')

console.log('compile: 整份配置')

const config = buildXrayConfig({
  routing,
  nodes: [
    { id: 'n1', name: 'US', tag: 'us', protocol: 'shadowsocks', server: '1.2.3.4', port: 8388, method: 'aes-128-gcm', password: 'secret', addedAt: 0 },
    { id: 'n2', name: 'HK', tag: 'hk', protocol: 'trojan', server: 'example.net', port: 443, password: 'secret2', addedAt: 0 },
  ],
  selectedNode: 'n1',
  socksPort: 10808,
  httpPort: 10809,
})

checkEqual(config.inboundTags, ['socks', 'http'], '入站 tag')
checkEqual(config.config.inbounds.length, 2, '两个入站')
checkEqual(config.config.inbounds[0].listen, '127.0.0.1', '只监听回环')
checkEqual(config.config.inbounds[0].sniffing.enabled, true, '入站开启嗅探')
checkEqual(config.config.inbounds[0].port, 10808, 'SOCKS 端口')
checkEqual(config.config.routing.domainStrategy, 'IPIfNonMatch', '默认 domainStrategy')
checkEqual(config.config.outbounds.map((entry) => entry.tag), ['us', 'hk', 'proxy', 'direct', 'block'], '出口列表含选中节点别名 proxy')
checkEqual(config.config.outbounds[2].protocol, 'shadowsocks', 'proxy 别名复制选中节点的协议')
checkEqual(config.config.outbounds[3].protocol, 'freedom', 'direct 是 freedom')
checkEqual(config.config.outbounds[4].protocol, 'blackhole', 'block 是 blackhole')
checkEqual(config.warnings, [], '有选中节点时没有警告')

const noNode = buildXrayConfig({ routing, nodes: [], selectedNode: null, socksPort: 1, httpPort: 2 })
check(noNode.warnings.length === 1, '没有选中节点时给出警告')
check(!noNode.config.outbounds.some((entry) => entry.tag === 'proxy'), '没有选中节点时没有 proxy 出口')

finish('compile')
