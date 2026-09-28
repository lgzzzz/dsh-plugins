import { clientPackage } from '../tsdown.client.mjs'

export default clientPackage('@deepseek-ai/dsh-client-ui-chat', {
  nodeEntries: ['src/index.ts'],
  clientEntry: 'src/client/index.ts',
})
