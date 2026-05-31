import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { api, type OsSearchResult, type SubtitleListItem } from '../../lib/api.js';

type SubStyle = {
  font?: string;
  size?: string;
  color?: string;
  bg?: string;
  position?: string;
};

type Props = {
  fileId: number;
  profileId: number;
  open: boolean;
  onClose: () => void;
  current: number | 'off';
  initialStyle?: SubStyle | null;
  onSelect: (subId: number | 'off', sub?: SubtitleListItem) => void;
};

export function SubtitlePicker({
  fileId,
  profileId,
  open,
  onClose,
  current,
  initialStyle,
  onSelect,
}: Props) {
  const qc = useQueryClient();
  const [lang, setLang] = useState('en');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<OsSearchResult[]>([]);
  const [searchErr, setSearchErr] = useState<string | null>(null);
  const [style, setStyle] = useState<SubStyle>(initialStyle ?? {});

  const list = useQuery({
    queryKey: ['subs', fileId],
    queryFn: () => api.get<{ subtitles: SubtitleListItem[] }>(`/api/subs/list/${fileId}`),
    enabled: open,
  });

  const saveStyle = useMutation({
    mutationFn: (s: SubStyle) =>
      api.post('/api/profiles/prefs', { key: 'subtitleStyle', value: JSON.stringify(s) }),
  });

  const dl = useMutation({
    mutationFn: (it: OsSearchResult) =>
      api.post<{ id: number; url: string }>(`/api/subs/download/${fileId}`, {
        osFileId: it.fileId,
        lang: it.lang,
        label: it.lang,
      }),
    onSuccess: (data, it) => {
      qc.invalidateQueries({ queryKey: ['subs', fileId] });
      onSelect(data.id, {
        id: data.id,
        lang: it.lang,
        label: it.lang,
        source: 'opensubs',
        url: data.url,
      });
    },
  });

  async function search() {
    setSearching(true);
    setSearchErr(null);
    setResults([]);
    try {
      const r = await api.get<{ results: OsSearchResult[] }>(
        `/api/subs/search/${fileId}?lang=${encodeURIComponent(lang)}`,
      );
      setResults(r.results);
    } catch (e) {
      setSearchErr((e as Error).message);
    } finally {
      setSearching(false);
    }
  }

  function updateStyle(patch: Partial<SubStyle>) {
    const next = { ...style, ...patch };
    setStyle(next);
    saveStyle.mutate(next);
  }

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm grid place-items-end sm:place-items-center"
          onClick={onClose}
        >
          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 20, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full sm:w-[480px] max-h-[80dvh] bg-neutral-950 border border-white/10 rounded-t-2xl sm:rounded-2xl p-6 overflow-y-auto"
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Subtitles</h2>
              <button onClick={onClose} className="text-neutral-400 hover:text-white">
                ✕
              </button>
            </div>

            <div className="space-y-1 mb-6">
              <label className="flex items-center gap-3 px-3 py-2 rounded hover:bg-white/5 cursor-pointer">
                <input type="radio" checked={current === 'off'} onChange={() => onSelect('off')} />
                <span className="text-sm">Off</span>
              </label>
              {(list.data?.subtitles ?? []).map((s) => (
                <label
                  key={s.id}
                  className="flex items-center gap-3 px-3 py-2 rounded hover:bg-white/5 cursor-pointer"
                >
                  <input
                    type="radio"
                    checked={current === s.id}
                    onChange={() => onSelect(s.id, s)}
                  />
                  <span className="text-sm">
                    {s.label ?? s.lang}{' '}
                    <span className="text-xs text-neutral-500 ml-1">({s.source})</span>
                  </span>
                </label>
              ))}
            </div>

            <div className="border-t border-white/5 pt-4 mb-6">
              <h3 className="text-sm font-semibold mb-3">Appearance</h3>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <label className="flex flex-col gap-1">
                  Size
                  <select
                    value={style.size ?? '1.1em'}
                    onChange={(e) => updateStyle({ size: e.target.value })}
                    className="bg-neutral-900 border border-white/10 rounded px-2 py-1"
                  >
                    <option value="0.9em">Small</option>
                    <option value="1.1em">Medium</option>
                    <option value="1.4em">Large</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  Color
                  <input
                    type="color"
                    value={style.color ?? '#ffffff'}
                    onChange={(e) => updateStyle({ color: e.target.value })}
                    className="h-9 bg-neutral-900 border border-white/10 rounded"
                  />
                </label>
                <label className="flex flex-col gap-1 col-span-2">
                  Background
                  <select
                    value={style.bg ?? 'rgba(0,0,0,0.6)'}
                    onChange={(e) => updateStyle({ bg: e.target.value })}
                    className="bg-neutral-900 border border-white/10 rounded px-2 py-1"
                  >
                    <option value="transparent">None</option>
                    <option value="rgba(0,0,0,0.6)">Dark</option>
                    <option value="rgba(0,0,0,0.85)">Solid</option>
                  </select>
                </label>
              </div>
            </div>

            <div className="border-t border-white/5 pt-4">
              <h3 className="text-sm font-semibold mb-2">Search OpenSubtitles</h3>
              <div className="flex gap-2 mb-3">
                <input
                  value={lang}
                  onChange={(e) => setLang(e.target.value)}
                  placeholder="en"
                  className="w-24 bg-neutral-900 border border-white/10 rounded px-2 py-1 text-sm"
                />
                <button
                  onClick={search}
                  disabled={searching}
                  className="bg-white/10 hover:bg-white/15 text-sm rounded px-3 py-1 disabled:opacity-40"
                >
                  {searching ? 'Searching…' : 'Search'}
                </button>
              </div>
              {searchErr ? <p className="text-xs text-red-400">{searchErr}</p> : null}
              <ul className="space-y-1 max-h-[200px] overflow-y-auto">
                {results.map((r) => (
                  <li
                    key={r.id}
                    className="flex items-center justify-between gap-2 px-3 py-2 rounded hover:bg-white/5"
                  >
                    <div className="min-w-0">
                      <div className="text-sm truncate">{r.release ?? r.fileName ?? r.id}</div>
                      <div className="text-[11px] text-neutral-500">
                        {r.lang} {r.hd ? '· HD' : ''}{' '}
                        {typeof r.downloads === 'number' ? `· ${r.downloads} dl` : ''}
                      </div>
                    </div>
                    <button
                      disabled={!r.fileId || dl.isPending}
                      onClick={() => dl.mutate(r)}
                      className="text-xs bg-brand/90 hover:bg-brand px-3 py-1 rounded disabled:opacity-40"
                    >
                      Download
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
