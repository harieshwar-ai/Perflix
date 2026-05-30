import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Link } from '@tanstack/react-router';
import type { Title } from '../../lib/api.js';

type Props = { titles: Title[] };

const ROTATE_MS = 8000;

export function Hero({ titles }: Props) {
  const featured = titles.filter((t) => t.backdrop || t.poster).slice(0, 6);
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (featured.length <= 1) return;
    const t = window.setInterval(() => setIdx((i) => (i + 1) % featured.length), ROTATE_MS);
    return () => window.clearInterval(t);
  }, [featured.length]);

  if (featured.length === 0) return null;
  const cur = featured[idx]!;

  return (
    <div className="relative w-full h-[75vh] min-h-[420px] overflow-hidden">
      <AnimatePresence mode="popLayout">
        <motion.div
          key={cur.id}
          initial={{ opacity: 0, scale: 1.04 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 1.0, ease: 'easeOut' }}
          className="absolute inset-0"
        >
          {cur.backdrop ? (
            <img
              src={cur.backdrop}
              alt={cur.title}
              className="absolute inset-0 w-full h-full object-cover"
            />
          ) : null}
          <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/20 to-transparent" />
        </motion.div>
      </AnimatePresence>

      <div className="relative h-full max-w-[1100px] px-6 sm:px-12 flex flex-col justify-end pb-20 z-10">
        <motion.h1
          key={`title-${cur.id}`}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="text-4xl sm:text-6xl font-black tracking-tight max-w-[20ch]"
        >
          {cur.title}
        </motion.h1>
        <motion.div
          key={`meta-${cur.id}`}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.18 }}
          className="mt-3 flex items-center gap-3 text-xs uppercase tracking-wider text-neutral-300"
        >
          {cur.year ? <span>{cur.year}</span> : null}
          {cur.runtime ? <span>{cur.runtime} min</span> : null}
          {cur.rating ? <span>★ {cur.rating.toFixed(1)}</span> : null}
          {cur.genres.slice(0, 3).map((g) => (
            <span key={g} className="border border-white/20 px-2 py-0.5 rounded">
              {g}
            </span>
          ))}
        </motion.div>
        {cur.overview ? (
          <motion.p
            key={`overview-${cur.id}`}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.26 }}
            className="mt-4 max-w-[50ch] text-sm sm:text-base text-neutral-200 line-clamp-3"
          >
            {cur.overview}
          </motion.p>
        ) : null}
        <motion.div
          key={`cta-${cur.id}`}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.34 }}
          className="mt-6 flex items-center gap-3"
        >
          <Link
            to="/title/$id"
            params={{ id: String(cur.id) }}
            className="inline-flex items-center gap-2 bg-white text-black font-semibold px-6 py-2.5 rounded-md hover:bg-white/90 transition-colors"
          >
            <PlayIcon /> Play
          </Link>
          <Link
            to="/title/$id"
            params={{ id: String(cur.id) }}
            className="inline-flex items-center gap-2 bg-white/15 backdrop-blur text-white font-semibold px-6 py-2.5 rounded-md hover:bg-white/25 transition-colors"
          >
            More info
          </Link>
        </motion.div>
      </div>

      {featured.length > 1 ? (
        <div className="absolute right-6 bottom-6 z-10 flex gap-1.5">
          {featured.map((_, i) => (
            <button
              key={i}
              onClick={() => setIdx(i)}
              className={`h-1 rounded-full transition-all ${
                i === idx ? 'w-8 bg-white' : 'w-4 bg-white/30 hover:bg-white/50'
              }`}
              aria-label={`feature ${i + 1}`}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
      <path d="M8 5v14l11-7L8 5z" />
    </svg>
  );
}
