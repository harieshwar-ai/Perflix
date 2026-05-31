import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { RUNG_ENCODE, RUNG_RES, rungsFor, type Rung } from './ladder.js';
import type { ProbeResult } from './probe.js';
import type { RenditionRow } from './renditions.js';
import { listAudioRenditions, listVideoRenditions } from './renditions.js';

const H264_CODEC = 'avc1.640028,mp4a.40.2';
const HEVC_CODEC = 'hvc1.1.6.L153.B0,mp4a.40.2';

function codecForRung(rung: Rung): string {
  return rung === 'hevc-hdr' ? HEVC_CODEC : H264_CODEC;
}

export function buildMasterPlaylist(
  fileId: number,
  probe: ProbeResult,
  videoRenditions: RenditionRow[],
  audioRenditions: RenditionRow[],
): string {
  const lines: string[] = ['#EXTM3U', '#EXT-X-VERSION:7'];

  const readyAudio = audioRenditions.filter((a) => a.status === 'ready' || a.status === 'encoding');
  for (const a of readyAudio) {
    const lang = a.lang ?? 'und';
    const name = a.label ?? lang;
    const isDefault = readyAudio[0]?.id === a.id ? 'YES' : 'NO';
    lines.push(
      `#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="${name}",LANGUAGE="${lang}",DEFAULT=${isDefault},AUTOSELECT=YES,URI="audio/${lang}/playlist.m3u8"`,
    );
  }

  const audioGroup = readyAudio.length ? ',AUDIO="audio"' : '';
  let usable = videoRenditions.filter((r) => r.status !== 'failed');

  if (usable.length === 0) {
    usable = rungsFor(probe).map(
      (rung) =>
        ({
          rung,
          bandwidth: RUNG_ENCODE[rung]?.bandwidth ?? null,
          width: RUNG_RES[rung]?.[0] ?? probe.width,
          height: RUNG_RES[rung]?.[1] ?? probe.height,
          status: 'pending',
        }) as RenditionRow,
    );
  }

  for (const r of usable) {
    const rung = r.rung as Rung;
    const [w, h] = RUNG_RES[rung] ?? [r.width ?? probe.width ?? 0, r.height ?? probe.height ?? 0];
    const bw = r.bandwidth ?? RUNG_ENCODE[rung]?.bandwidth ?? 5_000_000;
    lines.push(
      `#EXT-X-STREAM-INF:BANDWIDTH=${bw},RESOLUTION=${w}x${h},CODECS="${codecForRung(rung)}"${audioGroup}`,
      `${rung}/playlist.m3u8`,
    );
  }

  return lines.join('\n') + '\n';
}

export function readMediaPlaylist(playlistPath: string, fallbackDuration?: number): string | null {
  if (!existsSync(playlistPath)) {
    if (fallbackDuration && fallbackDuration > 0) return null;
    return null;
  }
  return readFileSync(playlistPath, 'utf8');
}

export function masterForFile(fileId: number, probe: ProbeResult): string {
  const videos = listVideoRenditions(fileId);
  const audio = listAudioRenditions(fileId);
  return buildMasterPlaylist(fileId, probe, videos, audio);
}
