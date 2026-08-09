import Phaser from 'phaser';
import { ISO, TIMING, type BlockType } from '../config';
import { BLOCKS, DEFAULT_BLOCK } from '../assets/blocks';
import { projection } from '../grid/projection';

/**
 * Meccanica: piazzamento e rottura di blocchi su griglia.
 *
 * Questo e' il pezzo che scrivo io. E' una classe autonoma: la scena la
 * istanzia e le passa i parametri, esattamente come in GDevelop applicheresti
 * un behavior a un oggetto.
 *
 * Nota su cosa sparisce rispetto alla versione a eventi: qui ogni blocco e' un
 * oggetto con il proprio stato, quindi non esiste la "picking contamination"
 * documentata in decisions.md, e non serve nessun ForEach ne' flag scalare.
 */
export class GridPlacement {
  private readonly scene: Phaser.Scene;
  private readonly blocks = new Map<string, Phaser.GameObjects.Sprite>();

  // -Infinity e non 0: a inizio scena time.now vale 0, quindi con 0 il
  // cooldown scarterebbe il primissimo piazzamento.
  private lastPlacementAt = Number.NEGATIVE_INFINITY;
  private breakTarget: Phaser.GameObjects.Sprite | null = null;
  private breakStartedAt = 0;

  /** Tipo di blocco attualmente selezionato (lo slot di inventario). */
  selected: BlockType = DEFAULT_BLOCK;

  /** Chiamato quando un blocco viene rotto: serve a restituirlo all'inventario. */
  onBlockBroken?: (type: BlockType) => void;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  /** Chiave univoca di una cella, usata come identita' del blocco. */
  private static key(col: number, row: number): string {
    return `${col},${row}`;
  }

  /** Tipi gia' segnalati: un livello con 200 blocchi orfani non deve urlare 200 volte. */
  private static readonly warned = new Set<BlockType>();

  private static warnUnknownType(type: BlockType): void {
    if (GridPlacement.warned.has(type)) return;
    GridPlacement.warned.add(type);
    console.warn(
      `[blocchi] tipo "${type}" ignorato: manca src/assets/blocks/${type}.png. ` +
        `Tipi disponibili: ${Object.keys(BLOCKS).join(', ') || '(nessuno)'}`,
    );
  }

  /** Converte una coordinata mondo nella cella di griglia che la contiene. */
  static worldToCell(x: number, y: number): { col: number; row: number } {
    return projection.worldToCell(x, y);
  }

  /** Centro in coordinate mondo di una cella. Le origini sono al centro. */
  static cellToWorld(col: number, row: number): { x: number; y: number } {
    return projection.cellToWorld(col, row);
  }

  isOccupied(col: number, row: number): boolean {
    return this.blocks.has(GridPlacement.key(col, row));
  }

  blockAt(col: number, row: number): Phaser.GameObjects.Sprite | undefined {
    return this.blocks.get(GridPlacement.key(col, row));
  }

  get count(): number {
    return this.blocks.size;
  }

  /**
   * Tutti i blocchi piazzati, in forma serializzabile. Ordinati per riga e poi
   * colonna, cosi' il level.json esportato ha un diff stabile su git.
   */
  list(): { col: number; row: number; type: BlockType }[] {
    const out = [...this.blocks.entries()].map(([key, sprite]) => {
      const [col, row] = key.split(',').map(Number) as [number, number];
      return { col, row, type: sprite.getData('type') as BlockType };
    });
    out.sort((a, b) => a.row - b.row || a.col - b.col);
    return out;
  }

  /**
   * True se un piazzamento andrebbe a buon fine adesso. Da controllare prima
   * di scalare il blocco dall'inventario, per non consumarlo a vuoto.
   */
  canPlace(col: number, row: number): boolean {
    if (this.scene.time.now - this.lastPlacementAt < TIMING.placementCooldownMs) return false;
    return !this.isOccupied(col, row);
  }

