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
 * Coordinate di cella con la parte frazionaria: la posizione dentro la cella,
 * non solo quale cella sia. `{ col: 3.5, row: 6.25 }` e' un punto preciso.
 */
export interface CellPoint {
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

  /**
   * La versione continua di `worldToCell`: stessa cosa senza arrotondare.
   *
   * E' la chiave per le collisioni. In questo spazio ogni cella e' il quadrato
   * unitario `[col, col+1) x [row, row+1)` qualunque forma abbia sullo
   * schermo, quindi un rombo isometrico torna a essere un quadrato e il
   * problema "il personaggio urta il blocco" diventa la solita collisione
   * rettangolo-contro-griglia. Chi calcola le collisioni lavora qui dentro e
   * continua a non sapere che forma abbia una cella.
   *
   * Invariante: `worldToCell` e' il `floor` di questa, su entrambi gli assi.
   */
  toCellSpace(x: number, y: number): CellPoint;

  /** Inversa di `toCellSpace`: da coordinate di cella continue al mondo. */
  fromCellSpace(col: number, row: number): Point;

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
 * `worldToCell` e' sempre il `floor` di `toCellSpace`. Scriverlo una volta
 * sola evita che le due funzioni si allontanino: era gia' successo che
 * l'inversa isometrica arrotondasse su un riferimento sbagliato.
 */
function floorCell(p: CellPoint): Cell {
  return { col: Math.floor(p.col), row: Math.floor(p.row) };
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

  toCellSpace(x, y) {
    return {
      col: (x - GRID.offsetX) / GRID.cellSize,
      row: (y - GRID.offsetY) / GRID.cellSize,
    };
  },

  fromCellSpace(col, row) {
    return {
      x: GRID.offsetX + col * GRID.cellSize,
      y: GRID.offsetY + row * GRID.cellSize,
    };
  },

  worldToCell(x, y) {
    return floorCell(this.toCellSpace(x, y));
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
   * la coppia (col,row) vive in uno spazio dove ogni rombo e' un quadrato
   * unitario e `floor` taglia esattamente sui bordi del rombo.
   *
   * Usando il centro come riferimento il round-trip sui centri torna lo stesso,
   * ma i punti intorno finiscono nella cella sbagliata: e' un errore che si
   * vede solo campionando l'area, non i centri.
   */
  toCellSpace(x, y) {
    const dx = (x - ISO.originX) / ISO.tileWidth;
    const dy = (y - ISO.originY) / ISO.tileHeight;
    return {
      col: dy + dx,
      row: dy - dx,
    };
  },

  fromCellSpace(col, row) {
    return {
      x: ISO.originX + (col - row) * (ISO.tileWidth / 2),
      y: ISO.originY + (col + row) * (ISO.tileHeight / 2),
    };
  },

  worldToCell(x, y) {
    return floorCell(this.toCellSpace(x, y));
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

/**
 * Il riquadro di mondo che contiene tutte le celle dell'intervallo.
 *
 * Serve alla camera, che non deve mostrare il vuoto oltre la griglia. Passa
 * dai perimetri veri (`cellOutline`) invece di ricavarli dai centri, cosi'
 * vale per qualsiasi proiezione: chi chiama non deve sapere che in isometrica
 * il rombo sporge di mezza cella oltre il proprio centro.
 */
export function gridBounds(
  fromCol: number,
  toCol: number,
  fromRow: number,
  toRow: number,
  proj: GridProjection = projection,
): { x: number; y: number; width: number; height: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (let col = fromCol; col <= toCol; col++) {
    for (let row = fromRow; row <= toRow; row++) {
      for (const p of proj.cellOutline(col, row)) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
    }
  }

  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

// `orthogonal` resta disponibile come alternativa: e' la geometria del
// progetto GDevelop originale.
export { orthogonal, isometric };
