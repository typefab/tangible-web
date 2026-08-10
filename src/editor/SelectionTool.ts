import Phaser from 'phaser';
import { GRID, Z, type BlockType } from '../config';
import { projection } from '../grid/projection';
import { GridPlacement } from '../mechanics/GridPlacement';

/** Un blocco staccato dalla scena: sopravvive allo spostamento e agli appunti. */
export interface Picked {
  col: number;
  row: number;
  type: BlockType;
}

interface Cell {
  col: number;
  row: number;
}

const MARQUEE_COLOR = 0x6ee7ff;
const SELECTED_COLOR = 0xffd166;

/**
 * Selezione a rettangolo, come in GDevelop.
 *
 * **La selezione e' un'area di celle, non un insieme di blocchi.** E' la
 * differenza che fa funzionare tutto il resto: si seleziona il terreno che si
 * vuole modificare — comprese le celle vuote — e poi lo si riempie col
 * pennello o lo si svuota con la gomma. Con una selezione di soli blocchi non
 * si potrebbe riempire un'area vuota, e servirebbe un secondo strumento solo
 * per quello.
 *
 * Vale sul layer attivo al momento della selezione e solo su quello, come il
 * pennello. Cambiare layer la annulla: altrimenti resterebbe appesa a un piano
 * che non si sta piu' guardando.
 *
 * Il criterio di appartenenza e' il centro della cella dentro il rettangolo
 * **di schermo**: su griglia isometrica si prende il rombo che si vede, non un
 * blocco di righe e colonne.
 */
export class SelectionTool {
  private readonly placement: GridPlacement;
  private readonly graphics: Phaser.GameObjects.Graphics;

  private cells: Cell[] = [];
  /** Il layer su cui e' stata fatta la selezione. */
  private layerIndex = 0;

  private mode: 'idle' | 'marquee' | 'move' = 'idle';
  private anchor = { x: 0, y: 0 };
  private corner = { x: 0, y: 0 };
  private dragFrom: Cell = { col: 0, row: 0 };
  private delta = { col: 0, row: 0 };

  constructor(scene: Phaser.Scene, placement: GridPlacement) {
    this.placement = placement;
    this.graphics = scene.add.graphics().setDepth(Z.placeHitbox - 1);
  }

  /** Quante celle sono selezionate, vuote comprese. */
  get count(): number {
    return this.cells.length;
  }

  /** Quante di quelle celle hanno davvero un blocco. */
  get blockCount(): number {
    return this.blocksInArea().length;
  }

  get isDragging(): boolean {
    return this.mode !== 'idle';
  }

  /** I blocchi che stanno nell'area, staccati dalla scena. */
  snapshot(): Picked[] {
    return this.blocksInArea();
  }

  /**
   * Seleziona l'area occupata da questi blocchi, sul layer attivo.
   * Serve dopo un incolla: quello che arriva resta in mano, pronto da spostare.
   */
  adopt(blocks: readonly Picked[]): void {
    this.layerIndex = this.placement.activeLayer;
    this.cells = blocks.map((b) => ({ col: b.col, row: b.row }));
    this.mode = 'idle';
    this.delta = { col: 0, row: 0 };
    this.redraw();
  }

  // ------------------------------------------------------------- gesti

  /**
   * Comincia un gesto. Se il dito si appoggia dentro l'area la sposta,
   * altrimenti ricomincia a selezionare da capo: e' il comportamento che ci si
   * aspetta e non richiede un secondo strumento.
   */
  begin(world: { x: number; y: number }, cell: Cell): void {
    if (this.layerIndex === this.placement.activeLayer && this.contains(cell)) {
      this.mode = 'move';
      this.dragFrom = { ...cell };
      this.delta = { col: 0, row: 0 };
      this.redraw();
      return;
    }

    this.mode = 'marquee';
    this.layerIndex = this.placement.activeLayer;
    this.cells = [];
    this.anchor = { x: world.x, y: world.y };
    this.corner = { x: world.x, y: world.y };
    this.redraw();
  }

