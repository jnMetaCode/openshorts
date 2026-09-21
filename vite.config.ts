import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // 函数形式：Vite 8（rolldown）不再接受对象形式（TS2769），函数形式新旧版本都认
        manualChunks: (id) => (/\/node_modules\/(remotion|@remotion\/player)\//.test(id) ? 'remotion' : undefined),
      },
    },
  },
  server: {
    port: 4173,
    proxy: {'/api': 'http://127.0.0.1:4174'},
  },
});
