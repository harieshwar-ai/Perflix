import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { motion, AnimatePresence } from 'framer-motion';
import { attachStream, fmtTime, type AttachHandle, type LevelInfo } from '../../lib/player.js';
import { api } from '../../lib/api.js';
import { SubtitlePicker } from './SubtitlePicker.js';

type Ctx = {
  file: { id: number; duration: number | null };
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
  thumbsMetaUrl: string;
  thumbsSpriteUrl: string;
};

type ThumbMeta = {
  tileWidth: number;
  tileHeight: number;
  cols: number;
  rows: number;
  count: number;
  intervalSec: number;
  duration: number;
};

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

export function PlayerView({ fileId, ctx }: { fileId: number; ctx: Ctx }) {
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<AttachHandle | null>(null);

  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(ctx.file.duration ?? 0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState<number>(1);
  const [levels, setLevels] = useState<LevelInfo[]>([]);
  const [currentLevel, setCurrentLevel] = useState<number | 'auto'>('auto');
  const [showControls, setShowControls] = useState(true);
  const [showSubs, setShowSubs] = useState(false);
  const [currentSub, setCurrentSub] = useState<number | 'off'>('off');
  const [thumbMeta, setThumbMeta] = useState<ThumbMeta | null>(null);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [hoverX, setHoverX] = useState<number>(0);

  const hideTimer = useRef<number | null>(null);

  const goBack = useCallback(() => {
    if (ctx.title) void navigate({ to: `/title/${ctx.title.id}` });
    else void navigate({ to: '/' });
  }, [ctx.title, navigate]);

  // attach stream + initial state
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const h = attachStream(video, ctx.streamUrl, ctx.preferDirect, setLevels);
    handleRef.current = h;

    const onLoaded = () => {
      const d = video.duration || ctx.file.duration || 0;
      setDuration(d);
      const resume = ctx.progress?.position ?? 0;
      if (resume > 30 && (!d || resume / d < 0.95)) {
        video.currentTime = resume;
      }
      void video.play().catch(() => {
        /* user gesture required */
      });
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onTime = () => setTime(video.currentTime);
    const onVol = () => {
      setVolume(video.volume);
      setMuted(video.muted);
    };
    const onRate = () => setSpeed(video.playbackRate);
    const onEnded = () => {
      if (ctx.next) void navigate({ to: `/play/${ctx.next.file_id}` });
    };

    video.addEventListener('loadedmetadata', onLoaded);
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('timeupdate', onTime);
    video.addEventListener('volumechange', onVol);
    video.addEventListener('ratechange', onRate);
    video.addEventListener('ended', onEnded);

    return () => {
      video.removeEventListener('loadedmetadata', onLoaded);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('timeupdate', onTime);
      video.removeEventListener('volumechange', onVol);
      video.removeEventListener('ratechange', onRate);
      video.removeEventListener('ended', onEnded);
      h.destroy();
      handleRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.streamUrl, ctx.preferDirect]);

  // subtitles: refresh whenever the picker changes
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    // wait one tick to allow tracks DOM update
    const id = window.setTimeout(() => {
      for (let i = 0; i < video.textTracks.length; i++) {
        const t = video.textTracks[i];
        if (!t) continue;
        t.mode = currentSub !== 'off' && Number(t.id) === currentSub ? 'showing' : 'disabled';
      }
    }, 30);
    return () => window.clearTimeout(id);
  }, [currentSub, ctx.subtitles]);

  // thumb meta
  useEffect(() => {
    let cancelled = false;
    fetch(ctx.thumbsMetaUrl)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d) setThumbMeta(d as ThumbMeta);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [ctx.thumbsMetaUrl]);

  // progress save every 5s
  useEffect(() => {
    const t = window.setInterval(() => {
      const v = videoRef.current;
      if (!v || v.paused) return;
      api
        .post('/api/progress', { fileId, position: v.currentTime, duration: v.duration || null })
        .catch(() => {});
    }, 5000);
    return () => window.clearInterval(t);
  }, [fileId]);

  // save on unload + pause
  useEffect(() => {
    const save = () => {
      const v = videoRef.current;
      if (!v) return;
      navigator.sendBeacon?.(
        '/api/progress',
        new Blob(
          [JSON.stringify({ fileId, position: v.currentTime, duration: v.duration || null })],
          { type: 'application/json' },
        ),
      );
    };
    window.addEventListener('pagehide', save);
    return () => {
      save();
      window.removeEventListener('pagehide', save);
    };
  }, [fileId]);

  // keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const v = videoRef.current;
      if (!v) return;
      if (e.target instanceof HTMLInputElement) return;
      switch (e.key) {
        case ' ':
        case 'k':
          e.preventDefault();
          if (v.paused) void v.play();
          else v.pause();
          break;
        case 'ArrowLeft':
          v.currentTime = Math.max(0, v.currentTime - 5);
          break;
        case 'ArrowRight':
          v.currentTime = Math.min(v.duration, v.currentTime + 5);
          break;
        case 'j':
          v.currentTime = Math.max(0, v.currentTime - 10);
          break;
        case 'l':
          v.currentTime = Math.min(v.duration, v.currentTime + 10);
          break;
        case 'ArrowUp':
          v.volume = Math.min(1, v.volume + 0.05);
          break;
        case 'ArrowDown':
          v.volume = Math.max(0, v.volume - 0.05);
          break;
        case 'm':
          v.muted = !v.muted;
          break;
        case 'f':
          void toggleFullscreen();
          break;
        case 'Escape':
          if (document.fullscreenElement) document.exitFullscreen();
          else goBack();
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goBack]);

  // controls auto-hide (fade after idle; stay visible when paused)
  useEffect(() => {
    const reset = () => {
      setShowControls(true);
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
      hideTimer.current = window.setTimeout(() => {
        if (!videoRef.current?.paused) setShowControls(false);
      }, 2500);
    };
    reset();
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener('mousemove', reset);
    el.addEventListener('touchstart', reset, { passive: true });
    el.addEventListener('mouseleave', () => {
      if (!videoRef.current?.paused) setShowControls(false);
    });
    return () => {
      el.removeEventListener('mousemove', reset);
      el.removeEventListener('touchstart', reset);
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
    };
  }, []);

  const progressPct = duration > 0 ? (time / duration) * 100 : 0;

  const thumbStyle = useMemo<React.CSSProperties | null>(() => {
    if (!thumbMeta || hoverTime === null) return null;
    const idx = Math.min(thumbMeta.count - 1, Math.floor(hoverTime / thumbMeta.intervalSec));
    const col = idx % thumbMeta.cols;
    const row = Math.floor(idx / thumbMeta.cols);
    return {
      width: thumbMeta.tileWidth,
      height: thumbMeta.tileHeight,
      backgroundImage: `url(${ctx.thumbsSpriteUrl})`,
      backgroundPosition: `-${col * thumbMeta.tileWidth}px -${row * thumbMeta.tileHeight}px`,
      backgroundRepeat: 'no-repeat',
    };
  }, [thumbMeta, hoverTime, ctx.thumbsSpriteUrl]);

  async function toggleFullscreen() {
    const el = containerRef.current;
    if (!el) return;
    if (!document.fullscreenElement) await el.requestFullscreen();
    else await document.exitFullscreen();
  }

  function seek(pct: number) {
    const v = videoRef.current;
    if (!v || !duration) return;
    v.currentTime = Math.max(0, Math.min(duration, duration * pct));
  }

  function onSeekBarMove(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pct = Math.max(0, Math.min(1, x / rect.width));
    setHoverTime(duration * pct);
    setHoverX(x);
  }

  return (
    <div ref={containerRef} className="fixed inset-0 z-[60] bg-black overflow-hidden">
      <video
        ref={videoRef}
        className="absolute inset-0 w-full h-full bg-black"
        playsInline
        crossOrigin="use-credentials"
        x-webkit-airplay="allow"
        onClick={() => {
          const v = videoRef.current;
          if (!v) return;
          if (v.paused) void v.play();
          else v.pause();
        }}
      >
        {ctx.subtitles.map((s) => (
          <track
            key={s.id}
            id={String(s.id)}
            kind="subtitles"
            src={s.url}
            srcLang={s.lang}
            label={s.label ?? s.lang}
          />
        ))}
      </video>

      <AnimatePresence mode="sync">
        {showControls ? (
          <>
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
              className="absolute inset-x-0 top-0 z-10 pt-4 px-6 pb-12 bg-gradient-to-b from-black/80 to-transparent flex items-start justify-between gap-4"
            >
              <button onClick={goBack} className="text-white/90 hover:text-white text-2xl">
                ←
              </button>
              <div className="text-right">
                <div className="text-sm font-semibold">{ctx.title?.title}</div>
                {ctx.episode ? (
                  <div className="text-xs text-neutral-400">
                    S{String(ctx.episode.season).padStart(2, '0')}E
                    {String(ctx.episode.episode).padStart(2, '0')}
                    {ctx.episode.name ? ` — ${ctx.episode.name}` : ''}
                  </div>
                ) : null}
                <div className="text-[10px] text-neutral-500 mt-1 uppercase tracking-wider">
                  {ctx.mode}
                </div>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 12 }}
              transition={{ duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
              className="absolute inset-x-0 bottom-0 z-10 px-6 pb-6 pt-16 bg-gradient-to-t from-black/85 via-black/40 to-transparent"
            >
              {/* progress bar */}
              <div
                className="relative h-2 group/seek mb-3"
                onMouseMove={onSeekBarMove}
                onMouseLeave={() => setHoverTime(null)}
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  seek((e.clientX - rect.left) / rect.width);
                }}
              >
                <div className="absolute inset-y-0 left-0 right-0 bg-white/20 rounded-full" />
                <div
                  className="absolute inset-y-0 left-0 bg-brand rounded-full"
                  style={{ width: `${progressPct}%` }}
                />
                <div
                  className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5 bg-brand rounded-full shadow-md opacity-0 group-hover/seek:opacity-100 transition-opacity"
                  style={{ left: `${progressPct}%` }}
                />
                {thumbStyle && hoverTime !== null ? (
                  <div
                    className="absolute bottom-full mb-3 pointer-events-none"
                    style={{
                      left: hoverX,
                      transform: 'translateX(-50%)',
                    }}
                  >
                    <div
                      className="rounded border border-white/20 shadow-2xl"
                      style={thumbStyle}
                    />
                    <div className="text-center text-xs mt-1 text-white drop-shadow">
                      {fmtTime(hoverTime)}
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <IconButton
                    onClick={() => {
                      const v = videoRef.current;
                      if (!v) return;
                      v.paused ? void v.play() : v.pause();
                    }}
                  >
                    {playing ? <PauseIcon /> : <PlayIcon />}
                  </IconButton>
                  <IconButton
                    onClick={() =>
                      videoRef.current && (videoRef.current.currentTime = Math.max(0, time - 5))
                    }
                  >
                    <Rewind5 />
                  </IconButton>
                  <IconButton
                    onClick={() =>
                      videoRef.current &&
                      (videoRef.current.currentTime = Math.min(duration, time + 5))
                    }
                  >
                    <Forward5 />
                  </IconButton>
                  {ctx.prev ? (
                    <IconButton
                      onClick={() => navigate({ to: `/play/${ctx.prev!.file_id}` })}
                      title="Previous episode"
                    >
                      <Prev />
                    </IconButton>
                  ) : null}
                  {ctx.next ? (
                    <IconButton
                      onClick={() => navigate({ to: `/play/${ctx.next!.file_id}` })}
                      title="Next episode"
                    >
                      <Next />
                    </IconButton>
                  ) : null}
                  <div className="flex items-center gap-2 ml-2 group/vol">
                    <IconButton
                      onClick={() => videoRef.current && (videoRef.current.muted = !muted)}
                    >
                      {muted || volume === 0 ? <MuteIcon /> : <VolumeIcon />}
                    </IconButton>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={muted ? 0 : volume}
                      onChange={(e) => {
                        const v = videoRef.current;
                        if (!v) return;
                        v.muted = false;
                        v.volume = Number(e.target.value);
                      }}
                      className="w-0 group-hover/vol:w-24 transition-[width] accent-white"
                    />
                  </div>
                  <span className="text-xs text-neutral-300 ml-2 tabular-nums">
                    {fmtTime(time)} / {fmtTime(duration)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Menu
                    label={`${speed}×`}
                    items={SPEEDS.map((s) => ({
                      label: `${s}×`,
                      onClick: () => videoRef.current && (videoRef.current.playbackRate = s),
                      active: s === speed,
                    }))}
                  />
                  {levels.length > 0 ? (
                    <Menu
                      label={currentLevel === 'auto' ? 'Auto' : `${levels[currentLevel as number]?.height ?? '?'}p`}
                      items={[
                        {
                          label: 'Auto',
                          onClick: () => {
                            handleRef.current?.setLevel(-1);
                            setCurrentLevel('auto');
                          },
                          active: currentLevel === 'auto',
                        },
                        ...levels
                          .slice()
                          .sort((a, b) => b.height - a.height)
                          .map((l) => ({
                            label: `${l.height}p`,
                            onClick: () => {
                              handleRef.current?.setLevel(l.index);
                              setCurrentLevel(l.index);
                            },
                            active: currentLevel === l.index,
                          })),
                      ]}
                    />
                  ) : null}
                  <IconButton onClick={() => setShowSubs(true)} title="Subtitles">
                    <SubsIcon />
                  </IconButton>
                  <IconButton onClick={toggleFullscreen} title="Fullscreen">
                    <FullscreenIcon />
                  </IconButton>
                </div>
              </div>
            </motion.div>
          </>
        ) : null}
      </AnimatePresence>

      <SubtitlePicker
        fileId={fileId}
        open={showSubs}
        onClose={() => setShowSubs(false)}
        current={currentSub}
        onSelect={(v) => {
          setCurrentSub(v);
          setShowSubs(false);
        }}
      />
    </div>
  );
}

