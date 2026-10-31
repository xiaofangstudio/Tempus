/* 自检入口：node scripts/run-check.mjs（或 npm run check:templates）
 *
 * check-templates.mjs 是 TS 写的（要 import 项目里的 templates.ts），
 * Node 不认无扩展名的 TS import，所以先用 esbuild 打成一个包再执行 ——
 * 和应用里浏览器内编译走的是同一个编译器，等于顺带验了那条链。 */

import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, '..', 'node_modules', '.cache', 'tempus-check-templates.mjs');

await build({
  entryPoints: [path.join(here, 'check-templates.mjs')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  external: ['esbuild'],
  outfile: out,
  logLevel: 'error'
});

await import('file://' + out.replace(/\\/g, '/'));
