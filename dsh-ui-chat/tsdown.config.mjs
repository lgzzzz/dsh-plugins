import { clientPackage } from '../tsdown.client.mjs'

export default clientPackage('ui-chat-lgz', {
  nodeEntries: ['src/index.ts'],
  clientEntry: 'src/client/index.ts',
})
