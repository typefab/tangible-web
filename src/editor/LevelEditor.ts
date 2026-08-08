import Phaser from 'phaser';
import { GRID, LAYERS, type BlockType } from '../config';
import { BLOCKS } from '../assets/catalog';
import { GridPlacement, type SerializedLevel } from '../mechanics/GridPlacement';

/**
 * Modalita' editor: si attiva aggiungendo ?editor=1 all'URL.
 *
 * Gira sulla stessa pagina del gioco, servita da GitHub Pages: nessun servizio
 * esterno, nessuna installazione. Produce esattamente il `public/level.json`
 * che il gioco poi carica.
 *
 * La toolbar e' HTML e non Phaser: cosi' il download del file e la copia negli
 * appunti usano le API del browser, e i pulsanti restano comodi da toccare
 * anche su telefono.
 *
 * L'editor disegna attraverso la scena di gioco, non con un canvas proprio:
 * quello che vedi mentre costruisci e' letteralmente quello che vedrai
 * giocando, senza nessuna geometria duplicata da tenere allineata.
 */
/** I metodi della scena che l'editor usa, senza importarla (eviterebbe un ciclo). */
interface GameSceneLike extends Phaser.Scene {
  setGridVisible(visible: boolean): void;
  readonly gridVisible: boolean;
  /** La cella sotto il puntatore, gia' corretta per l'alzata del layer attivo. */
  cellUnder(p: Phaser.Input.Pointer): { col: number; row: number };
}

/**
 * Uno stato completo dell'editor, per l'undo: la scena e il layer su cui si
 * stava lavorando. Senza il secondo, annullare riporterebbe i blocchi giusti
 * ma lascerebbe la mano sul piano sbagliato.
 */
type Snapshot = { level: SerializedLevel; active: number };

const TOOLS = ['brush', 'erase', 'fill', 'pan'] as const;
type Tool = (typeof TOOLS)[number];

const TOOL_LABELS: Record<Tool, string> = {
  brush: '🖌 Pennello',
  erase: '🧽 Gomma',
  fill: '🪣 Riempi',
  pan: '✋ Sposta',
};

/** Quanti passi indietro si possono fare. */
const UNDO_LIMIT = 60;

const ZOOM_MIN = 0.4;
const ZOOM_MAX = 2.5;
const ZOOM_STEP = 1.25;

export class LevelEditor {
  private readonly scene: GameSceneLike;
  private readonly placement: GridPlacement;
  private root!: HTMLDivElement;
  private layerPanel!: HTMLDivElement;
  private layerList!: HTMLDivElement;
  private countLabel!: HTMLSpanElement;
  private paletteButtons = new Map<BlockType, HTMLButtonElement>();
  private toolButtons = new Map<Tool, HTMLButtonElement>();
  private undoButton!: HTMLButtonElement;
  private redoButton!: HTMLButtonElement;
  private addLayerButton!: HTMLButtonElement;

  private tool: Tool = 'brush';

