import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    elements: 'src/elements.ts',
    react: 'src/react.tsx',
    iframe: 'src/iframe.ts',
  },
  format: ['esm'],
  dts: true,
  splitting: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
  treeshake: true,
})
