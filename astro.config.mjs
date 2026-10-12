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
  integrations: [react()],
  vite: {
    plugins: [tailwindcss()]
  },
  server: {
    port: 3000,
    host: true
  }
});
