import { defineConfig } from 'vite';

// base: '' produce percorsi relativi, cosi' lo stesso build funziona sia su
// GitHub Pages (sottocartella /<repo>/) sia dentro l'APK Capacitor (file://).
export default defineConfig({
  base: '',
  build: { outDir: 'dist' },
  server: { host: true },
});
