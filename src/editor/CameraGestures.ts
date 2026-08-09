import Phaser from 'phaser';

export const ZOOM_MIN = 0.3;
export const ZOOM_MAX = 3;
export const ZOOM_STEP = 1.25;

interface Point {
  x: number;
  y: number;
}

/**
 * Navigazione della scena: due dita per spostarsi e ingrandire, rotella per lo
 * zoom.
 *
 * **Due dita e non uno.** Un dito solo e' gia' preso: disegna, cancella,
 * seleziona. Il gesto a due dita invece e' libero in ogni strumento, quindi ci
 * si sposta senza mai cambiare modalita' — che e' il punto. Chi preferisce il
 * dito singolo ha lo strumento ✋, a un tocco di distanza.
 *
 * Lo zoom e' ancorato al punto sotto le dita, non al centro dello schermo: il
 * pezzo di scena che stai guardando resta dov'e' mentre ingrandisci, altrimenti
 * ogni zoom richiede un riposizionamento.
 */
export class CameraGestures {
  private readonly scene: Phaser.Scene;
  private readonly pointers = new Map<number, Point>();
  private previous: { distance: number; middle: Point } | null = null;

  /** Chiamato quando il secondo dito tocca: serve ad annullare il tratto in corso. */
  onGestureStart?: () => void;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    // Di default Phaser traccia un puntatore solo: senza questo il secondo dito
    // non esiste e il pinch non puo' funzionare.
    scene.input.addPointer(2);

    const input = scene.input;
    input.on(Phaser.Input.Events.POINTER_DOWN, this.onDown, this);
    input.on(Phaser.Input.Events.POINTER_MOVE, this.onMove, this);
    input.on(Phaser.Input.Events.POINTER_UP, this.onUp, this);
    input.on(Phaser.Input.Events.GAME_OUT, () => this.reset());
    input.on(
      Phaser.Input.Events.POINTER_WHEEL,
      (pointer: Phaser.Input.Pointer, _o: unknown[], _dx: number, dy: number) => {
        this.zoomAt(dy > 0 ? 1 / ZOOM_STEP : ZOOM_STEP, { x: pointer.x, y: pointer.y });
      },
    );
  }

  /** True mentre due dita stanno guidando la vista: chi disegna deve stare fermo. */
  get active(): boolean {
    return this.pointers.size >= 2;
  }

  private onDown(pointer: Phaser.Input.Pointer): void {
    this.pointers.set(pointer.id, { x: pointer.x, y: pointer.y });
    if (this.pointers.size === 2) {
      this.previous = null;
      this.onGestureStart?.();
    }
  }

  private onMove(pointer: Phaser.Input.Pointer): void {
    if (!this.pointers.has(pointer.id)) return;
    this.pointers.set(pointer.id, { x: pointer.x, y: pointer.y });
    if (this.pointers.size < 2) return;

    const [a, b] = [...this.pointers.values()] as [Point, Point];
    const distance = Math.hypot(a.x - b.x, a.y - b.y);
    const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };

    // Il primo frame del gesto stabilisce solo il riferimento: senza un "prima"
    // non esiste un rapporto di zoom ne' uno spostamento.
    if (this.previous && this.previous.distance > 0) {
      this.zoomAt(distance / this.previous.distance, middle);
      this.panBy(middle.x - this.previous.middle.x, middle.y - this.previous.middle.y);
    }
    this.previous = { distance, middle };
  }

  private onUp(pointer: Phaser.Input.Pointer): void {
    this.pointers.delete(pointer.id);
    // Togliendo un dito da un pinch, il gesto ricomincia da capo: senza questo
    // il dito rimasto farebbe un salto pari alla distanza fra i due.
    this.previous = null;
  }

  private reset(): void {
    this.pointers.clear();
    this.previous = null;
  }

  /** Diviso per lo zoom: a schermo il dito deve restare sullo stesso punto. */
  private panBy(dx: number, dy: number): void {
    const cam = this.scene.cameras.main;
    cam.scrollX -= dx / cam.zoom;
    cam.scrollY -= dy / cam.zoom;
  }

  /**
   * Ingrandisce tenendo fermo il punto di schermo indicato.
   *
   * Si misura il punto del mondo sotto le dita prima e dopo, e si sposta la
   * camera della differenza. E' piu' semplice che ricavare la formula, e non
   * puo' sbagliare di un fattore.
   */
  zoomAt(factor: number, screen: Point): void {
    const cam = this.scene.cameras.main;
    const before = cam.getWorldPoint(screen.x, screen.y);
    cam.setZoom(Phaser.Math.Clamp(cam.zoom * factor, ZOOM_MIN, ZOOM_MAX));
    const after = cam.getWorldPoint(screen.x, screen.y);
    cam.scrollX += before.x - after.x;
    cam.scrollY += before.y - after.y;
  }

  /** Per i pulsanti − e +: si ingrandisce verso il centro dello schermo. */
  zoomBy(factor: number): void {
    this.zoomAt(factor, { x: this.scene.scale.width / 2, y: this.scene.scale.height / 2 });
  }
}
