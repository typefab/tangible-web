import Phaser from 'phaser';
import { JOYSTICK } from '../config';

/**
 * Joystick virtuale per il controllo touch.
 *
 * Sostituisce l'estensione SpriteMultitouchJoystick usata nel progetto
 * GDevelop (oggetto `_TransparentDarkJoystick`), riusando gli stessi sprite.
 *
 * Multitouch: il joystick "rivendica" il puntatore che lo attiva e ignora
 * tutti gli altri, cosi' si puo' camminare con un pollice e piazzare blocchi
 * con l'altro. Il metodo `owns()` serve alla scena per non interpretare come
 * piazzamento il tocco che sta guidando il joystick.
 */
export class VirtualJoystick {
  private readonly scene: Phaser.Scene;
  private readonly base: Phaser.GameObjects.Image;
  private readonly thumb: Phaser.GameObjects.Image;

  /** id del puntatore che sta guidando il joystick, null se fermo. */
  private activePointerId: number | null = null;
  private origin = new Phaser.Math.Vector2();
  /** Spazio riservato in basso, es. alla barra dell'inventario. */
  private bottomInset = 0;

  /** Direzione corrente, gia' normalizzata. (0,0) se fermo. */
  readonly direction = new Phaser.Math.Vector2();

  constructor(scene: Phaser.Scene) {
    this.scene = scene;

    // Serve piu' di un puntatore attivo: di default Phaser ne traccia uno solo.
    scene.input.addPointer(2);

    this.base = scene.add
      .image(0, 0, JOYSTICK.borderTexture)
      .setScrollFactor(0)
      .setDepth(10_000)
      .setAlpha(0.55)
      .setDisplaySize(JOYSTICK.radius * 2, JOYSTICK.radius * 2);

    this.thumb = scene.add
      .image(0, 0, JOYSTICK.thumbTexture)
      .setScrollFactor(0)
      .setDepth(10_001)
      .setAlpha(0.75)
      .setDisplaySize(JOYSTICK.radius * 1.1, JOYSTICK.radius * 1.1);

    this.reposition();
    scene.scale.on(Phaser.Scale.Events.RESIZE, () => this.reposition());

    scene.input.on(Phaser.Input.Events.POINTER_DOWN, this.onDown, this);
    scene.input.on(Phaser.Input.Events.POINTER_MOVE, this.onMove, this);
    scene.input.on(Phaser.Input.Events.POINTER_UP, this.onUp, this);
  }

  /**
   * Riserva spazio in fondo allo schermo: su telefono la barra
   * dell'inventario finirebbe sotto il joystick.
   */
  setBottomInset(pixels: number): void {
    this.bottomInset = pixels;
    this.reposition();
  }

  /** Il joystick vive in basso a sinistra, ancorato allo schermo. */
  private reposition(): void {
    const { height } = this.scene.scale;
    this.origin.set(JOYSTICK.margin, height - JOYSTICK.margin - this.bottomInset);
    this.base.setPosition(this.origin.x, this.origin.y);
    this.thumb.setPosition(this.origin.x, this.origin.y);
  }

  /** True se quel puntatore sta guidando il joystick: la scena lo ignora. */
  owns(pointer: Phaser.Input.Pointer): boolean {
    return this.activePointerId === pointer.id;
  }

  /** Un tocco attiva il joystick se cade entro il doppio del suo raggio. */
  private onDown(pointer: Phaser.Input.Pointer): void {
    if (this.activePointerId !== null) return;
    if (Phaser.Math.Distance.Between(pointer.x, pointer.y, this.origin.x, this.origin.y) > JOYSTICK.radius * 2) {
      return;
    }
    this.activePointerId = pointer.id;
    this.onMove(pointer);
  }

  private onMove(pointer: Phaser.Input.Pointer): void {
    if (this.activePointerId !== pointer.id) return;

    const dx = pointer.x - this.origin.x;
    const dy = pointer.y - this.origin.y;
    const distance = Math.hypot(dx, dy);
    const clamped = Math.min(distance, JOYSTICK.radius);

    if (distance > 0) {
      const nx = dx / distance;
      const ny = dy / distance;
      this.thumb.setPosition(this.origin.x + nx * clamped, this.origin.y + ny * clamped);

      const strength = clamped / JOYSTICK.radius;
      if (strength < JOYSTICK.deadZone) this.direction.set(0, 0);
      else this.direction.set(nx, ny);
    }
  }

  private onUp(pointer: Phaser.Input.Pointer): void {
    if (this.activePointerId !== pointer.id) return;
    this.activePointerId = null;
    this.direction.set(0, 0);
    this.thumb.setPosition(this.origin.x, this.origin.y);
  }
}
