/** 浏览器半部：`src/client.tsx` → `lib/client.js`（共享预设产出 __ModuleLoader__ 的 CJS 工厂）。 */
import { clientBundle } from '../tsdown.client.mjs'

export default clientBundle('dsh-proxy', { entry: 'src/client.tsx' })
