import {
  Link,
  Outlet,
  createRootRouteWithContext,
  useNavigate,
  useRouterState,
} from '@tanstack/react-router';
import type { QueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useAuthState, useLogout } from '../lib/auth.js';
import { LoadingScreen } from '../components/ui/LoadingScreen.js';
import { TmdbAttribution } from '../components/ui/TmdbAttribution.js';

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: RootLayout,
});

function RootLayout() {
  const router = useRouterState();
  const { data: auth, isPending } = useAuthState();
  const navigate = useNavigate();
  const logout = useLogout();
  const pathname = router.location.pathname;
  const isPlayer = pathname.startsWith('/play/');

  useEffect(() => {
    if (isPending) return;
    const wantsLogin = pathname === '/login';
    if (!auth?.authenticated && !wantsLogin) {
      void navigate({ to: '/login', replace: true });
    } else if (auth?.authenticated && wantsLogin) {
      void navigate({ to: '/', replace: true });
    }
  }, [auth, isPending, pathname, navigate]);

  if (isPending) {
    return <LoadingScreen label="Checking session…" />;
  }

  const showChrome = auth?.authenticated && pathname !== '/login';

  return (
    <div className="min-h-dvh bg-black text-white flex flex-col">
      {showChrome && !isPlayer ? <TopNav onLogout={() => logout.mutate()} /> : null}
      <main className={`flex-1 ${showChrome && !isPlayer ? 'pt-16' : ''}`}>
        <Outlet />
      </main>
      {showChrome && !isPlayer ? <TmdbAttribution /> : null}
    </div>
  );
}

function TopNav({ onLogout }: { onLogout: () => void }) {
  const router = useRouterState();
  const path = router.location.pathname;
  const linkCls = (active: boolean) =>
    `text-sm transition-colors ${active ? 'text-white' : 'text-neutral-400 hover:text-white'}`;

  return (
    <nav className="fixed inset-x-0 top-0 z-40 backdrop-blur-md bg-black/70 border-b border-white/5">
      <div className="px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
        <Link to="/" className="text-xl sm:text-2xl font-black tracking-tight text-brand shrink-0">
          PERFLIX
        </Link>
        <div className="hidden md:flex items-center gap-6">
          <Link to="/" className={linkCls(path === '/')}>
            Home
          </Link>
          <Link to="/browse/$kind" params={{ kind: 'movie' }} className={linkCls(path.startsWith('/browse/movie'))}>
            Movies
          </Link>
          <Link to="/browse/$kind" params={{ kind: 'series' }} className={linkCls(path.startsWith('/browse/series'))}>
            Series
          </Link>
          <Link to="/lists" className={linkCls(path === '/lists')}>
            My List
          </Link>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="flex md:hidden items-center gap-3 text-xs">
            <Link to="/browse/$kind" params={{ kind: 'movie' }} className={linkCls(path.startsWith('/browse'))}>
              Browse
            </Link>
            <Link to="/lists" className={linkCls(path === '/lists')}>
              List
            </Link>
          </div>
          <button
            onClick={onLogout}
            className="text-xs text-neutral-400 hover:text-white border border-white/10 rounded-full px-3 py-1.5 hover:bg-white/5"
          >
            Sign out
          </button>
        </div>
      </div>
    </nav>
  );
}
