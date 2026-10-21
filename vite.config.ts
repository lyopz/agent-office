import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `--mode single` inlines everything into one HTML file (used for hosted previews).
// `base: './'` keeps asset URLs relative so the build also loads from a file or the desktop app.
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [react(), ...(mode === 'single' ? [viteSingleFile()] : [])],
  build: { outDir: mode === 'single' ? 'dist-single' : 'dist' },
  server: { proxy: { '/api/origin': 'http://127.0.0.1:8788' } },
  test: { globals: true, environment: 'node', include: ['tests/**/*.test.ts'] },
}));
