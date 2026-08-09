import Phaser from 'phaser';
import { ISO, TIMING, LAYERS, type BlockType } from '../config';
import { canonicalBlockId, DEFAULT_BLOCK_ID } from '../assets/catalog';
import { projection } from '../grid/projection';
import { emptyLayer, type SerializedLayer } from '../level/project';

/**
 * Un piano di costruzione, come un layer di GDevelop.
 *
 * `id` non finisce mai nel file salvato: e' solo l'identita' del layer finche'
 * il gioco gira. Serve perche' i blocchi sono indicizzati per layer, e se la
 * chiave fosse la posizione nell'elenco, riordinare o cancellare un layer
 * rimescolerebbe i blocchi di tutti gli altri.
 */
export interface Layer {
  readonly id: string;
  name: string;
  /** Quanti piani sopra il terreno. 0 = piano piatto, sovrapposto in loco. */
  elevation: number;
  visible: boolean;
}

let nextLayerId = 0;

/**
 * Meccanica: piazzamento e rottura di blocchi su griglia, su piu' layer.
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

  /**
   * Tutti i blocchi, indicizzati per layer e cella. Una mappa sola e non una
   * per layer: le operazioni che attraversano i piani (cercare il blocco piu'
   * in alto, serializzare) restano una scansione unica.
   */
  private readonly blocks = new Map<string, Phaser.GameObjects.Sprite>();

  private layerList: Layer[] = [];
  private activeIndex = 0;

  // -Infinity e non 0: a inizio scena time.now vale 0, quindi con 0 il
  // cooldown scarterebbe il primissimo piazzamento.
  private lastPlacementAt = Number.NEGATIVE_INFINITY;
  private breakTarget: Phaser.GameObjects.Sprite | null = null;
  /** La chiave del blocco in rottura: la posizione dello sprite non basta piu'
   * a ricavarla, perche' l'elevazione del layer la sposta in su. */
  private breakKey: string | null = null;
  private breakStartedAt = 0;

  /** Tipo di blocco attualmente selezionato (lo slot di inventario). */
  selected: BlockType = DEFAULT_BLOCK_ID;

  /** Chiamato quando un blocco viene rotto: serve a restituirlo all'inventario. */
  onBlockBroken?: (type: BlockType) => void;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.addLayer('Terreno', 0);
  }

  // ---------------------------------------------------------------- layer

  get layers(): readonly Layer[] {
    return this.layerList;
  }

  /** Indice del layer su cui si costruisce. */
  get activeLayer(): number {
    return this.activeIndex;
  }

  set activeLayer(index: number) {
    if (index < 0 || index >= this.layerList.length) return;
    this.activeIndex = index;
  }

  /**
   * Aggiunge un piano sopra tutti gli altri.
   *
   * L'elevazione di partenza e' un passo sopra l'ultimo layer: in un gioco
   * isometrico a blocchi "un altro layer" quasi sempre vuol dire "un piano
   * sopra". Per ottenere invece un piano piatto alla GDevelop si riporta
   * l'elevazione a quella del layer sotto, che e' un tocco.
   *
   * @returns l'indice del nuovo layer, o -1 se si e' al limite.
   */
  addLayer(name?: string, elevation?: number): number {
    if (this.layerList.length >= LAYERS.max) return -1;

    const top = this.layerList[this.layerList.length - 1];
    this.layerList.push({
      id: `L${nextLayerId++}`,
      name: name ?? `Layer ${this.layerList.length}`,
      elevation: elevation ?? (top ? top.elevation + 1 : 0),
      visible: true,
    });
    return this.layerList.length - 1;
  }

  /**
   * Toglie un layer e tutti i suoi blocchi.
   * L'ultimo layer non si puo' togliere: senza piani non si costruisce.
   */
  removeLayer(index: number): boolean {
    const layer = this.layerList[index];
    if (!layer || this.layerList.length <= 1) return false;

    for (const key of [...this.blocks.keys()]) {
      if (key.startsWith(`${layer.id}#`)) this.destroyAt(key);
    }
    this.layerList.splice(index, 1);
    this.activeIndex = Math.min(this.activeIndex, this.layerList.length - 1);
    this.refreshDepths();
    return true;
  }

  renameLayer(index: number, name: string): void {
    const layer = this.layerList[index];
    if (layer) layer.name = name;
  }

  setLayerVisible(index: number, visible: boolean): void {
    const layer = this.layerList[index];
    if (!layer) return;

    layer.visible = visible;
    for (const [key, sprite] of this.blocks) {
      if (key.startsWith(`${layer.id}#`)) sprite.setVisible(visible);
    }
    // Un blocco che sparisce sotto il dito non deve restare in rottura.
    if (!visible) this.cancelBreak();
  }

  /** Alza o abbassa il piano: i suoi blocchi si spostano di conseguenza. */
  setLayerElevation(index: number, elevation: number): void {
    const layer = this.layerList[index];
    if (!layer) return;

    layer.elevation = Math.max(0, Math.round(elevation));
    for (const [key, sprite] of this.blocks) {
      if (!key.startsWith(`${layer.id}#`)) continue;
      const { col, row } = GridPlacement.parseKey(key);
      sprite.setY(GridPlacement.cellToWorld(col, row).y + projection.elevationOffsetY(layer.elevation));
    }
  }

  /** Sposta un layer di un posto su o giu' nell'ordine di disegno. */
  moveLayer(index: number, delta: number): boolean {
    const target = index + delta;
    const layer = this.layerList[index];
    const other = this.layerList[target];
    if (!layer || !other) return false;

    this.layerList[index] = other;
    this.layerList[target] = layer;
    if (this.activeIndex === index) this.activeIndex = target;
    else if (this.activeIndex === target) this.activeIndex = index;
    this.refreshDepths();
    return true;
  }

  private layerAt(index: number): Layer | undefined {
    return this.layerList[index];
  }

  private indexOfLayerId(id: string): number {
    return this.layerList.findIndex((l) => l.id === id);
  }

  // ----------------------------------------------------------------- celle

  /**
   * Chiave univoca di un blocco: layer piu' cella.
   *
   * Si usa l'id del layer e non il suo indice proprio perche' l'indice cambia
   * quando si riordina o si cancella.
   */
  private static key(layerId: string, col: number, row: number): string {
    return `${layerId}#${col},${row}`;
  }

  private static parseKey(key: string): { layerId: string; col: number; row: number } {
    const [layerId, cell] = key.split('#') as [string, string];
    const [col, row] = cell.split(',').map(Number) as [number, number];
    return { layerId, col, row };
  }

  /** Converte una coordinata mondo nella cella di griglia che la contiene. */
  static worldToCell(x: number, y: number): { col: number; row: number } {
    return projection.worldToCell(x, y);
  }

  /** Centro in coordinate mondo di una cella. Le origini sono al centro. */
  static cellToWorld(col: number, row: number): { x: number; y: number } {
    return projection.cellToWorld(col, row);
  }

  isOccupied(col: number, row: number, layerIndex = this.activeIndex): boolean {
    return this.blockAt(col, row, layerIndex) !== undefined;
  }

  blockAt(
    col: number,
    row: number,
    layerIndex = this.activeIndex,
  ): Phaser.GameObjects.Sprite | undefined {
    const layer = this.layerAt(layerIndex);
    return layer ? this.blocks.get(GridPlacement.key(layer.id, col, row)) : undefined;
  }

  /** Il tipo di blocco nella cella, se c'e'. Scorciatoia per l'editor. */
  typeAt(col: number, row: number, layerIndex = this.activeIndex): BlockType | undefined {
    return this.blockAt(col, row, layerIndex)?.getData('type') as BlockType | undefined;
  }

  /**
   * Il blocco piu' in alto sulla cella, ignorando i layer spenti.
   *
   * E' quello che il giocatore vede e quindi quello che si aspetta di colpire.
   */
  topBlockAt(col: number, row: number): { layerIndex: number; sprite: Phaser.GameObjects.Sprite } | undefined {
    for (let i = this.layerList.length - 1; i >= 0; i--) {
      if (!this.layerList[i]!.visible) continue;
      const sprite = this.blockAt(col, row, i);
      if (sprite) return { layerIndex: i, sprite };
    }
    return undefined;
  }

  /**
   * Il layer su cui poggerebbe un blocco piazzato ora su questa cella: quello
   * subito sopra il piu' alto occupato, o il primo se la cella e' libera.
   *
   * @returns undefined se la pila e' arrivata all'ultimo layer.
   */
  nextStackLayer(col: number, row: number): number | undefined {
    const top = this.topBlockAt(col, row);
    const index = top === undefined ? 0 : top.layerIndex + 1;
    return index < this.layerList.length ? index : undefined;
  }

  get count(): number {
    return this.blocks.size;
  }

  /**
   * I blocchi di un layer, con il loro sprite. Serve alla selezione, che deve
   * sapere dove stanno davvero a schermo: la posizione dello sprite tiene conto
   * della quota, il centro della cella no.
   */
  entriesOn(layerIndex: number): { col: number; row: number; sprite: Phaser.GameObjects.Sprite }[] {
    const layer = this.layerAt(layerIndex);
    if (!layer) return [];

    const out: { col: number; row: number; sprite: Phaser.GameObjects.Sprite }[] = [];
    for (const [key, sprite] of this.blocks) {
      const { layerId, col, row } = GridPlacement.parseKey(key);
      if (layerId === layer.id) out.push({ col, row, sprite });
    }
    return out;
  }

  countOn(layerIndex: number): number {
    const layer = this.layerAt(layerIndex);
    if (!layer) return 0;

    let n = 0;
    for (const key of this.blocks.keys()) if (key.startsWith(`${layer.id}#`)) n++;
    return n;
  }

  // --------------------------------------------------------- piazzamento

  /**
   * True se un piazzamento andrebbe a buon fine adesso. Da controllare prima
   * di scalare il blocco dall'inventario, per non consumarlo a vuoto.
   */
  canPlace(col: number, row: number, layerIndex = this.activeIndex): boolean {
    if (this.scene.time.now - this.lastPlacementAt < TIMING.placementCooldownMs) return false;
    return this.layerAt(layerIndex) !== undefined && !this.isOccupied(col, row, layerIndex);
  }

  /**
   * Piazza un blocco per input del giocatore: soggetto a cooldown.
   * Ritorna false se la cella e' occupata o se il cooldown non e' scaduto.
   */
  place(
    col: number,
    row: number,
    type: BlockType = this.selected,
    layerIndex = this.activeIndex,
  ): boolean {
    const now = this.scene.time.now;
    if (now - this.lastPlacementAt < TIMING.placementCooldownMs) return false;
    if (!this.spawn(col, row, type, layerIndex)) return false;

    this.lastPlacementAt = now;
    return true;
  }

  /**
   * Piazza un blocco senza passare dal cooldown: serve al caricamento del
   * livello, che deposita molti blocchi nello stesso frame.
   */
  spawn(
    col: number,
    row: number,
    type: BlockType = this.selected,
    layerIndex = this.activeIndex,
  ): boolean {
    const layer = this.layerAt(layerIndex);
    if (!layer || this.isOccupied(col, row, layerIndex)) return false;

    // Un id sconosciuto (blocco cancellato dal repository, file scritto a mano)
    // non deve piazzare uno sprite invisibile: meglio niente, e visibilmente.
    const texture = canonicalBlockId(type);
    if (!texture) return false;

    const { x, y } = GridPlacement.cellToWorld(col, row);
    const sprite = this.scene.add.sprite(x, y + projection.elevationOffsetY(layer.elevation), texture);
    // Largo quanto il rombo, altezza in proporzione: gli sprite dei blocchi
    // sono piu' alti della cella perche' mostrano anche la faccia frontale.
    sprite.setDisplaySize(ISO.tileWidth, sprite.height * (ISO.tileWidth / sprite.width));
    sprite.setDepth(GridPlacement.depthOf(col, row, layerIndex));
    sprite.setData('type', texture);
    sprite.setVisible(layer.visible);

    this.blocks.set(GridPlacement.key(layer.id, col, row), sprite);
    return true;
  }

  /**
   * Profondita' di disegno: la cella decide, il layer rompe il pareggio.
   *
   * Il contributo del layer resta minuscolo di proposito. Un blocco alzato non
   * deve scavalcare quello della cella davanti solo perche' sta piu' in alto:
   * a deciderlo e' sempre col+row, cioe' la distanza da chi guarda.
   */
  private static depthOf(col: number, row: number, layerIndex: number): number {
    return projection.depthFor(col, row) + layerIndex * LAYERS.depthStep;
  }

  /** Dopo un riordino o una cancellazione gli indici cambiano: le profondita' seguono. */
  private refreshDepths(): void {
    for (const [key, sprite] of this.blocks) {
      const { layerId, col, row } = GridPlacement.parseKey(key);
      sprite.setDepth(GridPlacement.depthOf(col, row, this.indexOfLayerId(layerId)));
    }
  }

  private destroyAt(key: string): void {
    const sprite = this.blocks.get(key);
    if (!sprite) return;

    if (this.breakTarget === sprite) this.cancelBreak();
    sprite.destroy();
    this.blocks.delete(key);
  }

  /** Rimuove il blocco nella cella, se c'e'. */
  remove(col: number, row: number, layerIndex = this.activeIndex): boolean {
    const layer = this.layerAt(layerIndex);
    if (!layer) return false;

    const key = GridPlacement.key(layer.id, col, row);
    if (!this.blocks.has(key)) return false;

    this.destroyAt(key);
    return true;
  }

  /**
   * Svuota la scena, layer compresi. Serve all'undo dell'editor, che ripristina
   * uno stato ricostruendolo da zero invece di invertire le singole operazioni:
   * con poche centinaia di blocchi conviene, ed e' molto piu' difficile da
   * sbagliare di un command pattern.
   */
  clear(): void {
    this.cancelBreak();
    for (const sprite of this.blocks.values()) sprite.destroy();
    this.blocks.clear();
    this.layerList = [];
    this.activeIndex = 0;
    this.addLayer('Terreno', 0);
  }

  // ------------------------------------------------------------ rottura

  /** Inizia (o continua) la rottura del blocco piu' in alto sulla cella. */
  beginBreak(col: number, row: number): void {
    const top = this.topBlockAt(col, row);
    if (!top) {
      this.cancelBreak();
      return;
    }
    if (this.breakTarget === top.sprite) return;

    this.cancelBreak();
    this.breakTarget = top.sprite;
    this.breakKey = GridPlacement.key(this.layerList[top.layerIndex]!.id, col, row);
    this.breakStartedAt = this.scene.time.now;
  }

  cancelBreak(): void {
    if (this.breakTarget) {
      this.breakTarget.setAngle(0);
      this.breakTarget = null;
      this.breakKey = null;
    }
  }

  /**
   * Dove si trova il blocco in rottura, per agganciarci la barra di avanzamento.
   * Non e' il centro della cella: un blocco su un layer alzato sta piu' in su.
   */
  get breakTargetCenter(): { x: number; y: number } | null {
    return this.breakTarget ? { x: this.breakTarget.x, y: this.breakTarget.y } : null;
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
    if (!this.breakTarget || !this.breakKey) return;

    const elapsedSec = (this.scene.time.now - this.breakStartedAt) / 1000;
    this.breakTarget.setAngle(
      Math.sin(elapsedSec * TIMING.oscillationFrequency) * TIMING.oscillationDegrees,
    );

    if (this.breakProgress >= 1) {
      const type = this.breakTarget.getData('type') as BlockType;
      this.destroyAt(this.breakKey);
      this.onBlockBroken?.(type);
    }
  }

  // -------------------------------------------------------- serializzazione

  /**
   * Lo stato completo, in forma serializzabile. I blocchi sono ordinati per
   * riga e poi colonna, cosi' il `level.json` esportato ha un diff stabile su
   * git anche quando li si e' disegnati in ordine sparso.
   */
  serializeLayers(): SerializedLayer[] {
    const byLayer = new Map<string, SerializedLayer['blocks']>();
    for (const layer of this.layerList) byLayer.set(layer.id, []);

    for (const [key, sprite] of this.blocks) {
      const { layerId, col, row } = GridPlacement.parseKey(key);
      byLayer.get(layerId)?.push({ col, row, type: sprite.getData('type') as BlockType });
    }

    return this.layerList.map((layer) => ({
      name: layer.name,
      elevation: layer.elevation,
      visible: layer.visible,
      blocks: (byLayer.get(layer.id) ?? []).sort((a, b) => a.row - b.row || a.col - b.col),
    }));
  }

  /**
   * Ricostruisce la scena. I dati arrivano gia' normalizzati da
   * `level/project.ts`: qui non si sa niente dei formati vecchi.
   */
  loadLayers(layers: readonly SerializedLayer[]): void {
    this.clear();
    this.layerList = [];

    for (const layer of layers.slice(0, LAYERS.max)) {
      const index = this.addLayer(layer.name, layer.elevation);
      this.layerList[index]!.visible = layer.visible;
      for (const b of layer.blocks) this.spawn(b.col, b.row, b.type, index);
    }

    // Un elenco vuoto lascerebbe la scena senza piani su cui costruire.
    if (this.layerList.length === 0) {
      const base = emptyLayer();
      this.addLayer(base.name, base.elevation);
    }
    this.activeIndex = 0;
  }
}
