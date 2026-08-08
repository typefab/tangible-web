import { defineConfig } from 'vite';

// base: '' produce percorsi relativi, cosi' lo stesso build funziona sia su
// GitHub Pages (sottocartella /<repo>/) sia dentro l'APK Capacitor (file://).
export default defineConfig({
  base: '',
  build: {
    outDir: 'dist',
    // Gli sprite restano file veri anche quando sono piccolissimi.
    // Di default Vite trasforma in data URI tutto cio' che sta sotto 4 KB, e
    // il loader di Phaser scarica le immagini con XHR: su un data URI non
    // funziona. Sarebbe un guasto solo in produzione — in sviluppo Vite non
    // inlinea nulla — cioe' il tipo di guasto che si scopre tardi.
    assetsInlineLimit: 0,
  },
  server: { host: true },
});