  /**
   * Piazza un blocco per input del giocatore: soggetto a cooldown.
   * Ritorna false se la cella e' occupata o se il cooldown non e' scaduto.
   */
  place(col: number, row: number, type: BlockType = this.selected): boolean {
    const now = this.scene.time.now;
    if (now - this.lastPlacementAt < TIMING.placementCooldownMs) return false;
    if (!this.spawn(col, row, type)) return false;

    this.lastPlacementAt = now;
    return true;
  }

  /**
   * Piazza un blocco senza passare dal cooldown: serve al caricamento del
   * livello, che deposita molti blocchi nello stesso frame.
   */
  spawn(col: number, row: number, type: BlockType = this.selected): boolean {
    if (this.isOccupied(col, row)) return false;

    // Da quando i tipi di blocco vengono dai nomi dei file in
    // `assets/blocks/`, un tipo puo' sparire: basta rinominare un PNG e un
    // `level.json` gia' scritto lo cita ancora. Deve saltare quel blocco e
    // caricare il resto, non far esplodere la scena.
    const kind = BLOCKS[type];
    if (!kind) {
      GridPlacement.warnUnknownType(type);
      return false;
    }

    const { x, y } = GridPlacement.cellToWorld(col, row);
    const sprite = this.scene.add.sprite(x, y, kind.texture);
    // Largo quanto il rombo, altezza in proporzione: gli sprite dei blocchi
    // sono piu' alti della cella perche' mostrano anche la faccia frontale.
    sprite.setDisplaySize(ISO.tileWidth, sprite.height * (ISO.tileWidth / sprite.width));
    sprite.setDepth(projection.depthFor(col, row));
    sprite.setData('type', type);

    this.blocks.set(GridPlacement.key(col, row), sprite);
    return true;
  }

  /**
   * Svuota la scena. Serve all'undo dell'editor, che ripristina uno stato
   * ricostruendolo da zero invece di invertire le singole operazioni: con
   * poche centinaia di blocchi conviene, ed e' molto piu' difficile da
   * sbagliare di un command pattern.
   */
  clear(): void {
    this.cancelBreak();
    for (const sprite of this.blocks.values()) sprite.destroy();
    this.blocks.clear();
  }

  /** Rimuove il blocco nella cella, se c'e'. */
  remove(col: number, row: number): boolean {
    const key = GridPlacement.key(col, row);
    const sprite = this.blocks.get(key);
    if (!sprite) return false;

    if (this.breakTarget === sprite) this.breakTarget = null;
    sprite.destroy();
    this.blocks.delete(key);
    return true;
  }

  /** Inizia (o continua) la rottura del blocco nella cella indicata. */
  beginBreak(col: number, row: number): void {
    const sprite = this.blockAt(col, row);
    if (!sprite) {
      this.cancelBreak();
      return;
    }
    if (this.breakTarget === sprite) return;

    this.cancelBreak();
    this.breakTarget = sprite;
    this.breakStartedAt = this.scene.time.now;
  }

  cancelBreak(): void {
    if (this.breakTarget) {
      this.breakTarget.setAngle(0);
      this.breakTarget = null;
    }
  }

  /** Progresso della rottura in corso, 0..1. */
  get breakProgress(): number {
    if (!this.breakTarget) return 0;
    const elapsed = this.scene.time.now - this.breakStartedAt;
    return Phaser.Math.Clamp(elapsed / TIMING.breakTimeMs, 0, 1);
  }

  /**
   * Da chiamare ogni frame. Anima l'oscillazione del blocco in rottura e lo
   * distrugge quando il tempo di break e' scaduto.
   */
  update(): void {
    if (!this.breakTarget) return;

    const elapsedSec = (this.scene.time.now - this.breakStartedAt) / 1000;
    this.breakTarget.setAngle(
      Math.sin(elapsedSec * TIMING.oscillationFrequency) * TIMING.oscillationDegrees,
    );

    if (this.breakProgress >= 1) {
      const cell = GridPlacement.worldToCell(this.breakTarget.x, this.breakTarget.y);
      const type = this.breakTarget.getData('type') as BlockType;
      this.remove(cell.col, cell.row);
      this.onBlockBroken?.(type);
    }
  }
}
