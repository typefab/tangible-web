import Phaser from 'phaser';
import { PLAYER, Z } from '../config';
import { projection } from '../grid/projection';
import type { GridCollision } from './GridCollision';

/**
 * Il personaggio giocante.
 *
 * Si muove su un vettore direzione gia' normalizzato (dal joystick o dalla
 * tastiera). Nessuna fisica: il gioco e' su griglia e il movimento e' diretto,
 * cosi' resta prevedibile e facile da testare.
 *
 * Le collisioni sono delegate a `GridCollision`, che e' facoltativo: senza,
 * il personaggio attraversa i blocchi come prima.
 */
export class Player {
  readonly sprite: Phaser.GameObjects.Sprite;
  private readonly collision?: GridCollision;

  constructor(scene: Phaser.Scene, x: number, y: number, collision?: GridCollision) {
    this.collision = collision;

    // Il punto chiesto dalla scena e' il centro dello schermo: con un livello
    // caricato puo' cadere dentro un blocco. Meglio spostarsi di una cella
    // che comparire murato.
    const spot = collision?.findFreeSpot(x, y) ?? { x, y };

    this.sprite = scene.add.sprite(spot.x, spot.y, PLAYER.texture);
    this.sprite.setDisplaySize(PLAYER.width, PLAYER.height);
    // Origine ai piedi: cosi' la profondita' si confronta con la riga di griglia
    // su cui il personaggio poggia, non con la sua testa.
    this.sprite.setOrigin(0.5, 1);
    // Da fermo la profondita' va comunque calcolata: senza questa riga il
    // personaggio resterebbe a depth 0 e sparirebbe dietro i blocchi fino al
    // primo passo.
    this.refreshDepth();
  }

  /**
   * Allinea il personaggio all'ordinamento dei blocchi.
   *
   * La profondita' si legge dai piedi (l'origine dello sprite e' 0.5,1), cioe'
   * dal punto in cui poggia sulla griglia: e' la cella su cui sta, non la sua
   * testa, a dire chi gli passa davanti.
   */
  private refreshDepth(): void {
    this.sprite.setDepth(projection.depthForWorld(this.sprite.x, this.sprite.y) + Z.playerDepthBias);
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
    const dx = direction.x * step;
    const dy = direction.y * step;

    // Il risolutore ritorna dove si finisce davvero: contro un muro lo
    // spostamento sopravvive sull'asse libero, ed e' quello che fa scivolare
    // lungo la parete invece di incastrarsi.
    const next = this.collision
      ? this.collision.move(this.sprite.x, this.sprite.y, dx, dy)
      : { x: this.sprite.x + dx, y: this.sprite.y + dy };
    this.sprite.setPosition(next.x, next.y);

    // Specchia lo sprite nella direzione di marcia.
    if (direction.x !== 0) this.sprite.setFlipX(direction.x < 0);

    this.refreshDepth();
  }
}
