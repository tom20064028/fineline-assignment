import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const proxy = {
  '/api': {
    target: process.env.FRONTEND_API_TARGET ?? `http://127.0.0.1:${process.env.API_PORT ?? 3001}`,
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/api(?=\/|$)/, ''),
  },
};

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  build: { outDir: '../dist/frontend', emptyOutDir: true },
  server: { host: '127.0.0.1', port: Number(process.env.FRONTEND_PORT ?? 3000), strictPort: true, proxy },
  preview: { host: '127.0.0.1', port: Number(process.env.FRONTEND_PORT ?? 3000), strictPort: true, proxy },
});
