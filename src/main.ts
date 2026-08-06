import Phaser from 'phaser';
import { GameScene } from './scenes/GameScene';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#1b1b22',
  // Scala per riempire lo schermo del telefono mantenendo le proporzioni.
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  render: { pixelArt: true, antialias: false },
  scene: [GameScene],
});

// Solo in sviluppo: permette di ispezionare lo stato dalla console del browser
// (window.game). Non finisce nel build di produzione.
if (import.meta.env.DEV) {
  (window as unknown as { game: Phaser.Game }).game = game;
}
