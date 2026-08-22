/**
 * tsdown bundle config for the client half.
 *
 * Build order (npm run build):
 *   1. `tsc -p tsconfig.json`        → lib/index.js          (host half, ESM)
 *   2. `tsc -p tsconfig.client.json` → lib/client/*.js       (client half, ESM)
 *   3. `tsdown`                      → lib/client.js         (ModuleLoader bundle)
 *
 * The emitted artifact is the CJS closure-factory the browser loads:
 * `window.__ModuleLoader__.load({ id, factory })`. The three externals stay
 * `require()` calls answered by the loader's module table (react/react-jsx are
 * shell-seeded; `@deepseek-ai/dsh-client-runtime/client` is a dynamic
 * module-table row). Everything else — the plugin's own modules — inlines.
 */
const CLIENT_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  '@deepseek-ai/dsh-client-runtime/client',
]

export default {
  name: 'dsh-change-summary/client',
  entry: { client: 'lib/client/index.js' },
  outDir: 'lib',
  format: ['cjs'],
  platform: 'browser',
  dts: false,
  sourcemap: true,
  hash: false,
  // Never clean: the host tsc output (lib/index.js) shares this directory.
  clean: false,
  deps: {
    neverBundle: (specifier) => CLIENT_EXTERNALS.includes(specifier),
    alwaysBundle: (specifier) => !CLIENT_EXTERNALS.includes(specifier),
  },
  outputOptions: {
    entryFileNames: 'client.js',
  },
  banner:
    'window.__ModuleLoader__.load({ id: "dsh-change-summary", factory: (require) => {\nvar module = { exports: {} }; var exports = module.exports;',
  footer: 'return module.exports; } });',
}
