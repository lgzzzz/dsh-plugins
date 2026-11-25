/**
 * 仿真：确定命中、可能抢先、确定跳过、默认出口，以及各种值约定。
 */

import { explainFlow } from '../src/explain.ts'
import { check, checkEqual, finish } from './helpers.mjs'

const routing = {
  default: 'proxy',
  rules: [
    { id: 'ads', name: '拦截广告', match: { domain: ['geosite:category-ads-all'] }, out: 'block' },
    { id: 'cn-domain', name: '国内域名', match: { domain: ['domain:cn'] }, out: 'direct' },
    { id: 'corp', name: '公司内网', match: { domain: ['domain:corp.example'], port: ['443'] }, out: 'direct' },
    { id: 'ai', name: 'AI 走美国', match: { domain: ['domain:openai.com', 'domain:anthropic.com'] }, out: 'us' },
    { id: 'lan', name: '内网 IP', match: { ip: ['10.0.0.0/8', '192.168.0.0/16'] }, out: 'direct' },
    { id: 'off', name: '禁用', enabled: false, match: { domain: ['domain:disabled.example'] }, out: 'block' },
  ],
}

console.log('explain: 确定命中')

const openai = explainFlow(routing, { domain: 'api.openai.com', port: 443 })
checkEqual(openai.matched?.id, 'ai', 'api.openai.com 确定命中 ai')
checkEqual(openai.matched?.out, 'us', '出口是 us')
checkEqual(openai.matched?.position, 4, '命中位置是第 4 条')
checkEqual(openai.skipped.map((entry) => entry.id), ['cn-domain', 'corp'], '确定跳过的规则')
check(openai.skipped[0].reason.includes('domain:cn'), '跳过原因提到具体条件')
checkEqual(openai.uncertain.map((entry) => entry.id), ['ads'], '第一条 geosite 规则无法排除')
checkEqual(openai.uncertain[0].kind, 'opaque', '标成 opaque 而不是缺输入')
checkEqual(openai.certain, false, '有无法排除的规则时结论不是必然')
check(openai.warnings.some((line) => line.includes('可能抢先')), 'warnings 说明结论不是必然')

const corp = explainFlow(routing, { domain: 'intranet.corp.example', port: 443 })
checkEqual(corp.matched?.id, 'corp', '公司域名与端口同时命中')
checkEqual(corp.skipped.map((entry) => entry.id), ['cn-domain'], '公司域名跳过 cn-domain')
checkEqual(explainFlow(routing, { domain: 'intranet.corp.example', port: 8080 }).matched, null, '端口不符时不命中 corp')

console.log('explain: 值约定')

checkEqual(explainFlow(routing, { domain: 'a.cn' }).matched?.id, 'cn-domain', 'domain:cn 命中子域')
checkEqual(explainFlow(routing, { domain: 'cn' }).matched?.id, 'cn-domain', 'domain:cn 命中自身')
checkEqual(explainFlow(routing, { domain: 'notcn.example' }).matched, null, '不含 .cn 的不命中')
checkEqual(explainFlow(routing, { ip: '10.1.2.3' }).matched?.id, 'lan', '内网 IP 命中 lan')
checkEqual(explainFlow(routing, { ip: '8.8.8.8' }).matched, null, '公网 IP 不命中 lan')

const literals = {
  default: 'proxy',
  rules: [
    { id: 'full', match: { domain: ['full:exact.example'] }, out: 'direct' },
    { id: 'keyword', match: { domain: ['keyword:google'] }, out: 'block' },
    { id: 'plain', match: { domain: ['plain.example'] }, out: 'direct' },
    { id: 'regexp', match: { domain: ['regexp:^ad[0-9]+\\.'] }, out: 'block' },
  ],
}
checkEqual(explainFlow(literals, { domain: 'exact.example' }).matched?.id, 'full', 'full: 精确命中')
checkEqual(explainFlow(literals, { domain: 'sub.exact.example' }).matched, null, 'full: 不匹配子域')
checkEqual(explainFlow(literals, { domain: 'www.google.com' }).matched?.id, 'keyword', 'keyword: 命中子串')
checkEqual(explainFlow(literals, { domain: 'a.plain.example' }).matched?.id, 'plain', '裸字符串按子串匹配')
checkEqual(explainFlow(literals, { domain: 'ad12.example.com' }).matched?.id, 'regexp', 'regexp: 命中')

