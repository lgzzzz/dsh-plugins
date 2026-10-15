import { clientPackage } from '../tsdown.client.mjs'

// 两半都产出:宿主半部 src/index.ts → lib/index.js(空 apply),浏览器半部
// src/client/index.ts → lib/client.js。第一个参数必须等于 package.json 的 name,
// 它就是浏览器模块表里的行 id。
//
// zod 保持 external:官方 @deepseek-ai/dsh-client-ui-sidebar-right 的 lib/client.js
// 也是 require("zod"),外壳的模块表里有这一行;不内联可以少一份重复实现,并与官方
// 产物的 require 集合逐行一致。其余第三方库(picomatch)与内联安全的 wire 层
// (dsh-util-crypto 的 randomUUID)按预设规则内联。
export default clientPackage('dsh-client-ui-sidebar-right-lgz', {
  nodeEntries: ['src/index.ts'],
  clientEntry: 'src/client/index.ts',
  clientExternals: ['zod'],
})
