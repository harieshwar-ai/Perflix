import Hls, { ErrorDetails, ErrorTypes } from 'hls.js';

export type LevelInfo = { index: number; height: number; bitrate: number };

export type AttachHandle = {
  destroy: () => void;
  hls?: Hls;
  setQualityLock: (rung: string | 'auto') => void;
};

export type AttachOptions = {
  startPositionSec?: number;
  qualityLock?: string | 'auto';
  onLevels?: (levels: LevelInfo[]) => void;
  onProgress?: (pct: number) => void;
};

function isHlsPlaylist(url: string): boolean {
  return url.includes('.m3u8');
}

export function attachStream(
  video: HTMLVideoElement,
  url: string,
  preferDirect: boolean,
  opts: AttachOptions = {},
): AttachHandle {
  if (preferDirect || !isHlsPlaylist(url)) {
    video.src = url;
    return {
      destroy: () => {
        video.removeAttribute('src');
        video.load();
      },
      setQualityLock: () => {},
    };
  }

  if (!Hls.isSupported()) {
    video.src = url;
    return {
      destroy: () => {
        video.removeAttribute('src');
        video.load();
      },
      setQualityLock: () => {},
    };
  }

  const startPos =
    opts.startPositionSec && opts.startPositionSec > 0 ? opts.startPositionSec : -1;
  let qualityLock = opts.qualityLock ?? 'auto';

  const hls = new Hls({
    maxBufferLength: 30,
    maxMaxBufferLength: 60,
    enableWorker: true,
    lowLatencyMode: false,
    backBufferLength: 30,
    startPosition: startPos,
    startFragPrefetch: true,
    maxBufferHole: 0.5,
    maxFragLookUpTolerance: 0.25,
    maxLoadingDelay: 4,
    maxStarvationDelay: 4,
    manifestLoadingTimeOut: 30_000,
    levelLoadingTimeOut: 30_000,
    fragLoadingTimeOut: 60_000,
    fragLoadingMaxRetry: 12,
    fragLoadingRetryDelay: 1500,
  });

  hls.loadSource(url);
  hls.attachMedia(video);

  hls.on(Hls.Events.MANIFEST_PARSED, () => {
    const levels: LevelInfo[] = hls.levels.map((l, index) => ({
      index,
      height: l.height,
      bitrate: l.bitrate,
    }));
    opts.onLevels?.(levels);
    applyQualityLock();
  });

  hls.on(Hls.Events.FRAG_LOADED, () => {
    if (video.buffered.length > 0 && video.duration > 0) {
      const end = video.buffered.end(video.buffered.length - 1);
      opts.onProgress?.(Math.min(100, (end / video.duration) * 100));
    }
  });

  function applyQualityLock() {
    if (qualityLock === 'auto') {
      hls.currentLevel = -1;
      return;
    }
    const target = hls.levels.findIndex((l) => {
      const h = l.height || 0;
      if (qualityLock === '2160' || qualityLock === 'hevc-hdr') return h >= 2000;
      if (qualityLock === '1080') return h >= 1000 && h < 2000;
      if (qualityLock === '720') return h >= 700 && h < 1000;
      if (qualityLock === '480') return h < 700;
      if (qualityLock === 'src') return true;
      return false;
    });
    hls.currentLevel = target >= 0 ? target : hls.levels.length - 1;
  }

  hls.on(Hls.Events.ERROR, (_evt, data) => {
    if (!data.fatal) return;
    if (data.type === ErrorTypes.MEDIA_ERROR) {
      hls.recoverMediaError();
      return;
    }
    if (data.type === ErrorTypes.NETWORK_ERROR) {
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
    hls,
    destroy: () => hls.destroy(),
    setQualityLock: (rung) => {
      qualityLock = rung;
      if (hls.levels.length) applyQualityLock();
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
