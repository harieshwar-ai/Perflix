CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS credentials (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_key BLOB NOT NULL,
  counter INTEGER NOT NULL,
  transports TEXT,
  device_name TEXT,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);

CREATE TABLE IF NOT EXISTS titles (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('movie','series')),
  tmdb_id INTEGER,
  imdb_id TEXT,
  title TEXT NOT NULL,
  year INTEGER,
  overview TEXT,
  poster TEXT,
  backdrop TEXT,
  logo TEXT,
  genres TEXT,
  runtime INTEGER,
  rating REAL,
  added_at INTEGER NOT NULL,
  refreshed_at INTEGER,
  UNIQUE(kind, tmdb_id)
);

CREATE TABLE IF NOT EXISTS episodes (
  id INTEGER PRIMARY KEY,
  title_id INTEGER NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  season INTEGER NOT NULL,
  episode INTEGER NOT NULL,
  name TEXT,
  overview TEXT,
  still TEXT,
  air_date TEXT,
  UNIQUE(title_id, season, episode)
);

CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY,
  title_id INTEGER REFERENCES titles(id) ON DELETE CASCADE,
  episode_id INTEGER REFERENCES episodes(id) ON DELETE CASCADE,
  path TEXT NOT NULL UNIQUE,
  size INTEGER NOT NULL,
  mtime INTEGER NOT NULL,
  duration REAL,
  container TEXT,
  vcodec TEXT,
  acodec TEXT,
  width INTEGER,
  height INTEGER,
  mode TEXT CHECK(mode IN ('direct','remux','transcode')),
  probed_at INTEGER,
  added_at INTEGER NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS profiles (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  avatar TEXT,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS progress (
  profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  position REAL NOT NULL,
  duration REAL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(profile_id, file_id)
);

CREATE TABLE IF NOT EXISTS lists (
  profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title_id INTEGER NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'watchlist' CHECK(kind IN ('watchlist','watched','hidden')),
  added_at INTEGER NOT NULL,
  PRIMARY KEY(profile_id, title_id, kind)
);

CREATE TABLE IF NOT EXISTS subtitles (
  id INTEGER PRIMARY KEY,
  file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  lang TEXT NOT NULL,
  label TEXT,
  path TEXT NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('local','opensubs')),
  added_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_files_path ON files(path);
CREATE INDEX IF NOT EXISTS idx_files_title ON files(title_id);
CREATE INDEX IF NOT EXISTS idx_episodes_title ON episodes(title_id);
CREATE INDEX IF NOT EXISTS idx_progress_profile ON progress(profile_id);
CREATE INDEX IF NOT EXISTS idx_lists_profile ON lists(profile_id);
CREATE INDEX IF NOT EXISTS idx_profiles_user ON profiles(user_id);

CREATE TABLE IF NOT EXISTS profile_prefs (
  profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (profile_id, key)
);

CREATE TABLE IF NOT EXISTS renditions (
  id INTEGER PRIMARY KEY,
  file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('video','audio','sub')),
  rung TEXT NOT NULL,
  lang TEXT,
  label TEXT,
  codec TEXT,
  container TEXT DEFAULT 'fmp4',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','encoding','ready','failed')),
  progress_pct REAL NOT NULL DEFAULT 0,
  playlist_path TEXT,
  init_path TEXT,
  bytes INTEGER NOT NULL DEFAULT 0,
  bandwidth INTEGER,
  width INTEGER,
  height INTEGER,
  hdr INTEGER NOT NULL DEFAULT 0,
  pinned INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  updated_at INTEGER NOT NULL,
  UNIQUE(file_id, kind, rung, lang)
);

CREATE TABLE IF NOT EXISTS encode_jobs (
  id INTEGER PRIMARY KEY,
  file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  priority INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'queued'
    CHECK(state IN ('queued','running','done','failed','cancelled')),
  error TEXT,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER
);

CREATE TABLE IF NOT EXISTS skip_markers (
  file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('intro','recap','credits')),
  start_sec REAL NOT NULL,
  end_sec REAL NOT NULL,
  confidence REAL,
  PRIMARY KEY (file_id, kind)
);

CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_renditions_file ON renditions(file_id);
CREATE INDEX IF NOT EXISTS idx_renditions_status ON renditions(status);
CREATE INDEX IF NOT EXISTS idx_encode_jobs_state ON encode_jobs(state);
