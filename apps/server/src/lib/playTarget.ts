import { db } from '../db/client.js';

const movieFile = db.prepare(`
  SELECT f.id AS file_id, p.position, p.duration, p.updated_at AS progress_updated_at
  FROM files f
  LEFT JOIN progress p ON p.file_id = f.id AND p.user_id = @user_id
  WHERE f.title_id = @title_id AND f.episode_id IS NULL
  LIMIT 1
`);

const seriesResume = db.prepare(`
  SELECT f.id AS file_id, p.position, p.duration, p.updated_at AS progress_updated_at
  FROM progress p
  JOIN files f ON f.id = p.file_id
  JOIN episodes e ON e.id = f.episode_id
  WHERE e.title_id = @title_id
    AND p.user_id = @user_id
    AND p.position > 30
    AND (p.duration IS NULL OR p.position / p.duration < 0.95)
  ORDER BY p.updated_at DESC
  LIMIT 1
`);

const seriesFirstEpisode = db.prepare(`
  SELECT f.id AS file_id
  FROM episodes e
  JOIN files f ON f.episode_id = e.id
  WHERE e.title_id = @title_id
  ORDER BY e.season ASC, e.episode ASC
  LIMIT 1
`);

export type PlayTarget = {
  fileId: number;
  position: number;
  action: 'play' | 'resume';
};

export function resolvePlayTarget(titleId: number, kind: 'movie' | 'series', userId: number): PlayTarget | null {
  if (kind === 'movie') {
    const row = movieFile.get({ title_id: titleId, user_id: userId }) as
      | { file_id: number; position: number | null; duration: number | null }
      | undefined;
    if (!row?.file_id) return null;
    const position = row.position ?? 0;
    const resume =
      position > 30 && (row.duration === null || position / row.duration < 0.95);
    return { fileId: row.file_id, position, action: resume ? 'resume' : 'play' };
  }

  const resumed = seriesResume.get({ title_id: titleId, user_id: userId }) as
    | { file_id: number; position: number; duration: number | null }
    | undefined;
  if (resumed?.file_id) {
    return { fileId: resumed.file_id, position: resumed.position, action: 'resume' };
  }

  const first = seriesFirstEpisode.get(titleId) as { file_id: number } | undefined;
  if (!first?.file_id) return null;
  return { fileId: first.file_id, position: 0, action: 'play' };
}
