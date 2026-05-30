import { resolve, sep } from 'node:path';
import { config, paths as appPaths } from '../config.js';

export const MEDIA_EXTS = new Set([
  '.mp4',
  '.mkv',
  '.m4v',
  '.avi',
  '.mov',
  '.webm',
  '.mpg',
  '.mpeg',
  '.ts',
  '.wmv',
]);

export const SUB_EXTS = new Set(['.srt', '.ass', '.vtt', '.ssa']);

export function isMediaFile(name: string): boolean {
  if (name.startsWith('.') || name.startsWith('._')) return false;
  const dot = name.lastIndexOf('.');
  if (dot < 0) return false;
  return MEDIA_EXTS.has(name.slice(dot).toLowerCase());
}

export function isSubtitleFile(name: string): boolean {
  if (name.startsWith('.') || name.startsWith('._')) return false;
  const dot = name.lastIndexOf('.');
  if (dot < 0) return false;
  return SUB_EXTS.has(name.slice(dot).toLowerCase());
}

/** Resolve a path under LIBRARY_ROOT, throw if it escapes. */
export function resolveUnderLibrary(...parts: string[]): string {
  if (!config.LIBRARY_ROOT) throw new Error('LIBRARY_ROOT not set');
  const root = resolve(config.LIBRARY_ROOT);
  const target = resolve(root, ...parts);
  if (target !== root && !target.startsWith(root + sep)) {
    throw new Error(`Path escapes library root: ${target}`);
  }
  return target;
}

export const artDir = resolve(appPaths.dataDir, 'art');
export const previewDir = resolve(appPaths.dataDir, 'preview');
export const thumbsDir = resolve(appPaths.dataDir, 'thumbs');
export const hlsCacheDir = resolve(appPaths.dataDir, 'hls-cache');
export const subsCacheDir = resolve(appPaths.dataDir, 'subs');
export const tmdbCacheDir = resolve(appPaths.dataDir, 'tmdb');
