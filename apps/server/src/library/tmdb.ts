import { createHash } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { config } from '../config.js';
import { tmdbCacheDir } from '../lib/paths.js';

const TMDB_BASE = 'https://api.themoviedb.org/3';
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

mkdirSync(tmdbCacheDir, { recursive: true });

type CacheEntry<T> = { fetchedAt: number; data: T };

function cacheKeyFor(path: string): string {
  return createHash('sha1').update(path).digest('hex') + '.json';
}

async function readCache<T>(path: string): Promise<T | null> {
  const file = resolve(tmdbCacheDir, cacheKeyFor(path));
  if (!existsSync(file)) return null;
  try {
    const parsed: CacheEntry<T> = JSON.parse(await readFile(file, 'utf8'));
    if (Date.now() - parsed.fetchedAt > CACHE_TTL_MS) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

async function writeCache<T>(path: string, data: T): Promise<void> {
  const file = resolve(tmdbCacheDir, cacheKeyFor(path));
  const payload: CacheEntry<T> = { fetchedAt: Date.now(), data };
  await writeFile(file, JSON.stringify(payload));
}

export class TMDbUnauthorizedError extends Error {}
export class TMDbNotFoundError extends Error {}

async function tmdb<T>(path: string): Promise<T> {
  const cached = await readCache<T>(path);
  if (cached !== null) return cached;
  if (!config.TMDB_ACCESS_TOKEN) throw new Error('TMDB_ACCESS_TOKEN not configured');
  const res = await fetch(`${TMDB_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${config.TMDB_ACCESS_TOKEN}`,
      Accept: 'application/json',
    },
  });
  if (res.status === 401 || res.status === 403) throw new TMDbUnauthorizedError(await res.text());
  if (res.status === 404) throw new TMDbNotFoundError(path);
  if (!res.ok) throw new Error(`TMDb ${path} ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as T;
  await writeCache(path, data);
  return data;
}

// ------- response shapes (trimmed to what we need) -------

export interface TMDbMovie {
  id: number;
  title: string;
  original_title: string;
  release_date?: string;
  overview?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  genres?: { id: number; name: string }[];
  runtime?: number | null;
  vote_average?: number;
  imdb_id?: string | null;
}

export interface TMDbSeries {
  id: number;
  name: string;
  original_name: string;
  first_air_date?: string;
  overview?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  genres?: { id: number; name: string }[];
  episode_run_time?: number[];
  vote_average?: number;
  external_ids?: { imdb_id?: string | null };
  number_of_seasons?: number;
  seasons?: { season_number: number; episode_count: number; name: string; air_date?: string }[];
}

export interface TMDbSeason {
  id: number;
  season_number: number;
  name: string;
  overview?: string;
  episodes?: TMDbEpisode[];
}

export interface TMDbEpisode {
  id: number;
  season_number: number;
  episode_number: number;
  name?: string;
  overview?: string;
  still_path?: string | null;
  air_date?: string;
}

export interface TMDbSearchResult<T> {
  page: number;
  results: T[];
  total_results: number;
}

const enc = encodeURIComponent;

export async function searchMovie(title: string, year?: number): Promise<TMDbMovie | null> {
  const q = `/search/movie?query=${enc(title)}${year ? `&year=${year}` : ''}&include_adult=true`;
  const data = await tmdb<TMDbSearchResult<TMDbMovie>>(q);
  return data.results[0] ?? null;
}

export async function searchSeries(name: string, year?: number): Promise<TMDbSeries | null> {
  const q = `/search/tv?query=${enc(name)}${year ? `&first_air_date_year=${year}` : ''}&include_adult=true`;
  const data = await tmdb<TMDbSearchResult<TMDbSeries>>(q);
  return data.results[0] ?? null;
}

export async function getMovie(id: number): Promise<TMDbMovie> {
  return tmdb<TMDbMovie>(`/movie/${id}`);
}

export async function getSeries(id: number): Promise<TMDbSeries> {
  return tmdb<TMDbSeries>(`/tv/${id}?append_to_response=external_ids`);
}

export async function getSeason(seriesId: number, season: number): Promise<TMDbSeason> {
  return tmdb<TMDbSeason>(`/tv/${seriesId}/season/${season}`);
}

export const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p';
