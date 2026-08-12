import Phaser from 'phaser';
import { Z } from '../config';
import { resolveBackground } from '../assets/catalog';
import type { SerializedBackground } from '../level/project';

/**
 * I fondali di un livello: immagini dietro alla scena.
 *
 * Stanno qui e non in `GridPlacement` perche' **non sono blocchi**. Un blocco
 * vive in una cella, e tutto cio' che l'editor sa fare — pennello, gomma,
 * selezione ad area, appunti — gira per celle. Un fondale ha posizione e scala
 * libere: tenerlo separato e' quello che permette a quegli strumenti di non
 * imparare nessun caso speciale.
 *
 * Vengono montati anche in gioco, non solo in editor: e' la stessa ragione per
 * cui l'editor disegna attraverso `GameScene`, cioe' che quello che si vede
 * costruendo sia quello che si vedra' giocando per costruzione, non per
 * diligenza.
 */
export class Backdrop {
  private readonly scene: Phaser.Scene;
  /** Ordinati come si disegnano: l'ultimo sta davanti agli altri, dietro a tutto il resto. */
  private items: Phaser.GameObjects.Image[] = [];

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  get count(): number {
    return this.items.length;
  }

  /**
   * Rimonta i fondali del livello.
   *
   * Gli id che il catalogo non conosce vengono **scartati**, come per i
   * blocchi: l'elenco delle immagini esiste solo dopo la build, quindi un file
   * che nomina un fondale cancellato dal repository non puo' essere fermato dal
   * compilatore. Meglio un'immagine in meno che uno sprite invisibile che
   * nessuno riesce a selezionare.
   */
  load(backgrounds: readonly SerializedBackground[] = []): void {
    this.clear();
    for (const item of backgrounds) {
      const index = this.add(item.id, item.x, item.y, item.scale);
      if (index >= 0 && item.rotation) this.items[index]!.setAngle(item.rotation);
    }
  }

  serialize(): SerializedBackground[] {
    return this.items.map((image) => {
      const item: SerializedBackground = {
        id: image.texture.key,
        // Arrotondati: un fondale trascinato col dito produrrebbe altrimenti
        // sette decimali per riga, e il diff di `level.json` va letto a mano.
        x: Math.round(image.x),
        y: Math.round(image.y),
        scale: Math.round(image.scaleX * 1000) / 1000,
      };
      const angle = ((Math.round(image.angle) % 360) + 360) % 360;
      if (angle !== 0) item.rotation = angle;
      return item;
    });
  }

  /** @returns l'indice del fondale aggiunto, o -1 se l'id non esiste. */
  add(id: string, x: number, y: number, scale = 1): number {
    const asset = resolveBackground(id);
    if (!asset || !this.scene.textures.exists(asset.id)) return -1;

    const image = this.scene.add.image(x, y, asset.id).setScale(scale);
    this.items.push(image);
    this.applyDepth();
    return this.items.length - 1;
  }

  /**
   * Il fondale sotto quel punto del mondo, il piu' avanti fra quelli che lo
   * contengono. Serve all'editor per capire se un tocco prende un'immagine
   * esistente o ne piazza una nuova.
   *
   * Sulle immagini ruotate: `getBounds()` da' il rettangolo **allineato agli
   * assi** che contiene l'immagine girata, quindi la presa e' un po' generosa
   * negli angoli. E' il compromesso giusto: l'alternativa sarebbe ricostruire
   * il quadrilatero ruotato per un tocco che deve solo dire "quale di queste
   * immagini stai indicando".
   */
  at(x: number, y: number): number | undefined {
    for (let i = this.items.length - 1; i >= 0; i--) {
      if (this.items[i]!.getBounds().contains(x, y)) return i;
    }
    return undefined;
  }

  positionOf(index: number): { x: number; y: number; scale: number } | undefined {
    const image = this.items[index];
    return image ? { x: image.x, y: image.y, scale: image.scaleX } : undefined;
  }

  /** Cosa mostrare nell'elenco del pannello: l'etichetta del catalogo. */
  labels(): string[] {
    return this.items.map((image) => resolveBackground(image.texture.key)?.label ?? image.texture.key);
  }

  move(index: number, x: number, y: number): void {
    this.items[index]?.setPosition(x, y);
  }

  /** Scala tenendo fermo il centro. Il limite evita di perdere un'immagine. */
  scaleBy(index: number, factor: number): void {
    const image = this.items[index];
    if (!image) return;
    image.setScale(Phaser.Math.Clamp(image.scaleX * factor, 0.05, 20));
  }

  /**
   * Ruota di un passo. Il centro resta dov'e': e' il punto che si e' scelto
   * mettendo l'immagine, e farlo spostare a ogni tocco sarebbe scomodo.
   */
  rotateBy(index: number, degrees: number): void {
    const image = this.items[index];
    if (!image) return;
    image.setAngle((((image.angle + degrees) % 360) + 360) % 360);
  }

  remove(index: number): void {
    const [image] = this.items.splice(index, 1);
    image?.destroy();
    this.applyDepth();
  }

  /**
   * Sposta un fondale di un posto nell'elenco.
   *
   * @param direction +1 lo porta davanti agli altri fondali, -1 dietro.
   * @returns il nuovo indice, o lo stesso se era gia' in fondo.
   */
  reorder(index: number, direction: 1 | -1): number {
    const target = index + direction;
    if (!this.items[index] || target < 0 || target >= this.items.length) return index;

    const [image] = this.items.splice(index, 1);
    this.items.splice(target, 0, image!);
    this.applyDepth();
    return target;
  }

  clear(): void {
    for (const image of this.items) image.destroy();
    this.items = [];
  }

  /** La posizione nell'elenco **e'** l'ordine di disegno: nessuna seconda verita'. */
  private applyDepth(): void {
    this.items.forEach((image, i) => image.setDepth(Z.background + i));
  }
}
