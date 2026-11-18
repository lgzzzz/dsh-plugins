import { clientPackage } from '../tsdown.client.mjs'

// 两半都编译成 JS:宿主半部 src/index.ts → lib/index.js(ESM 库 bundle),
// 浏览器半部 src/client/index.ts → lib/client.js(__ModuleLoader__ CJS 工厂)。
const configs = clientPackage('dsh-request-stats', {
  nodeEntries: ['src/index.ts'],
  clientEntry: 'src/client/index.ts',
})

// 宿主入口只由 DSH 运行时加载,不对外提供类型入口:关掉 .d.ts 生成,
// 免得把 cordis 的声明一并折进产物。
configs[0].dts = false

export default configs
