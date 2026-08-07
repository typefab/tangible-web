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

  /**
   * La stessa profondita' di `depthFor`, ma per un punto qualsiasi del mondo
   * invece che per una cella intera.
   *
   * Serve a chi non e' agganciato alla griglia — il personaggio — per entrare
   * nello stesso ordinamento dei blocchi. Deve essere continua e coincidere
   * con `depthFor` quando il punto e' il centro di una cella, altrimenti chi
   * cammina "salta" davanti o dietro nel momento sbagliato.
   */
  depthForWorld(x: number, y: number): number;

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

  // Inversa continua di cellToWorld sull'asse y: al centro della cella `row`
  // il risultato e' esattamente `row`.
  depthForWorld(_x, y) {
    return (y - GRID.offsetY) / GRID.cellSize - 0.5;
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

  /**
   * In isometrica col+row dipende solo dalla y: sommando le due righe
   * dell'inversa, i termini in x si elidono e resta 2*(y - originY)/tileHeight.
   * Tolto l'offset di mezza cella di cellToWorld, al centro della cella
   * (col,row) il valore e' esattamente col+row.
   *
   * Il che e' anche la ragione per cui questo metodo esiste: la profondita'
   * isometrica non e' la y in pixel, e usare la y direttamente mette il
   * personaggio su una scala numerica diversa da quella dei blocchi.
   */
  depthForWorld(_x, y) {
    return (2 * (y - ISO.originY)) / ISO.tileHeight - 1;
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
