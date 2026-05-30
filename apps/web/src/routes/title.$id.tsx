import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { api, type TitleDetail, type EpisodeRow } from '../lib/api.js';

export const Route = createFileRoute('/title/$id')({
  component: TitlePage,
});

function TitlePage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const { data, isPending } = useQuery({
    queryKey: ['title', id],
    queryFn: () => api.get<TitleDetail>(`/api/title/${id}`),
  });

  const seasons = useMemo(() => {
    if (!data?.episodes) return [];
    const seasonSet = new Set<number>();
    for (const e of data.episodes) seasonSet.add(e.season);
    return [...seasonSet].sort((a, b) => a - b);
  }, [data]);

  const [activeSeason, setActiveSeason] = useState<number | null>(null);
  const season = activeSeason ?? seasons[0] ?? null;

  if (isPending) return <div className="px-8 py-12 text-neutral-500">Loading…</div>;
  if (!data) return <div className="px-8 py-12 text-neutral-500">Not found.</div>;

  const fileToPlay =
    data.kind === 'movie'
      ? data.file?.file_id
      : data.episodes?.find((e) => e.file_id && (e.position ?? 0) > 0)?.file_id ??
        data.episodes?.find((e) => e.file_id)?.file_id;

  const resumePosition =
    data.kind === 'movie'
      ? data.file?.position ?? 0
      : data.episodes?.find((e) => e.file_id && (e.position ?? 0) > 0)?.position ?? 0;

  function play(fileId?: number | null) {
    if (!fileId) return;
    void navigate({ to: `/play/${fileId}` });
  }

  return (
    <div>
      <div className="relative h-[60vh] min-h-[360px] overflow-hidden -mt-16">
        {data.backdrop ? (
          <img
            src={data.backdrop}
            alt={data.title}
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 bg-neutral-900" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/60 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-black via-black/30 to-transparent" />
        <div className="relative h-full px-6 sm:px-12 flex flex-col justify-end pb-12 max-w-[1000px]">
          <motion.h1
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="text-4xl sm:text-6xl font-black tracking-tight"
          >
            {data.title}
          </motion.h1>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs uppercase tracking-wider text-neutral-300">
            {data.year ? <span>{data.year}</span> : null}
            {data.kind === 'series' ? (
              <span>
                {data.season_count} Season{data.season_count === 1 ? '' : 's'}
              </span>
            ) : null}
            {data.runtime ? <span>{data.runtime} min</span> : null}
            {data.rating ? <span>★ {data.rating.toFixed(1)}</span> : null}
            {data.genres.slice(0, 3).map((g) => (
              <span key={g} className="border border-white/20 px-2 py-0.5 rounded">
                {g}
              </span>
            ))}
          </div>
          {data.overview ? (
            <p className="mt-4 max-w-[60ch] text-sm sm:text-base text-neutral-200">
              {data.overview}
            </p>
          ) : null}
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button
              onClick={() => play(fileToPlay)}
              disabled={!fileToPlay}
              className="inline-flex items-center gap-2 bg-white text-black font-semibold px-6 py-2.5 rounded-md hover:bg-white/90 transition-colors disabled:opacity-40"
            >
              <PlayIcon /> {resumePosition > 0 ? 'Resume' : 'Play'}
            </button>
          </div>
        </div>
      </div>

      {data.kind === 'series' && seasons.length > 0 ? (
        <div className="px-6 sm:px-12 py-8">
          <div className="flex items-center gap-3 mb-6">
            <h2 className="text-xl font-semibold">Episodes</h2>
            <select
              value={season ?? 1}
              onChange={(e) => setActiveSeason(Number(e.target.value))}
              className="bg-neutral-900 border border-white/10 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-white/30"
            >
              {seasons.map((s) => (
                <option key={s} value={s}>
                  Season {s}
                </option>
              ))}
            </select>
          </div>
          <ul className="divide-y divide-white/5">
            {(data.episodes ?? [])
              .filter((e) => e.season === season)
              .sort((a, b) => a.episode - b.episode)
              .map((ep) => (
                <EpisodeRowItem key={ep.id} ep={ep} onPlay={() => play(ep.file_id ?? undefined)} />
              ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function EpisodeRowItem({ ep, onPlay }: { ep: EpisodeRow; onPlay: () => void }) {
  const progressPct = ep.duration && ep.position ? Math.min(100, (ep.position / ep.duration) * 100) : 0;
  return (
    <li className="py-4 grid grid-cols-[160px_1fr_auto] gap-5 items-start">
      <div
        onClick={onPlay}
        className="relative aspect-video rounded overflow-hidden bg-neutral-900 group cursor-pointer"
      >
        {ep.still ? (
          <img src={ep.still} alt="" className="absolute inset-0 w-full h-full object-cover" />
        ) : null}
        <div className="absolute inset-0 grid place-items-center bg-black/0 group-hover:bg-black/40 transition-colors">
          <PlayIcon className="opacity-0 group-hover:opacity-100 transition-opacity" size={40} />
        </div>
        {progressPct > 0 ? (
          <div className="absolute inset-x-0 bottom-0 h-1 bg-white/20">
            <div className="h-full bg-brand" style={{ width: `${progressPct}%` }} />
          </div>
        ) : null}
      </div>
      <div>
        <div className="font-semibold">
          {ep.episode}. {ep.name ?? `Episode ${ep.episode}`}
        </div>
        {ep.overview ? (
          <p className="mt-1 text-sm text-neutral-400 line-clamp-2 max-w-[55ch]">{ep.overview}</p>
        ) : null}
        {!ep.file_id ? (
          <p className="mt-1 text-[11px] uppercase tracking-wide text-amber-400/80">No file</p>
        ) : null}
      </div>
      <div className="text-right text-xs text-neutral-500">{ep.air_date ?? ''}</div>
    </li>
  );
}

function PlayIcon({ className, size = 20 }: { className?: string; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" className={className}>
      <path d="M8 5v14l11-7L8 5z" />
    </svg>
  );
}

void Link; // keep import for future inline use
