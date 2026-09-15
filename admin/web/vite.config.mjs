// Admin SPA build (admin-ops.md §6.1). The output in admin/web/dist/ is served by the admin service at
// /admin/ and /admin/assets/*. CSP rules the build must keep: no inline script, no style attributes,
// every asset (fonts, thumbnails) emitted as a hashed file (assetsInlineLimit 0).
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: '/admin/',
  plugins: [vue()],
  resolve: {
    alias: {
      '@admin-shared': repo + 'admin/shared',
      '@schema': repo + 'src/schema',
      '@src': repo + 'src',
      '@thumbs': repo + 'src/admin-thumbs',
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    fs: { allow: [repo] },
    proxy: { '/admin/api': 'http://127.0.0.1:3097', '/admin/preview': 'http://127.0.0.1:3097' },
  },
  build: { outDir: 'dist', emptyOutDir: true, assetsInlineLimit: 0, sourcemap: false, target: 'es2022' },
});
