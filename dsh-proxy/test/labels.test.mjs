/**
 * 展示名兜底：出口名 → 名字的退让顺序，以及节点 `label` / `name` / `tag` 的三级退让。
 *
 * 这两条是「宿主半部与浏览器半部不同批更新」时的保险：字段缺席不能让面板渲染成空白，
 * 也不能把出口名（稳定标识）当成展示名以外的东西。
 */

import { exitLabel, exitText, nodeLabelOf, verdictOf, withChinaFlag } from '../src/ui/labels.ts'
import { checkEqual, finish } from './helpers.mjs'

console.log('labels: 出口展示名')

const labels = { 'hk-01': '🇭🇰 香港01', 'us-02': '美国 02', proxy: 'proxy' }

checkEqual(exitLabel('hk-01', labels), '🇭🇰 香港01', '有展示名时用展示名')
checkEqual(exitLabel('proxy', labels), 'proxy', '展示名与出口名相同时原样显示')
checkEqual(exitLabel('direct', labels), 'direct', '没有登记的内置出口原样显示')
checkEqual(exitLabel('hk-01'), 'hk-01', '没有标签表时退回出口名')
checkEqual(exitLabel('hk-01', { 'hk-01': '' }), 'hk-01', '空字符串的标签按缺席处理')

console.log('labels: 内置出口描述')

/** 测试用翻译函数。 */
const t = (key) => ({ 'exit.proxy': '代理', 'exit.direct': '直连', 'exit.block': '拦截' })[key] ?? key

checkEqual(exitText('proxy', labels, t), '代理', 'proxy 显示为代理')
checkEqual(exitText('direct', labels, t), '直连', 'direct 显示为直连')
checkEqual(exitText('block', labels, t), '拦截', 'block 显示为拦截')
checkEqual(exitText('hk-01', labels, t), '🇭🇰 香港01', '节点出口仍显示节点名字')
checkEqual(exitText('unknown', {}, t), 'unknown', '未知出口退回出口名')

console.log('labels: 规则出口归一化')

checkEqual(verdictOf('direct'), 'direct', 'direct 归为直连')
checkEqual(verdictOf('block'), 'block', 'block 归为拦截')
checkEqual(verdictOf('proxy'), 'proxy', 'proxy 归为代理')
checkEqual(verdictOf('hk-01'), 'proxy', '节点出口也算代理，行内出口列只显示策略')

console.log('labels: 节点展示名')

checkEqual(nodeLabelOf({ label: '🇭🇰 香港01', name: '香港01', tag: 'hk-01' }), '🇭🇰 香港01', '优先 label')
checkEqual(nodeLabelOf({ name: '香港01', tag: 'hk-01' }), '香港01', 'label 缺席时退回 name')
checkEqual(nodeLabelOf({ label: '', name: '香港01', tag: 'hk-01' }), '香港01', '空 label 按缺席处理')
checkEqual(nodeLabelOf({ tag: 'hk-01' }), 'hk-01', 'name 也缺席时退回 tag')
checkEqual(nodeLabelOf({ name: '', tag: 'hk-01' }), 'hk-01', '空 name 按缺席处理')

console.log('labels: 台湾旗帜')

checkEqual(withChinaFlag('🇹🇼 台湾01'), '🇨🇳 台湾01', '台湾旗帜换成中国国旗')
checkEqual(withChinaFlag('🇹🇼 台湾01 🇹🇼'), '🇨🇳 台湾01 🇨🇳', '出现多次时逐处替换')
checkEqual(withChinaFlag('🇭🇰 香港01'), '🇭🇰 香港01', '其他旗帜原样保留')
checkEqual(withChinaFlag('台湾01'), '台湾01', '没有旗帜的文本原样保留')
checkEqual(exitLabel('tw-01', { 'tw-01': '🇹🇼 台湾01' }), '🇨🇳 台湾01', '出口展示名同样替换')
checkEqual(nodeLabelOf({ name: '🇹🇼 台湾01', tag: '01-2' }), '🇨🇳 台湾01', '节点展示名同样替换')

finish('展示名兜底')
