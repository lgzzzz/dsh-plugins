/**
 * 节点：分享链接解析、订阅解码、出口生成、脱敏。
 */

import { assignIdentities, nodeLabel, outboundForNode, parseNodeUri, parseSubscription, redactNode } from '../src/nodes.ts'
import { check, checkEqual, finish } from './helpers.mjs'

const b64 = (text) => Buffer.from(text, 'utf8').toString('base64')

console.log('nodes: 分享链接')

const ss = parseNodeUri('ss://YWVzLTEyOC1nY206c2VjcmV0@1.2.3.4:8388#US%20node')
check(ss.ok, 'ss 链接解析成功')
checkEqual(ss.node?.protocol, 'shadowsocks', 'ss 协议')
checkEqual(ss.node?.method, 'aes-128-gcm', 'ss 加密方式')
checkEqual(ss.node?.password, 'secret', 'ss 密码')
checkEqual(ss.node?.port, 8388, 'ss 端口')
checkEqual(ss.node?.name, 'US node', 'ss 名字解码')

const ssLegacy = parseNodeUri(`ss://${b64('aes-128-gcm:secret@example.com:8389')}#legacy`)
check(ssLegacy.ok, '旧式整段 base64 的 ss 链接也能解析')
checkEqual(ssLegacy.node?.server, 'example.com', '旧式 ss 服务器')

const vmess = parseNodeUri(
  `vmess://${b64(
    JSON.stringify({ v: '2', ps: 'HK', add: 'hk.example', port: '443', id: 'uuid-1234', aid: '0', net: 'ws', path: '/ray', host: 'cdn.example', tls: 'tls', sni: 'hk.example' }),
  )}`,
)
check(vmess.ok, 'vmess 链接解析成功')
checkEqual(vmess.node?.uuid, 'uuid-1234', 'vmess uuid')
checkEqual(vmess.node?.transport?.network, 'ws', 'vmess ws 传输')
checkEqual(vmess.node?.transport?.path, '/ray', 'vmess ws path')
checkEqual(vmess.node?.tls?.mode, 'tls', 'vmess tls')

const vless = parseNodeUri('vless://uuid-5678@example.com:443?encryption=none&security=reality&sni=www.example.com&fp=chrome&pbk=abc&sid=dead&type=grpc&serviceName=svc#VLESS')
check(vless.ok, 'vless 链接解析成功')
checkEqual(vless.node?.uuid, 'uuid-5678', 'vless uuid')
checkEqual(vless.node?.tls?.mode, 'reality', 'vless reality')
checkEqual(vless.node?.tls?.publicKey, 'abc', 'vless reality 公钥')
checkEqual(vless.node?.transport?.serviceName, 'svc', 'vless grpc serviceName')

const trojan = parseNodeUri('trojan://pass123@example.com:443?sni=t.example.com#TROJAN')
check(trojan.ok, 'trojan 链接解析成功')
checkEqual(trojan.node?.password, 'pass123', 'trojan 密码')
checkEqual(trojan.node?.tls?.mode, 'tls', 'trojan 默认按参数读 tls')

const plainTrojan = parseNodeUri('trojan://pass123@example.com:8443#T')
check(plainTrojan.ok, '不带参数的 trojan 也能解析')

const unsupported = parseNodeUri('hysteria2://whatever@example.com:443')
check(!unsupported.ok, '不支持的协议被拒')
check(unsupported.reason.includes('不支持的协议'), '拒绝原因说明不支持')

const empty = parseNodeUri('')
check(!empty.ok, '空行被拒')

console.log('nodes: 订阅')

const subscriptionBody = [`ss://${b64('aes-128-gcm:pw@1.1.1.1:8388')}`, 'trojan://pw@2.2.2.2:443#T'].join('\n')
const parsed = parseSubscription(subscriptionBody)
checkEqual(parsed.nodes.length, 2, '逐行链接解析出两个节点')
checkEqual(parsed.errors.length, 0, '没有解析错误')

const encoded = parseSubscription(Buffer.from(subscriptionBody, 'utf8').toString('base64'))
checkEqual(encoded.nodes.length, 2, '整段 base64 订阅也能解析')

const mixed = parseSubscription(`ss://${b64('aes-128-gcm:pw@1.1.1.1:8388')}\n# comment\nhysteria2://x@y:443\n`)
checkEqual(mixed.nodes.length, 1, '注释与不支持的协议被跳过')
checkEqual(mixed.errors.length, 1, '不支持的协议记为错误')

console.log('nodes: 标识与出口')

const specs = parseSubscription(subscriptionBody).nodes
const nodes = assignIdentities(specs, [])
checkEqual(nodes.length, 2, '分配标识后仍是两个节点')
check(nodes[0].id.startsWith('sh-') && nodes[1].id.startsWith('tr-'), 'id 按协议前缀 + 哈希')
check(new Set(nodes.map((node) => node.tag)).size === 2, 'tag 互不冲突')

const again = assignIdentities(specs, nodes)
checkEqual(again.map((node) => node.id), nodes.map((node) => node.id), '重复导入得到同样的 id')
checkEqual(again.map((node) => node.tag), nodes.map((node) => node.tag), '重复导入保住原来的 tag')

const sameName = assignIdentities(
  [
    { name: 'US', protocol: 'trojan', server: 'a.example', port: 443, password: '1' },
    { name: 'US', protocol: 'trojan', server: 'b.example', port: 443, password: '2' },
  ],
  [],
)
checkEqual(sameName.map((node) => node.tag), ['us', 'us-2'], '同名节点自动加后缀')

const outbound = outboundForNode(nodes[0])
checkEqual(outbound.protocol, 'shadowsocks', 'ss 出口协议')
checkEqual(outbound.settings.servers[0].password, 'pw', '出口里带密码')
checkEqual(outbound.tag, nodes[0].tag, '出口 tag 默认取节点 tag')

const shadowOutbound = outboundForNode({ ...nodes[1], transport: { network: 'ws', path: '/ws', host: 'cdn.example' }, tls: { mode: 'tls', serverName: 'a.example', alpn: ['h2'] } })
checkEqual(shadowOutbound.streamSettings.network, 'ws', 'ws 传输写进 streamSettings')
checkEqual(shadowOutbound.streamSettings.security, 'tls', 'tls 写进 streamSettings')
checkEqual(shadowOutbound.streamSettings.wsSettings.headers.Host, 'cdn.example', 'ws Host 头')

console.log('nodes: 脱敏')

const redacted = redactNode(nodes[0])
checkEqual(redacted.password, undefined, '脱敏结果不含密码')
checkEqual(redacted.uuid, undefined, '脱敏结果不含 uuid')
check(JSON.stringify(redacted).includes(nodes[0].server), '脱敏结果仍保留服务器地址')

console.log('nodes: 展示名')

const named = { ...nodes[0], name: '🇭🇰 香港01', tag: 'hk-01' }
checkEqual(nodeLabel(named), '🇭🇰 香港01', '展示名取节点名字')
checkEqual(nodeLabel({ ...named, name: '' }), 'hk-01', '名字为空时退回出口名')
checkEqual(nodeLabel({ ...named, name: '   ' }), 'hk-01', '名字只有空白时退回出口名')
checkEqual(redactNode(named).label, '🇭🇰 香港01', '脱敏视图带展示名')
checkEqual(redactNode(named).tag, 'hk-01', '脱敏视图仍保留出口名')
checkEqual(redactNode(named).name, '🇭🇰 香港01', '脱敏视图保留原始名字')
checkEqual(outboundForNode(named).tag, 'hk-01', '内核 outbound tag 仍是出口名，不受名字影响')

finish('nodes')