  // L'undo tiene stati interi, non operazioni: vedi GridPlacement.load().
  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];

  /** Traccia in corso: serve a non ripetere l'operazione sulla stessa cella. */
  private strokeCell: string | null = null;
  private pointerDown = false;
  /** Lo stato prima della traccia corrente: si impila solo se qualcosa cambia. */
  private strokeStart: Snapshot | null = null;
  private panFrom: { x: number; y: number; scrollX: number; scrollY: number } | null = null;

  constructor(scene: Phaser.Scene, placement: GridPlacement) {
    this.scene = scene as GameSceneLike;
    this.placement = placement;

    this.buildToolbar();
    this.buildLayerPanel();
    this.bindInput();
    this.bindKeyboard();
    // La vista parte inquadrata: vedi sotto perche' non basta la posizione di
    // partenza della camera.
    this.resetView();
    this.refresh();
  }

  // ---------------------------------------------------------------- input

  private bindInput(): void {
    const input = this.scene.input;

    input.on(Phaser.Input.Events.POINTER_DOWN, (p: Phaser.Input.Pointer) => {
      this.pointerDown = true;

      if (this.tool === 'pan') {
        const cam = this.scene.cameras.main;
        this.panFrom = { x: p.x, y: p.y, scrollX: cam.scrollX, scrollY: cam.scrollY };
        return;
      }

      // Lo stato di partenza si cattura qui e si impila solo a fine traccia:
      // un trascinamento che tocca 30 celle deve costare un solo undo.
      this.strokeStart = this.snapshot();
      this.strokeCell = null;
      this.applyAt(p);
    });

    input.on(Phaser.Input.Events.POINTER_MOVE, (p: Phaser.Input.Pointer) => {
      if (!this.pointerDown) return;

      if (this.tool === 'pan') {
        if (!this.panFrom) return;
        const cam = this.scene.cameras.main;
        // Diviso per lo zoom: a schermo il dito deve restare sullo stesso punto.
        cam.scrollX = this.panFrom.scrollX - (p.x - this.panFrom.x) / cam.zoom;
        cam.scrollY = this.panFrom.scrollY - (p.y - this.panFrom.y) / cam.zoom;
        return;
      }

      // Il riempimento a trascinamento sarebbe distruttivo e incomprensibile.
      if (this.tool === 'fill') return;
      this.applyAt(p);
    });

    input.on(Phaser.Input.Events.POINTER_UP, () => {
      this.pointerDown = false;
      this.panFrom = null;
      this.commitStroke();
    });

    // Il dito che esce dal canvas non deve lasciare la traccia aperta.
    input.on(Phaser.Input.Events.GAME_OUT, () => {
      this.pointerDown = false;
      this.panFrom = null;
      this.commitStroke();
    });

    input.on(
      Phaser.Input.Events.POINTER_WHEEL,
      (_p: Phaser.Input.Pointer, _o: unknown[], _dx: number, dy: number) => {
        this.zoomBy(dy > 0 ? 1 / ZOOM_STEP : ZOOM_STEP);
      },
    );
  }

  private bindKeyboard(): void {
    // Le scorciatoie stanno sul document e non su Phaser: la toolbar e' HTML,
    // e con il focus su un pulsante la tastiera di Phaser non riceve nulla.
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey) {
        const k = e.key.toLowerCase();
        if (k === 'z' && !e.shiftKey) {
          e.preventDefault();
          this.undo();
        } else if ((k === 'z' && e.shiftKey) || k === 'y') {
          e.preventDefault();
          this.redo();
        }
        return;
      }

      // Parentesi quadre per salire e scendere di piano: sono le stesse di
      // Photoshop per cambiare livello, e stanno vicine su ogni layout.
      if (e.key === '[') return this.selectLayer(this.placement.activeLayer - 1);
      if (e.key === ']') return this.selectLayer(this.placement.activeLayer + 1);

      const shortcuts: Record<string, Tool> = { b: 'brush', e: 'erase', g: 'fill', h: 'pan' };
      const tool = shortcuts[e.key.toLowerCase()];
      if (tool) this.setTool(tool);
    });
  }

  /** Applica lo strumento corrente alla cella sotto il puntatore. */
  private applyAt(p: Phaser.Input.Pointer): void {
    const { col, row } = this.scene.cellUnder(p);
    if (!this.inBounds(col, row)) return;

    // Trascinando si passa piu' volte sulla stessa cella: senza questo
    // controllo il pennello la ripiazzerebbe a ogni frame.
    const key = `${col},${row}`;
    if (key === this.strokeCell) return;
    this.strokeCell = key;

    // Tutte le operazioni valgono sul layer attivo e solo su quello: e' la
    // regola che rende prevedibile un editor a piani.
    if (this.tool === 'brush') {
      // spawn e non place: in editor il cooldown darebbe solo fastidio.
      this.placement.spawn(col, row);
    } else if (this.tool === 'erase') {
      this.placement.remove(col, row);
    } else if (this.tool === 'fill') {
      this.fill(col, row);
    }

    this.refresh();
  }

  /** La griglia disegnata e' finita: fuori non si costruisce. */
  private inBounds(col: number, row: number): boolean {
    return col >= GRID.drawFrom && col <= GRID.drawTo && row >= GRID.drawFrom && row <= GRID.drawTo;
  }

  /**
   * Riempimento per contiguita' a partire dalla cella toccata, sul layer attivo.
   *
   * Su cella vuota riempie l'area vuota collegata; su cella occupata sostituisce
   * l'area contigua dello stesso tipo. E' il comportamento del secchiello di
   * blurymind/tilemap-editor, che e' anche quello che ci si aspetta da un
   * secchiello.
   */
  private fill(col: number, row: number): void {
    const target = this.placement.typeAt(col, row);
    const replacement = this.placement.selected;
    if (target === replacement) return;

    const seen = new Set<string>();
    const queue: [number, number][] = [[col, row]];

    while (queue.length > 0) {
      const [c, r] = queue.pop() as [number, number];
      const key = `${c},${r}`;
      if (seen.has(key) || !this.inBounds(c, r)) continue;

      if (this.placement.typeAt(c, r) !== target) continue;

      seen.add(key);
      if (target !== undefined) this.placement.remove(c, r);
      this.placement.spawn(c, r, replacement);

      queue.push([c + 1, r], [c - 1, r], [c, r + 1], [c, r - 1]);
    }
  }

  // ----------------------------------------------------------------- undo

  private snapshot(): Snapshot {
    return { level: this.placement.serialize(), active: this.placement.activeLayer };
  }

  /** Chiude la traccia corrente e la registra, se ha cambiato qualcosa. */
  private commitStroke(): void {
    this.strokeCell = null;
    const before = this.strokeStart;
    this.strokeStart = null;
    if (!before) return;
    this.push(before);
  }

  /**
   * Impila uno stato precedente, se davvero diverso da quello attuale.
   *
   * Il confronto e' sul serializzato: due stati con gli stessi blocchi negli
   * stessi layer sono lo stesso stato, e `serialize()` ordina i blocchi, quindi
   * il confronto e' stabile.
   */
  private push(before: Snapshot): void {
    if (JSON.stringify(before) === JSON.stringify(this.snapshot())) return;

    this.undoStack.push(before);
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
    // Una nuova modifica invalida il futuro che si era tornati indietro a vedere.
    this.redoStack = [];
    this.refresh();
  }

  /** Esegue una modifica di struttura registrandola nell'undo. */
  private edit(change: () => void): void {
    const before = this.snapshot();
    change();
    this.push(before);
    this.refresh();
  }

  private restore(snapshot: Snapshot): void {
    this.placement.load(snapshot.level);
    this.placement.activeLayer = snapshot.active;
    this.refresh();
  }

  private undo(): void {
    const previous = this.undoStack.pop();
    if (!previous) return;
    this.redoStack.push(this.snapshot());
    this.restore(previous);
  }

  private redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(this.snapshot());
    this.restore(next);
  }

  // ----------------------------------------------------------------- zoom

  private zoomBy(factor: number): void {
    const cam = this.scene.cameras.main;
    cam.setZoom(Phaser.Math.Clamp(cam.zoom * factor, ZOOM_MIN, ZOOM_MAX));
  }

  /**
   * Riporta la vista sul centro della griglia.
   *
   * Non su (0,0): l'origine isometrica e' spostata a destra di 480px, quindi su
   * uno schermo da telefono la scena si apriva fuori campo e bisognava cercarla
   * trascinando.
   */
  private resetView(): void {
    const mid = (GRID.drawFrom + GRID.drawTo) / 2;
    const { x, y } = GridPlacement.cellToWorld(mid, mid);
    const cam = this.scene.cameras.main;
    cam.setZoom(1);
    cam.centerOn(x, y);
  }

  // ---------------------------------------------------------------- layer

  /**
   * Rende attivo un layer.
   *
   * Un layer nascosto diventa visibile quando lo si seleziona: se restasse
   * spento si disegnerebbe su qualcosa che non si vede, e ogni pennellata
   * sembrerebbe non fare niente. La regola e' che **il layer attivo si vede
   * sempre**, e per questo il suo occhio e' disabilitato.
   */
  private selectLayer(index: number): void {
    if (index < 0 || index >= this.placement.layers.length) return;

    this.placement.activeLayer = index;
    if (!this.placement.layers[index]!.visible) this.placement.setLayerVisible(index, true);
    this.refresh();
  }

  private setTool(tool: Tool): void {
    this.tool = tool;
    this.refresh();
  }

  // -------------------------------------------------------------- toolbar

  /**
   * Lo sprite gia' caricato da Phaser, come sorgente per un <img> della
   * toolbar. Si passa dal texture manager invece di ricostruire il percorso del
   * file: cosi' la palette non puo' divergere da cio' che il gioco disegna
   * davvero.
   *
   * Serve un base64 e non la `src` dell'immagine originale: Phaser carica da un
   * blob URL e lo revoca appena la texture e' pronta, quindi riusarlo darebbe
   * un'immagine rotta.
   */
  private textureSrc(texture: string): string {
    return this.scene.textures.getBase64(texture);
  }

  private button(label: string, onClick: () => void, parent: HTMLElement = this.root): HTMLButtonElement {
    const b = document.createElement('button');
    b.textContent = label;
    b.onclick = onClick;
    parent.appendChild(b);
    return b;
  }

  private static style(): string {
    return `
      #editor-toolbar {
        position: fixed; left: 0; right: 0; bottom: 0; z-index: 10;
        display: flex; flex-direction: column; gap: 8px;
        padding: 8px calc(10px + env(safe-area-inset-left)) calc(10px + env(safe-area-inset-bottom));
        background: #24242e; border-top: 1px solid #3a3a48;
        font: 13px/1.4 system-ui, sans-serif; color: #e8e8ef;
      }
      #editor-toolbar .controls {
        display: flex; flex-wrap: wrap; gap: 8px; align-items: center;
      }
      /* La palette scorre invece di andare a capo: con molti sprite caricati
         una barra che cresce in altezza mangerebbe tutta la scena. */
      #editor-toolbar .palette-strip {
        display: flex; gap: 6px; overflow-x: auto; padding-bottom: 2px;
        scrollbar-width: thin;
      }
      #editor-toolbar button, #layer-panel button {
        min-height: 40px; padding: 0 14px; border-radius: 8px;
        border: 1px solid #3a3a48; background: #2f2f3d; color: #e8e8ef;
        font: inherit; cursor: pointer; touch-action: manipulation;
      }
      #editor-toolbar button:hover:not(:disabled),
      #layer-panel button:hover:not(:disabled) { background: #3a3a48; }
      #editor-toolbar button:disabled, #layer-panel button:disabled { opacity: .35; cursor: default; }
      #editor-toolbar button[aria-pressed="true"], #layer-panel button[aria-pressed="true"] {
        border-color: #ffd166; background: #4a4432; color: #ffd166;
      }
      /* La palette mostra il blocco, non il suo nome: si sceglie a colpo d'occhio. */
      #editor-toolbar button.palette {
        display: flex; flex-direction: column; align-items: center; gap: 2px;
        flex: 0 0 auto; width: 56px; min-height: 56px; padding: 4px;
      }
      #editor-toolbar button.palette img {
        width: 32px; height: 32px; object-fit: contain; image-rendering: pixelated;
      }
      #editor-toolbar button.palette span {
        font-size: 10px; opacity: .8; max-width: 100%;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      #editor-toolbar .sep { width: 1px; align-self: stretch; background: #3a3a48; }
      #editor-toolbar .spacer { flex: 1 1 auto; }

      /* Il pannello sta a destra perche' l'HUD della scena occupa l'angolo
         in alto a sinistra. */
      #layer-panel {
        position: fixed; z-index: 10;
        top: calc(8px + env(safe-area-inset-top));
        right: calc(8px + env(safe-area-inset-right));
        width: 210px; max-width: calc(100vw - 16px);
        display: flex; flex-direction: column; gap: 6px; padding: 8px;
        border-radius: 10px; border: 1px solid #3a3a48; background: #24242ee6;
        font: 13px/1.4 system-ui, sans-serif; color: #e8e8ef;
      }
      #layer-panel .head { display: flex; align-items: center; gap: 6px; }
      #layer-panel .head strong { flex: 1 1 auto; font-weight: 600; }
      #layer-panel .head button { min-height: 32px; padding: 0 10px; }
      #layer-panel .list { display: flex; flex-direction: column-reverse; gap: 4px; }
      #layer-panel .row { display: flex; align-items: center; gap: 4px; }
      #layer-panel .row button { min-height: 34px; padding: 0 6px; }
      #layer-panel .row .name {
        flex: 1 1 auto; text-align: left; overflow: hidden;
        text-overflow: ellipsis; white-space: nowrap;
      }
      #layer-panel .row .quota { flex: 0 0 auto; font-variant-numeric: tabular-nums; }
      #layer-panel .actions { display: flex; gap: 4px; }
      #layer-panel .actions button { flex: 1 1 0; min-height: 34px; padding: 0; }
      #layer-panel.collapsed .list, #layer-panel.collapsed .actions { display: none; }
      #layer-panel .hint { font-size: 11px; opacity: .6; }
    `;
  }

  private buildToolbar(): void {
    this.root = document.createElement('div');
    this.root.id = 'editor-toolbar';
    this.root.innerHTML = `<style>${LevelEditor.style()}</style>`;

    // Riga 1: la palette, generata dal catalogo degli sprite.
    const strip = document.createElement('div');
    strip.className = 'palette-strip';
    this.root.appendChild(strip);

    for (const block of BLOCKS) {
      const b = document.createElement('button');
      b.className = 'palette';
      b.title = block.label;
      b.innerHTML = `<img alt="" src="${this.textureSrc(block.id)}"><span>${block.label}</span>`;
      b.onclick = () => {
        this.placement.selected = block.id;
        // Scegliere un blocco significa volerlo piazzare: con la gomma attiva
        // il clic successivo cancellerebbe, che non e' quello che si intende.
        if (this.tool === 'erase') this.tool = 'brush';
        this.refresh();
      };
      strip.appendChild(b);
      this.paletteButtons.set(block.id, b);
    }

    // Riga 2: strumenti, cronologia, vista, esportazione.
    const controls = document.createElement('div');
    controls.className = 'controls';
    this.root.appendChild(controls);

    for (const tool of TOOLS) {
      this.toolButtons.set(tool, this.button(TOOL_LABELS[tool], () => this.setTool(tool), controls));
    }

    controls.appendChild(Object.assign(document.createElement('span'), { className: 'sep' }));

    this.undoButton = this.button('↶', () => this.undo(), controls);
    this.undoButton.title = 'Annulla (Ctrl+Z)';
    this.redoButton = this.button('↷', () => this.redo(), controls);
    this.redoButton.title = 'Rifai (Ctrl+Shift+Z)';

    this.button('−', () => this.zoomBy(1 / ZOOM_STEP), controls).title = 'Riduci';
    this.button('+', () => this.zoomBy(ZOOM_STEP), controls).title = 'Ingrandisci';
    this.button('⤢', () => this.resetView(), controls).title = 'Reimposta vista';

    controls.appendChild(Object.assign(document.createElement('span'), { className: 'spacer' }));

    this.countLabel = document.createElement('span');
    controls.appendChild(this.countLabel);

    // Nasconde le linee della griglia per guardare la scena pulita.
    // Lo snap resta comunque attivo: si tocca sempre una cella.
    const grid = document.createElement('button');
    const syncGridLabel = () => {
      const on = this.scene.gridVisible;
      grid.textContent = on ? 'Griglia: on' : 'Griglia: off';
      grid.setAttribute('aria-pressed', String(on));
    };
    grid.onclick = () => {
      this.scene.setGridVisible(!this.scene.gridVisible);
      syncGridLabel();
    };
    syncGridLabel();
    controls.appendChild(grid);

    const copy = this.button('Copia JSON', () => this.copyToClipboard(copy), controls);
    this.button('Scarica level.json', () => this.download(), controls);

    // Da telefono, togliere ?editor=1 a mano dalla barra dell'indirizzo e'
    // scomodo: tanto vale un pulsante.
    this.button('▶ Gioca', () => {
      const url = new URL(location.href);
      url.searchParams.delete('editor');
      location.href = url.toString();
    }, controls).title = 'Esce dall editor e ricarica il gioco';

    document.body.appendChild(this.root);
  }

  private buildLayerPanel(): void {
    this.layerPanel = document.createElement('div');
    this.layerPanel.id = 'layer-panel';

    const head = document.createElement('div');
    head.className = 'head';
    head.innerHTML = '<strong>Layer</strong>';
    this.layerPanel.appendChild(head);

    this.addLayerButton = this.button('+', () => this.edit(() => {
      const index = this.placement.addLayer();
      if (index >= 0) this.placement.activeLayer = index;
    }), head);
    this.addLayerButton.title = `Aggiungi un piano sopra (max ${LAYERS.max})`;

    // Su telefono il pannello coprirebbe l'angolo della scena: si richiude.
    const collapse = this.button('▾', () => {
      this.layerPanel.classList.toggle('collapsed');
      collapse.textContent = this.layerPanel.classList.contains('collapsed') ? '▸' : '▾';
    }, head);
    collapse.title = 'Comprimi il pannello';

    this.layerList = document.createElement('div');
    this.layerList.className = 'list';
    this.layerPanel.appendChild(this.layerList);

    const actions = document.createElement('div');
    actions.className = 'actions';
    this.layerPanel.appendChild(actions);

    this.button('▲', () => this.edit(() => this.placement.moveLayer(this.placement.activeLayer, 1)), actions)
      .title = 'Sposta il layer attivo sopra il successivo';
    this.button('▼', () => this.edit(() => this.placement.moveLayer(this.placement.activeLayer, -1)), actions)
      .title = 'Sposta il layer attivo sotto il precedente';
    this.button('✎', () => this.renameActive(), actions).title = 'Rinomina il layer attivo';
    this.button('🗑', () => this.deleteActive(), actions).title = 'Elimina il layer attivo';

    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.textContent = 'Si disegna solo sul layer attivo. [ e ] cambiano piano.';
    this.layerPanel.appendChild(hint);

    document.body.appendChild(this.layerPanel);
  }

  private renameActive(): void {
    const index = this.placement.activeLayer;
    const current = this.placement.layers[index]?.name ?? '';
    const name = window.prompt('Nome del layer', current);
    if (name === null || name.trim() === '' || name === current) return;
    this.edit(() => this.placement.renameLayer(index, name.trim()));
  }

  private deleteActive(): void {
    const index = this.placement.activeLayer;
    const layer = this.placement.layers[index];
    if (!layer) return;

    const blocks = this.placement.countOn(index);
    // Cancellare un layer pieno butta via lavoro: la conferma serve solo li'.
    if (blocks > 0 && !window.confirm(`Eliminare "${layer.name}" e i suoi ${blocks} blocchi?`)) return;
    this.edit(() => this.placement.removeLayer(index));
  }

  /** Ricostruisce l'elenco dei layer. Sono pochi: rifarlo e' piu' sicuro che aggiornarlo. */
  private refreshLayers(): void {
    this.layerList.textContent = '';

    // `column-reverse` nel CSS: l'indice 0 e' il terreno e va disegnato in
    // fondo all'elenco, come in ogni programma a livelli.
    this.placement.layers.forEach((layer, index) => {
      const active = index === this.placement.activeLayer;

      const row = document.createElement('div');
      row.className = 'row';

      const eye = this.button(layer.visible ? '👁' : '🚫', () => {
        this.placement.setLayerVisible(index, !layer.visible);
        this.refresh();
      }, row);
      // Il layer attivo si vede sempre: spegnerlo darebbe un pennello cieco.
      eye.disabled = active;
      eye.title = active ? 'Il layer attivo resta sempre visibile' : 'Mostra o nascondi';

      const name = this.button(`${layer.name} (${this.placement.countOn(index)})`, () => this.selectLayer(index), row);
      name.className = 'name';
      name.setAttribute('aria-pressed', String(active));

      const down = this.button('−', () => this.edit(() => this.placement.setLayerElevation(index, layer.elevation - 1)), row);
      down.disabled = layer.elevation === 0;
      down.title = 'Abbassa il piano';

      const quota = document.createElement('span');
      quota.className = 'quota';
      quota.textContent = `↑${layer.elevation}`;
      quota.title = 'Quota: 0 = piano piatto, sovrapposto in loco';
      row.appendChild(quota);

      this.button('+', () => this.edit(() => this.placement.setLayerElevation(index, layer.elevation + 1)), row)
        .title = 'Alza il piano di una cella';

      this.layerList.appendChild(row);
    });
  }

  // ------------------------------------------------------------ serializza

  /** Il contenuto esatto di public/level.json. */
  private serialize(): string {
    return `${JSON.stringify(this.placement.serialize(), null, 2)}\n`;
  }

  private download(): void {
    const url = URL.createObjectURL(new Blob([this.serialize()], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'level.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  private async copyToClipboard(button: HTMLButtonElement): Promise<void> {
    const original = button.textContent;
    try {
      await navigator.clipboard.writeText(this.serialize());
      button.textContent = 'Copiato!';
    } catch {
      // Su http:// o browser senza permessi la clipboard non e' disponibile.
      button.textContent = 'Usa Scarica';
    }
    setTimeout(() => (button.textContent = original), 1500);
  }

  private refresh(): void {
    this.countLabel.textContent = `${this.placement.count} blocchi`;
    for (const [type, button] of this.paletteButtons) {
      button.setAttribute('aria-pressed', String(this.placement.selected === type));
    }
    for (const [tool, button] of this.toolButtons) {
      button.setAttribute('aria-pressed', String(this.tool === tool));
    }
    this.undoButton.disabled = this.undoStack.length === 0;
    this.redoButton.disabled = this.redoStack.length === 0;
    this.addLayerButton.disabled = this.placement.layers.length >= LAYERS.max;
    this.refreshLayers();
  }
}
