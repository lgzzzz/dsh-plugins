/**
 * 面板词条：中文表 `ZH` 定义键域，英文表 `EN` 按同一个键域声明 —— 少一个键或多一个键
 * 都会在类型检查期报错，避免中英表漂移后界面上漏出原始 key。
 *
 * 模板占位符形如 `{count}`，由 {@link fill} 替换。
 */

const ZH = {
  panel: '分流路由',
  'status.running': '运行中',
  'status.stopped': '未运行',
  'status.starting': '启动中',
  'status.error': '出错',
  'status.ports': 'SOCKS {socks} · HTTP {http}',
  'status.rules': '{count} 条规则',
  'status.nodes': '{count} 个节点',
  'status.binary': '内核',
  'status.binaryMissing': '未找到 xray',
  'action.start': '启动',
  'action.stop': '停止',
  'action.restart': '重启',
  'tab.rules': '规则',
  'tab.nodes': '节点',
  'tab.traffic': '连接',
  'tab.logs': '日志',
  'exit.proxy': '代理',
  'exit.direct': '直连',
  'exit.block': '拦截',
  'traffic.filterHost': '域名或 IP',
  'traffic.filterAll': '全部',
  'traffic.pause': '暂停',
  'traffic.resume': '继续',
  'traffic.verdictLabel': '出口分类',
  'traffic.verdict.proxy': '代理',
  'traffic.verdict.direct': '直连',
  'traffic.verdict.block': '拦截',
  'traffic.summary': '命中 {count} 条：代理 {proxy} · 直连 {direct} · 拦截 {block}',
  'traffic.empty': '还没有连接记录。应用连上代理端口后才会出现。',
  'traffic.noMatch': '没有匹配的连接记录。',
  'traffic.conclusionProxy': '{host}：最近 {count} 次全部经过代理（{exit}）',
  'traffic.conclusionProxyAny': '{host}：最近 {count} 次全部经过代理',
  'traffic.conclusionDirect': '{host}：最近 {count} 次全部直连',
  'traffic.conclusionBlocked': '{host}：最近 {count} 次全部被拦截',
  'traffic.stopped': '内核未运行：以下是本次会话已有的记录。',
  'rules.empty': '还没有规则，所有流量走默认出口。',
  'rules.default': '默认出口',
  'rules.check': '校验',
  'rules.apply': '应用',
  'rules.reset': '重置',
  'rules.dirty': '有未应用的改动',
  'rules.enabled': '启用',
  'rules.up': '上移',
  'rules.down': '下移',
  'rules.remove': '删除',
  'nodes.empty': '还没有节点。导入订阅后，规则里就能用节点当出口。',
  'nodes.import': '导入订阅',
  'nodes.url': '订阅地址',
  'nodes.name': '名字（可选）',
  'nodes.latency': '测延迟',
  'nodes.protocol': '协议',
  'nodes.subscriptions': '订阅',
  'logs.empty': '还没有日志。',
  'logs.hint': '内核启动、规则应用与失败都记在这里；每条连接走了哪个出口见「连接」页签。',
  'diag.error': '错误',
  'diag.warning': '提示',
  'message.saved': '已保存',
  'message.checkOk': '校验通过',
  'message.checkFailed': '校验未通过',
  'common.loading': '加载中…',
  'common.error': '出错了',
  'common.retry': '重试',
  'common.none': '无',
} as const

/** 面板词条的键域，由中文表推导。 */
export type LocaleKey = keyof typeof ZH

const EN: Record<LocaleKey, string> = {
  panel: 'Split routing',
  'status.running': 'Running',
  'status.stopped': 'Stopped',
  'status.starting': 'Starting',
  'status.error': 'Error',
  'status.ports': 'SOCKS {socks} · HTTP {http}',
  'status.rules': '{count} rules',
  'status.nodes': '{count} nodes',
  'status.binary': 'Kernel',
  'status.binaryMissing': 'xray not found',
  'action.start': 'Start',
  'action.stop': 'Stop',
  'action.restart': 'Restart',
  'tab.rules': 'Rules',
  'tab.nodes': 'Nodes',
  'tab.traffic': 'Connections',
  'tab.logs': 'Logs',
  'exit.proxy': 'Proxy',
  'exit.direct': 'Direct',
  'exit.block': 'Block',
  'traffic.filterHost': 'Host or IP',
  'traffic.filterAll': 'All',
  'traffic.pause': 'Pause',
  'traffic.resume': 'Resume',
  'traffic.verdictLabel': 'Exit class',
  'traffic.verdict.proxy': 'Proxied',
  'traffic.verdict.direct': 'Direct',
  'traffic.verdict.block': 'Blocked',
  'traffic.summary': '{count} matched: {proxy} proxied · {direct} direct · {block} blocked',
  'traffic.empty': 'No connections yet. They appear once an app uses the proxy ports.',
  'traffic.noMatch': 'No matching connections.',
  'traffic.conclusionProxy': '{host}: all {count} recent connections went through the proxy ({exit})',
  'traffic.conclusionProxyAny': '{host}: all {count} recent connections went through the proxy',
  'traffic.conclusionDirect': '{host}: all {count} recent connections were direct',
  'traffic.conclusionBlocked': '{host}: all {count} recent connections were blocked',
  'traffic.stopped': 'Kernel stopped: showing records from this session.',
  'rules.empty': 'No rules yet; everything uses the default exit.',
  'rules.default': 'Default exit',
  'rules.check': 'Check',
  'rules.apply': 'Apply',
  'rules.reset': 'Reset',
  'rules.dirty': 'Unapplied changes',
  'rules.enabled': 'Enabled',
  'rules.up': 'Move up',
  'rules.down': 'Move down',
  'rules.remove': 'Delete',
  'nodes.empty': 'No nodes yet. Import a subscription to use nodes as exits.',
  'nodes.import': 'Import subscription',
  'nodes.url': 'Subscription URL',
  'nodes.name': 'Name (optional)',
  'nodes.latency': 'Test latency',
  'nodes.protocol': 'Protocol',
  'nodes.subscriptions': 'Subscriptions',
  'logs.empty': 'No log lines yet.',
  'logs.hint': 'Kernel start, rule application, and failures are recorded here; see the Connections tab for which exit each connection used.',
  'diag.error': 'Error',
  'diag.warning': 'Notice',
  'message.saved': 'Saved',
  'message.checkOk': 'Check passed',
  'message.checkFailed': 'Check failed',
  'common.loading': 'Loading…',
  'common.error': 'Something went wrong',
  'common.retry': 'Retry',
  'common.none': 'none',
}

/**
 * 两套基线字典，注册时各取一份。
 * @returns 语言 id → 词条表。
 */
export function dictionaries(): { zh: Record<string, string>; en: Record<string, string> } {
  return { zh: { ...ZH }, en: { ...EN } }
}

/**
 * 替换模板里的 `{name}` 占位符；缺值的占位符原样保留，便于一眼看出没填。
 * @param template - 含占位符的模板串。
 * @param values - 占位符名 → 替换值。
 * @returns 替换后的文本。
 */
export function fill(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{(\w+)\}/g, (placeholder, name: string) => values[name] ?? placeholder)
}
