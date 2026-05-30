import Hls from 'hls.js';

export type LevelInfo = { index: number; height: number; bitrate: number };

export function canPlayNativeHls(video: HTMLVideoElement): boolean {
  return video.canPlayType('application/vnd.apple.mpegurl') !== '';
}

export type AttachHandle = {
  destroy: () => void;
  setLevel: (index: number) => void;
  getLevels: () => LevelInfo[];
};

export function attachStream(
  video: HTMLVideoElement,
  url: string,
  preferDirect: boolean,
  onLevels: (levels: LevelInfo[]) => void,
): AttachHandle {
  if (preferDirect) {
    video.src = url;
    return {
      destroy: () => {
        video.removeAttribute('src');
        video.load();
      },
      setLevel: () => {},
      getLevels: () => [],
    };
  }

  if (canPlayNativeHls(video)) {
    video.src = url;
    onLevels([]);
    return {
      destroy: () => {
        video.removeAttribute('src');
        video.load();
      },
      setLevel: () => {},
      getLevels: () => [],
    };
  }

  if (!Hls.isSupported()) {
    video.src = url;
    return {
      destroy: () => {
        video.removeAttribute('src');
        video.load();
      },
      setLevel: () => {},
      getLevels: () => [],
    };
  }

  const hls = new Hls({
    maxBufferLength: 30,
    maxMaxBufferLength: 60,
    enableWorker: true,
    lowLatencyMode: false,
    backBufferLength: 30,
  });
  hls.loadSource(url);
  hls.attachMedia(video);
  hls.on(Hls.Events.MANIFEST_PARSED, () => {
    const ls: LevelInfo[] = hls.levels.map((l, i) => ({
      index: i,
      height: l.height,
      bitrate: l.bitrate,
    }));
    onLevels(ls);
  });
  hls.on(Hls.Events.ERROR, (_evt, data) => {
    if (data.fatal) {
      // Try recover on network/media; HLS fatal is unrecoverable
      switch (data.type) {
        case Hls.ErrorTypes.NETWORK_ERROR:
          hls.startLoad();
          break;
        case Hls.ErrorTypes.MEDIA_ERROR:
          hls.recoverMediaError();
          break;
      }
    }
  });
  return {
    destroy: () => {
      hls.destroy();
      video.removeAttribute('src');
      video.load();
    },
    setLevel: (i) => {
      hls.nextLevel = i;
      hls.currentLevel = i;
    },
    getLevels: () =>
      hls.levels.map((l, i) => ({ index: i, height: l.height, bitrate: l.bitrate })),
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
