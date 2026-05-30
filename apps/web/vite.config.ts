import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:7000',
      '/stream': 'http://127.0.0.1:7000',
      '/hls': 'http://127.0.0.1:7000',
      '/preview': 'http://127.0.0.1:7000',
      '/thumbs': 'http://127.0.0.1:7000',
      '/art': 'http://127.0.0.1:7000',
      '/subs': 'http://127.0.0.1:7000',
      '/auth': 'http://127.0.0.1:7000',
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
