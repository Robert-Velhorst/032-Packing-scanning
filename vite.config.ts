import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^react$/, replacement: 'preact/compat' },
      { find: /^react-dom\/client$/, replacement: 'preact/compat/client' },
      { find: /^react\/jsx-runtime$/, replacement: 'preact/jsx-runtime' },
      { find: /^react\/jsx-dev-runtime$/, replacement: 'preact/jsx-dev-runtime' },
    ],
  },
  server: { proxy: { '/api/': 'http://127.0.0.1:3001' } },
  preview: { proxy: { '/api/': 'http://127.0.0.1:3001' } },
  build: {
    target: 'es2022',
    sourcemap: false,
    rollupOptions: {
      input: {
        app: 'index.html',
        three: 'three/three-view.html',
      },
    },
  },
});
