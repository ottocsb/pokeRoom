import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { pokerServerPlugin } from './server/vite-plugin';

export default defineConfig({
  base: './',
  plugins: [vue(), pokerServerPlugin()],
  server: { watch: { ignored: ['**/server-data/**', '**/dist-server/**'] } },
});
