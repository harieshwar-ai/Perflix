import { motion } from 'framer-motion';

export function LoadingScreen({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="min-h-dvh grid place-items-center bg-black">
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.35, ease: 'easeOut' }}
        className="flex flex-col items-center gap-4"
      >
        <div className="text-2xl font-black tracking-tight text-brand">PERFLIX</div>
        <div className="h-0.5 w-24 overflow-hidden rounded-full bg-white/10">
          <motion.div
            className="h-full w-1/2 rounded-full bg-brand"
            animate={{ x: ['-100%', '200%'] }}
            transition={{ duration: 1.1, repeat: Infinity, ease: 'easeInOut' }}
          />
        </div>
        <p className="text-xs text-neutral-500">{label}</p>
      </motion.div>
    </div>
  );
}