  update(world: { x: number; y: number }, cell: Cell): void {
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
      this.cells = this.cellsInsideMarquee();
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

  // ---------------------------------------------------------- operazioni

  /**
   * Riempie l'area col blocco indicato, sostituendo quello che trova.
   * E' quello che fa il pennello quando c'e' una selezione.
   */
  fillArea(type: BlockType): boolean {
    if (this.cells.length === 0) return false;

    for (const { col, row } of this.cells) {
      // Prima si toglie: `spawn` rifiuta una cella occupata, e riempire sopra
      // a qualcosa deve sostituirlo, non lasciarlo com'era.
      this.placement.remove(col, row, this.layerIndex);
      this.placement.spawn(col, row, type, this.layerIndex);
    }
    this.redraw();
    return true;
  }

  /**
   * Svuota l'area. E' quello che fa la gomma quando c'e' una selezione.
   *
   * L'area **resta selezionata** anche se ora e' vuota: dopo aver svuotato,
   * quasi sempre si vuole riempire con qualcos'altro.
   */
  clearArea(): boolean {
    let cambiato = false;
    for (const { col, row } of this.cells) {
      if (this.placement.remove(col, row, this.layerIndex)) cambiato = true;
    }
    this.redraw();
    return cambiato;
  }

  clear(): void {
    this.cells = [];
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

  hide(): void {
    this.clear();
    this.graphics.setVisible(false);
  }

  show(): void {
    this.graphics.setVisible(true);
    this.redraw();
  }

  // ------------------------------------------------------------- interni

  private blocksInArea(): Picked[] {
    const out: Picked[] = [];
    for (const { col, row } of this.cells) {
      const type = this.placement.typeAt(col, row, this.layerIndex);
      if (type !== undefined) out.push({ col, row, type });
    }
    return out;
  }

  private contains(cell: Cell): boolean {
    return this.cells.some((c) => c.col === cell.col && c.row === cell.row);
  }

  private get rect(): Phaser.Geom.Rectangle {
    return new Phaser.Geom.Rectangle(
      Math.min(this.anchor.x, this.corner.x),
      Math.min(this.anchor.y, this.corner.y),
      Math.abs(this.corner.x - this.anchor.x),
      Math.abs(this.corner.y - this.anchor.y),
    );
  }

  /**
   * Le celle il cui centro cade dentro il rettangolo tracciato.
   *
   * Si passano in rassegna tutte le celle della griglia disegnata: sono 625,
   * cioe' niente, e cosi' non serve invertire la proiezione sugli angoli — che
   * sarebbe un secondo pezzo di geometria da tenere d'accordo col primo.
   */
  private cellsInsideMarquee(): Cell[] {
    const rect = this.rect;
    const lift = projection.elevationOffsetY(
      this.placement.layers[this.layerIndex]?.elevation ?? 0,
    );

    const out: Cell[] = [];
    for (let row = GRID.drawFrom; row <= GRID.drawTo; row++) {
      for (let col = GRID.drawFrom; col <= GRID.drawTo; col++) {
        const c = GridPlacement.cellToWorld(col, row);
        if (rect.contains(c.x, c.y + lift)) out.push({ col, row });
      }
    }
    return out;
  }

  /** Nessuna cella dell'area puo' uscire dalla griglia disegnata. */
  private clampDelta(dCol: number, dRow: number): { col: number; row: number } {
    if (this.cells.length === 0) return { col: 0, row: 0 };

    let minCol = Infinity;
    let maxCol = -Infinity;
    let minRow = Infinity;
    let maxRow = -Infinity;
    for (const c of this.cells) {
      minCol = Math.min(minCol, c.col);
      maxCol = Math.max(maxCol, c.col);
      minRow = Math.min(minRow, c.row);
      maxRow = Math.max(maxRow, c.row);
    }

    return {
      col: Phaser.Math.Clamp(dCol, GRID.drawFrom - minCol, GRID.drawTo - maxCol),
      row: Phaser.Math.Clamp(dRow, GRID.drawFrom - minRow, GRID.drawTo - maxRow),
    };
  }

  /**
   * Sposta i blocchi dell'area di `delta`, e con loro l'area stessa.
   *
   * Prima si tolgono tutti quelli di partenza e poi si ripiazzano: facendolo
   * blocco per blocco, spostare una fila di uno a destra cancellerebbe il
   * vicino appena scritto.
   */
  private applyMove(): boolean {
    const { col: dCol, row: dRow } = this.delta;
    this.delta = { col: 0, row: 0 };
    if (dCol === 0 && dRow === 0) return false;

    const blocks = this.blocksInArea();
    for (const b of blocks) this.placement.remove(b.col, b.row, this.layerIndex);

    for (const b of blocks) {
      const col = b.col + dCol;
      const row = b.row + dRow;
      // La destinazione puo' essere occupata da un blocco che non fa parte
      // della selezione: la selezione vince, come in ogni editor.
      this.placement.remove(col, row, this.layerIndex);
      this.placement.spawn(col, row, b.type, this.layerIndex);
    }

    this.cells = this.cells.map((c) => ({ col: c.col + dCol, row: c.row + dRow }));
    return blocks.length > 0;
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

    if (this.cells.length === 0) return;

    // Durante lo spostamento il contorno mostra dove finira' l'area, non dove
    // sta: e' l'anteprima che rende il trascinamento leggibile.
    const lift = projection.elevationOffsetY(
      this.placement.layers[this.layerIndex]?.elevation ?? 0,
    );
    g.lineStyle(2, SELECTED_COLOR, 0.9);
    g.fillStyle(SELECTED_COLOR, 0.12);
    for (const c of this.cells) {
      const outline = projection
        .cellOutline(c.col + this.delta.col, c.row + this.delta.row)
        .map((p) => ({ x: p.x, y: p.y + lift }));
      g.fillPoints(outline, true);
      g.strokePoints(outline, true);
    }
  }
}
