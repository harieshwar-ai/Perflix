import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { api, type Title } from '../lib/api.js';
import { Hero } from '../components/hero/Hero.js';
import { Row } from '../components/row/Row.js';

export const Route = createFileRoute('/')({
  component: HomePage,
});

function HomePage() {
  const { data, isPending } = useQuery({
    queryKey: ['library'],
    queryFn: () => api.get<{ titles: Title[] }>('/api/library'),
  });

  if (isPending) {
    return <div className="px-6 py-12 text-neutral-500">Loading library…</div>;
  }

  const titles = data?.titles ?? [];

  if (titles.length === 0) {
    return (
      <div className="px-6 py-24 max-w-2xl mx-auto">
        <h2 className="text-3xl font-bold">Your library is empty</h2>
        <p className="mt-4 text-neutral-400">
          Set <code className="text-white">LIBRARY_ROOT</code> in <code className="text-white">.env</code>{' '}
          (e.g., <code className="text-white">/Volumes/Extreme SSD/Perflix Media</code>) and drop
          files into <code className="text-white">Movies/</code> or{' '}
          <code className="text-white">TV/&lt;Show&gt;/Season N/</code>. The scanner watches in
          real time.
        </p>
      </div>
    );
  }

  const featured = pickFeatured(titles);
  const recent = [...titles].sort((a, b) => b.added_at - a.added_at).slice(0, 18);
  const movies = titles.filter((t) => t.kind === 'movie').slice(0, 18);
  const series = titles.filter((t) => t.kind === 'series').slice(0, 18);
  const byGenre = groupByGenre(titles);

  return (
    <div className="-mt-16">
      <Hero titles={featured} />
      <div className="pt-6 space-y-8 pb-16">
        <Row heading="Recently added" titles={recent} />
        {movies.length > 0 ? <Row heading="Movies" titles={movies} /> : null}
        {series.length > 0 ? <Row heading="Series" titles={series} /> : null}
        {byGenre.slice(0, 6).map(([genre, list]) => (
          <Row key={genre} heading={genre} titles={list} />
        ))}
      </div>
    </div>
  );
}

function pickFeatured(titles: Title[]): Title[] {
  return [...titles]
    .filter((t) => t.backdrop && t.overview)
    .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))
    .slice(0, 6);
}

function groupByGenre(titles: Title[]): [string, Title[]][] {
  const map = new Map<string, Title[]>();
  for (const t of titles) {
    for (const g of t.genres ?? []) {
      let bucket = map.get(g);
      if (!bucket) {
        bucket = [];
        map.set(g, bucket);
      }
      bucket.push(t);
    }
  }
  return [...map.entries()]
    .filter(([, v]) => v.length >= 3)
    .sort((a, b) => b[1].length - a[1].length);
}
