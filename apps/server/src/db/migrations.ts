import type Database from 'better-sqlite3';

type Migration = {
  version: number;
  name: string;
  up: (db: Database.Database) => void;
};

function tableHasColumn(db: Database.Database, table: string, column: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return cols.some((c) => c.name === column);
}

const migrations: Migration[] = [
  {
    version: 1,
    name: 'netflix_grade_schema',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS profiles (
          id INTEGER PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          avatar TEXT,
          is_default INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL
        );

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

        CREATE INDEX IF NOT EXISTS idx_renditions_file ON renditions(file_id);
        CREATE INDEX IF NOT EXISTS idx_renditions_status ON renditions(status);
        CREATE INDEX IF NOT EXISTS idx_encode_jobs_state ON encode_jobs(state);
        CREATE INDEX IF NOT EXISTS idx_profiles_user ON profiles(user_id);
      `);

      const users = db.prepare('SELECT id FROM users').all() as { id: number }[];
      const insertProfile = db.prepare(`
        INSERT INTO profiles (user_id, name, avatar, is_default, created_at)
        VALUES (@user_id, @name, NULL, 1, @now)
      `);
      const findDefault = db.prepare(
        'SELECT id FROM profiles WHERE user_id = ? AND is_default = 1 LIMIT 1',
      );
      const now = Date.now();
      for (const u of users) {
        if (!findDefault.get(u.id)) {
          insertProfile.run({ user_id: u.id, name: 'Default', now });
        }
      }

      if (!tableHasColumn(db, 'progress', 'profile_id')) {
        db.exec(`
          CREATE TABLE progress_new (
            profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
            file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
            position REAL NOT NULL,
            duration REAL,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (profile_id, file_id)
          );
        `);
        const rows = db.prepare('SELECT user_id, file_id, position, duration, updated_at FROM progress').all() as {
          user_id: number;
          file_id: number;
          position: number;
          duration: number | null;
          updated_at: number;
        }[];
        const ins = db.prepare(`
          INSERT INTO progress_new (profile_id, file_id, position, duration, updated_at)
          VALUES (?, ?, ?, ?, ?)
        `);
        for (const r of rows) {
          const prof = findDefault.get(r.user_id) as { id: number } | undefined;
          if (!prof) continue;
          ins.run(prof.id, r.file_id, r.position, r.duration, r.updated_at);
        }
        db.exec('DROP TABLE progress');
        db.exec('ALTER TABLE progress_new RENAME TO progress');
        db.exec('CREATE INDEX IF NOT EXISTS idx_progress_profile ON progress(profile_id)');
      }

      if (!tableHasColumn(db, 'lists', 'profile_id')) {
        db.exec(`
          CREATE TABLE lists_new (
            profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
            title_id INTEGER NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
            kind TEXT NOT NULL DEFAULT 'watchlist' CHECK(kind IN ('watchlist','watched','hidden')),
            added_at INTEGER NOT NULL,
            PRIMARY KEY (profile_id, title_id, kind)
          );
        `);
        const rows = db.prepare('SELECT user_id, title_id, kind, added_at FROM lists').all() as {
          user_id: number;
          title_id: number;
          kind: string;
          added_at: number;
        }[];
        const ins = db.prepare(`
          INSERT INTO lists_new (profile_id, title_id, kind, added_at)
          VALUES (?, ?, ?, ?)
        `);
        for (const r of rows) {
          const prof = findDefault.get(r.user_id) as { id: number } | undefined;
          if (!prof) continue;
          ins.run(prof.id, r.title_id, r.kind, r.added_at);
        }
        db.exec('DROP TABLE lists');
        db.exec('ALTER TABLE lists_new RENAME TO lists');
        db.exec('CREATE INDEX IF NOT EXISTS idx_lists_profile ON lists(profile_id)');
      }

      if (!tableHasColumn(db, 'files', 'pinned')) {
        db.exec('ALTER TABLE files ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0');
      }
    },
  },
];

export function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `);

  const row = db.prepare('SELECT MAX(version) AS v FROM schema_version').get() as { v: number | null };
  const current = row.v ?? 0;

  for (const m of migrations) {
    if (m.version <= current) continue;
    const apply = db.transaction(() => {
      m.up(db);
      db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(
        m.version,
        Date.now(),
      );
    });
    apply();
  }
}
