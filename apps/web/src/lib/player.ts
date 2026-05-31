import Hls, { ErrorDetails, ErrorTypes } from 'hls.js';

export type LevelInfo = { index: number; height: number; bitrate: number };

export type AttachHandle = {
  destroy: () => void;
};

function isHlsPlaylist(url: string): boolean {
  return url.includes('.m3u8');
}

export function attachStream(
  video: HTMLVideoElement,
  url: string,
  preferDirect: boolean,
  startPositionSec?: number,
): AttachHandle {
  if (preferDirect || !isHlsPlaylist(url)) {
    video.src = url;
    return {
      destroy: () => {
        video.removeAttribute('src');
        video.load();
      },
    };
  }

  if (!Hls.isSupported()) {
    video.src = url;
    return {
      destroy: () => {
        video.removeAttribute('src');
        video.load();
      },
    };
  }

  const startPos = startPositionSec && startPositionSec > 0 ? startPositionSec : -1;

  const hls = new Hls({
    maxBufferLength: 20,
    maxMaxBufferLength: 40,
    enableWorker: true,
    lowLatencyMode: false,
    backBufferLength: 20,
    startPosition: startPos,
    startFragPrefetch: false,
    maxBufferHole: 1,
    maxFragLookUpTolerance: 0.25,
    maxLoadingDelay: 8,
    maxStarvationDelay: 8,
    manifestLoadingTimeOut: 20_000,
    levelLoadingTimeOut: 20_000,
    fragLoadingTimeOut: 120_000,
    fragLoadingMaxRetry: 20,
    fragLoadingRetryDelay: 2000,
  });

  hls.loadSource(url);
  hls.attachMedia(video);

  hls.on(Hls.Events.ERROR, (_evt, data) => {
    if (!data.fatal) return;
    if (data.type === ErrorTypes.MEDIA_ERROR) {
      hls.recoverMediaError();
      return;
    }
    if (data.type === ErrorTypes.NETWORK_ERROR) {
      // Only restart manifest/level loads. Never restart fragment loading from t=0 —
      // that replays the studio intro when the next segment is still transcoding.
      const manifestish =
        data.details === ErrorDetails.MANIFEST_LOAD_ERROR ||
        data.details === ErrorDetails.MANIFEST_PARSING_ERROR ||
        data.details === ErrorDetails.LEVEL_LOAD_ERROR ||
        data.details === ErrorDetails.LEVEL_PARSING_ERROR;
      if (manifestish) {
        const pos = video.currentTime;
        hls.startLoad(pos > 0.5 ? pos : startPos > 0 ? startPos : undefined);
      }
    }
  });

  return {
    destroy: () => {
      hls.destroy();
    },
  };
}

export function fmtTime(t: number): string {
  if (!Number.isFinite(t) || t < 0) t = 0;
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}
