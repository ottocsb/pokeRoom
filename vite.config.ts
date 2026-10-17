import { defineConfig } from 'vite';
import { pokerServerPlugin } from './server/vite-plugin';

export default defineConfig({
  base: './',
  plugins: [pokerServerPlugin()],
  server: { watch: { ignored: ['**/server-data/**', '**/dist-server/**'] } },
});
