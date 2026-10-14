// A self-contained ESM build for <script type="module"> use from a CDN (jsDelivr serves the npm
// package's files). Everything is bundled, and code splitting keeps wallet SDKs in their own
// chunks so they load only when a visitor picks that wallet.
import { build } from 'esbuild'

await build({
  entryPoints: { kit: 'src/elements.ts' },
  outdir: 'dist/cdn',
  bundle: true,
  splitting: true,
  format: 'esm',
  minify: true,
  target: 'es2022',
  platform: 'browser',
  legalComments: 'eof',
  define: { 'process.env.NODE_ENV': '"production"', global: 'globalThis' },
  logLevel: 'warning',
})
console.log('cdn build: dist/cdn/kit.js')
