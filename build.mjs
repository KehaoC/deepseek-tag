/** Build the Node host and the one-file Harness Web client plugin. */

import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { build } from 'esbuild'

rmSync('lib', { recursive: true, force: true })
mkdirSync('lib', { recursive: true })

execFileSync('node_modules/.bin/tsc', ['-p', 'tsconfig.build.json'], { stdio: 'inherit' })
execFileSync('node_modules/.bin/tsc', ['-p', 'tsconfig.client.json'], { stdio: 'inherit' })

await build({
  entryPoints: ['src/client/index.ts'],
  outfile: 'lib/client.js',
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: ['es2022'],
  sourcemap: true,
  external: [
    '@deepseek-ai/cordis',
    '@deepseek-ai/dsh-*',
    'react',
    'react-dom',
    'react/jsx-runtime',
    'react/jsx-dev-runtime',
    'scheduler',
  ],
  banner: {
    js: "window.__ModuleLoader__.load({ id: 'deepseek-tag', factory: (require) => { var module = { exports: {} }; var exports = module.exports;",
  },
  footer: { js: 'return module.exports; } });' },
  logLevel: 'info',
})
