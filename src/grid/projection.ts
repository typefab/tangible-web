import { GRID, ISO } from '../config';

export interface Point {
  x: number;
  y: number;
}

export interface Cell {
  col: number;
  row: number;
}

/**
 * La geometria della griglia, isolata dietro un'unica interfaccia.
 *
 * Tutto il resto del codice (piazzamento, editor, disegno) passa da qui e non
 * sa se la cella sia un quadrato, un rombo o un parallelogramma. Cambiare
 * proiezione significa scrivere una nuova implementazione e cambiare la riga
 * in fondo a questo file: nessun altro file va toccato.
 */
export interface GridProjection {
  readonly name: string;

  /** Centro della cella in coordinate mondo. */
  cellToWorld(col: number, row: number): Point;

  /** La cella che contiene quel punto del mondo. */
  worldToCell(x: number, y: number): Cell;

  /** Ordinamento in profondita': valore piu' alto = disegnato davanti. */
  depthFor(col: number, row: number): number;

  /** Vertici del perimetro della cella, per evidenziarla e disegnare la griglia. */
  cellOutline(col: number, row: number): Point[];
}

/**
 * Griglia ortogonale classica: celle quadrate allineate agli assi.
 * E' quella usata dal progetto GDevelop, con offset (16,16) sul terreno.
 */
const orthogonal: GridProjection = {
  name: 'ortogonale',

  cellToWorld(col, row) {
    return {
      x: GRID.offsetX + col * GRID.cellSize + GRID.cellSize / 2,
      y: GRID.offsetY + row * GRID.cellSize + GRID.cellSize / 2,
    };
  },

  worldToCell(x, y) {
    return {
      col: Math.floor((x - GRID.offsetX) / GRID.cellSize),
      row: Math.floor((y - GRID.offsetY) / GRID.cellSize),
    };
  },

  // Piu' in basso = davanti.
  depthFor(_col, row) {
    return row;
  },

  cellOutline(col, row) {
    const left = GRID.offsetX + col * GRID.cellSize;
    const top = GRID.offsetY + row * GRID.cellSize;
    const s = GRID.cellSize;
    return [
      { x: left, y: top },
      { x: left + s, y: top },
      { x: left + s, y: top + s },
      { x: left, y: top + s },
    ];
  },
};

/**
 * Griglia isometrica a rombi, rapporto 2:1.
 *
 * Gli assi col e row corrono in diagonale sullo schermo: col va verso destra
 * e in basso, row verso sinistra e in basso. Il centro della cella (0,0) sta
 * mezza cella sotto l'origine.
 */
const isometric: GridProjection = {
  name: 'isometrica',

  cellToWorld(col, row) {
    return {
      x: ISO.originX + (col - row) * (ISO.tileWidth / 2),
      y: ISO.originY + (col + row) * (ISO.tileHeight / 2) + ISO.tileHeight / 2,
    };
  },

  /**
   * Inversa della trasformazione isometrica.
   *
   * Si normalizza rispetto al vertice SUPERIORE della cella (0,0), non al suo
   * centro, e si divide per il lato intero del tile (non per la meta'): cosi'
   * la coppia (u,v) vive in uno spazio dove ogni rombo e' un quadrato unitario
   * e `floor` taglia esattamente sui bordi del rombo.
   *
   * Usando il centro come riferimento il round-trip sui centri torna lo stesso,
   * ma i punti intorno finiscono nella cella sbagliata: e' un errore che si
   * vede solo campionando l'area, non i centri.
   */
  worldToCell(x, y) {
    const dx = (x - ISO.originX) / ISO.tileWidth;
    const dy = (y - ISO.originY) / ISO.tileHeight;
    return {
      col: Math.floor(dy + dx),
      row: Math.floor(dy - dx),
    };
  },

  // In isometrica la profondita' cresce lungo entrambi gli assi: chi ha
  // col+row maggiore e' piu' vicino a chi guarda.
  depthFor(col, row) {
    return col + row;
  },

  cellOutline(col, row) {
    const cx = ISO.originX + (col - row) * (ISO.tileWidth / 2);
    const top = ISO.originY + (col + row) * (ISO.tileHeight / 2);
    const hw = ISO.tileWidth / 2;
    const hh = ISO.tileHeight / 2;
    return [
      { x: cx, y: top },
      { x: cx + hw, y: top + hh },
      { x: cx, y: top + ISO.tileHeight },
      { x: cx - hw, y: top + hh },
    ];
  },
};

/**
 * La proiezione attiva. Per tornare alla griglia quadrata basta cambiare
 * questa riga: nessun altro file va toccato.
 */
export const projection: GridProjection = isometric;

// `orthogonal` resta disponibile come alternativa: e' la geometria del
// progetto GDevelop originale.
export { orthogonal, isometric };
