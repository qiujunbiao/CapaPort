import { chmod, mkdir } from 'node:fs/promises';
import { build } from 'esbuild';

await mkdir('dist', { recursive: true });
await build({
  entryPoints: ['src/main.ts'],
  outfile: 'dist/capaport.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  banner: {
    js: '#!/usr/bin/env node\nimport { createRequire as __capaportCreateRequire } from "node:module";\nconst require = __capaportCreateRequire(import.meta.url);',
  },
});
await chmod('dist/capaport.mjs', 0o755);
