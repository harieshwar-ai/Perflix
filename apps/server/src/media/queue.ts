import type { FastifyBaseLogger } from 'fastify';
import { db } from '../db/client.js';
import { probeAndPersist, type ProbeResult } from './probe.js';
import { rungsFor } from './ladder.js';
import {
  aggregateEncodeProgress,
  ensureVideoRendition,
  getVideoRendition,
  listVideoRenditions,
} from './renditions.js';
import { encodeAudioRendition, encodeVideoRung, readyThroughSec, shouldReuseRendition } from './encoder.js';
import { renditionDir } from './renditions.js';
import { detectSkipMarkers } from './skip.js';
import { extractEmbeddedSubs } from '../subs/embedded.js';

const MAX_WORKERS = 2;
const PLAY_PRIORITY = 100;
const PREPARE_PRIORITY = 50;
const BOOT_PRIORITY = 10;

type QueueItem = { jobId: number; fileId: number; priority: number };

const pending: QueueItem[] = [];
const queuedIds = new Set<number>();
let activeWorkers = 0;
let bootstrapped = false;

const findFile = db.prepare('SELECT id, path FROM files WHERE id = ?');

const insertJob = db.prepare(`
  INSERT INTO encode_jobs (file_id, priority, state, created_at)
  VALUES (@file_id, @priority, 'queued', @now)
`);

const findActiveJob = db.prepare(`
  SELECT id, priority FROM encode_jobs
  WHERE file_id = ? AND state IN ('queued', 'running')
  ORDER BY id DESC LIMIT 1
`);

const bumpPriority = db.prepare(`
  UPDATE encode_jobs SET priority = MAX(priority, @priority)
  WHERE id = @id AND state = 'queued'
`);

const markRunning = db.prepare(`
  UPDATE encode_jobs SET state = 'running', started_at = @now WHERE id = @id
`);

const markDone = db.prepare(`
  UPDATE encode_jobs SET state = 'done', finished_at = @now WHERE id = @id
`);

const markFailed = db.prepare(`
  UPDATE encode_jobs SET state = 'failed', error = @error, finished_at = @now WHERE id = @id
`);

const resumeJobs = db.prepare(`
  SELECT id, file_id, priority FROM encode_jobs
  WHERE state IN ('queued', 'running')
  ORDER BY priority DESC, created_at ASC
`);

export function enqueueEncode(
  fileId: number,
  priority: number,
  log: FastifyBaseLogger,
): { jobId: number; queued: boolean } {
  const existing = findActiveJob.get(fileId) as { id: number; priority: number } | undefined;
  if (existing) {
    if (priority > existing.priority) bumpPriority.run({ id: existing.id, priority });
    if (!queuedIds.has(fileId)) {
      pending.push({ jobId: existing.id, fileId, priority: Math.max(priority, existing.priority) });
      queuedIds.add(fileId);
      sortPending();
      pump(log);
    }
    return { jobId: existing.id, queued: true };
  }

  const info = insertJob.run({ file_id: fileId, priority, now: Date.now() });
  const jobId = Number(info.lastInsertRowid);
  pending.push({ jobId, fileId, priority });
  queuedIds.add(fileId);
  sortPending();
  pump(log);
  return { jobId, queued: true };
}

export function enqueueOnPlay(fileId: number, log: FastifyBaseLogger): void {
  enqueueEncode(fileId, PLAY_PRIORITY, log);
}

export function enqueuePrepare(fileId: number, log: FastifyBaseLogger): void {
  enqueueEncode(fileId, PREPARE_PRIORITY, log);
}

export function resumeQueueOnBoot(log: FastifyBaseLogger): void {
  if (bootstrapped) return;
  bootstrapped = true;
  const rows = resumeJobs.all() as { id: number; file_id: number; priority: number }[];
  for (const r of rows) {
    if (queuedIds.has(r.file_id)) continue;
    pending.push({ jobId: r.id, fileId: r.file_id, priority: Math.max(r.priority, BOOT_PRIORITY) });
    queuedIds.add(r.file_id);
  }
  sortPending();
  pump(log);
}

function sortPending(): void {
  pending.sort((a, b) => b.priority - a.priority || a.jobId - b.jobId);
}

function pump(log: FastifyBaseLogger): void {
  while (activeWorkers < MAX_WORKERS && pending.length > 0) {
    const item = pending.shift()!;
    activeWorkers++;
    void runJob(item, log).finally(() => {
      activeWorkers--;
      queuedIds.delete(item.fileId);
      pump(log);
    });
  }
}

async function runJob(item: QueueItem, log: FastifyBaseLogger): Promise<void> {
  markRunning.run({ now: Date.now(), id: item.jobId });
  try {
    await encodeFile(item.fileId, log);
    markDone.run({ now: Date.now(), id: item.jobId });
  } catch (err) {
    markFailed.run({ error: String(err), now: Date.now(), id: item.jobId });
  }
}

async function encodeFile(fileId: number, log: FastifyBaseLogger): Promise<void> {
  const row = findFile.get(fileId) as { id: number; path: string } | undefined;
  if (!row) throw new Error('file not found');

  const probe = await probeAndPersist(fileId, row.path);
  if (probe.mode === 'direct') return;

  const rungs = rungsFor(probe);
  for (const rung of rungs) {
    const existing = getVideoRendition(fileId, rung);
    const dir = renditionDir(fileId, rung);
    if (existing?.status === 'ready' && shouldReuseRendition(dir, probe.duration)) continue;
    await encodeVideoRung(fileId, row.path, probe, rung, log);
  }

  if (probe.audioStreams.length > 1) {
    for (const audio of probe.audioStreams) {
      await encodeAudioRendition(fileId, row.path, probe, audio, log);
    }
  }

  void detectSkipMarkers(fileId, row.path, log);
  void extractEmbeddedSubs(fileId, row.path).catch(() => {});
}

export function getEncodeStatus(fileId: number): {
  state: 'none' | 'queued' | 'running' | 'ready' | 'failed';
  progressPct: number;
  readyThroughSec: number;
  renditions: ReturnType<typeof listVideoRenditions>;
} {
  const renditions = listVideoRenditions(fileId);
  const agg = aggregateEncodeProgress(fileId);
  const job = findActiveJob.get(fileId) as { id: number } | undefined;

  let state: 'none' | 'queued' | 'running' | 'ready' | 'failed' = 'none';
  if (agg.allReady) state = 'ready';
  else if (agg.status === 'failed') state = 'failed';
  else if (agg.status === 'encoding') state = 'running';
  else if (job) state = 'queued';

  const activeRung = renditions.find((r) => r.status === 'ready' || r.status === 'encoding');
  let readySec = 0;
  if (activeRung) {
    const durRow = db.prepare('SELECT duration FROM files WHERE id = ?').get(fileId) as
      | { duration: number | null }
      | undefined;
    readySec = readyThroughSec(renditionDir(fileId, activeRung.rung), durRow?.duration ?? 0);
  }

  return { state, progressPct: agg.progressPct, readyThroughSec: readySec, renditions };
}

export function listQueue(): Array<{
  id: number;
  file_id: number;
  priority: number;
  state: string;
  created_at: number;
}> {
  return db
    .prepare(
      `SELECT id, file_id, priority, state, created_at FROM encode_jobs
       WHERE state IN ('queued','running') ORDER BY priority DESC, created_at ASC`,
    )
    .all() as Array<{
    id: number;
    file_id: number;
    priority: number;
    state: string;
    created_at: number;
  }>;
}
