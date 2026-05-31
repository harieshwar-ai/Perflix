import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Profile } from '../../lib/api.js';

export function ProfileSwitcher() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['profiles'],
    queryFn: () =>
      api.get<{ profiles: Profile[]; activeProfileId: number }>('/api/profiles'),
  });

  const switchProfile = useMutation({
    mutationFn: (id: number) => api.post(`/api/profiles/${id}/switch`),
    onSuccess: () => {
      qc.invalidateQueries();
    },
  });

  if (!data?.profiles.length) return null;

  return (
    <select
      value={data.activeProfileId ?? data.profiles[0]?.id}
      onChange={(e) => switchProfile.mutate(Number(e.target.value))}
      className="text-xs bg-transparent border border-white/10 rounded-full px-2 py-1 text-neutral-300 hover:text-white max-w-[120px] truncate"
      title="Profile"
    >
      {data.profiles.map((p) => (
        <option key={p.id} value={p.id} className="bg-neutral-900">
          {p.name}
        </option>
      ))}
    </select>
  );
}
