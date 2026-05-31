import { useState } from 'react';
import { motion } from 'framer-motion';
import { LoadingSpinner } from './LoadingScreen.js';

type Props = {
  src: string | null | undefined;
  alt: string;
  className?: string;
  imgClassName?: string;
  priority?: boolean;
  onLoad?: () => void;
};

export function PosterImage({
  src,
  alt,
  className = 'absolute inset-0',
  imgClassName = 'absolute inset-0 w-full h-full object-cover',
  priority = false,
  onLoad,
}: Props) {
  const [loaded, setLoaded] = useState(!src);

  if (!src) return null;

  return (
    <div className={`${className} overflow-hidden bg-neutral-900`}>
      {!loaded ? (
        <div className="absolute inset-0 grid place-items-center">
          <LoadingSpinner size="sm" />
        </div>
      ) : null}
      <motion.img
        src={src}
        alt={alt}
        draggable={false}
        loading={priority ? 'eager' : 'lazy'}
        decoding="async"
        fetchPriority={priority ? 'high' : 'auto'}
        onLoad={() => {
          setLoaded(true);
          onLoad?.();
        }}
        initial={{ opacity: 0, scale: 1.03 }}
        animate={{ opacity: loaded ? 1 : 0, scale: loaded ? 1 : 1.03 }}
        transition={{ duration: 0.4, ease: [0.32, 0.72, 0, 1] }}
        className={imgClassName}
      />
    </div>
  );
}
