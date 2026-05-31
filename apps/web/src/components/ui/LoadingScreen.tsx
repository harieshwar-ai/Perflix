import { motion } from 'framer-motion';

type SpinnerProps = {
  label?: string;
  size?: 'sm' | 'md';
  className?: string;
};

export function LoadingSpinner({ label, size = 'md', className = '' }: SpinnerProps) {
  const barW = size === 'sm' ? 'w-16' : 'w-24';
  return (
    <div className={`flex flex-col items-center gap-3 ${className}`}>
      <div className={`h-0.5 ${barW} overflow-hidden rounded-full bg-white/10`}>
        <motion.div
          className="h-full w-1/2 rounded-full bg-brand"
          animate={{ x: ['-100%', '200%'] }}
          transition={{ duration: 1.1, repeat: Infinity, ease: 'easeInOut' }}
        />
      </div>
      {label ? <p className="text-xs text-neutral-500">{label}</p> : null}
    </div>
  );
}

type LoadingScreenProps = {
  label?: string;
  overlay?: boolean;
};

export function LoadingScreen({ label = 'Loading…', overlay = false }: LoadingScreenProps) {
  const shell = overlay
    ? 'absolute inset-0 z-50 grid place-items-center bg-black/85 backdrop-blur-sm'
    : 'min-h-dvh grid place-items-center bg-black';

  return (
    <div className={shell}>
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.98 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        className="flex flex-col items-center gap-4"
      >
        <div className="text-2xl font-black tracking-tight text-brand">PERFLIX</div>
        <LoadingSpinner label={label} />
      </motion.div>
    </div>
  );
}
