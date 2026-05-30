import { parse } from 'parse-torrent-title';
import { basename, dirname, sep } from 'node:path';
import { config } from '../config.js';

const SERIES_DIRS = new Set(['tv', 'series', 'shows', 'tvshows']);
const MOVIE_DIRS = new Set(['movies', 'films', 'film']);

const SEASON_RE = /^season[\s._-]*(\d{1,3})$/i;

export type Parsed =
  | {
      kind: 'movie';
      title: string;
      year?: number;
      resolution?: string;
      codec?: string;
    }
  | {
      kind: 'series';
      showName: string;
      season: number;
      episode: number;
      year?: number;
      resolution?: string;
      codec?: string;
    }
  | { kind: 'skip'; reason: string };

/**
 * Classify a file under LIBRARY_ROOT into a movie or a series episode based on
 * folder structure first, then filename parsing.
 */
export function classify(absPath: string): Parsed {
  if (!config.LIBRARY_ROOT) return { kind: 'skip', reason: 'LIBRARY_ROOT unset' };
  const root = config.LIBRARY_ROOT.replace(/\/+$/, '');
  if (!absPath.startsWith(root + sep)) {
    return { kind: 'skip', reason: 'outside library' };
  }
  const rel = absPath.slice(root.length + 1);
  const segs = rel.split(sep);
  if (segs.length < 2) return { kind: 'skip', reason: 'no kind folder' };

  const top = segs[0]!.toLowerCase();
  const file = basename(absPath);
  const parsed = parse(file);

  if (SERIES_DIRS.has(top)) {
    // TV/<Show>/<Season N>/<file.ext>   OR   TV/<Show>/<file.ext>
    const showName = segs[1] ?? cleanseShowName(file);
    let season = parsed.season;
    let episode = parsed.episode;

    if ((!season || !episode) && segs.length >= 3) {
      const m = segs[segs.length - 2]?.match(SEASON_RE);
      if (m && m[1]) season = parseInt(m[1], 10);
    }

    if (!season) season = 1;
    if (!episode) {
      // try simpler patterns like "01.mkv" or "Ep 5"
      const fallback = file.match(/(?:^|[^a-z0-9])(?:e|ep|episode)[\s._-]*(\d{1,3})/i);
      if (fallback && fallback[1]) episode = parseInt(fallback[1], 10);
    }
    if (!season || !episode) return { kind: 'skip', reason: 'no s/e detected' };

    return {
      kind: 'series',
      showName: cleanseShowName(showName),
      season,
      episode,
      year: parsed.year,
      resolution: parsed.resolution,
      codec: parsed.codec,
    };
  }

  if (MOVIE_DIRS.has(top)) {
    return {
      kind: 'movie',
      title: parsed.title || cleanseShowName(basename(dirname(absPath))),
      year: parsed.year,
      resolution: parsed.resolution,
      codec: parsed.codec,
    };
  }

  return { kind: 'skip', reason: `unknown top folder: ${segs[0]}` };
}

function cleanseShowName(s: string): string {
  // strip trailing year markers and release group noise
  return s
    .replace(/\.[a-z0-9]{2,4}$/i, '') // ext
    .replace(/[._]/g, ' ')
    .replace(/\s*\(\d{4}\)\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}
