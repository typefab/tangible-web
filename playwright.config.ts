import { defineConfig, devices } from '@playwright/test';

/**
 * I test girano contro il gioco vero, in un browser vero.
 *
 * Non ci sono unit test: le parti interessanti di questo progetto — la
 * proiezione isometrica, l'ordine di disegno dei layer, i gesti a due dita, il
 * salvataggio che sopravvive a una ricarica — o si verificano su una pagina che
 * gira o non si verificano affatto. Un mock di `Phaser.Scene` direbbe solo che
 * il mock funziona.
 *
 * Serve il server di sviluppo e non l'anteprima del build: `window.game` e'
 * esposto solo in `import.meta.env.DEV`, ed e' da li' che i test leggono lo
 * stato invece di dedurlo dai pixel.
 */
const PORT = 5174;

export default defineConfig({
  testDir: './test',
  fullyParallel: true,
  // Su CI un test che passa solo qualche volta e' peggio di un test rosso.
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],

  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    launchOptions: {
      // Scappatoia per gli ambienti che hanno gia' un Chromium, con una build
      // diversa da quella che si aspetta questa versione di Playwright: si passa
      // `CHROMIUM_PATH=/percorso/al/chrome`. Vuota altrove, dove il browser lo
      // scarica `npx playwright install`.
      executablePath: process.env.CHROMIUM_PATH || undefined,
    },
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Il gesto a due dita si prova solo con eventi touch veri.
        hasTouch: true,
        viewport: { width: 900, height: 700 },
      },
    },
  ],

  webServer: {
    command: `npm run dev -- --port ${PORT} --host 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
