import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'io.github.fabri.tangiblecushion',
  appName: 'Tangible Cushion',
  webDir: 'dist',
  android: {
    // Il gioco disegna da solo lo sfondo; niente barra bianca dietro al canvas.
    backgroundColor: '#1b1b22',
  },
};

export default config;