console.log('explain: 条件组合')

checkEqual(explainFlow({ default: 'proxy', rules: [{ id: 'net', match: { network: ['udp'] }, out: 'block' }] }, { domain: 'x.example', network: 'udp' }).matched?.id, 'net', 'network 条件命中')
checkEqual(explainFlow({ default: 'proxy', rules: [{ id: 'proto', match: { protocol: ['tls'] }, out: 'block' }] }, { domain: 'x.example', protocol: 'tls' }).matched?.id, 'proto', 'protocol 条件命中')
checkEqual(explainFlow({ default: 'proxy', rules: [{ id: 'port', match: { port: ['1000-2000'] }, out: 'block' }] }, { port: 1500 }).matched?.id, 'port', '端口区间命中')
checkEqual(explainFlow({ default: 'proxy', rules: [{ id: 'port', match: { port: ['1000-2000'] }, out: 'block' }] }, { port: 2001 }).matched, null, '端口区间不命中')

const andRule = { default: 'proxy', rules: [{ id: 'and', match: { domain: ['domain:a.example'], port: ['443'] }, out: 'block' }] }
checkEqual(explainFlow(andRule, { domain: 'x.a.example', port: 443 }).matched?.id, 'and', '不同字段之间是「且」')
checkEqual(explainFlow(andRule, { domain: 'x.a.example', port: 80 }).matched, null, '任一字段不匹配即整条不匹配')

const orRule = { default: 'proxy', rules: [{ id: 'or', match: { domain: ['domain:a.example', 'domain:b.example'] }, out: 'block' }] }
checkEqual(explainFlow(orRule, { domain: 'x.b.example' }).matched?.id, 'or', '同一字段内多个值是「或」')

console.log('explain: 无法排除与默认出口')

checkEqual(explainFlow(routing, { domain: 'disabled.example' }).matched, null, '禁用规则不参与仿真')
check(explainFlow(routing, { domain: 'disabled.example' }).uncertain.every((entry) => entry.id !== 'off'), '禁用规则不出现在可能命中里')

const fallback = explainFlow({ default: 'direct', rules: [] }, { domain: 'example.com' })
checkEqual(fallback.matched, null, '空规则集没有命中')
checkEqual(fallback.fallbackOut, 'direct', '空规则集用默认出口')
checkEqual(fallback.certain, false, '没有命中时结论不是「确定走了某条规则」')

const geoOnly = explainFlow({ default: 'proxy', rules: [{ id: 'geo', match: { domain: ['geosite:cn'] }, out: 'direct' }] }, { domain: 'a.cn' })
checkEqual(geoOnly.matched, null, '只有 geosite 条件时没有确定命中')
checkEqual(geoOnly.uncertain[0]?.id, 'geo', 'geosite 规则进入 uncertain')
checkEqual(geoOnly.uncertain[0]?.kind, 'opaque', 'geosite 是 opaque 而不是缺输入')

const noDomain = explainFlow({ default: 'proxy', rules: [{ id: 'need-domain', match: { domain: ['domain:a.example'] }, out: 'direct' }] }, { port: 443 })
checkEqual(noDomain.uncertain[0]?.kind, 'missing', '没给域名时属于缺输入')
check(noDomain.warnings.some((line) => line.includes('域名')), '提示缺少域名')

const asIs = explainFlow(
  { default: 'direct', rules: [{ id: 'ip-only', match: { ip: ['geoip:cn'] }, out: 'proxy' }] },
  { domain: 'example.cn', ip: '1.2.3.4' },
  { domainStrategy: 'AsIs' },
)
checkEqual(asIs.uncertain[0]?.kind, 'opaque', 'geoip 条件无法本地判定')
check(asIs.assumptions.some((line) => line.includes('AsIs')), '说明 domainStrategy 的影响')
check(asIs.assumptions.some((line) => line.includes('geoip')), '说明 geo 数据缺失')

finish('explain')
