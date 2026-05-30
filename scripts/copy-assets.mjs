// Copy non-TS assets from server src into dist after `tsc` compilation.
import { cp, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const serverSrc = resolve(here, '../apps/server/src');
const serverDist = resolve(here, '../apps/server/dist');

const assets = [['db/schema.sql', 'db/schema.sql']];

for (const [from, to] of assets) {
  const src = resolve(serverSrc, from);
  const dst = resolve(serverDist, to);
  await mkdir(dirname(dst), { recursive: true });
  await cp(src, dst);
  console.log(`copied ${from} -> dist/${to}`);
}
