import { chmod, mkdir } from 'node:fs/promises';
import { build } from 'esbuild';

await mkdir('dist', { recursive: true });
await build({
  entryPoints: ['src/main.ts'],
  outfile: 'dist/agentdoor.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  banner: {
    js: '#!/usr/bin/env node\nimport { createRequire as __agentdoorCreateRequire } from "node:module";\nconst require = __agentdoorCreateRequire(import.meta.url);',
  },
});
await chmod('dist/agentdoor.mjs', 0o755);
