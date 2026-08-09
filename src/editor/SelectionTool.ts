import Phaser from 'phaser';
import { GRID, Z, type BlockType } from '../config';
import { projection } from '../grid/projection';
import type { GridPlacement } from '../mechanics/GridPlacement';

/**
 * Un blocco selezionato, staccato dallo sprite: sopravvive allo spostamento,
 * al cambio di livello e agli appunti.
 */
export interface Picked {
  col: number;
  row: number;
  type: BlockType;
}

const MARQUEE_COLOR = 0x6ee7ff;
const SELECTED_COLOR = 0xffd166;

/**
 * Selezione a rettangolo, come in GDevelop.
 *
 * Si trascina dal punto in cui si appoggia il dito, il rettangolo si allarga
 * seguendolo, e al rilascio resta selezionato tutto quello che ci e' finito
 * dentro. Poi la selezione si trascina per spostarla, o si cancella.
 *
 * **Vale sul layer attivo e solo su quello**, come il pennello: e' la regola
 * che rende prevedibile un editor a piani. La selezione si annulla da sola se
 * si cambia layer, perche' altrimenti resterebbe appesa a blocchi che non si
 * stanno piu' guardando.
 *
 * Il test di appartenenza usa la posizione dello **sprite**, non il centro
 * della cella: su un layer con quota i due punti non coincidono, e chi
 * seleziona si aspetta di prendere quello che vede.
 */
export class SelectionTool {
  private readonly placement: GridPlacement;
  private readonly graphics: Phaser.GameObjects.Graphics;

  private selected: Picked[] = [];
  /** Il layer su cui e' stata fatta la selezione. */
  private layerIndex = 0;

  private mode: 'idle' | 'marquee' | 'move' = 'idle';
  private anchor = { x: 0, y: 0 };
  private corner = { x: 0, y: 0 };
  private dragFrom = { col: 0, row: 0 };
  private delta = { col: 0, row: 0 };

  constructor(scene: Phaser.Scene, placement: GridPlacement) {
    this.placement = placement;
    this.graphics = scene.add.graphics().setDepth(Z.placeHitbox - 1);
  }

  get count(): number {
    return this.selected.length;
  }

  get isDragging(): boolean {
    return this.mode !== 'idle';
  }

  /** I blocchi selezionati, staccati dalla scena. Copia: il chiamante li tiene. */
  snapshot(): Picked[] {
    return this.selected.map((b) => ({ ...b }));
  }

  /**
   * Rende selezionati dei blocchi gia' piazzati, sul layer attivo.
   * Serve dopo un incolla: quello che arriva resta in mano, pronto da spostare.
   */
  adopt(blocks: Picked[]): void {
    this.layerIndex = this.placement.activeLayer;
    this.selected = blocks.map((b) => ({ ...b }));
    this.mode = 'idle';
    this.delta = { col: 0, row: 0 };
    this.redraw();
  }

  /**
   * Comincia un gesto. Se il dito si appoggia dentro la selezione la sposta,
   * altrimenti ricomincia a selezionare da capo: e' il comportamento che ci si
   * aspetta e non richiede un secondo strumento.
   */
  begin(world: Phaser.Math.Vector2 | { x: number; y: number }, cell: { col: number; row: number }): void {
    if (this.layerIndex === this.placement.activeLayer && this.contains(cell)) {
      this.mode = 'move';
      this.dragFrom = { ...cell };
      this.delta = { col: 0, row: 0 };
      this.redraw();
      return;
    }

    this.mode = 'marquee';
    this.layerIndex = this.placement.activeLayer;
    this.selected = [];
    this.anchor = { x: world.x, y: world.y };
    this.corner = { x: world.x, y: world.y };
    this.redraw();
  }

  update(world: { x: number; y: number }, cell: { col: number; row: number }): void {
    if (this.mode === 'marquee') {
      this.corner = { x: world.x, y: world.y };
    } else if (this.mode === 'move') {
      this.delta = this.clampDelta(cell.col - this.dragFrom.col, cell.row - this.dragFrom.row);
    } else {
      return;
    }
    this.redraw();
  }

  /** Chiude il gesto. @returns true se la scena e' cambiata (serve all'undo). */
  end(): boolean {
    const mode = this.mode;
    this.mode = 'idle';

    if (mode === 'marquee') {
      this.pickInsideMarquee();
      this.redraw();
      return false;
    }

    if (mode === 'move') {
      const moved = this.applyMove();
      this.redraw();
      return moved;
    }
    return false;
  }

  /** @returns true se qualcosa e' stato davvero cancellato. */
  deleteSelected(): boolean {
    if (this.selected.length === 0) return false;

    for (const block of this.selected) this.placement.remove(block.col, block.row, this.layerIndex);
    this.selected = [];
    this.redraw();
    return true;
  }

