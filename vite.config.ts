import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    port: 3000,
    open: true,
    headers: {
      'Cache-Control': 'no-cache'
    }
  }
});
