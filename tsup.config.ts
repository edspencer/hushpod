import { defineConfig } from 'tsup'

// Transpile the server (+ shared) to dist/server. Dependencies are left
// external (resolved from node_modules at runtime) — native modules like
// better-sqlite3 and nodejs-whisper's bundled whisper.cpp must not be bundled.
export default defineConfig({
  entry: ['src/server/index.ts'],
  outDir: 'dist/server',
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  clean: true,
  sourcemap: true,
  dts: false,
  skipNodeModulesBundle: true,
})
