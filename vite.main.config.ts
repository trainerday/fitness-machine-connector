import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
  build: {
    rollupOptions: {
      // Native modules cannot be bundled by Vite — they must be required at runtime.
      // @stoprocent/bleno is in optionalDependencies so the Forge Vite plugin doesn't
      // externalize it automatically, causing it to fail in packaged builds.
      external: ['@stoprocent/bleno'],
    },
  },
});