function IconButton({
  children,
  onClick,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="w-9 h-9 grid place-items-center rounded-full hover:bg-white/15 text-white"
    >
      {children}
    </button>
  );
}

function Menu({
  label,
  items,
}: {
  label: string;
  items: { label: string; onClick: () => void; active?: boolean }[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="px-3 h-9 rounded-full text-xs text-white hover:bg-white/15 border border-white/15"
      >
        {label}
      </button>
      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            className="absolute bottom-full right-0 mb-2 min-w-[120px] bg-neutral-950 border border-white/10 rounded-md py-1 z-30"
            onMouseLeave={() => setOpen(false)}
          >
            {items.map((it, i) => (
              <button
                key={i}
                onClick={() => {
                  it.onClick();
                  setOpen(false);
                }}
                className={`block w-full text-left px-3 py-1.5 text-sm hover:bg-white/10 ${
                  it.active ? 'text-brand' : ''
                }`}
              >
                {it.label}
              </button>
            ))}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
      <path d="M8 5v14l11-7L8 5z" />
    </svg>
  );
}
function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
      <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
    </svg>
  );
}
function Rewind5() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 3v6h6" strokeLinecap="round" strokeLinejoin="round" />
      <text x="10" y="16" fontSize="7" fill="currentColor" stroke="none">
        5
      </text>
    </svg>
  );
}
function Forward5() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 12a9 9 0 1 1-3-6.7" />
      <path d="M21 3v6h-6" strokeLinecap="round" strokeLinejoin="round" />
      <text x="7" y="16" fontSize="7" fill="currentColor" stroke="none">
        5
      </text>
    </svg>
  );
}
function Prev() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
      <path d="M6 6h2v12H6zM20 6L9 12l11 6V6z" />
    </svg>
  );
}
function Next() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
      <path d="M16 6h2v12h-2zM4 6l11 6L4 18V6z" />
    </svg>
  );
}
function VolumeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
      <path d="M3 10v4h4l5 4V6L7 10H3zm13 2a4 4 0 0 0-2.5-3.7v7.4A4 4 0 0 0 16 12z" />
    </svg>
  );
}
function MuteIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
      <path d="M3 10v4h4l5 4V6L7 10H3zm14.6 2L20 9.4 18.6 8 16 10.6 13.4 8 12 9.4 14.6 12 12 14.6 13.4 16 16 13.4 18.6 16 20 14.6z" />
    </svg>
  );
}
function SubsIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
      <path d="M20 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zM4 12h4v2H4v-2zm10 6H4v-2h10v2zm6 0h-4v-2h4v2zm0-4H10v-2h10v2z" />
    </svg>
  );
}
function FullscreenIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
      <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zm-3-12v2h3v3h2V5h-5z" />
    </svg>
  );
}
