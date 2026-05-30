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
  added_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS progress (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  position REAL NOT NULL,
  duration REAL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(user_id, file_id)
);

CREATE TABLE IF NOT EXISTS lists (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title_id INTEGER NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'watchlist' CHECK(kind IN ('watchlist','watched','hidden')),
  added_at INTEGER NOT NULL,
  PRIMARY KEY(user_id, title_id, kind)
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
CREATE INDEX IF NOT EXISTS idx_progress_user ON progress(user_id);
CREATE INDEX IF NOT EXISTS idx_lists_user ON lists(user_id);