  clear(): void {
    this.selected = [];
    this.mode = 'idle';
    this.delta = { col: 0, row: 0 };
    this.redraw();
  }

  /**
   * Abbandona il gesto in corso senza applicarlo, tenendo la selezione.
   * Serve quando il secondo dito entra in scena: quel trascinamento non era
   * uno spostamento, era l'inizio di un pinch.
   */
  cancel(): void {
    this.mode = 'idle';
    this.delta = { col: 0, row: 0 };
    this.redraw();
  }

  /** Da chiamare quando lo strumento viene abbandonato o cambia il contesto. */
  hide(): void {
    this.clear();
    this.graphics.setVisible(false);
  }

  show(): void {
    this.graphics.setVisible(true);
    this.redraw();
  }

  // ------------------------------------------------------------- interni

  private contains(cell: { col: number; row: number }): boolean {
    return this.selected.some((b) => b.col === cell.col && b.row === cell.row);
  }

  private get rect(): Phaser.Geom.Rectangle {
    return new Phaser.Geom.Rectangle(
      Math.min(this.anchor.x, this.corner.x),
      Math.min(this.anchor.y, this.corner.y),
      Math.abs(this.corner.x - this.anchor.x),
      Math.abs(this.corner.y - this.anchor.y),
    );
  }

  private pickInsideMarquee(): void {
    const rect = this.rect;
    this.selected = this.placement
      .entriesOn(this.layerIndex)
      .filter((e) => rect.contains(e.sprite.x, e.sprite.y))
      .map((e) => ({ col: e.col, row: e.row, type: e.sprite.getData('type') as BlockType }));
  }

  /** Nessuna cella della selezione puo' uscire dalla griglia disegnata. */
  private clampDelta(dCol: number, dRow: number): { col: number; row: number } {
    if (this.selected.length === 0) return { col: 0, row: 0 };

    let minCol = Infinity;
    let maxCol = -Infinity;
    let minRow = Infinity;
    let maxRow = -Infinity;
    for (const b of this.selected) {
      minCol = Math.min(minCol, b.col);
      maxCol = Math.max(maxCol, b.col);
      minRow = Math.min(minRow, b.row);
      maxRow = Math.max(maxRow, b.row);
    }

    return {
      col: Phaser.Math.Clamp(dCol, GRID.drawFrom - minCol, GRID.drawTo - maxCol),
      row: Phaser.Math.Clamp(dRow, GRID.drawFrom - minRow, GRID.drawTo - maxRow),
    };
  }

  /**
   * Sposta i blocchi selezionati di `delta`.
   *
   * Prima si tolgono tutti quelli di partenza e poi si ripiazzano: facendolo
   * blocco per blocco, spostare una fila di uno a destra cancellerebbe il
   * vicino appena scritto.
   */
  private applyMove(): boolean {
    const { col: dCol, row: dRow } = this.delta;
    this.delta = { col: 0, row: 0 };
    if (dCol === 0 && dRow === 0) return false;

    for (const b of this.selected) this.placement.remove(b.col, b.row, this.layerIndex);

    const moved = this.selected.map((b) => ({ ...b, col: b.col + dCol, row: b.row + dRow }));
    for (const b of moved) {
      // La destinazione puo' essere occupata da un blocco che non fa parte
      // della selezione: la selezione vince, come in ogni editor.
      this.placement.remove(b.col, b.row, this.layerIndex);
      this.placement.spawn(b.col, b.row, b.type, this.layerIndex);
    }

    this.selected = moved;
    return true;
  }

  private redraw(): void {
    const g = this.graphics;
    g.clear();

    if (this.mode === 'marquee') {
      const r = this.rect;
      g.fillStyle(MARQUEE_COLOR, 0.12).fillRectShape(r);
      g.lineStyle(1, MARQUEE_COLOR, 0.9).strokeRectShape(r);
      return;
    }

    if (this.selected.length === 0) return;

    // Durante lo spostamento il contorno mostra dove finiranno i blocchi, non
    // dove sono: e' l'anteprima che rende il trascinamento leggibile.
    const offsetY = projection.elevationOffsetY(this.placement.layers[this.layerIndex]?.elevation ?? 0);
    g.lineStyle(2, SELECTED_COLOR, 0.9);
    for (const b of this.selected) {
      const outline = projection
        .cellOutline(b.col + this.delta.col, b.row + this.delta.row)
        .map((p) => ({ x: p.x, y: p.y + offsetY }));
      g.strokePoints(outline, true);
    }
  }
}
