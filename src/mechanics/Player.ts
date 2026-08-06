import Phaser from 'phaser';
import { PLAYER } from '../config';

/**
 * Il personaggio giocante.
 *
 * Si muove su un vettore direzione gia' normalizzato (dal joystick o dalla
 * tastiera). Nessuna fisica: il gioco e' su griglia e il movimento e' diretto,
 * cosi' resta prevedibile e facile da testare.
 */
export class Player {
  readonly sprite: Phaser.GameObjects.Sprite;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    this.sprite = scene.add.sprite(x, y, PLAYER.texture);
    this.sprite.setDisplaySize(PLAYER.width, PLAYER.height);
    // Origine ai piedi: cosi' la profondita' si confronta con la riga di griglia
    // su cui il personaggio poggia, non con la sua testa.
    this.sprite.setOrigin(0.5, 1);
  }

  get x(): number {
    return this.sprite.x;
  }

  get y(): number {
    return this.sprite.y;
  }

  /**
   * @param delta millisecondi dall'ultimo frame
   * @param direction vettore normalizzato; (0,0) sta fermo
   */
  update(delta: number, direction: Phaser.Math.Vector2): void {
    if (direction.x === 0 && direction.y === 0) return;

    const step = (PLAYER.speed * delta) / 1000;
    this.sprite.x += direction.x * step;
    this.sprite.y += direction.y * step;

    // Specchia lo sprite nella direzione di marcia.
    if (direction.x !== 0) this.sprite.setFlipX(direction.x < 0);

    // La profondita' segue la posizione verticale: chi sta piu' in basso
    // e' davanti, coerente con i blocchi che usano la riga come depth.
    this.sprite.setDepth(this.sprite.y);
  }
}
