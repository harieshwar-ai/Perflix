import { watch as chokidarWatch, type FSWatcher } from 'chokidar';
import { basename, sep } from 'node:path';
import { statSync } from 'node:fs';
import type { FastifyBaseLogger } from 'fastify';
import { config } from '../config.js';
import { db } from '../db/client.js';
import { isMediaFile } from '../lib/paths.js';
import { classify, type Parsed } from './parser.js';
import { fetchArt } from './art.js';
import { probeAndPersist } from '../media/probe.js';
import { registerLocalSubs } from '../subs/local.js';
import {
  getMovie,
  getSeason,
  getSeries,
  searchMovie,
  searchSeries,
  TMDbNotFoundError,
} from './tmdb.js';

const upsertMovieTitle = db.prepare(`
  INSERT INTO titles (kind, tmdb_id, imdb_id, title, year, overview, poster, backdrop, genres, runtime, rating, added_at, refreshed_at)
  VALUES ('movie', @tmdb_id, @imdb_id, @title, @year, @overview, @poster, @backdrop, @genres, @runtime, @rating, @now, @now)
  ON CONFLICT(kind, tmdb_id) DO UPDATE SET
    title = excluded.title, year = excluded.year, overview = excluded.overview,
    poster = excluded.poster, backdrop = excluded.backdrop, genres = excluded.genres,
    runtime = excluded.runtime, rating = excluded.rating, refreshed_at = excluded.refreshed_at
  RETURNING id
`);

const upsertSeriesTitle = db.prepare(`
  INSERT INTO titles (kind, tmdb_id, imdb_id, title, year, overview, poster, backdrop, genres, runtime, rating, added_at, refreshed_at)
  VALUES ('series', @tmdb_id, @imdb_id, @title, @year, @overview, @poster, @backdrop, @genres, @runtime, @rating, @now, @now)
  ON CONFLICT(kind, tmdb_id) DO UPDATE SET
    title = excluded.title, year = excluded.year, overview = excluded.overview,
    poster = excluded.poster, backdrop = excluded.backdrop, genres = excluded.genres,
    runtime = excluded.runtime, rating = excluded.rating, refreshed_at = excluded.refreshed_at
  RETURNING id
`);

const insertOrphanTitle = db.prepare(`
  INSERT INTO titles (kind, title, year, added_at) VALUES (@kind, @title, @year, @now) RETURNING id
`);

const findOrphanTitleByName = db.prepare(`
  SELECT id FROM titles WHERE kind = @kind AND tmdb_id IS NULL AND title = @title LIMIT 1
`);

const upsertEpisode = db.prepare(`
  INSERT INTO episodes (title_id, season, episode, name, overview, still, air_date)
  VALUES (@title_id, @season, @episode, @name, @overview, @still, @air_date)
  ON CONFLICT(title_id, season, episode) DO UPDATE SET
    name = excluded.name, overview = excluded.overview,
    still = excluded.still, air_date = excluded.air_date
  RETURNING id
`);

const insertFile = db.prepare(`
  INSERT INTO files (title_id, episode_id, path, size, mtime, added_at)
  VALUES (@title_id, @episode_id, @path, @size, @mtime, @now)
  ON CONFLICT(path) DO UPDATE SET
    title_id = excluded.title_id, episode_id = excluded.episode_id,
    size = excluded.size, mtime = excluded.mtime
  RETURNING id
`);

const deleteFile = db.prepare(`DELETE FROM files WHERE path = ?`);

const deleteOrphanTitles = db.prepare(`
  DELETE FROM titles WHERE id NOT IN (SELECT DISTINCT title_id FROM files WHERE title_id IS NOT NULL)
`);

type IngestCtx = { log: FastifyBaseLogger; tmdbAvailable: boolean };

/** Cache of in-flight series lookups so concurrent episode events don't duplicate work. */
const seriesPromise = new Map<string, Promise<number>>();
const moviePromise = new Map<string, Promise<number>>();

