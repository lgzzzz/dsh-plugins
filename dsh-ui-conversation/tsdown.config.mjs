import { clientPackage } from '../tsdown.client.mjs'

export default clientPackage('ui-conversation-lgz', {
  nodeEntries: ['src/index.ts'],
  clientEntry: 'src/client/index.ts',
})
