import { createFileRoute } from '@tanstack/react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api, type StorageStats } from '../lib/api.js';
import { LoadingScreen } from '../components/ui/LoadingScreen.js';

export const Route = createFileRoute('/storage')({
  component: StoragePage,
});

function fmtBytes(n: number): string {
  if (n >= 1_099_511_627_776) return `${(n / 1_099_511_627_776).toFixed(1)} TB`;
  if (n >= 1_073_741_824) return `${(n / 1_073_741_824).toFixed(1)} GB`;
  return `${(n / 1_048_576).toFixed(0)} MB`;
}

function StoragePage() {
  const { data, isPending, refetch } = useQuery({
    queryKey: ['storage'],
    queryFn: () => api.get<StorageStats>('/api/storage/stats'),
    refetchInterval: 10_000,
  });

  const sweep = useMutation({
    mutationFn: () => api.post<{ evicted: number; bytes: number }>('/api/storage/sweep'),
    onSuccess: () => refetch(),
  });

  if (isPending || !data) return <LoadingScreen label="Loading storage…" />;

  const usedPct = data.capBytes > 0 ? (data.totalBytes / data.capBytes) * 100 : 0;

  return (
    <div className="max-w-3xl mx-auto px-6 py-10 space-y-8">
      <div>
        <h1 className="text-2xl font-bold mb-2">Storage & encode queue</h1>
        <p className="text-sm text-neutral-400">
          HLS cache cap {fmtBytes(data.capBytes)} · protected {fmtBytes(data.protectedBytes)}
        </p>
      </div>

      <div>
        <div className="flex justify-between text-sm mb-2">
          <span>Cache used</span>
          <span>
            {fmtBytes(data.totalBytes)} / {fmtBytes(data.capBytes)} ({usedPct.toFixed(0)}%)
          </span>
        </div>
        <div className="h-3 bg-white/10 rounded-full overflow-hidden">
          <div className="h-full bg-brand" style={{ width: `${Math.min(100, usedPct)}%` }} />
        </div>
      </div>

      <div>
        <h2 className="font-semibold mb-3">Renditions</h2>
        <ul className="space-y-2 text-sm">
          {data.renditions.map((r) => (
            <li key={r.status} className="flex justify-between border-b border-white/5 pb-2">
              <span className="capitalize">{r.status}</span>
              <span>
                {r.n} · {fmtBytes(r.bytes ?? 0)}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">Encode queue</h2>
          <button
            onClick={() => sweep.mutate()}
            disabled={sweep.isPending}
            className="text-xs border border-white/10 rounded-full px-3 py-1 hover:bg-white/5"
          >
            Run sweep
          </button>
        </div>
        {data.queue.length === 0 ? (
          <p className="text-sm text-neutral-500">Queue empty</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {data.queue.map((j) => (
              <li key={j.id} className="flex justify-between border-b border-white/5 pb-2">
                <span>
                  File #{j.file_id} · {j.state}
                </span>
                <span className="text-neutral-500">priority {j.priority}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
