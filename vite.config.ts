import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  root: 'web',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: '../dist/web',
    emptyOutDir: true,
    rollupOptions: {
      // Libraries change less often than the app, so browsers keep them cached across updates.
      output: { manualChunks: { vendor: ['react', 'react-dom', 'react-dom/client', '@tanstack/react-query', '@tanstack/react-virtual'] } },
    },
  },
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:8080' },
  },
});
