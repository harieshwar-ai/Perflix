export function TmdbAttribution() {
  return (
    <footer className="border-t border-white/5 px-6 py-6 text-center text-[11px] text-neutral-600">
      Metadata and artwork provided by{' '}
      <a
        href="https://www.themoviedb.org/"
        target="_blank"
        rel="noopener noreferrer"
        className="text-neutral-400 underline-offset-2 hover:text-neutral-300 hover:underline"
      >
        TMDb
      </a>
      . This product uses the TMDb API but is not endorsed or certified by TMDb.
    </footer>
  );
}
