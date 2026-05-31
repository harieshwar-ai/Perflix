import { useEffect, useMemo, useRef, useState, useCallback, type CSSProperties } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { motion, AnimatePresence } from 'framer-motion';
import { attachStream, fmtTime } from '../../lib/player.js';
import { cueAt, fetchSubtitleCues, type VttCue } from '../../lib/subtitles.js';
import { api, type PlayContext, type QualityOption, type SubtitleListItem } from '../../lib/api.js';
import { SubtitlePicker } from './SubtitlePicker.js';
import { LoadingScreen } from '../ui/LoadingScreen.js';

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

function subtitleOverlayStyle(style: Record<string, string> | null | undefined): CSSProperties {
  return {
    fontFamily: style?.font ?? 'system-ui, sans-serif',
    fontSize: style?.size ?? '1.1em',
    color: style?.color ?? '#fff',
    background: style?.bg ?? 'rgba(0,0,0,0.6)',
  };
}

/** Event HLS exposes only encoded segments in video.duration (~4s early on). */
function resolveTimelineDuration(
  videoDur: number,
  probed: number,
  preferDirect: boolean,
): number {
  if (probed > 0 && !preferDirect) {
    if (!Number.isFinite(videoDur) || videoDur <= 0) return probed;
    if (videoDur < probed * 0.95) return probed;
    return Math.max(probed, videoDur);
  }
  if (probed > 0) return Math.max(probed, videoDur || 0);
  return videoDur || 0;
}

