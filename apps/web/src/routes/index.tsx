import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { api, type Title } from '../lib/api.js';

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
      <div className="px-6 py-12">
        <h2 className="text-2xl font-semibold">No titles yet</h2>
        <p className="mt-2 text-neutral-400 text-sm max-w-prose">
          Drop video files into your library root and they'll appear here. The scanner watches in
          real time. If nothing's showing up, verify <code className="text-white">LIBRARY_ROOT</code>{' '}
          in <code className="text-white">.env</code> points at a folder with{' '}
          <code className="text-white">Movies/</code> and <code className="text-white">TV/</code>{' '}
          subfolders.
        </p>
      </div>
    );
  }

  return (
    <div className="px-6 py-12 space-y-12">
      <section>
        <h2 className="text-xl font-semibold mb-4">Recently added</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {titles.slice(0, 12).map((t) => (
            <a
              key={t.id}
              href={`/title/${t.id}`}
              className="group block aspect-[2/3] rounded-md overflow-hidden bg-neutral-900 relative"
            >
              {t.poster ? (
                <img
                  src={t.poster}
                  alt={t.title}
                  loading="lazy"
                  className="absolute inset-0 w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                />
              ) : (
                <div className="absolute inset-0 grid place-items-center text-xs text-neutral-500 p-2 text-center">
                  {t.title}
                </div>
              )}
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-2 text-xs">
                {t.title}
              </div>
            </a>
          ))}
        </div>
      </section>
    </div>
  );
}
