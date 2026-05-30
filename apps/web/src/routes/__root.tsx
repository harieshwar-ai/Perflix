import { Outlet, createRootRouteWithContext, useNavigate, useRouterState } from '@tanstack/react-router';
import type { QueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useAuthState, useLogout } from '../lib/auth.js';

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: RootLayout,
});

function RootLayout() {
  const router = useRouterState();
  const { data: auth, isPending } = useAuthState();
  const navigate = useNavigate();
  const logout = useLogout();

  useEffect(() => {
    if (isPending) return;
    const at = router.location.pathname;
    const wantsLogin = at === '/login';
    if (!auth?.authenticated && !wantsLogin) {
      void navigate({ to: '/login', replace: true });
    } else if (auth?.authenticated && wantsLogin) {
      void navigate({ to: '/', replace: true });
    }
  }, [auth, isPending, router.location.pathname, navigate]);

  if (isPending) {
    return <div className="min-h-dvh grid place-items-center text-neutral-600">…</div>;
  }

  const showChrome = auth?.authenticated && router.location.pathname !== '/login';

  return (
    <div className="min-h-dvh bg-black text-white">
      {showChrome ? <TopNav onLogout={() => logout.mutate()} /> : null}
      <main className={showChrome ? 'pt-16' : ''}>
        <Outlet />
      </main>
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
      <div className="px-6 h-16 flex items-center justify-between gap-8">
        <a href="/" className="text-2xl font-black tracking-tight text-brand">
          PERFLIX
        </a>
        <div className="flex items-center gap-6">
          <a href="/" className={linkCls(path === '/')}>
            Home
          </a>
          <a href="/browse/movie" className={linkCls(path.startsWith('/browse/movie'))}>
            Movies
          </a>
          <a href="/browse/series" className={linkCls(path.startsWith('/browse/series'))}>
            Series
          </a>
          <a href="/lists" className={linkCls(path === '/lists')}>
            My List
          </a>
        </div>
        <button
          onClick={onLogout}
          className="text-xs text-neutral-400 hover:text-white border border-white/10 rounded-full px-3 py-1.5 hover:bg-white/5"
        >
          Sign out
        </button>
      </div>
    </nav>
  );
}
