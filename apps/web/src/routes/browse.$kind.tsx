import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { api, type Title } from '../lib/api.js';
import { Tile } from '../components/tile/Tile.js';

export const Route = createFileRoute('/browse/$kind')({
  component: BrowsePage,
});

function BrowsePage() {
  const { kind } = Route.useParams();
  const normalized = kind === 'movie' ? 'movie' : 'series';
  const path = normalized === 'movie' ? '/api/library/movies' : '/api/library/series';

  const { data, isPending } = useQuery({
    queryKey: ['library', normalized],
    queryFn: () => api.get<{ titles: Title[] }>(path),
  });

  const titles = data?.titles ?? [];
  const allGenres = useMemo(() => {
    const set = new Set<string>();
    for (const t of titles) for (const g of t.genres ?? []) set.add(g);
    return [...set].sort();
  }, [titles]);

  const [sort, setSort] = useState<'added' | 'rating' | 'title'>('added');
  const [genre, setGenre] = useState<string | null>(null);

  const visible = useMemo(() => {
    let v = titles;
    if (genre) v = v.filter((t) => t.genres.includes(genre));
    const cmp =
      sort === 'rating'
        ? (a: Title, b: Title) => (b.rating ?? 0) - (a.rating ?? 0)
        : sort === 'title'
          ? (a: Title, b: Title) => a.title.localeCompare(b.title)
          : (a: Title, b: Title) => b.added_at - a.added_at;
    return [...v].sort(cmp);
  }, [titles, genre, sort]);

  return (
    <div className="px-6 sm:px-12 py-8">
      <div className="flex items-end justify-between flex-wrap gap-4 mb-8">
        <h1 className="text-3xl sm:text-4xl font-black tracking-tight">
          {normalized === 'movie' ? 'Movies' : 'Series'}
          <span className="ml-3 text-base font-normal text-neutral-500">
            {titles.length} title{titles.length === 1 ? '' : 's'}
          </span>
        </h1>
        <div className="flex items-center gap-3">
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as typeof sort)}
            className="bg-neutral-900 border border-white/10 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-white/30"
          >
            <option value="added">Recently added</option>
            <option value="rating">Top rated</option>
            <option value="title">Title A–Z</option>
          </select>
        </div>
      </div>

      {allGenres.length > 0 ? (
        <div className="flex flex-wrap gap-2 mb-8">
          <Chip selected={genre === null} onClick={() => setGenre(null)}>
            All
          </Chip>
          {allGenres.map((g) => (
            <Chip key={g} selected={genre === g} onClick={() => setGenre(g)}>
              {g}
            </Chip>
          ))}
        </div>
      ) : null}

      {isPending ? (
        <p className="text-neutral-500">Loading…</p>
      ) : visible.length === 0 ? (
        <p className="text-neutral-500">Nothing here yet.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {visible.map((t) => (
            <Tile key={t.id} title={t} />
          ))}
        </div>
      )}
    </div>
  );
}

function Chip({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
        selected
          ? 'bg-white text-black border-white'
          : 'bg-transparent text-neutral-300 border-white/15 hover:border-white/40'
      }`}
    >
      {children}
    </button>
  );
}
