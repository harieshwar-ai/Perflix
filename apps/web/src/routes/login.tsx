import { createFileRoute } from '@tanstack/react-router';
import { motion } from 'framer-motion';
import { useState } from 'react';
import { useAuthState, useLoginPasskey, useRegisterPasskey } from '../lib/auth.js';
import { LoadingScreen } from '../components/ui/LoadingScreen.js';

export const Route = createFileRoute('/login')({
  component: LoginPage,
});

function LoginPage() {
  const { data: auth, isPending } = useAuthState();
  const register = useRegisterPasskey();
  const login = useLoginPasskey();
  const [deviceName, setDeviceName] = useState('');

  if (isPending) return <LoadingScreen label="Checking session…" />;

  const busy = register.isPending || login.isPending;
  const isFirstUser = !auth?.hasUser;
  const error = register.error ?? login.error;

  return (
    <div className="relative min-h-dvh overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_-10%,rgba(229,9,20,0.18),transparent_55%),radial-gradient(circle_at_85%_120%,rgba(0,80,200,0.12),transparent_55%)]" />
      <div className="relative grid place-items-center min-h-dvh px-6">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
          className="w-full max-w-md rounded-2xl border border-white/10 bg-black/40 backdrop-blur-xl p-10 shadow-2xl"
        >
          <div className="mb-8 text-center">
            <h1 className="text-4xl font-black tracking-tight text-brand">PERFLIX</h1>
            <p className="mt-2 text-sm text-neutral-400">
              {isFirstUser
                ? 'No accounts yet. Register your first passkey to claim this server.'
                : 'Sign in with your passkey to continue.'}
            </p>
          </div>

          {isFirstUser ? (
            <div className="space-y-4">
              <label className="block">
                <span className="text-xs uppercase tracking-wider text-neutral-500">
                  Device name (optional)
                </span>
                <input
                  className="mt-1 block w-full bg-neutral-900 border border-white/10 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-white/30"
                  value={deviceName}
                  onChange={(e) => setDeviceName(e.target.value)}
                  placeholder="MacBook"
                />
              </label>
              <button
                disabled={busy}
                onClick={() => register.mutate(deviceName)}
                className="w-full bg-brand hover:bg-red-700 text-white font-semibold py-2.5 rounded-md transition-colors disabled:opacity-50"
              >
                {register.isPending ? 'Creating passkey…' : 'Create passkey'}
              </button>
            </div>
          ) : (
            <button
              disabled={busy}
              onClick={() => login.mutate()}
              className="w-full bg-brand hover:bg-red-700 text-white font-semibold py-2.5 rounded-md transition-colors disabled:opacity-50"
            >
              {login.isPending ? 'Waiting for passkey…' : 'Sign in with passkey'}
            </button>
          )}

          {error ? (
            <p className="mt-4 text-xs text-red-400">
              {(error as Error).message ?? 'Something went wrong.'}
            </p>
          ) : null}

          <p className="mt-8 text-[11px] text-center text-neutral-600 leading-relaxed">
            Perflix is a single-user, passkey-only server. Up to 4 devices total.
          </p>
        </motion.div>
      </div>
    </div>
  );
}
