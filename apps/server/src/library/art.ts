import { existsSync, mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { artDir } from '../lib/paths.js';
import { TMDB_IMAGE_BASE } from './tmdb.js';

mkdirSync(artDir, { recursive: true });

type ArtKind = 'poster' | 'backdrop' | 'still' | 'logo';

const SIZE_BY_KIND: Record<ArtKind, string> = {
  poster: 'w500',
  backdrop: 'w1280',
  still: 'w500',
  logo: 'w500',
};

/**
 * Download a TMDb image and return the local relative filename
 * (suitable for the `/art/<file>` route). No-op if already cached.
 */
export async function fetchArt(
  tmdbPath: string | null | undefined,
  kind: ArtKind,
  scope: { type: 'title' | 'episode'; id: number },
): Promise<string | null> {
  if (!tmdbPath) return null;
  const ext = extname(tmdbPath) || '.jpg';
  const name = `${scope.type}-${scope.id}-${kind}${ext}`;
  const dest = resolve(artDir, name);
  if (existsSync(dest)) return name;
  const url = `${TMDB_IMAGE_BASE}/${SIZE_BY_KIND[kind]}${tmdbPath}`;
  const res = await fetch(url);
  if (!res.ok) {
    return null;
  }
  await writeFile(dest, Buffer.from(await res.arrayBuffer()));
  return name;
}
