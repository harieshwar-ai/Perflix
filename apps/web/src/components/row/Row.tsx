import { useRef } from 'react';
import { Tile } from '../tile/Tile.js';
import type { Title } from '../../lib/api.js';

type Props = {
  heading: string;
  titles: Title[];
  variant?: 'poster' | 'landscape';
};

export function Row({ heading, titles, variant = 'poster' }: Props) {
  const scroller = useRef<HTMLDivElement>(null);

  function scroll(dir: -1 | 1) {
    const el = scroller.current;
    if (!el) return;
    el.scrollBy({ left: el.clientWidth * 0.85 * dir, behavior: 'smooth' });
  }

  if (titles.length === 0) return null;

  return (
    <section className="group/row relative overflow-visible">
      <h2 className="px-6 sm:px-8 text-lg sm:text-xl font-semibold mb-3">{heading}</h2>
      <div className="relative overflow-visible">
        <button
          onClick={() => scroll(-1)}
          className="hidden md:grid absolute left-0 inset-y-0 z-20 place-items-center w-12 bg-gradient-to-r from-black/80 to-transparent opacity-0 group-hover/row:opacity-100 transition-opacity hover:bg-black/40"
          aria-label="scroll left"
        >
          <ChevronLeft />
        </button>
        <div
          ref={scroller}
          className="flex gap-3 overflow-x-auto overflow-y-visible scroll-px-6 sm:scroll-px-8 px-6 sm:px-8 pb-10 [&::-webkit-scrollbar]:hidden [scrollbar-width:none]"
        >
          {titles.map((t) => (
            <div
              key={t.id}
              className={
                variant === 'landscape'
                  ? 'shrink-0 w-[280px] sm:w-[320px]'
                  : 'shrink-0 w-[140px] sm:w-[170px]'
              }
            >
              <Tile title={t} variant={variant} />
            </div>
          ))}
        </div>
        <button
          onClick={() => scroll(1)}
          className="hidden md:grid absolute right-0 inset-y-0 z-20 place-items-center w-12 bg-gradient-to-l from-black/80 to-transparent opacity-0 group-hover/row:opacity-100 transition-opacity hover:bg-black/40"
          aria-label="scroll right"
        >
          <ChevronRight />
        </button>
      </div>
    </section>
  );
}

function ChevronLeft() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="white" strokeWidth="2.4">
      <path d="m15 18-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function ChevronRight() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="white" strokeWidth="2.4">
      <path d="m9 18 6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
