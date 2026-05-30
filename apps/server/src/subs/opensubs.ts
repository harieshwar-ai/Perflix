import { config } from '../config.js';

const BASE = 'https://api.opensubtitles.com/api/v1';

let token: string | null = null;
let tokenAt = 0;
const TOKEN_TTL = 23 * 60 * 60 * 1000; // 23 h

function requireKey(): string {
  if (!config.OPENSUBS_API_KEY) throw new Error('OPENSUBS_API_KEY not set');
  return config.OPENSUBS_API_KEY;
}

function commonHeaders(): Record<string, string> {
  return {
    'Api-Key': requireKey(),
    'User-Agent': config.OPENSUBS_USER_AGENT,
    Accept: 'application/json',
  };
}

async function login(): Promise<string> {
  // Anonymous downloads are limited; we authenticate only if username/password are
  // supplied. Most users won't have them — search and (free) download work with key alone.
  // This helper exists so future credential-bearing flows can call it.
  throw new Error('opensubs login requires username/password (not configured)');
}

export type OsSearchHit = {
  id: string;
  type: 'subtitle';
  attributes: {
    subtitle_id: string;
    language: string;
    download_count?: number;
    hearing_impaired?: boolean;
    hd?: boolean;
    fps?: number;
    votes?: number;
    ratings?: number;
    from_trusted?: boolean;
    foreign_parts_only?: boolean;
    release?: string;
    feature_details?: {
      title?: string;
      year?: number;
      season_number?: number;
      episode_number?: number;
    };
    files?: { file_id: number; file_name?: string }[];
  };
};

export type SearchOpts = {
  query?: string;
  imdbId?: string | null; // tt-prefixed accepted
  tmdbId?: number | null;
  parentImdbId?: string | null;
  parentTmdbId?: number | null;
  season?: number;
  episode?: number;
  languages?: string[]; // ISO 639-1 codes
  type?: 'movie' | 'episode';
};

function tt(id: string | null | undefined): string | undefined {
  if (!id) return undefined;
  return id.startsWith('tt') ? id.slice(2) : id;
}

export async function searchSubtitles(opts: SearchOpts): Promise<OsSearchHit[]> {
  const params = new URLSearchParams();
  if (opts.query) params.set('query', opts.query);
  const imdb = tt(opts.imdbId ?? undefined);
  if (imdb) params.set('imdb_id', imdb);
  if (opts.tmdbId) params.set('tmdb_id', String(opts.tmdbId));
  const pImdb = tt(opts.parentImdbId ?? undefined);
  if (pImdb) params.set('parent_imdb_id', pImdb);
  if (opts.parentTmdbId) params.set('parent_tmdb_id', String(opts.parentTmdbId));
  if (opts.season !== undefined) params.set('season_number', String(opts.season));
  if (opts.episode !== undefined) params.set('episode_number', String(opts.episode));
  if (opts.languages?.length) params.set('languages', opts.languages.join(','));
  if (opts.type) params.set('type', opts.type);
  params.set('order_by', 'download_count');

  const res = await fetch(`${BASE}/subtitles?${params}`, {
    headers: commonHeaders(),
  });
  if (!res.ok) throw new Error(`opensubs search ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as { data: OsSearchHit[] };
  return body.data;
}

export type DownloadInfo = {
  link: string;
  fileName: string;
  remaining: number;
  resetTimeUtc: string;
};

/** Request a one-time download link for the given subtitle file_id. */
export async function downloadSubtitle(fileId: number): Promise<DownloadInfo> {
  const res = await fetch(`${BASE}/download`, {
    method: 'POST',
    headers: { ...commonHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ file_id: fileId, sub_format: 'srt' }),
  });
  if (!res.ok) throw new Error(`opensubs download ${res.status}: ${await res.text()}`);
  const j = (await res.json()) as {
    link: string;
    file_name: string;
    remaining: number;
    reset_time_utc: string;
  };
  return {
    link: j.link,
    fileName: j.file_name,
    remaining: j.remaining,
    resetTimeUtc: j.reset_time_utc,
  };
}

export async function fetchSubtitleText(link: string): Promise<string> {
  const res = await fetch(link);
  if (!res.ok) throw new Error(`subtitle download ${res.status}`);
  return res.text();
}

// helper to silence the unused login marker for now
void login;
void tokenAt;
void token;
void TOKEN_TTL;
