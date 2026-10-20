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
    // Match the native WebKit minimum; ES year targets alone do not pin Safari.
    target: ['chrome111', 'edge111', 'firefox114', 'safari15.4', 'ios15.4'],
    sourcemap: false,
    rollupOptions: {
      input: {
        app: 'index.html',
        three: 'three/three-view.html',
      },
    },
  },
});
