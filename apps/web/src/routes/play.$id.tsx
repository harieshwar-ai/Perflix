import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { PlayerView } from '../components/player/PlayerView.js';

export const Route = createFileRoute('/play/$id')({
  component: PlayPage,
});

function PlayPage() {
  const { id } = Route.useParams();
  const fileId = Number(id);
  const { data, isPending, error } = useQuery({
    queryKey: ['play', id],
    queryFn: () => api.get(`/api/play/${id}/context`),
  });

  if (isPending) {
    return <div className="min-h-dvh grid place-items-center text-neutral-500">Loading…</div>;
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
  return <PlayerView fileId={fileId} ctx={data as any} />;
}
