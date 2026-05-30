import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { api, type Title } from '../lib/api.js';
import { fetchLibrary, libraryQueryKey } from '../lib/libraryQueries.js';
import { Hero } from '../components/hero/Hero.js';
import { Row } from '../components/row/Row.js';
import { ContinueWatchingRow, type ContinueItem } from '../components/row/ContinueWatchingRow.js';
import { LoadingScreen } from '../components/ui/LoadingScreen.js';

export const Route = createFileRoute('/')({
  loader: ({ context: { queryClient } }) =>
    queryClient.ensureQueryData({ queryKey: libraryQueryKey, queryFn: fetchLibrary }),
  component: HomePage,
});

function HomePage() {
  const { data, isPending, isFetching } = useQuery({
    queryKey: libraryQueryKey,
    queryFn: fetchLibrary,
  });
  const recentProgress = useQuery({
    queryKey: ['progress', 'recent'],
    queryFn: () => api.get<{ items: ContinueItem[] }>('/api/progress/recent'),
  });

  if (isPending && !data) {
    return <LoadingScreen label="Loading library…" />;
  }

  const titles = data?.titles ?? [];
  const continueItems = recentProgress.data?.items ?? [];

  if (titles.length === 0 && !isFetching) {
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
      <Hero titles={featured.length > 0 ? featured : titles.slice(0, 6)} />
      <div className="pt-6 space-y-8 pb-16">
        {continueItems.length > 0 ? <ContinueWatchingRow items={continueItems} /> : null}
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
    .filter((t) => t.backdrop || t.poster)
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
