import { useRef } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { motion } from 'framer-motion';

export type ContinueItem = {
  fileId: number;
  position: number;
  duration: number | null;
  updatedAt: number;
  title: {
    id: number;
    kind: 'movie' | 'series';
    title: string;
    year: number | null;
    poster: string | null;
    backdrop: string | null;
    season: number | null;
    episode: number | null;
    episodeName: string | null;
  } | null;
};

export function ContinueWatchingRow({ items }: { items: ContinueItem[] }) {
  const scroller = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  if (items.length === 0) return null;
  return (
    <section className="group/row">
      <h2 className="px-6 sm:px-8 text-lg sm:text-xl font-semibold mb-3">Continue watching</h2>
      <div
        ref={scroller}
        className="flex gap-3 overflow-x-auto px-6 sm:px-8 pb-6 [&::-webkit-scrollbar]:hidden [scrollbar-width:none]"
      >
        {items.map((it) => {
          const t = it.title;
          if (!t) return null;
          const pct = it.duration ? Math.min(100, (it.position / it.duration) * 100) : 0;
          const remain = it.duration ? it.duration - it.position : null;
          return (
            <motion.button
              key={it.fileId}
              whileHover={{ scale: 1.03 }}
              transition={{ duration: 0.2 }}
              onClick={() => navigate({ to: `/play/${it.fileId}` })}
              className="shrink-0 w-[280px] sm:w-[320px] aspect-video rounded-md overflow-hidden relative bg-neutral-900 text-left shadow-md"
            >
              {t.backdrop || t.poster ? (
                <img
                  src={t.backdrop ?? t.poster ?? ''}
                  alt={t.title}
                  className="absolute inset-0 w-full h-full object-cover"
                />
              ) : null}
              <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent" />
              <div className="absolute inset-x-0 bottom-0 p-3">
                <div className="text-sm font-semibold truncate">
                  {t.title}
                  {t.kind === 'series' && t.season && t.episode ? (
                    <span className="text-xs text-neutral-300 font-normal ml-1">
                      S{String(t.season).padStart(2, '0')}E
                      {String(t.episode).padStart(2, '0')}
                    </span>
                  ) : null}
                </div>
                {t.episodeName ? (
                  <div className="text-[11px] text-neutral-300 truncate">{t.episodeName}</div>
                ) : null}
                {remain && remain > 0 ? (
                  <div className="text-[10px] mt-1 text-neutral-400">
                    {Math.ceil(remain / 60)}m left
                  </div>
                ) : null}
              </div>
              <div className="absolute inset-x-0 bottom-0 h-1 bg-white/20">
                <div className="h-full bg-brand" style={{ width: `${pct}%` }} />
              </div>
            </motion.button>
          );
        })}
      </div>
    </section>
  );
}