export function PlayerView({ fileId, ctx }: { fileId: number; ctx: PlayContext }) {
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const seekBarRef = useRef<HTMLDivElement>(null);
  const pendingSeekRef = useRef<number | null>(null);
  const handleRef = useRef<ReturnType<typeof attachStream> | null>(null);

  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(ctx.file.duration ?? 0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState<number>(1);
  const [qualityRung, setQualityRung] = useState(ctx.defaultQualityRung);
  const [streamUrl, setStreamUrl] = useState(ctx.streamUrl);
  const [showControls, setShowControls] = useState(true);
  const [showSubs, setShowSubs] = useState(false);
  const [currentSub, setCurrentSub] = useState<number | 'off'>('off');
  const [subtitleTracks, setSubtitleTracks] = useState(ctx.subtitles);
  const [subCues, setSubCues] = useState<VttCue[]>([]);
  const [subCueText, setSubCueText] = useState<string | null>(null);
  const [thumbMeta, setThumbMeta] = useState<ThumbMeta | null>(null);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [hoverX, setHoverX] = useState<number>(0);
  const [scrubbing, setScrubbing] = useState(false);
  const [scrubTime, setScrubTime] = useState<number | null>(null);
  const [showLoader, setShowLoader] = useState(true);
  const [encodePct, setEncodePct] = useState(ctx.encode.progressPct);
  const [encodeState, setEncodeState] = useState(ctx.encode.state);
  const [readyThrough, setReadyThrough] = useState(ctx.encode.readyThroughSec);
  const [showSkipIntro, setShowSkipIntro] = useState(false);
  const [showSkipCredits, setShowSkipCredits] = useState(false);
  const [audioLang, setAudioLang] = useState<string | null>(null);

  const hideTimer = useRef<number | null>(null);
  const scrubbingRef = useRef(false);
  const hasStartedRef = useRef(false);
  scrubbingRef.current = scrubbing;

  const introMarker = ctx.skipMarkers.find((m) => m.kind === 'intro');
  const creditsMarker = ctx.skipMarkers.find((m) => m.kind === 'credits');
  const subOverlayStyle = subtitleOverlayStyle(ctx.subtitleStyle);
  const probedDuration = ctx.file.duration ?? 0;

  const goBack = useCallback(() => {
    if (ctx.title) void navigate({ to: `/title/${ctx.title.id}` });
    else void navigate({ to: '/' });
  }, [ctx.title, navigate]);

  const displayTime = scrubTime ?? time;
  const progressPct = duration > 0 ? (displayTime / duration) * 100 : 0;
  const encodedPct =
    duration > 0 && !ctx.preferDirect && encodeState !== 'ready'
      ? Math.min(100, (readyThrough / duration) * 100)
      : 100;

  const currentQuality = useMemo(
    () => ctx.qualities.find((q) => q.rung === qualityRung) ?? ctx.qualities[0],
    [ctx.qualities, qualityRung],
  );

  const pctFromClientX = useCallback(
    (clientX: number) => {
      const rect = seekBarRef.current?.getBoundingClientRect();
      if (!rect?.width) return 0;
      return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    },
    [],
  );

  const seekToTime = useCallback(
    (t: number, updateVideo = true) => {
      const clamped = Math.max(0, Math.min(duration, t));
      setScrubTime(null);
      setTime(clamped);
      if (updateVideo && videoRef.current) {
        videoRef.current.currentTime = clamped;
      }
    },
    [duration],
  );

  const changeQuality = useCallback(
    (q: QualityOption) => {
      if (q.rung === qualityRung) return;
      const v = videoRef.current;
      if (v && Number.isFinite(v.currentTime)) pendingSeekRef.current = v.currentTime;
      setQualityRung(q.rung);
      setStreamUrl(q.streamUrl);
      handleRef.current?.setQualityLock(q.rung === 'direct' ? 'auto' : q.rung);
      void api.post('/api/profiles/prefs', {
        key: 'qualityLock',
        value: q.rung === 'direct' ? 'auto' : q.rung,
      });
    },
    [qualityRung],
  );

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let cancelled = false;
    let streamHandle: ReturnType<typeof attachStream> | null = null;

    setShowLoader(true);
    hasStartedRef.current = false;
    const pending = pendingSeekRef.current;
    pendingSeekRef.current = null;
    const rawResume = pending ?? ctx.progress?.position ?? 0;
    const d0 = ctx.file.duration ?? 0;
    const shouldResume = rawResume > 30 && (d0 === 0 || rawResume / d0 < 0.95);
    const startPosition = shouldResume ? (pending ?? ctx.playbackStartSec) : undefined;
    const playbackUrl = streamUrl;

    const onLoaded = () => {
      setDuration(resolveTimelineDuration(video.duration, probedDuration, ctx.preferDirect));
      if (shouldResume && startPosition != null) {
        if (ctx.preferDirect) video.currentTime = rawResume;
        setTime(startPosition);
      }
    };
    const onDurationChange = () => {
      setDuration((cur) =>
        Math.max(cur, resolveTimelineDuration(video.duration, probedDuration, ctx.preferDirect)),
      );
    };
    const onCanPlay = () => {
      setShowLoader(false);
      if (video.paused) void video.play().catch(() => {});
    };
    const onPlaying = () => {
      setPlaying(true);
      hasStartedRef.current = true;
      setShowLoader(false);
    };
    const onPause = () => setPlaying(false);
    const onWaiting = () => {
      if (hasStartedRef.current) setShowLoader(true);
    };
    const onTime = () => {
      if (!scrubbingRef.current) {
        setTime(video.currentTime);
        if (introMarker && video.currentTime >= introMarker.startSec && video.currentTime < introMarker.endSec - 2) {
          setShowSkipIntro(true);
        } else {
          setShowSkipIntro(false);
        }
        if (creditsMarker && video.currentTime >= creditsMarker.startSec) {
          setShowSkipCredits(true);
        } else {
          setShowSkipCredits(false);
        }
      }
    };
    const onVol = () => {
      setVolume(video.volume);
      setMuted(video.muted);
    };
    const onRate = () => setSpeed(video.playbackRate);
    const onEnded = () => {
      if (ctx.next) void navigate({ to: `/play/${ctx.next.file_id}` });
    };

    video.addEventListener('loadedmetadata', onLoaded);
    video.addEventListener('durationchange', onDurationChange);
    video.addEventListener('canplay', onCanPlay);
    video.addEventListener('playing', onPlaying);
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('pause', onPause);
    video.addEventListener('timeupdate', onTime);
    video.addEventListener('volumechange', onVol);
    video.addEventListener('ratechange', onRate);
    video.addEventListener('ended', onEnded);

    // Defer attach so React StrictMode's mount→unmount→mount cycle doesn't
    // attach, destroy, and re-attach (which replays the opening segment).
    const attachTimer = window.setTimeout(() => {
      if (cancelled) return;
      streamHandle = attachStream(video, playbackUrl, ctx.preferDirect, {
        startPositionSec: startPosition,
        qualityLock: qualityRung === 'direct' ? 'auto' : qualityRung,
      });
      handleRef.current = streamHandle;
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(attachTimer);
      video.removeEventListener('loadedmetadata', onLoaded);
      video.removeEventListener('durationchange', onDurationChange);
      video.removeEventListener('canplay', onCanPlay);
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('timeupdate', onTime);
      video.removeEventListener('volumechange', onVol);
      video.removeEventListener('ratechange', onRate);
      video.removeEventListener('ended', onEnded);
      streamHandle?.destroy();
      if (handleRef.current === streamHandle) handleRef.current = null;
    };
  }, [streamUrl, ctx.preferDirect, ctx.playbackStartSec, probedDuration, ctx.progress?.position, ctx.next, navigate, qualityRung, introMarker, creditsMarker]);

  useEffect(() => {
    if (ctx.preferDirect || encodeState === 'ready') return;
    const poll = window.setInterval(() => {
      api
        .get<{ progressPct: number; state: string; readyThroughSec: number }>(`/api/play/${fileId}/encode-status`)
        .then((s) => {
          setEncodePct(s.progressPct);
          setEncodeState(s.state as typeof encodeState);
          setReadyThrough(s.readyThroughSec);
        })
        .catch(() => {});
    }, 3000);
    return () => window.clearInterval(poll);
  }, [fileId, ctx.preferDirect, encodeState]);

  const handleSubSelect = useCallback((choice: number | 'off', sub?: SubtitleListItem) => {
    setCurrentSub(choice);
    if (sub) {
      setSubtitleTracks((prev) => (prev.some((s) => s.id === sub.id) ? prev : [...prev, sub]));
    }
    setShowSubs(false);
  }, []);

  useEffect(() => {
    if (currentSub === 'off') {
      setSubCues([]);
      setSubCueText(null);
      return;
    }

    const sub = subtitleTracks.find((s) => s.id === currentSub);
    if (!sub) return;

    let cancelled = false;
    fetchSubtitleCues(sub.url)
      .then((cues) => {
        if (!cancelled) setSubCues(cues);
      })
      .catch(() => {
        if (!cancelled) setSubCues([]);
      });

    return () => {
      cancelled = true;
    };
  }, [currentSub, subtitleTracks]);

  useEffect(() => {
    if (currentSub === 'off' || subCues.length === 0) {
      setSubCueText(null);
      return;
    }
    setSubCueText(cueAt(subCues, time));
  }, [time, subCues, currentSub]);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      fetch(ctx.thumbsMetaUrl, { credentials: 'include' })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!cancelled && d) setThumbMeta(d as ThumbMeta);
        })
        .catch(() => {});
    }, 5000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [ctx.thumbsMetaUrl]);

  useEffect(() => {
    const t = window.setInterval(() => {
      const v = videoRef.current;
      if (!v || v.paused || scrubbing) return;
      api
        .post('/api/progress', {
          fileId,
          position: v.currentTime,
          duration: duration > 0 ? duration : v.duration || null,
        })
        .catch(() => {});
    }, 5000);
    return () => window.clearInterval(t);
  }, [fileId, scrubbing, duration, probedDuration]);

  useEffect(() => {
    const save = () => {
      const v = videoRef.current;
      if (!v) return;
      navigator.sendBeacon?.(
        '/api/progress',
        new Blob(
          [JSON.stringify({ fileId, position: v.currentTime, duration: duration > 0 ? duration : v.duration || null })],
          { type: 'application/json' },
        ),
      );
    };
    window.addEventListener('pagehide', save);
    return () => {
      save();
      window.removeEventListener('pagehide', save);
    };
  }, [fileId, duration, probedDuration]);

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
          seekToTime(v.currentTime - 5);
          break;
        case 'ArrowRight':
          seekToTime(v.currentTime + 5);
          break;
        case 'j':
          seekToTime(v.currentTime - 10);
          break;
        case 'l':
          seekToTime(v.currentTime + 10);
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
  }, [goBack, seekToTime]);

  useEffect(() => {
    const reset = () => {
      setShowControls(true);
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
      hideTimer.current = window.setTimeout(() => {
        if (!videoRef.current?.paused && !scrubbing) setShowControls(false);
      }, 2500);
    };
    reset();
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener('mousemove', reset);
    el.addEventListener('touchstart', reset, { passive: true });
    el.addEventListener('mouseleave', () => {
      if (!videoRef.current?.paused && !scrubbing) setShowControls(false);
    });
    return () => {
      el.removeEventListener('mousemove', reset);
      el.removeEventListener('touchstart', reset);
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
    };
  }, [scrubbing]);

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
      backgroundSize: `${thumbMeta.cols * thumbMeta.tileWidth}px ${thumbMeta.rows * thumbMeta.tileHeight}px`,
      backgroundRepeat: 'no-repeat',
    };
  }, [thumbMeta, hoverTime, ctx.thumbsSpriteUrl]);

  async function toggleFullscreen() {
    const el = containerRef.current;
    if (!el) return;
    if (!document.fullscreenElement) await el.requestFullscreen();
    else await document.exitFullscreen();
  }

  function updateHover(clientX: number) {
    const rect = seekBarRef.current?.getBoundingClientRect();
    if (!rect) return;
    const pct = pctFromClientX(clientX);
    const t = duration * pct;
    setHoverTime(t);
    setHoverX(clientX - rect.left);
    return t;
  }

  function onSeekPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setScrubbing(true);
    setShowControls(true);
    const t = updateHover(e.clientX) ?? 0;
    setScrubTime(t);
    setTime(t);
  }

  function onSeekPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (scrubbing) {
      const t = updateHover(e.clientX) ?? 0;
      setScrubTime(t);
      setTime(t);
    } else {
      updateHover(e.clientX);
    }
  }

  function onSeekPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (!scrubbing) return;
    const pct = pctFromClientX(e.clientX);
    seekToTime(duration * pct);
    setScrubbing(false);
    setHoverTime(null);
    e.currentTarget.releasePointerCapture(e.pointerId);
  }

  return (
    <div ref={containerRef} className="fixed inset-0 z-[60] bg-black overflow-hidden select-none">
      <video
        ref={videoRef}
        className="absolute inset-0 w-full h-full bg-black"
        playsInline
        crossOrigin="use-credentials"
        x-webkit-airplay="allow"
        onClick={() => {
          if (scrubbing) return;
          const v = videoRef.current;
          if (!v) return;
          if (v.paused) void v.play();
          else v.pause();
        }}
      />

      {subCueText ? (
        <div className="absolute inset-x-0 bottom-[14%] z-[55] flex justify-center px-6 pointer-events-none">
          <p
            className="max-w-[85%] text-center leading-snug whitespace-pre-wrap rounded px-3 py-1.5 shadow-lg"
            style={subOverlayStyle}
          >
            {subCueText}
          </p>
        </div>
      ) : null}

      <AnimatePresence>
        {showLoader || (encodeState !== 'ready' && !ctx.preferDirect && time > readyThrough + 2) ? (
          <motion.div
            key="player-loader"
            className="absolute inset-0 z-[70] pointer-events-none"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.32, 0.72, 0, 1] }}
          >
            <LoadingScreen
              overlay
              label={
                encodeState !== 'ready' && !ctx.preferDirect
                  ? `Preparing ${Math.round(encodePct)}%`
                  : 'Starting playback…'
              }
            />
            {encodeState !== 'ready' && !ctx.preferDirect ? (
              <div className="absolute bottom-24 inset-x-0 px-12">
                <div className="h-1 bg-white/20 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-brand transition-all duration-500"
                    style={{ width: `${encodePct}%` }}
                  />
                </div>
              </div>
            ) : null}
          </motion.div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {showSkipIntro && introMarker ? (
          <motion.button
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            className="absolute right-8 bottom-32 z-20 px-5 py-2 rounded bg-white/90 text-black font-semibold text-sm hover:bg-white"
            onClick={() => seekToTime(introMarker.endSec)}
          >
            Skip Intro
          </motion.button>
        ) : null}
        {showSkipCredits && creditsMarker ? (
          <motion.button
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            className="absolute right-8 bottom-44 z-20 px-5 py-2 rounded bg-white/90 text-black font-semibold text-sm hover:bg-white"
            onClick={() => {
              if (ctx.next) void navigate({ to: `/play/${ctx.next.file_id}` });
              else seekToTime(duration);
            }}
          >
            Skip Credits
          </motion.button>
        ) : null}
      </AnimatePresence>

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
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 12 }}
              transition={{ duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
              className="absolute inset-x-0 bottom-0 z-10 px-6 pb-6 pt-16 bg-gradient-to-t from-black/85 via-black/40 to-transparent"
            >
              <div
                ref={seekBarRef}
                className="relative h-3 group/seek mb-3 cursor-pointer touch-none"
                onPointerDown={onSeekPointerDown}
                onPointerMove={onSeekPointerMove}
                onPointerUp={onSeekPointerUp}
                onPointerCancel={onSeekPointerUp}
                onMouseLeave={() => {
                  if (!scrubbing) setHoverTime(null);
                }}
              >
                <div className="absolute inset-y-1 left-0 right-0 bg-white/20 rounded-full" />
                {encodedPct < 100 ? (
                  <div
                    className="absolute inset-y-1 left-0 bg-white/35 rounded-full"
                    style={{ width: `${encodedPct}%` }}
                  />
                ) : null}
                <div
                  className="absolute inset-y-1 left-0 bg-brand rounded-full"
                  style={{ width: `${progressPct}%` }}
                />
                <div
                  className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-4 h-4 bg-brand rounded-full shadow-md transition-opacity ${
                    scrubbing ? 'opacity-100 scale-110' : 'opacity-0 group-hover/seek:opacity-100'
                  }`}
                  style={{ left: `${progressPct}%` }}
                />
                {thumbStyle && hoverTime !== null ? (
                  <div
                    className="absolute bottom-full mb-3 pointer-events-none z-20"
                    style={{ left: hoverX, transform: 'translateX(-50%)' }}
                  >
                    <div className="rounded border border-white/20 shadow-2xl overflow-hidden" style={thumbStyle} />
                    <div className="text-center text-xs mt-1 text-white drop-shadow">
                      {fmtTime(hoverTime)}
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-3 flex-wrap">
                  <IconButton
                    onClick={() => {
                      const v = videoRef.current;
                      if (!v) return;
                      v.paused ? void v.play() : v.pause();
                    }}
                  >
                    {playing ? <PauseIcon /> : <PlayIcon />}
                  </IconButton>
                  <IconButton onClick={() => seekToTime(time - 5)}>
                    <Rewind5 />
                  </IconButton>
                  <IconButton onClick={() => seekToTime(time + 5)}>
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
                    <IconButton onClick={() => videoRef.current && (videoRef.current.muted = !muted)}>
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
                    {fmtTime(displayTime)} / {fmtTime(duration)}
                  </span>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <Menu
                    label={`${speed}×`}
                    items={SPEEDS.map((s) => ({
                      label: `${s}×`,
                      onClick: () => videoRef.current && (videoRef.current.playbackRate = s),
                      active: s === speed,
                    }))}
                  />
                  {ctx.audioTracks.length > 1 ? (
                    <Menu
                      label={audioLang ?? 'Audio'}
                      items={ctx.audioTracks.map((a) => ({
                        label: a.label,
                        active: audioLang === a.lang,
                        onClick: () => {
                          setAudioLang(a.lang);
                          void api.post('/api/profiles/prefs', { key: 'audioTrack', value: a.lang });
                        },
                      }))}
                    />
                  ) : null}
                  {ctx.qualities.length > 0 ? (
                    <Menu
                      label={currentQuality?.label ?? 'Quality'}
                      items={[
                        {
                          label: 'Auto',
                          onClick: () => {
                            handleRef.current?.setQualityLock('auto');
                            void api.post('/api/profiles/prefs', { key: 'qualityLock', value: 'auto' });
                          },
                          active: qualityRung === 'auto',
                        },
                        ...ctx.qualities.map((q) => ({
                          label: q.label,
                          onClick: () => changeQuality(q),
                          active: q.rung === qualityRung,
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
        profileId={ctx.profileId}
        initialStyle={ctx.subtitleStyle}
        onSelect={handleSubSelect}
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
