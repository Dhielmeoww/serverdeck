// @ts-check
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  output: 'server',
  adapter: node({
    mode: 'standalone'
  }),
  // React hanya untuk komponen visual React Bits (island); sisa aplikasi tetap tanpa framework.
  integrations: [react(), {
    name: 'isolated-vite-cache',
    hooks: {
      // `astro check`/build must not replace an active dev server's React optimizer output.
      'astro:config:setup': ({ command, updateConfig }) => {
        updateConfig({ vite: { cacheDir: `node_modules/.vite/astro-${command}` } });
      }
    }
  }],
  vite: {
    plugins: [tailwindcss()]
  },
  server: {
    port: 3000,
    host: true
  }
});
