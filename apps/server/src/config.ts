import { config as loadEnv } from 'node:process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const envFile = resolve(repoRoot, '.env');

if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (value.length === 0) continue;
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

const schema = z.object({
  LIBRARY_ROOT: z.string().min(1, 'LIBRARY_ROOT is required').optional(),
  PUBLIC_URL: z.url().default('http://localhost:5173'),
  RP_ID: z.string().default('localhost'),
  RP_NAME: z.string().default('Perflix'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().positive().default(7000),
  TMDB_ACCESS_TOKEN: z.string().optional(),
  OPENSUBS_API_KEY: z.string().optional(),
  OPENSUBS_USER_AGENT: z.string().default('Perflix v0.1'),
  SESSION_SECRET: z.string().optional(),
  SIGNING_SECRET: z.string().optional(),
  HLS_CACHE_BYTES: z.coerce.number().int().positive().default(16_106_127_360),
});

export const config = schema.parse(process.env);
export const paths = {
  repoRoot,
  dataDir: resolve(repoRoot, '.perflix'),
};

// silence unused-import lint for loadEnv shim
void loadEnv;