async function ensureMovie(parsed: Extract<Parsed, { kind: 'movie' }>, ctx: IngestCtx): Promise<number> {
  const key = `${parsed.title}::${parsed.year ?? ''}`;
  const cached = moviePromise.get(key);
  if (cached) return cached;
  const p = (async () => {
    if (!ctx.tmdbAvailable) {
      return upsertOrphan('movie', parsed.title, parsed.year);
    }
    try {
      const hit = await searchMovie(parsed.title, parsed.year);
      if (!hit) {
        ctx.log.warn({ title: parsed.title, year: parsed.year }, 'no tmdb match for movie');
        return upsertOrphan('movie', parsed.title, parsed.year);
      }
      const full = await getMovie(hit.id);
      const poster = await fetchArt(full.poster_path, 'poster', { type: 'title', id: 0 });
      const backdrop = await fetchArt(full.backdrop_path, 'backdrop', { type: 'title', id: 0 });
      const row = upsertMovieTitle.get({
        tmdb_id: full.id,
        imdb_id: full.imdb_id ?? null,
        title: full.title,
        year: full.release_date ? Number(full.release_date.slice(0, 4)) : (parsed.year ?? null),
        overview: full.overview ?? null,
        poster: null,
        backdrop: null,
        genres: full.genres ? JSON.stringify(full.genres.map((g) => g.name)) : null,
        runtime: full.runtime ?? null,
        rating: full.vote_average ?? null,
        now: Date.now(),
      }) as { id: number };
      // re-fetch art with real title id for stable filenames
      const realPoster = await fetchArt(full.poster_path, 'poster', { type: 'title', id: row.id });
      const realBackdrop = await fetchArt(full.backdrop_path, 'backdrop', { type: 'title', id: row.id });
      db.prepare('UPDATE titles SET poster = ?, backdrop = ? WHERE id = ?').run(realPoster, realBackdrop, row.id);
      void poster;
      void backdrop;
      return row.id;
    } catch (e) {
      if (e instanceof TMDbNotFoundError) {
        return upsertOrphan('movie', parsed.title, parsed.year);
      }
      throw e;
    }
  })();
  moviePromise.set(key, p);
  try {
    return await p;
  } finally {
    setTimeout(() => moviePromise.delete(key), 60_000);
  }
}

async function ensureSeries(showName: string, ctx: IngestCtx): Promise<number> {
  const key = `series::${showName}`;
  const cached = seriesPromise.get(key);
  if (cached) return cached;
  const p = (async () => {
    if (!ctx.tmdbAvailable) return upsertOrphan('series', showName, null);
    try {
      const hit = await searchSeries(showName);
      if (!hit) {
        ctx.log.warn({ showName }, 'no tmdb match for series');
        return upsertOrphan('series', showName, null);
      }
      const full = await getSeries(hit.id);
      const row = upsertSeriesTitle.get({
        tmdb_id: full.id,
        imdb_id: full.external_ids?.imdb_id ?? null,
        title: full.name,
        year: full.first_air_date ? Number(full.first_air_date.slice(0, 4)) : null,
        overview: full.overview ?? null,
        poster: null,
        backdrop: null,
        genres: full.genres ? JSON.stringify(full.genres.map((g) => g.name)) : null,
        runtime: full.episode_run_time?.[0] ?? null,
        rating: full.vote_average ?? null,
        now: Date.now(),
      }) as { id: number };
      const poster = await fetchArt(full.poster_path, 'poster', { type: 'title', id: row.id });
      const backdrop = await fetchArt(full.backdrop_path, 'backdrop', { type: 'title', id: row.id });
      db.prepare('UPDATE titles SET poster = ?, backdrop = ? WHERE id = ?').run(poster, backdrop, row.id);
      return row.id;
    } catch (e) {
      if (e instanceof TMDbNotFoundError) return upsertOrphan('series', showName, null);
      throw e;
    }
  })();
  seriesPromise.set(key, p);
  try {
    return await p;
  } finally {
    setTimeout(() => seriesPromise.delete(key), 60_000);
  }
}

function upsertOrphan(kind: 'movie' | 'series', title: string, year: number | null | undefined): number {
  const existing = findOrphanTitleByName.get({ kind, title }) as { id: number } | undefined;
  if (existing) return existing.id;
  const row = insertOrphanTitle.get({ kind, title, year: year ?? null, now: Date.now() }) as { id: number };
  return row.id;
}

const seasonPromise = new Map<string, Promise<void>>();

async function ensureEpisode(
  seriesTitleId: number,
  tmdbSeriesId: number | null,
  season: number,
  episode: number,
  ctx: IngestCtx,
): Promise<number> {
  // If we have the season meta cached on disk, prefer it.
  if (tmdbSeriesId && ctx.tmdbAvailable) {
    const key = `${tmdbSeriesId}::S${season}`;
    let p = seasonPromise.get(key);
    if (!p) {
      p = (async () => {
        try {
          const data = await getSeason(tmdbSeriesId, season);
          for (const ep of data.episodes ?? []) {
            const still = await fetchArt(ep.still_path ?? null, 'still', {
              type: 'episode',
              id: ep.id,
            });
            upsertEpisode.run({
              title_id: seriesTitleId,
              season: ep.season_number,
              episode: ep.episode_number,
              name: ep.name ?? null,
              overview: ep.overview ?? null,
              still,
              air_date: ep.air_date ?? null,
            });
          }
        } catch (e) {
          ctx.log.warn({ err: String(e), tmdbSeriesId, season }, 'failed to fetch season');
        }
      })();
      seasonPromise.set(key, p);
      setTimeout(() => seasonPromise.delete(key), 60_000);
    }
    await p;
  }
  const row = upsertEpisode.get({
    title_id: seriesTitleId,
    season,
    episode,
    name: null,
    overview: null,
    still: null,
    air_date: null,
  }) as { id: number } | undefined;
  if (row) return row.id;
  return (
    (db
      .prepare('SELECT id FROM episodes WHERE title_id = ? AND season = ? AND episode = ?')
      .get(seriesTitleId, season, episode) as { id: number }).id
  );
}

