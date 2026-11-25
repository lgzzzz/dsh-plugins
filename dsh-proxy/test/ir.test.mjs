/**
 * 规则形状校验：字段类型、枚举、数值、id、规模上限。
 */

import { applyRoutingPatch, moveRule, validateRoutingShape } from '../src/ir.ts'
import { check, checkEqual, checkHasCode, checkNoError, finish } from './helpers.mjs'

const valid = {
  default: 'proxy',
  rules: [
    { id: 'ads', name: '拦截广告', match: { domain: ['geosite:category-ads-all'] }, out: 'block' },
    { id: 'cn', match: { domain: ['geosite:cn'], ip: ['geoip:cn'] }, out: 'direct' },
    { id: 'alt', enabled: false, match: { port: ['8443', '9000-9100'], network: ['tcp'] }, out: 'proxy' },
    { id: 'r4', match: { domain: ['regexp:^ad\\.'], ip: ['10.0.0.0/8', '::1'], source: ['192.168.1.0/24'] }, out: 'block' },
  ],
}

console.log('ir: 形状校验')

checkNoError(validateRoutingShape(valid), '一份合法规则集应当没有问题')
checkEqual(validateRoutingShape(undefined).map((entry) => entry.code), ['routing/not-an-object'], 'undefined 不是规则集')
checkHasCode(validateRoutingShape({ ...valid, extra: 1 }), 'routing/unknown-field', '未知顶层字段被拒')
checkHasCode(validateRoutingShape({ rules: [] }), 'routing/default-invalid', '缺少 default')
checkHasCode(validateRoutingShape({ default: '  ', rules: [] }), 'routing/default-invalid', 'default 全是空白')
checkHasCode(validateRoutingShape({ default: 'proxy', rules: {} }), 'routing/rules-invalid', 'rules 不是数组')

const duplicate = {
  default: 'proxy',
  rules: [
    { id: 'a', match: { network: ['tcp'] }, out: 'proxy' },
    { id: 'a', match: { network: ['udp'] }, out: 'proxy' },
  ],
}
checkHasCode(validateRoutingShape(duplicate), 'rule/id-duplicate', '重复 id 被拒')

const badId = { default: 'proxy', rules: [{ id: 'Bad Id', match: { port: ['80'] }, out: 'proxy' }] }
checkHasCode(validateRoutingShape(badId), 'rule/id-invalid', '非法 id 被拒')

const missingId = { default: 'proxy', rules: [{ match: { port: ['80'] }, out: 'proxy' }] }
checkHasCode(validateRoutingShape(missingId), 'rule/id-missing', '缺少 id 被拒')

const emptyMatch = { default: 'proxy', rules: [{ id: 'x', match: {}, out: 'proxy' }] }
checkHasCode(validateRoutingShape(emptyMatch), 'rule/match-empty', '空 match 被拒')

const badNetwork = { default: 'proxy', rules: [{ id: 'x', match: { network: ['TCP'] }, out: 'proxy' }] }
const networkDiagnostics = validateRoutingShape(badNetwork)
checkHasCode(networkDiagnostics, 'rule/network-invalid', 'network 大写被拒')
checkEqual(networkDiagnostics[0].path, 'routing.rules[0].match.network[0]', '诊断指向具体数组项')

const badPort = { default: 'proxy', rules: [{ id: 'x', match: { port: ['0', '70000', 'abc', '900-100'] }, out: 'proxy' }] }
const portDiagnostics = validateRoutingShape(badPort).filter((entry) => entry.code === 'rule/port-invalid')
checkEqual(portDiagnostics.length, 4, '四个非法端口各报一条')

const badIp = { default: 'proxy', rules: [{ id: 'x', match: { ip: ['1.2.3.4/33', 'nope'] }, out: 'proxy' }] }
checkEqual(validateRoutingShape(badIp).filter((entry) => entry.code === 'rule/ip-invalid').length, 2, '两个非法 IP 各报一条')

const commaDomain = { default: 'proxy', rules: [{ id: 'x', match: { domain: ['a.com,b.com'] }, out: 'proxy' }] }
checkHasCode(validateRoutingShape(commaDomain), 'rule/domain-invalid', '域名里带逗号被拒')

const badProtocol = { default: 'proxy', rules: [{ id: 'x', match: { protocol: ['grpc'] }, out: 'proxy' }] }
checkHasCode(validateRoutingShape(badProtocol), 'rule/protocol-invalid', '未知 protocol 被拒')

const unknownMatchKey = { default: 'proxy', rules: [{ id: 'x', match: { user: ['a'] }, out: 'proxy' }] }
checkHasCode(validateRoutingShape(unknownMatchKey), 'rule/match-unknown-field', '未开放的匹配字段被拒')

const tooMany = { default: 'proxy', rules: Array.from({ length: 201 }, (_, index) => ({ id: `r${index}`, match: { port: ['80'] }, out: 'proxy' })) }
checkHasCode(validateRoutingShape(tooMany), 'routing/too-many-rules', '规则条数上限')

checkEqual(validateRoutingShape({ default: 'proxy', rules: [{ id: 'x', match: { port: [] }, out: 'proxy' }] }).map((entry) => entry.code), ['rule/condition-empty'], '空数组条件被拒')

console.log('ir: 增量补丁')

const base = {
  default: 'proxy',
  rules: [
    { id: 'a', match: { port: ['80'] }, out: 'direct' },
    { id: 'b', match: { port: ['443'] }, out: 'proxy' },
  ],
}
const replaced = applyRoutingPatch(base, { upsert: [{ id: 'a', match: { port: ['8080'] }, out: 'block' }] })
checkEqual(replaced.routing.rules.map((rule) => rule.id), ['a', 'b'], '就地替换不改变顺序')
checkEqual(replaced.routing.rules[0].out, 'block', '替换后的内容生效')
checkEqual(replaced.changes.replaced, ['a'], 'changes 记录替换')
checkEqual(replaced.changes.added, [], 'changes 不记录新增')

const appended = applyRoutingPatch(base, { upsert: [{ id: 'c', match: { port: ['22'] }, out: 'direct' }] })
checkEqual(appended.routing.rules.map((rule) => rule.id), ['a', 'b', 'c'], '新规则追加到末尾')
checkEqual(appended.changes.added, ['c'], 'changes 记录新增')

const deleted = applyRoutingPatch(base, { delete: ['a'] })
checkEqual(deleted.routing.rules.map((rule) => rule.id), ['b'], '删除按 id 生效')
checkEqual(deleted.changes.removed, ['a'], 'changes 记录删除')

const defaultChanged = applyRoutingPatch(base, { default: 'direct' })
checkEqual(defaultChanged.routing.default, 'direct', 'patch 可以改默认出口')
check(deleted.routing.rules !== base.rules && base.rules.length === 2, '补丁不修改原对象')

const moved = moveRule(base, 0, 1)
checkEqual(moved.rules.map((rule) => rule.id), ['b', 'a'], '移动规则改变顺序')
checkEqual(moveRule(base, 0, 9).rules.map((rule) => rule.id), ['a', 'b'], '越界移动原样返回')

finish('ir')
