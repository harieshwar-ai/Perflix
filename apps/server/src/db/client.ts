import Database from 'better-sqlite3';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { paths } from '../config.js';
import { runMigrations } from './migrations.js';

const here = dirname(fileURLToPath(import.meta.url));
const schemaPath = resolve(here, 'schema.sql');

mkdirSync(paths.dataDir, { recursive: true });

export const db = new Database(resolve(paths.dataDir, 'perflix.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL');
db.exec(readFileSync(schemaPath, 'utf8'));
runMigrations(db);

export type Title = {
  id: number;
  kind: 'movie' | 'series';
  tmdb_id: number | null;
  imdb_id: string | null;
  title: string;
  year: number | null;
  overview: string | null;
  poster: string | null;
  backdrop: string | null;
  logo: string | null;
  genres: string | null;
  runtime: number | null;
  rating: number | null;
  added_at: number;
  refreshed_at: number | null;
};

export type Episode = {
  id: number;
  title_id: number;
  season: number;
  episode: number;
  name: string | null;
  overview: string | null;
  still: string | null;
  air_date: string | null;
};

export type FileRow = {
  id: number;
  title_id: number | null;
  episode_id: number | null;
  path: string;
  size: number;
  mtime: number;
  duration: number | null;
  container: string | null;
  vcodec: string | null;
  acodec: string | null;
  width: number | null;
  height: number | null;
  mode: 'direct' | 'remux' | 'transcode' | null;
  probed_at: number | null;
  added_at: number;
};
