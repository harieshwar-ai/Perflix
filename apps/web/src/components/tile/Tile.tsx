import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from '@tanstack/react-router';
import { api, type Title } from '../../lib/api.js';
import { springSnappy } from '../../lib/motion.js';
import { PosterImage } from '../ui/PosterImage.js';

type Props = {
  title: Title;
  variant?: 'poster' | 'landscape';
  hoverPreview?: boolean;
};

const HOVER_DELAY_MS = 500;
const LONG_PRESS_MS = 450;

export function Tile({ title, variant = 'poster', hoverPreview = true }: Props) {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(false);
  const [previewFileId, setPreviewFileId] = useState<number | null>(null);
  const hoverTimer = useRef<number | null>(null);
  const longPressTimer = useRef<number | null>(null);
  const suppressClick = useRef(false);

  useEffect(
    () => () => {
      if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
      if (longPressTimer.current) window.clearTimeout(longPressTimer.current);
    },
    [],
  );

  const isLandscape = variant === 'landscape';
  const aspect = isLandscape ? 'aspect-[16/9]' : 'aspect-[2/3]';
  const imageSrc = isLandscape ? (title.backdrop ?? title.poster) : (title.poster ?? title.backdrop);

  const activatePreview = useCallback(async () => {
    setExpanded(true);
    try {
      const { fileId } = await api.get<{ fileId: number }>(`/api/title/${title.id}/preview-file`);
      setPreviewFileId(fileId);
    } catch {
      setPreviewFileId(null);
    }
  }, [title.id]);

  function open() {
    void navigate({ to: `/title/${title.id}` });
  }

  function clearTimers() {
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
    if (longPressTimer.current) window.clearTimeout(longPressTimer.current);
  }

  function deactivatePreview() {
    clearTimers();
    setExpanded(false);
    setPreviewFileId(null);
  }

  function onMouseEnter() {
    if (!hoverPreview) return;
    clearTimers();
    hoverTimer.current = window.setTimeout(() => {
      void activatePreview();
    }, HOVER_DELAY_MS);
  }

  function onMouseLeave() {
    deactivatePreview();
  }

  function onTouchStart() {
    if (!hoverPreview) return;
    suppressClick.current = false;
    clearTimers();
    longPressTimer.current = window.setTimeout(() => {
      suppressClick.current = true;
      void activatePreview();
    }, LONG_PRESS_MS);
  }

  function onTouchEnd() {
    if (longPressTimer.current) window.clearTimeout(longPressTimer.current);
  }

  function onClick() {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    if (expanded) {
      deactivatePreview();
      return;
    }
    open();
  }

  return (
    <div
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
      onClick={onClick}
      className="relative cursor-pointer"
      style={{ zIndex: expanded ? 40 : undefined }}
    >
      <motion.div
        layout="position"
        className={`relative ${aspect} rounded-md overflow-hidden bg-neutral-900 shadow-lg will-change-transform`}
        animate={{ scale: expanded ? 1.16 : 1 }}
        transition={springSnappy}
        style={{ originY: 0.5 }}
      >
        {imageSrc ? (
          <PosterImage src={imageSrc} alt={title.title} />
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
              crossOrigin="use-credentials"
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
