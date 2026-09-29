import { clientPackage } from '../tsdown.client.mjs'

export default clientPackage('dsh-client-ui-chat-lgz', {
  nodeEntries: ['src/index.ts'],
  clientEntry: 'src/client/index.ts',
})
