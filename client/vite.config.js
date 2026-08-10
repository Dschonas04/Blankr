import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // Der CRDT-Kern liegt in ../shared, weil ihn Client und Server wortgleich
    // benutzen muessen -- zwei Kopien waeren die naheliegendste Fehlerquelle
    // fuer auseinanderlaufende Zustaende.
    fs: { allow: ['..'] },
    proxy: {
      '/ws': { target: 'ws://localhost:8080', ws: true },
      '/api': { target: 'http://localhost:8080' },
    },
  },
});
