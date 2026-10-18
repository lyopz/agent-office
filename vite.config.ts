import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `--mode single` inlines everything into one HTML file (used for hosted previews).
export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === 'single' ? [viteSingleFile()] : [])],
  build: { outDir: mode === 'single' ? 'dist-single' : 'dist' },
  server: { proxy: { '/api/ai': 'http://localhost:8787' } },
  test: { globals: true, environment: 'node', include: ['tests/**/*.test.ts'] },
}));
