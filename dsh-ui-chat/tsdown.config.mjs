import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { clientPackage } from '../tsdown.client.mjs'

// 两半都产出:宿主半部 src/index.ts → lib/index.js,浏览器半部
// src/client/index.ts → lib/client.js。第一个参数必须等于 package.json 的 name,
// 它就是浏览器模块表里的行 id。
//
// 比别的插件多一段的原因:ChatView.module.css 用 `url('./running-whale@2x.png')` 画
// 运行中的鲸鱼尾巴,而 `.module.css` 会被预设编译成 JS 里的样式字符串(见
// tsdown.client.mjs 的 cssModulesInlinePlugin),运行时那条相对 url 不再相对任何文件,
// 图片会 404。上游 monorepo 的 tsdown.client.ts 用同一个插件把这张 PNG 内联成 data URI,
// 这里照搬;插件排在预设之后,靠虚拟模块 id 只接管那一份样式表。
const whaleStylesheet = fileURLToPath(new URL('./src/client/chat/ChatView.module.css', import.meta.url)).replaceAll('\\', '/')
const whaleImage = fileURLToPath(new URL('./src/client/chat/running-whale@2x.png', import.meta.url))
const whaleImageUrl = './running-whale@2x.png'

export default clientPackage('dsh-client-ui-chat-lgz', {
  nodeEntries: ['src/index.ts'],
  clientEntry: 'src/client/index.ts',
}).map(config => ({
  ...config,
  plugins: [...(config.plugins ?? []), {
    name: 'chat-whale-image',
    async transform(code, id) {
      if (id.replaceAll('\\', '/') !== `\0dsh-css:${whaleStylesheet}.mjs`) return null
      if (!code.includes(whaleImageUrl)) return null
      this.addWatchFile(whaleImage)
      const image = await readFile(whaleImage)
      return {
        code: code.replaceAll(whaleImageUrl, `data:image/png;base64,${image.toString('base64')}`),
        map: null,
      }
    },
  }],
}))
