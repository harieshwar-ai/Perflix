import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { fetchWatchlist, listsWatchlistQueryKey } from '../lib/libraryQueries.js';
import { fadeUp, staggerContainer, staggerItem } from '../lib/motion.js';
import { Tile } from '../components/tile/Tile.js';
import { LoadingScreen } from '../components/ui/LoadingScreen.js';

export const Route = createFileRoute('/lists')({
  loader: ({ context: { queryClient } }) =>
    queryClient.ensureQueryData({ queryKey: listsWatchlistQueryKey, queryFn: fetchWatchlist }),
  component: ListsPage,
});

function ListsPage() {
  const { data, isPending } = useQuery({
    queryKey: listsWatchlistQueryKey,
    queryFn: fetchWatchlist,
  });
  const titles = data?.titles ?? [];

  if (isPending && !data) {
    return <LoadingScreen label="Loading your list…" />;
  }

  return (
    <motion.div className="px-6 sm:px-12 py-8" {...fadeUp}>
      <h1 className="text-3xl sm:text-4xl font-black tracking-tight mb-8">My List</h1>
      {titles.length === 0 ? (
        <p className="text-neutral-500 max-w-prose">
          Add titles to your list from any detail page. They'll show up here for quick access.
        </p>
      ) : (
        <motion.div
          className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4"
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
        >
          {titles.map((t) => (
            <motion.div key={t.id} variants={staggerItem}>
              <Tile title={t} />
            </motion.div>
          ))}
        </motion.div>
      )}
    </motion.div>
  );
}
