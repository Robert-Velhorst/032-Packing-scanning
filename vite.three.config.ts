import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/three/',
  plugins: [react()],
  build: {
    outDir: 'dist/three',
    emptyOutDir: false,
    target: 'es2022',
    sourcemap: false,
    rollupOptions: {
      input: 'three-view.html',
    },
  },
});
