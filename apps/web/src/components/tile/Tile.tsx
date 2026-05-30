import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from '@tanstack/react-router';
import type { Title } from '../../lib/api.js';

type Props = {
  title: Title;
  variant?: 'poster' | 'landscape';
  hoverPreview?: boolean;
};

const HOVER_DELAY_MS = 550;
const spring = { type: 'spring' as const, stiffness: 420, damping: 32, mass: 0.85 };

export function Tile({ title, variant = 'poster', hoverPreview = true }: Props) {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(false);
  const [previewFileId, setPreviewFileId] = useState<number | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );

  const isLandscape = variant === 'landscape';
  const aspect = isLandscape ? 'aspect-[16/9]' : 'aspect-[2/3]';
  const imageSrc = isLandscape ? (title.backdrop ?? title.poster) : (title.poster ?? title.backdrop);

  function open() {
    void navigate({ to: `/title/${title.id}` });
  }

  function onEnter() {
    if (!hoverPreview) return;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      setExpanded(true);
      try {
        const detail = await (await fetch(`/api/title/${title.id}`)).json();
        const fileId =
          detail?.file?.file_id ??
          detail?.episodes?.find((e: { file_id: number | null }) => e.file_id)?.file_id ??
          null;
        if (fileId) setPreviewFileId(fileId);
      } catch {
        // ignore
      }
    }, HOVER_DELAY_MS);
  }

  function onLeave() {
    if (timer.current) window.clearTimeout(timer.current);
    setExpanded(false);
    setPreviewFileId(null);
  }

  return (
    <div
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onClick={open}
      className="relative cursor-pointer"
    >
      <motion.div
        layout="position"
        className={`relative ${aspect} rounded-md overflow-hidden bg-neutral-900 shadow-lg will-change-transform`}
        animate={{ scale: expanded ? 1.16 : 1, zIndex: expanded ? 30 : 1 }}
        transition={spring}
        style={{ originY: 0.5 }}
      >
        {imageSrc ? (
          <img
            src={imageSrc}
            alt={title.title}
            loading="lazy"
            decoding="async"
            className="absolute inset-0 w-full h-full object-cover"
            draggable={false}
          />
        ) : (
          <div className="absolute inset-0 grid place-items-center text-xs text-neutral-500 p-2 text-center">
            {title.title}
          </div>
        )}

        <AnimatePresence>
          {expanded && previewFileId ? (
            <motion.video
              key="preview"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.35, ease: 'easeOut' }}
              src={`/preview/${previewFileId}`}
              autoPlay
              muted
              playsInline
              loop
              preload="none"
              className="absolute inset-0 w-full h-full object-cover pointer-events-none"
            />
          ) : null}
        </AnimatePresence>

        <AnimatePresence>
          {expanded ? (
            <motion.div
              key="info"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
              className="absolute inset-x-0 bottom-0 p-3 bg-gradient-to-t from-black via-black/80 to-transparent"
            >
              <div className="text-sm font-semibold leading-tight truncate">{title.title}</div>
              <div className="mt-1 flex items-center gap-2 text-[10px] uppercase tracking-wider text-neutral-300">
                {title.year ? <span>{title.year}</span> : null}
                {title.kind === 'series' ? (
                  <span>
                    {title.season_count} S · {title.episode_count} E
                  </span>
                ) : null}
                {title.rating ? <span>★ {title.rating.toFixed(1)}</span> : null}
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
