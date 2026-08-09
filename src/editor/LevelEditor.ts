import Phaser from 'phaser';
import { GRID, type BlockType } from '../config';
import { BLOCKS } from '../assets/blocks';
import { GridPlacement } from '../mechanics/GridPlacement';

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
}

/** Uno stato completo della scena, per l'undo. */
type Snapshot = { col: number; row: number; type: BlockType }[];

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
  private readonly scene: Phaser.Scene;
  private readonly placement: GridPlacement;
  private root!: HTMLDivElement;
  private countLabel!: HTMLSpanElement;
  private paletteButtons = new Map<BlockType, HTMLButtonElement>();
  private toolButtons = new Map<Tool, HTMLButtonElement>();
  private undoButton!: HTMLButtonElement;
  private redoButton!: HTMLButtonElement;

  private tool: Tool = 'brush';

  // L'undo tiene stati interi, non operazioni: vedi GridPlacement.clear().
  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];

  /** Traccia in corso: serve a non ripetere l'operazione sulla stessa cella. */
  private strokeCell: string | null = null;
  private pointerDown = false;
  /** Lo stato prima della traccia corrente: si impila solo se qualcosa cambia. */
  private strokeStart: Snapshot | null = null;
  private panFrom: { x: number; y: number; scrollX: number; scrollY: number } | null = null;

  constructor(scene: Phaser.Scene, placement: GridPlacement) {
    this.scene = scene;
    this.placement = placement;

    this.buildToolbar();
    this.bindInput();
    this.bindKeyboard();
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
      this.strokeStart = this.placement.list();
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

      const shortcuts: Record<string, Tool> = { b: 'brush', e: 'erase', g: 'fill', h: 'pan' };
      const tool = shortcuts[e.key.toLowerCase()];
      if (tool) this.setTool(tool);
    });
  }

  /** Applica lo strumento corrente alla cella sotto il puntatore. */
  private applyAt(p: Phaser.Input.Pointer): void {
    const { col, row } = GridPlacement.worldToCell(p.worldX, p.worldY);
    if (!this.inBounds(col, row)) return;

    // Trascinando si passa piu' volte sulla stessa cella: senza questo
    // controllo il pennello la ripiazzerebbe a ogni frame.
    const key = `${col},${row}`;
    if (key === this.strokeCell) return;
    this.strokeCell = key;

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
   * Riempimento per contiguita' a partire dalla cella toccata.
   *
   * Su cella vuota riempie l'area vuota collegata; su cella occupata sostituisce
   * l'area contigua dello stesso tipo. E' il comportamento del secchiello di
   * blurymind/tilemap-editor, che e' anche quello che ci si aspetta da un
   * secchiello.
   */
  private fill(col: number, row: number): void {
    const target = this.placement.blockAt(col, row)?.getData('type') as BlockType | undefined;
    const replacement = this.placement.selected;
    if (target === replacement) return;

    const seen = new Set<string>();
    const queue: [number, number][] = [[col, row]];

    while (queue.length > 0) {
      const [c, r] = queue.pop() as [number, number];
      const key = `${c},${r}`;
      if (seen.has(key) || !this.inBounds(c, r)) continue;

      const here = this.placement.blockAt(c, r)?.getData('type') as BlockType | undefined;
      if (here !== target) continue;

      seen.add(key);
      if (here !== undefined) this.placement.remove(c, r);
      this.placement.spawn(c, r, replacement);

      queue.push([c + 1, r], [c - 1, r], [c, r + 1], [c, r - 1]);
    }
  }

  // ----------------------------------------------------------------- undo

  /** Chiude la traccia corrente e la registra, se ha cambiato qualcosa. */
  private commitStroke(): void {
    this.strokeCell = null;
    const before = this.strokeStart;
    this.strokeStart = null;
    if (!before) return;

    // Confronto sul serializzato: due stati con gli stessi blocchi sono lo
    // stesso stato, e `list()` e' gia' ordinata quindi il confronto e' stabile.
    if (JSON.stringify(before) === JSON.stringify(this.placement.list())) return;

    this.undoStack.push(before);
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
    // Una nuova modifica invalida il futuro che si era tornati indietro a vedere.
    this.redoStack = [];
    this.refresh();
  }

  private restore(snapshot: Snapshot): void {
    this.placement.clear();
    for (const b of snapshot) this.placement.spawn(b.col, b.row, b.type);
    this.refresh();
  }

  private undo(): void {
    const previous = this.undoStack.pop();
    if (!previous) return;
    this.redoStack.push(this.placement.list());
    this.restore(previous);
  }

  private redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(this.placement.list());
    this.restore(next);
  }

  // ----------------------------------------------------------------- zoom

  private zoomBy(factor: number): void {
    const cam = this.scene.cameras.main;
    cam.setZoom(Phaser.Math.Clamp(cam.zoom * factor, ZOOM_MIN, ZOOM_MAX));
  }

  private resetView(): void {
    const cam = this.scene.cameras.main;
    cam.setZoom(1);
    cam.setScroll(0, 0);
  }

  // -------------------------------------------------------------- toolbar

  private setTool(tool: Tool): void {
    this.tool = tool;
    this.refresh();
  }

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

  private button(label: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.textContent = label;
    b.onclick = onClick;
    this.root.appendChild(b);
    return b;
  }

  private buildToolbar(): void {
    this.root = document.createElement('div');
    this.root.id = 'editor-toolbar';
    this.root.innerHTML = `
      <style>
        #editor-toolbar {
          position: fixed; left: 0; right: 0; bottom: 0; z-index: 10;
          display: flex; flex-wrap: wrap; gap: 8px; align-items: center;
          padding: 10px calc(10px + env(safe-area-inset-left)) calc(10px + env(safe-area-inset-bottom));
          background: #24242e; border-top: 1px solid #3a3a48;
          font: 13px/1.4 system-ui, sans-serif; color: #e8e8ef;
        }
        #editor-toolbar button {
          min-height: 40px; padding: 0 14px; border-radius: 8px;
          border: 1px solid #3a3a48; background: #2f2f3d; color: #e8e8ef;
          font: inherit; cursor: pointer; touch-action: manipulation;
        }
        #editor-toolbar button:hover:not(:disabled) { background: #3a3a48; }
        #editor-toolbar button:disabled { opacity: .35; cursor: default; }
        #editor-toolbar button[aria-pressed="true"] {
          border-color: #ffd166; background: #4a4432; color: #ffd166;
        }
        /* La palette mostra il blocco, non il suo nome: si sceglie a colpo d'occhio. */
        #editor-toolbar button.palette {
          display: flex; flex-direction: column; align-items: center; gap: 2px;
          width: 56px; min-height: 56px; padding: 4px;
        }
        #editor-toolbar button.palette img {
          width: 32px; height: 32px; object-fit: contain;
          image-rendering: pixelated;
        }
        #editor-toolbar button.palette span { font-size: 10px; opacity: .8; }
        #editor-toolbar .sep { width: 1px; align-self: stretch; background: #3a3a48; }
        #editor-toolbar .spacer { flex: 1 1 auto; }
        #editor-toolbar .hint { opacity: .7; }
      </style>
    `;

    for (const type of Object.keys(BLOCKS) as BlockType[]) {
      const b = document.createElement('button');
      b.className = 'palette';
      b.title = BLOCKS[type].label;
      b.innerHTML = `<img alt="" src="${this.textureSrc(BLOCKS[type].texture)}"><span>${BLOCKS[type].label}</span>`;
      b.onclick = () => {
        this.placement.selected = type;
        // Scegliere un blocco significa volerlo piazzare: con la gomma attiva
        // il clic successivo cancellerebbe, che non e' quello che si intende.
        if (this.tool === 'erase') this.tool = 'brush';
        this.refresh();
      };
      this.root.appendChild(b);
      this.paletteButtons.set(type, b);
    }

    this.root.appendChild(Object.assign(document.createElement('span'), { className: 'sep' }));

    for (const tool of TOOLS) {
      const b = this.button(TOOL_LABELS[tool], () => this.setTool(tool));
      this.toolButtons.set(tool, b);
    }

    this.root.appendChild(Object.assign(document.createElement('span'), { className: 'sep' }));

    this.undoButton = this.button('↶', () => this.undo());
    this.undoButton.title = 'Annulla (Ctrl+Z)';
    this.redoButton = this.button('↷', () => this.redo());
    this.redoButton.title = 'Rifai (Ctrl+Shift+Z)';

    this.button('−', () => this.zoomBy(1 / ZOOM_STEP)).title = 'Riduci';
    this.button('+', () => this.zoomBy(ZOOM_STEP)).title = 'Ingrandisci';
    this.button('⤢', () => this.resetView()).title = 'Reimposta vista';

    this.root.appendChild(Object.assign(document.createElement('span'), { className: 'spacer' }));

    this.countLabel = document.createElement('span');
    this.root.appendChild(this.countLabel);

    // Nasconde le linee della griglia per guardare la scena pulita.
    // Lo snap resta comunque attivo: si tocca sempre una cella.
    const grid = document.createElement('button');
    const syncGridLabel = () => {
      const on = (this.scene as GameSceneLike).gridVisible;
      grid.textContent = on ? 'Griglia: on' : 'Griglia: off';
      grid.setAttribute('aria-pressed', String(on));
    };
    grid.onclick = () => {
      const s = this.scene as GameSceneLike;
      s.setGridVisible(!s.gridVisible);
      syncGridLabel();
    };
    syncGridLabel();
    this.root.appendChild(grid);

    const copy = this.button('Copia JSON', () => this.copyToClipboard(copy));
    this.button('Scarica level.json', () => this.download());

    document.body.appendChild(this.root);
  }

  // ------------------------------------------------------------ serializza

  /** Il contenuto esatto di public/level.json. */
  private serialize(): string {
    return `${JSON.stringify({ blocks: this.placement.list() }, null, 2)}\n`;
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
  }
}
