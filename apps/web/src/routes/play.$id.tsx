import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { lazy, Suspense } from 'react';
import { api, type PlayContext } from '../lib/api.js';
import { LoadingScreen } from '../components/ui/LoadingScreen.js';

const PlayerView = lazy(() =>
  import('../components/player/PlayerView.js').then((m) => ({ default: m.PlayerView })),
);

export const Route = createFileRoute('/play/$id')({
  component: PlayPage,
});

function PlayPage() {
  const { id } = Route.useParams();
  const fileId = Number(id);
  const { data, isPending, error } = useQuery({
    queryKey: ['play', id],
    queryFn: () => api.get<PlayContext>(`/api/play/${id}/context`),
  });

  if (isPending) {
    return <LoadingScreen label="Preparing playback…" />;
  }
  if (error || !data) {
    return (
      <div className="min-h-dvh grid place-items-center text-neutral-500">
        <div>
          <p className="text-red-400 mb-2">Couldn't load playback context.</p>
          <p className="text-xs">{(error as Error)?.message ?? 'Not found'}</p>
        </div>
      </div>
    );
  }
  return (
    <Suspense fallback={<LoadingScreen label="Loading player…" />}>
      <PlayerView fileId={fileId} ctx={data} />
    </Suspense>
  );
}
