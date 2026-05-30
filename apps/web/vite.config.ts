import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { TanStackRouterVite } from '@tanstack/router-plugin/vite';
import tailwindcss from '@tailwindcss/vite';
import { visualizer } from 'rollup-plugin-visualizer';

export default defineConfig(({ mode }) => ({
  plugins: [
    TanStackRouterVite({ target: 'react', autoCodeSplitting: true }),
    react(),
    tailwindcss(),
    mode === 'analyze' &&
      visualizer({
        filename: 'dist/stats.html',
        gzipSize: true,
        brotliSize: true,
        open: false,
      }),
  ].filter(Boolean),
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
    sourcemap: false,
    cssMinify: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/hls.js')) return 'hls';
          if (id.includes('node_modules/framer-motion')) return 'motion';
          if (id.includes('node_modules/@tanstack')) return 'tanstack';
          if (id.includes('node_modules/react-dom') || id.includes('node_modules/react/')) return 'react';
        },
      },
    },
  },
}));
