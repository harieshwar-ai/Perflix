export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public payload?: unknown,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'include',
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  const contentType = res.headers.get('content-type') ?? '';
  const isJson = contentType.includes('application/json');
  const body = isJson ? await res.json() : await res.text();
  if (!res.ok) {
    const msg =
      isJson && typeof body === 'object' && body !== null && 'error' in body
        ? String((body as { error: unknown }).error)
        : res.statusText;
    throw new ApiError(msg, res.status, body);
  }
  return body as T;
}

export const api = {
  get<T>(path: string) {
    return request<T>(path);
  },
  post<T>(path: string, body?: unknown) {
    return request<T>(path, {
      method: 'POST',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  },
  delete<T>(path: string) {
    return request<T>(path, { method: 'DELETE' });
  },
};

// ----- response types -----

export type AuthState = {
  hasUser: boolean;
  authenticated: boolean;
  userId: number | null;
  credentialCount: number;
};

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
  genres: string[];
  runtime: number | null;
  rating: number | null;
  file_count: number;
  season_count: number;
  episode_count: number;
  added_at: number;
};

export type EpisodeRow = {
  id: number;
  title_id: number;
  season: number;
  episode: number;
  name: string | null;
  overview: string | null;
  still: string | null;
  air_date: string | null;
  file_id: number | null;
  position: number | null;
  duration: number | null;
  progress_updated_at?: number | null;
};

export type PlayTarget = {
  fileId: number;
  position: number;
  action: 'play' | 'resume';
};

export type QualityOption = {
  rung: string;
  height: number;
  label: string;
  streamUrl: string;
};

export type PlayContext = {
  file: { id: number; duration: number | null; width?: number | null; height?: number | null };
  title: {
    id: number;
    kind: 'movie' | 'series';
    title: string;
    backdrop: string | null;
  } | null;
  episode: { season: number; episode: number; name: string | null } | null;
  next: { file_id: number; season: number; episode: number; name: string | null } | null;
  prev: { file_id: number; season: number; episode: number; name: string | null } | null;
  subtitles: { id: number; lang: string; label: string | null; source: string; url: string }[];
  progress: { position: number; duration: number | null } | null;
  mode: 'direct' | 'remux' | 'transcode';
  preferDirect: boolean;
  streamUrl: string;
  qualities: QualityOption[];
  defaultQualityRung: string;
  thumbsMetaUrl: string;
  thumbsSpriteUrl: string;
};

export type TitleDetail = Title & {
  episodes?: EpisodeRow[];
  file?: {
    file_id: number;
    position: number | null;
    duration: number | null;
    progress_updated_at?: number | null;
  };
  playTarget?: PlayTarget | null;
};

export type SubtitleListItem = {
  id: number;
  lang: string;
  label: string | null;
  source: string;
  url: string;
};

export type OsSearchResult = {
  id: string;
  lang: string;
  release?: string;
  downloads?: number;
  hearingImpaired?: boolean;
  hd?: boolean;
  trusted?: boolean;
  fileId?: number;
  fileName?: string;
};