async function ingestFile(absPath: string, ctx: IngestCtx) {
  if (!isMediaFile(basename(absPath))) return;
  let st;
  try {
    st = statSync(absPath);
  } catch {
    return;
  }
  if (!st.isFile()) return;
  const parsed = classify(absPath);
  if (parsed.kind === 'skip') {
    ctx.log.debug({ absPath, reason: parsed.reason }, 'skip');
    return;
  }

  let fileRow: { id: number };
  if (parsed.kind === 'movie') {
    const titleId = await ensureMovie(parsed, ctx);
    fileRow = insertFile.get({
      title_id: titleId,
      episode_id: null,
      path: absPath,
      size: st.size,
      mtime: Math.floor(st.mtimeMs),
      now: Date.now(),
    }) as { id: number };
    ctx.log.info({ titleId, fileId: fileRow.id, path: absPath }, 'ingested movie file');
  } else {
    const titleId = await ensureSeries(parsed.showName, ctx);
    const tmdbId = (db.prepare('SELECT tmdb_id FROM titles WHERE id = ?').get(titleId) as { tmdb_id: number | null }).tmdb_id;
    const epId = await ensureEpisode(titleId, tmdbId, parsed.season, parsed.episode, ctx);
    fileRow = insertFile.get({
      title_id: titleId,
      episode_id: epId,
      path: absPath,
      size: st.size,
      mtime: Math.floor(st.mtimeMs),
      now: Date.now(),
    }) as { id: number };
    ctx.log.info({ titleId, epId, fileId: fileRow.id, path: absPath }, 'ingested episode file');
  }

  // probe + register sidecar subs lazily so we don't block ingest pipeline
  setImmediate(() => {
    probeAndPersist(fileRow.id, absPath).catch((err) =>
      ctx.log.warn({ err: String(err), fileId: fileRow.id }, 'probe failed'),
    );
    try {
      const n = registerLocalSubs(fileRow.id, absPath);
      if (n > 0) ctx.log.info({ fileId: fileRow.id, n }, 'registered local subs');
    } catch (err) {
      ctx.log.warn({ err: String(err), fileId: fileRow.id }, 'local sub scan failed');
    }
  });
}

function removeFile(absPath: string, log: FastifyBaseLogger) {
  const res = deleteFile.run(absPath);
  if (res.changes > 0) {
    log.info({ absPath }, 'removed file');
    deleteOrphanTitles.run();
  }
}

let watcher: FSWatcher | null = null;

export async function startScanner(log: FastifyBaseLogger): Promise<void> {
  if (!config.LIBRARY_ROOT) {
    log.warn('LIBRARY_ROOT not set; library scanner disabled');
    return;
  }
  const tmdbAvailable = Boolean(config.TMDB_ACCESS_TOKEN);
  if (!tmdbAvailable) log.warn('TMDB_ACCESS_TOKEN not set; titles will be filename-only');

  const ctx: IngestCtx = { log, tmdbAvailable };

  // Worker queue: prevent thundering herd on first scan.
  const queue: string[] = [];
  let running = 0;
  const CONCURRENCY = 4;
  const drain = async () => {
    while (running < CONCURRENCY && queue.length) {
      const next = queue.shift()!;
      running++;
      ingestFile(next, ctx)
        .catch((err) => log.error({ err: String(err), path: next }, 'ingest error'))
        .finally(() => {
          running--;
          drain();
        });
    }
  };

  watcher = chokidarWatch(config.LIBRARY_ROOT, {
    ignored: (p: string) => {
      const b = p.split(sep).pop() ?? '';
      return b.startsWith('.') || b.startsWith('._');
    },
    ignoreInitial: false,
    awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 500 },
    depth: 10,
    persistent: true,
  });

  watcher
    .on('add', (p: string) => {
      queue.push(p);
      void drain();
    })
    .on('unlink', (p: string) => removeFile(p, log))
    .on('error', (err: unknown) => log.error({ err: String(err) }, 'watcher error'))
    .on('ready', () => log.info({ root: config.LIBRARY_ROOT }, 'initial scan complete'));
}

export async function stopScanner(): Promise<void> {
  await watcher?.close();
  watcher = null;
}
