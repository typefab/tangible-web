import { projection, type Cell, type Point } from '../grid/projection';

/**
 * Meccanica: il personaggio non attraversa i blocchi.
 *
 * ## Perche' i conti si fanno in spazio di cella
 *
 * Sullo schermo le celle sono rombi, e far collidere un personaggio contro un
 * rombo vorrebbe dire ritagliare poligoni. Ma `projection.toCellSpace()` porta
 * il mondo in uno spazio dove **ogni cella e' il quadrato unitario**: li' i
 * muri sono le rette `col = intero` e `row = intero`, e la collisione torna a
 * essere quella classica rettangolo-contro-griglia.
 *
 * Ne segue anche che separare il movimento sui due assi `col` e `row` e' la
 * cosa giusta da fare, non un'approssimazione: le facce dei blocchi sono
 * esattamente perpendicolari a quegli assi. E' quello che produce lo
 * scivolamento lungo il muro invece dell'incastro nell'angolo.
 *
 * Questa classe non sa cosa sia un blocco: riceve un predicato `isSolid`, e
 * quindi si puo' provare senza schermo e senza Phaser.
 */

/** Dice se quella cella e' invalicabile. */
export type SolidTest = (col: number, row: number) => boolean;

/**
 * Quanto ci si appoggia al muro. Serve perche' fermarsi *esattamente* sul
 * bordo lascerebbe il personaggio dentro la cella solida (il bordo destro
 * appartiene gia' alla cella dopo), e al frame successivo risulterebbe
 * incastrato.
 */
const SKIN = 1e-4;

export class GridCollision {
  private readonly isSolid: SolidTest;

  /**
   * Mezzo lato dell'ingombro, in unita' di cella. Deve stare sotto 0.5,
   * altrimenti il personaggio e' piu' largo di una cella e non passa mai in un
   * varco di una casella sola.
   */
  private readonly radius: number;

  constructor(isSolid: SolidTest, radius: number) {
    this.isSolid = isSolid;
    this.radius = radius;
  }

  /** Le celle toccate dall'ingombro centrato in quel punto del mondo. */
  cellsAt(x: number, y: number): Cell[] {
    const p = projection.toCellSpace(x, y);
    const out: Cell[] = [];
    for (let col = Math.floor(p.col - this.radius); col <= Math.floor(p.col + this.radius); col++) {
      for (let row = Math.floor(p.row - this.radius); row <= Math.floor(p.row + this.radius); row++) {
        out.push({ col, row });
      }
    }
    return out;
  }

  /** True se l'ingombro centrato li' ricade, anche solo in parte, su quella cella. */
  touches(x: number, y: number, col: number, row: number): boolean {
    return this.cellsAt(x, y).some((c) => c.col === col && c.row === row);
  }

  /** True se l'ingombro centrato li' tocca almeno una cella solida. */
  blockedAt(x: number, y: number): boolean {
    return this.cellsAt(x, y).some((c) => this.isSolid(c.col, c.row));
  }

  /**
   * Sposta di (dx, dy) fermandosi contro i blocchi, e ritorna dove si finisce
   * davvero. Chi chiama non deve controllare niente: se la strada e' libera il
   * risultato e' semplicemente il punto di arrivo.
   */
  move(x: number, y: number, dx: number, dy: number): Point {
    const from = projection.toCellSpace(x, y);

    // Gia' dentro un blocco — succede se qualcuno lo piazza addosso, o se il
    // livello ne carica uno sopra il punto di partenza. Qui la collisione si
    // disattiva: bloccarlo lo terrebbe murato per sempre, mentre cosi' basta
    // camminare per uscire.
    if (this.solidAround(from.col, from.row)) {
      return { x: x + dx, y: y + dy };
    }

    // Lo spostamento si converte per differenza: `toCellSpace` e' una mappa
    // lineare, quindi questo vale per qualsiasi proiezione senza doverne
    // conoscere la matrice.
    const to = projection.toCellSpace(x + dx, y + dy);

    const col = this.slide(from.col, to.col - from.col, from.row, 'col');
    // Il secondo asse usa la colonna gia' risolta, non quella di partenza:
    // altrimenti scivolando lungo un muro si rientrerebbe dentro.
    const row = this.slide(from.row, to.row - from.row, col, 'row');

    return projection.fromCellSpace(col, row);
  }

  /**
   * La posizione libera piu' vicina, cercando a quadrati concentrici.
   *
   * Serve alla comparsa del personaggio: il punto scelto dalla scena e' il
   * centro dello schermo, che con un livello caricato cade tranquillamente
   * dentro un blocco.
   */
  findFreeSpot(x: number, y: number, maxRings = 12): Point {
    if (!this.blockedAt(x, y)) return { x, y };

    const start = projection.worldToCell(x, y);
    for (let ring = 1; ring <= maxRings; ring++) {
      for (let dc = -ring; dc <= ring; dc++) {
        for (let dr = -ring; dr <= ring; dr++) {
          // Solo il perimetro dell'anello: l'interno e' gia' stato provato.
          if (Math.max(Math.abs(dc), Math.abs(dr)) !== ring) continue;

          const spot = projection.cellToWorld(start.col + dc, start.row + dr);
          if (!this.blockedAt(spot.x, spot.y)) return spot;
        }
      }
    }
    // Tutto pieno per 12 celle intorno: meglio lasciarlo dov'e' che spedirlo
    // lontano. La regola "gia' dentro un blocco = passa" lo lascia libero.
    return { x, y };
  }

  /** Avanza su un solo asse, fermandosi contro la prima faccia solida. */
  private slide(pos: number, delta: number, other: number, axis: 'col' | 'row'): number {
    if (delta === 0) return pos;

    const target = pos + delta;
    if (!this.hits(target, other, axis)) return target;

    // Appoggia il bordo che avanza contro la faccia della cella solida.
    const wall =
      delta > 0
        ? Math.floor(target + this.radius) - this.radius - SKIN
        : Math.ceil(target - this.radius) + this.radius + SKIN;

    // Mai oltre la meta desiderata, mai indietro rispetto a dove si era.
    const stop =
      delta > 0 ? Math.max(pos, Math.min(target, wall)) : Math.min(pos, Math.max(target, wall));

    // Se anche il punto di appoggio e' dentro un blocco vuol dire che in un
    // solo frame se ne sono attraversati piu' d'uno (frame lunghissimo): si
    // resta fermi, che e' sempre preferibile a finire dentro un muro.
    return this.hits(stop, other, axis) ? pos : stop;
  }

  private hits(pos: number, other: number, axis: 'col' | 'row'): boolean {
    return axis === 'col' ? this.solidAround(pos, other) : this.solidAround(other, pos);
  }

  /** True se l'ingombro centrato in quelle coordinate di cella tocca un solido. */
  private solidAround(col: number, row: number): boolean {
    const colFrom = Math.floor(col - this.radius);
    const colTo = Math.floor(col + this.radius);
    const rowFrom = Math.floor(row - this.radius);
    const rowTo = Math.floor(row + this.radius);

    for (let c = colFrom; c <= colTo; c++) {
      for (let r = rowFrom; r <= rowTo; r++) {
        if (this.isSolid(c, r)) return true;
      }
    }
    return false;
  }
}
