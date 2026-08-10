import Phaser from 'phaser';
import { GRID, LAYERS, type BlockType } from '../config';
import { BLOCKS } from '../assets/catalog';
import { GridPlacement } from '../mechanics/GridPlacement';
import {
  emptyLevel,
  normalizeProject,
  type SerializedLevel,
  type SerializedProject,
} from '../level/project';
import { CameraGestures, ZOOM_STEP } from './CameraGestures';
import { SelectionTool, type Picked } from './SelectionTool';
import { EditorStorage, describeWhen } from './EditorStorage';
import { chooseDialog } from './dialog';

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
  readonly activeElevationY: number;
}

/**
 * Uno stato completo dell'editor, per l'undo.
 *
 * Contiene **tutto il progetto**, non solo il livello aperto. Costa qualche
 * kilobyte per passo, ma rende annullabili anche le operazioni sulle schede —
 * una scheda eliminata per sbaglio si recupera con Ctrl+Z come qualsiasi altra
 * cosa, e non c'e' una categoria di azioni "speciali" da spiegare.
 */
type Snapshot = { project: SerializedProject; level: number; layer: number };

const TOOLS = ['brush', 'erase', 'select', 'pan'] as const;
type Tool = (typeof TOOLS)[number];

/** Icona e parola separate: su schermo stretto resta solo l'icona. */
const TOOL_LABELS: Record<Tool, [icon: string, text: string]> = {
  brush: ['🖌', 'Pennello'],
  erase: ['🧽', 'Gomma'],
  select: ['⬚', 'Seleziona'],
  pan: ['✋', 'Sposta'],
};

/**
 * Come si chiamano pennello e gomma quando c'e' una selezione: li' non
 * cambiano strumento, agiscono sull'area. Il pulsante dice cosa fara' adesso,
 * cosi' non serve spiegare la doppia funzione da nessuna parte.
 */
const AREA_LABELS: Partial<Record<Tool, [icon: string, text: string]>> = {
  brush: ['🪣', 'Riempi area'],
  erase: ['🧹', 'Svuota area'],
};

const TOOL_KEYS: Record<string, Tool> = {
  b: 'brush',
  e: 'erase',
  s: 'select',
  h: 'pan',
};

/** Quanti passi indietro si possono fare. */
const UNDO_LIMIT = 60;

/** Copia profonda. Gli snapshot non devono condividere niente con lo stato vivo. */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export class LevelEditor {
  private readonly scene: GameSceneLike;
  private readonly placement: GridPlacement;
  private readonly gestures: CameraGestures;
  private readonly selection: SelectionTool;
  private readonly storage = new EditorStorage();

  private root!: HTMLDivElement;
  private tabBar!: HTMLDivElement;
  private tabList!: HTMLDivElement;
  private layerPanel!: HTMLDivElement;
  private layerList!: HTMLDivElement;
  private countLabel!: HTMLSpanElement;
  private statusLabel!: HTMLSpanElement;
  private paletteButtons = new Map<BlockType, HTMLButtonElement>();
  private toolButtons = new Map<Tool, HTMLButtonElement>();
  private undoButton!: HTMLButtonElement;
  private redoButton!: HTMLButtonElement;
  private deleteButton!: HTMLButtonElement;
  private selectionActions!: HTMLDivElement;
  private copyButton!: HTMLButtonElement;
  private cutButton!: HTMLButtonElement;
  private pasteButton!: HTMLButtonElement;
  private addLayerButton!: HTMLButtonElement;

  private tool: Tool = 'brush';

  /**
   * I livelli del progetto. Quello aperto vive dentro `placement`, gli altri
   * qui in forma serializzata: c'e' una scena sola, e tenerne cinque montate
   * significherebbe cinque volte gli sprite per niente.
   */
  private levels: SerializedLevel[] = [emptyLevel()];
  private activeLevelIndex = 0;

  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];

  /** Modifiche successive all'ultimo Salva. */
  private dirty = false;
  private lastSavedAt: number | null = null;

  /** Traccia in corso: serve a non ripetere l'operazione sulla stessa cella. */
  private strokeCell: string | null = null;
  private pointerDown = false;
  /** Lo stato prima della traccia corrente: si impila solo se qualcosa cambia. */
  private strokeStart: Snapshot | null = null;
  private panFrom: { x: number; y: number; scrollX: number; scrollY: number } | null = null;

  /**
   * Gli appunti, in coordinate relative al loro angolo. Vivono in memoria e non
   * nel progetto salvato: sopravvivono al cambio di scheda — che e' il caso che
   * conta, copiare un pezzo di livello in un altro — ma non a una ricarica.
   */
  private clipboard: Picked[] = [];
  /** Dove stavano quando sono stati copiati: e' il ripiego per l'incolla senza puntatore. */
  private clipboardOrigin = { col: 0, row: 0 };
  /** L'ultima cella sotto il puntatore: e' li' che si incolla. */
  private hoverCell: { col: number; row: number } | null = null;

  constructor(scene: Phaser.Scene, placement: GridPlacement, published: SerializedProject) {
    this.scene = scene as GameSceneLike;
    this.placement = placement;
    this.gestures = new CameraGestures(scene);
    this.selection = new SelectionTool(scene, placement);

    this.buildToolbar();
    this.buildLevelTabs();
    this.buildLayerPanel();
    this.bindInput();
    this.bindKeyboard();
    this.resetView();

    // Il lavoro in sospeso puo' richiedere una domanda, e una domanda non si
    // puo' fare dentro un costruttore: si apre sul progetto pubblicato e la
    // risposta, se arriva, lo sostituisce.
    this.adopt(published, 0);
    void this.offerResume(published);
  }

  // -------------------------------------------------- progetto e livelli

  /** Il progetto intero, col livello aperto riletto dalla scena. */
  private project(): SerializedProject {
    const levels = this.levels.map((level, i) =>
      i === this.activeLevelIndex
        ? { name: level.name, layers: this.placement.serializeLayers() }
        : clone(level),
    );
    return { levels };
  }

  /** Sostituisce tutto il progetto e apre il livello indicato. */
  private adopt(project: SerializedProject, levelIndex: number): void {
    this.levels = clone(project.levels);
    this.activeLevelIndex = Phaser.Math.Clamp(levelIndex, 0, this.levels.length - 1);
    this.placement.loadLayers(this.levels[this.activeLevelIndex]!.layers);
    this.selection.clear();
    this.refresh();
  }

  /**
   * Passa a un'altra scheda.
   *
   * Il livello che si lascia viene riletto dalla scena prima di montare
   * l'altro: e' l'unico punto in cui il lavoro non ancora serializzato
   * potrebbe sparire.
   */
  private openLevel(index: number): void {
    if (index === this.activeLevelIndex || index < 0 || index >= this.levels.length) return;

    this.levels = this.project().levels;
    this.activeLevelIndex = index;
    this.placement.loadLayers(this.levels[index]!.layers);
    this.selection.clear();
    // La cronologia resta valida: gli snapshot contengono il progetto intero,
    // quindi un undo dopo il cambio scheda riporta anche alla scheda giusta.
    this.touch();
  }

  private addLevel(): void {
    this.edit(() => {
      this.levels = this.project().levels;
      this.levels.push(emptyLevel(`Livello ${this.levels.length + 1}`));
      this.activeLevelIndex = this.levels.length - 1;
      this.placement.loadLayers(this.levels[this.activeLevelIndex]!.layers);
      this.selection.clear();
    });
  }

  private duplicateLevel(): void {
    this.edit(() => {
      this.levels = this.project().levels;
      const source = this.levels[this.activeLevelIndex]!;
      this.levels.splice(this.activeLevelIndex + 1, 0, {
        name: `${source.name} (copia)`,
        layers: clone(source.layers),
      });
      this.activeLevelIndex += 1;
      this.selection.clear();
    });
  }

  private renameLevel(): void {
    const current = this.levels[this.activeLevelIndex]!.name;
    const name = window.prompt('Nome del livello', current);
    if (name === null || name.trim() === '' || name.trim() === current) return;

    this.edit(() => {
      this.levels = this.project().levels;
      this.levels[this.activeLevelIndex]!.name = name.trim();
    });
  }

  /**
   * Apre un `level.json` scelto dal dispositivo.
   *
   * Senza questo, l'unico modo di riprendere un livello e' che sia gia'
   * pubblicato: si passa da un commit e da un minuto di deploy anche solo per
   * rimettere le mani su un file che si ha gia' in mano.
   *
   * Sostituisce tutto il progetto, ma passando dall'undo: un file aperto per
   * sbaglio si annulla con Ctrl+Z come qualsiasi altra cosa.
   */
  private async openFile(file: File): Promise<void> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      await chooseDialog(
        'File non leggibile',
        `"${file.name}" non contiene JSON valido. Se l'hai modificato a mano, controlla virgole e parentesi.`,
        [{ id: 'ok', label: 'Ho capito' }] as const,
      );
      return;
    }

    const project = normalizeProject(parsed);
    this.edit(() => this.adopt(project, 0));
  }

  private async deleteLevel(): Promise<void> {
    if (this.levels.length <= 1) return;

    const level = this.levels[this.activeLevelIndex]!;
    const blocks = this.placement.count;
    const choice = await chooseDialog('Eliminare la scheda?', `"${level.name}" con ${blocks} blocchi.`, [
      { id: 'cancel', label: 'Annulla' },
      { id: 'delete', label: 'Elimina', detail: 'Si recupera con Ctrl+Z', danger: true },
    ] as const);
    if (choice !== 'delete') return;

    this.edit(() => {
      this.levels = this.project().levels;
      this.levels.splice(this.activeLevelIndex, 1);
      this.activeLevelIndex = Math.min(this.activeLevelIndex, this.levels.length - 1);
      this.placement.loadLayers(this.levels[this.activeLevelIndex]!.layers);
      this.selection.clear();
    });
  }

  // --------------------------------------------------- salvataggio locale

  /**
   * All'apertura, se in questo browser c'e' del lavoro diverso dal file
   * pubblicato, la scelta la fa chi ha costruito.
   *
   * Ripristinare in silenzio sarebbe peggio in entrambi i versi: chi ha appena
   * caricato un `level.json` nuovo su GitHub non capirebbe perche' vede ancora
   * il vecchio, e chi ha chiuso la scheda per sbaglio si vedrebbe sovrascritto
   * senza accorgersene.
   */
  private async offerResume(published: SerializedProject): Promise<void> {
    const stored = this.storage.read();
    if (!stored) return;
    if (JSON.stringify(stored.project) === JSON.stringify(published)) {
      // Identici: il lavoro locale e' gia' nel gioco, non c'e' niente da chiedere.
      this.lastSavedAt = stored.savedAt;
      this.dirty = false;
      this.refresh();
      return;
    }

    const when = describeWhen(stored.savedAt);
    const choice = await chooseDialog(
      'C’è del lavoro in questo browser',
      stored.dirty
        ? `Modifiche mai salvate, l’ultima ${when}.`
        : `Salvato ${when}, ma diverso dal level.json pubblicato.`,
      [
        {
          id: 'resume',
          label: 'Riprendi',
          detail: `${stored.project.levels.length} livelli come li avevi lasciati`,
        },
        {
          id: 'restart',
          label: 'Ricomincia dal file pubblicato',
          detail: 'Butta via il lavoro locale, senza possibilità di tornare indietro',
          danger: true,
        },
      ] as const,
    );

    if (choice === 'resume') {
      this.adopt(stored.project, stored.activeLevel);
      this.dirty = stored.dirty;
      this.lastSavedAt = stored.dirty ? null : stored.savedAt;
    } else {
      this.storage.clear();
      this.adopt(published, 0);
      this.dirty = false;
      this.lastSavedAt = null;
    }
    this.refresh();
  }

  private collectWork(dirty: boolean): Parameters<EditorStorage['write']>[0] {
    return { dirty, activeLevel: this.activeLevelIndex, project: this.project() };
  }

  /** Salva esplicito: da qui in poi questo e' lo stato buono. */
  private save(): void {
    this.storage.write(this.collectWork(false));
    this.dirty = false;
    this.lastSavedAt = Date.now();
    this.refresh();
  }

  /** Una modifica qualsiasi: segna il lavoro come non salvato e programma l'autosave. */
  private touch(): void {
    this.dirty = true;
    this.storage.queueAutosave(() => this.collectWork(true));
    this.refresh();
  }

  // ---------------------------------------------------------------- input

  private bindInput(): void {
    const input = this.scene.input;

    // Il secondo dito annulla quello che il primo stava facendo: appoggiando
    // due dita per spostarsi non si deve restare con un blocco piazzato per
    // sbaglio dove e' atterrato il primo.
    this.gestures.onGestureStart = () => {
      this.pointerDown = false;
      this.panFrom = null;
      this.selection.cancel();
      if (this.strokeStart) {
        this.restore(this.strokeStart);
        this.strokeStart = null;
      }
    };

    input.on(Phaser.Input.Events.POINTER_DOWN, (p: Phaser.Input.Pointer) => {
      if (this.gestures.active) return;
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

      if (this.tool === 'select') {
        this.selection.begin(this.worldOnPlane(p), this.scene.cellUnder(p));
        this.refresh();
        return;
      }
      this.applyAt(p);
    });

    input.on(Phaser.Input.Events.POINTER_MOVE, (p: Phaser.Input.Pointer) => {
      // Aggiornata anche a dito alzato: e' la cella dove finira' un incolla.
      this.hoverCell = this.scene.cellUnder(p);
      if (!this.pointerDown || this.gestures.active) return;

      if (this.tool === 'pan') {
        if (!this.panFrom) return;
        const cam = this.scene.cameras.main;
        // Diviso per lo zoom: a schermo il dito deve restare sullo stesso punto.
        cam.scrollX = this.panFrom.scrollX - (p.x - this.panFrom.x) / cam.zoom;
        cam.scrollY = this.panFrom.scrollY - (p.y - this.panFrom.y) / cam.zoom;
        return;
      }

      if (this.tool === 'select') {
        this.selection.update(this.worldOnPlane(p), this.scene.cellUnder(p));
        return;
      }

      this.applyAt(p);
    });

    input.on(Phaser.Input.Events.POINTER_UP, () => this.endStroke());
    // Il dito che esce dal canvas non deve lasciare la traccia aperta.
    input.on(Phaser.Input.Events.GAME_OUT, () => this.endStroke());
  }

  private endStroke(): void {
    const wasDown = this.pointerDown;
    this.pointerDown = false;
    this.panFrom = null;
    if (!wasDown) return;

    if (this.tool === 'select') {
      // Una selezione che non sposta niente non e' una modifica della scena:
      // non deve finire nella cronologia.
      const changed = this.selection.end();
      if (!changed) this.strokeStart = null;
      this.refresh();
    }
    this.commitStroke();
  }

  /**
   * Il punto del mondo sotto il dito, senza correzioni.
   *
   * Qui la quota **non** va tolta, al contrario di `cellUnder`. Il rettangolo di
   * selezione e' una figura sullo schermo, e viene confrontato con la posizione
   * degli sprite, che sullo schermo sono gia' disegnati alzati: entrambi i
   * termini sono nello stesso spazio, e correggerne uno solo li disallineerebbe.
   */
  private worldOnPlane(p: Phaser.Input.Pointer): { x: number; y: number } {
    return { x: p.worldX, y: p.worldY };
  }

  private bindKeyboard(): void {
    // Le scorciatoie stanno sul document e non su Phaser: la toolbar e' HTML,
    // e con il focus su un pulsante la tastiera di Phaser non riceve nulla.
    document.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;

      if (e.ctrlKey || e.metaKey) {
        const k = e.key.toLowerCase();
        if (k === 'z' && !e.shiftKey) {
          e.preventDefault();
          this.undo();
        } else if ((k === 'z' && e.shiftKey) || k === 'y') {
          e.preventDefault();
          this.redo();
        } else if (k === 's') {
          e.preventDefault();
          this.save();
        } else if (k === 'c') {
          e.preventDefault();
          this.copySelection(false);
        } else if (k === 'x') {
          e.preventDefault();
          this.copySelection(true);
        } else if (k === 'v') {
          e.preventDefault();
          this.pasteClipboard();
        }
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (this.selection.count > 0) {
          e.preventDefault();
          this.deleteSelection();
        }
        return;
      }
      if (e.key === 'Escape') {
        // Anche la barra deve tornare indietro: senza il refresh i pulsanti
        // restavano "Riempi area" su una selezione che non c'era piu'.
        this.selection.clear();
        this.refresh();
        return;
      }

      // Parentesi quadre per salire e scendere di piano: sono le stesse di
      // Photoshop per cambiare livello, e stanno vicine su ogni layout.
      if (e.key === '[') return this.selectLayer(this.placement.activeLayer - 1);
      if (e.key === ']') return this.selectLayer(this.placement.activeLayer + 1);

      const tool = TOOL_KEYS[e.key.toLowerCase()];
      if (tool) this.chooseTool(tool);
    });

    // L'autosave e' ritardato: chiudendo la scheda subito dopo una modifica,
    // senza questo, l'ultima cosa fatta non verrebbe scritta.
    window.addEventListener('beforeunload', () => {
      this.storage.flush(() => this.collectWork(this.dirty));
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
    }

    this.refresh();
  }

  /** La griglia disegnata e' finita: fuori non si costruisce. */
  private inBounds(col: number, row: number): boolean {
    return col >= GRID.drawFrom && col <= GRID.drawTo && row >= GRID.drawFrom && row <= GRID.drawTo;
  }

  private deleteSelection(): void {
    if (this.selection.count === 0) return;
    this.edit(() => this.selection.clearArea());
  }

  // -------------------------------------------------------------- appunti

  /**
   * Mette la selezione negli appunti, in coordinate relative al suo angolo.
   *
   * Relative e non assolute perche' l'incolla deve poter atterrare altrove — su
   * un'altra cella, un altro layer o un'altra scheda — mantenendo la forma.
   */
  private copySelection(cut: boolean): void {
    const blocks = this.selection.snapshot();
    if (blocks.length === 0) return;

    const minCol = Math.min(...blocks.map((b) => b.col));
    const minRow = Math.min(...blocks.map((b) => b.row));
    this.clipboard = blocks.map((b) => ({ ...b, col: b.col - minCol, row: b.row - minRow }));
    this.clipboardOrigin = { col: minCol, row: minRow };

    if (cut) this.edit(() => this.selection.clearArea());
    else this.refresh();
  }

  /**
   * Incolla sul **layer attivo**, sotto il puntatore.
   *
   * Sotto il puntatore e non dove stava: incollare sopra l'originale sembra non
   * aver fatto niente. Senza puntatore — da tastiera, appena aperta la pagina —
   * si ripiega sulla posizione di partenza spostata di una cella, che e' visibile
   * e non copre quello che c'era.
   */
  private pasteClipboard(): void {
    if (this.clipboard.length === 0) return;

    const width = Math.max(...this.clipboard.map((b) => b.col));
    const height = Math.max(...this.clipboard.map((b) => b.row));
    const wanted = this.hoverCell ?? {
      col: this.clipboardOrigin.col + 1,
      row: this.clipboardOrigin.row + 1,
    };
    // Si sposta tutto dentro la griglia invece di scartare i pezzi che escono:
    // un incolla non deve mangiarsi in silenzio meta' di quello che copi.
    const anchor = {
      col: Phaser.Math.Clamp(wanted.col, GRID.drawFrom, GRID.drawTo - width),
      row: Phaser.Math.Clamp(wanted.row, GRID.drawFrom, GRID.drawTo - height),
    };

    this.edit(() => {
      const placed: Picked[] = [];
      for (const b of this.clipboard) {
        const col = anchor.col + b.col;
        const row = anchor.row + b.row;
        this.placement.remove(col, row);
        if (this.placement.spawn(col, row, b.type)) placed.push({ col, row, type: b.type });
      }
      // Quello che arriva resta in mano, pronto da trascinare. E per vederlo
      // serve lo strumento selezione: incollare con la gomma attiva mostrerebbe
      // dei blocchi senza dire che sono selezionati.
      this.selection.adopt(placed);
      if (this.tool !== 'select') this.setTool('select');
    });
  }

  // ----------------------------------------------------------------- undo

  private snapshot(): Snapshot {
    return {
      project: this.project(),
      level: this.activeLevelIndex,
      layer: this.placement.activeLayer,
    };
  }

  /** Chiude la traccia corrente e la registra, se ha cambiato qualcosa. */
  private commitStroke(): void {
    this.strokeCell = null;
    const before = this.strokeStart;
    this.strokeStart = null;
    if (before) this.push(before);
  }

  /**
   * Impila uno stato precedente, se davvero diverso da quello attuale.
   *
   * Il confronto e' sul serializzato: due stati con gli stessi blocchi negli
   * stessi layer sono lo stesso stato, e i blocchi escono ordinati, quindi il
   * confronto e' stabile.
   */
  private push(before: Snapshot): void {
    if (JSON.stringify(before) === JSON.stringify(this.snapshot())) return;

    this.undoStack.push(before);
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
    // Una nuova modifica invalida il futuro che si era tornati indietro a vedere.
    this.redoStack = [];
    this.touch();
  }

  /** Esegue una modifica registrandola nell'undo. */
  private edit(change: () => void): void {
    const before = this.snapshot();
    change();
    this.push(before);
    this.refresh();
  }

  private restore(snapshot: Snapshot): void {
    this.levels = clone(snapshot.project.levels);
    this.activeLevelIndex = Phaser.Math.Clamp(snapshot.level, 0, this.levels.length - 1);
    this.placement.loadLayers(this.levels[this.activeLevelIndex]!.layers);
    this.placement.activeLayer = snapshot.layer;
    this.selection.clear();
    this.touch();
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

  // ----------------------------------------------------------------- vista

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
   * Nascondere un layer e' una decisione che resta: selezionarlo non lo
   * riaccende, e l'unico modo di rivederlo e' il suo occhio. Prima si
   * riaccendeva da solo, per non far disegnare alla cieca, ma significava che
   * un layer nascosto tornava visibile appena lo si sfiorava — cioe' che la
   * decisione di nasconderlo non teneva.
   *
   * Il prezzo e' che si puo' dipingere su un piano spento. La riga del pannello
   * lo dice, sbiadita e con l'occhio sbarrato.
   */
  private selectLayer(index: number): void {
    if (index < 0 || index >= this.placement.layers.length) return;

    this.placement.activeLayer = index;
    // La selezione appartiene al layer su cui e' stata fatta.
    this.selection.clear();
    this.refresh();
  }

  /**
   * Cosa succede premendo un pulsante-strumento.
   *
   * Con una selezione in mano, pennello e gomma **non cambiano strumento**:
   * riempiono o svuotano l'area. E' la richiesta di chi lo usa — si sceglie il
   * terreno da modificare e poi si dice cosa farci — e l'etichetta del pulsante
   * cambia di conseguenza, cosi' non c'e' una doppia funzione nascosta.
   *
   * La selezione resta dopo l'operazione: quasi sempre si vuole riprovare con
   * un altro blocco. Per liberarla c'e' Esc.
   */
  private chooseTool(tool: Tool): void {
    if (this.selection.count > 0 && (tool === 'brush' || tool === 'erase')) {
      this.edit(() => {
        if (tool === 'brush') this.selection.fillArea(this.placement.selected);
        else this.selection.clearArea();
      });
      return;
    }
    this.setTool(tool);
  }

  private setTool(tool: Tool): void {
    this.tool = tool;
    if (tool === 'select') this.selection.show();
    else this.selection.hide();
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

  private button(label: string, onClick: () => void, parent: HTMLElement): HTMLButtonElement {
    const b = document.createElement('button');
    b.textContent = label;
    b.onclick = onClick;
    parent.appendChild(b);
    return b;
  }

  /**
   * Pulsante con icona e parola. Sotto i 600px la parola sparisce e resta
   * l'icona: su un telefono da 390px la barra a parole occupava il 44% dello
   * schermo, cioe' piu' della scena che si sta costruendo.
   */
  private iconButton(
    icon: string,
    text: string,
    onClick: () => void,
    parent: HTMLElement,
  ): HTMLButtonElement {
    const b = document.createElement('button');
    b.innerHTML = `<span class="ico">${icon}</span><span class="txt">${text}</span>`;
    b.title = text;
    b.onclick = onClick;
    parent.appendChild(b);
    return b;
  }

  private static style(): string {
    return `
      #editor-toolbar {
        position: fixed; left: 0; right: 0; bottom: 0; z-index: 10;
        display: flex; flex-direction: column; gap: 8px;
        /* Un tetto all'altezza: con molti pulsanti la barra mangerebbe lo
           schermo del telefono invece di lasciar vedere la scena. */
        max-height: 45vh; overflow-y: auto;
        padding: 8px calc(10px + env(safe-area-inset-left)) calc(10px + env(safe-area-inset-bottom));
        background: #24242e; border-top: 1px solid #3a3a48;
        font: 13px/1.4 system-ui, sans-serif; color: #e8e8ef;
      }
      #editor-toolbar .controls { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
      #editor-toolbar .tools button { display: inline-flex; align-items: center; gap: 6px; }
      #editor-toolbar .group { display: flex; flex-wrap: wrap; gap: 8px; }
      #editor-toolbar .group[hidden] { display: none; }
      /* La palette scorre invece di andare a capo: con molti sprite caricati
         una barra che cresce in altezza mangerebbe tutta la scena. */
      #editor-toolbar .palette-strip {
        display: flex; gap: 6px; overflow-x: auto; padding-bottom: 2px; scrollbar-width: thin;
      }
      #editor-toolbar button, #layer-panel button, #level-tabs button {
        min-height: 40px; padding: 0 14px; border-radius: 8px;
        border: 1px solid #3a3a48; background: #2f2f3d; color: #e8e8ef;
        font: inherit; cursor: pointer; touch-action: manipulation; white-space: nowrap;
      }
      #editor-toolbar button:hover:not(:disabled),
      #layer-panel button:hover:not(:disabled),
      #level-tabs button:hover:not(:disabled) { background: #3a3a48; }
      #editor-toolbar button:disabled, #layer-panel button:disabled, #level-tabs button:disabled {
        opacity: .35; cursor: default;
      }
      #editor-toolbar button[aria-pressed="true"],
      #layer-panel button[aria-pressed="true"],
      #level-tabs button[aria-pressed="true"] {
        border-color: #ffd166; background: #4a4432; color: #ffd166;
      }
      #editor-toolbar button.primary { border-color: #4a7a5a; background: #2c4436; }
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
      #editor-toolbar .hidden-input { display: none; }
      #editor-toolbar .status { font-size: 12px; opacity: .8; }
      #editor-toolbar .status.dirty { color: #ffd166; opacity: 1; }

      /* Le schede stanno in cima e per tutta la larghezza: sono la cosa piu'
         in alto nella gerarchia, un livello contiene i layer. */
      #level-tabs {
        position: fixed; z-index: 10;
        top: env(safe-area-inset-top); left: 0; right: 0;
        display: flex; gap: 6px; align-items: center;
        padding: 6px calc(6px + env(safe-area-inset-left)) 6px calc(6px + env(safe-area-inset-right));
        background: #1f1f28e6; border-bottom: 1px solid #3a3a48;
        font: 13px/1.4 system-ui, sans-serif; color: #e8e8ef;
      }
      #level-tabs .tabs { display: flex; gap: 6px; overflow-x: auto; flex: 1 1 auto; scrollbar-width: thin; }
      #level-tabs .tabs button { min-height: 34px; padding: 0 12px; }
      /* Le azioni non scorrono via con le schede: restano raggiungibili. */
      #level-tabs .actions { display: flex; gap: 4px; flex: 0 0 auto; }
      #level-tabs .actions button { min-height: 34px; padding: 0 9px; }

      #layer-panel {
        position: fixed; z-index: 10;
        top: calc(56px + env(safe-area-inset-top));
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
      /* Un layer spento si vede che e' spento anche quando e' quello attivo. */
      #layer-panel .row.spento .name { opacity: .45; font-style: italic; }
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

      /* Su telefono la barra a parole occupava il 44% dello schermo, cioe' piu'
         della scena che si sta costruendo. Gli strumenti restano solo icone:
         sono sei, si imparano subito, e liberano due righe. */
      @media (max-width: 600px) {
        #editor-toolbar .tools .txt { display: none; }
        #editor-toolbar .tools button.azione .txt { display: inline; }
        #editor-toolbar .tools button { padding: 0 12px; font-size: 17px; }
        #editor-toolbar button, #layer-panel button, #level-tabs button { min-height: 38px; }
        /* Il nome del layer porta anche il conteggio dei blocchi: stringendo
           la riga invece del pannello, non viene tagliato. */
        #layer-panel .row button { padding: 0 4px; }
        #layer-panel .row .quota { font-size: 12px; }
      }
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
        if (this.tool === 'erase' && this.selection.count === 0) this.setTool('brush');
        else this.refresh();
      };
      strip.appendChild(b);
      this.paletteButtons.set(block.id, b);
    }

    // Riga 2: strumenti.
    const tools = document.createElement('div');
    tools.className = 'controls tools';
    this.root.appendChild(tools);
    for (const tool of TOOLS) {
      const [icon, text] = TOOL_LABELS[tool];
      this.toolButtons.set(tool, this.iconButton(icon, text, () => this.chooseTool(tool), tools));
    }
    // Copia, taglia e incolla stanno anche come pulsanti: su telefono il Ctrl
    // non c'e', e sarebbero funzioni raggiungibili solo da tastiera.
    //
    // Compaiono solo quando servono davvero — c'e' una selezione, o qualcosa
    // negli appunti. Tenerli sempre li' disabilitati costava una riga intera
    // della barra su telefono, per pulsanti inutilizzabili nove volte su dieci.
    this.selectionActions = document.createElement('div');
    this.selectionActions.className = 'group';
    tools.appendChild(this.selectionActions);

    const box = this.selectionActions;
    this.copyButton = this.iconButton('⧉', 'Copia', () => this.copySelection(false), box);
    this.copyButton.title = 'Copia i blocchi selezionati (Ctrl+C)';
    this.cutButton = this.iconButton('✂', 'Taglia', () => this.copySelection(true), box);
    this.cutButton.title = 'Taglia i blocchi selezionati (Ctrl+X)';
    this.pasteButton = this.iconButton('📥', 'Incolla', () => this.pasteClipboard(), box);
    this.pasteButton.title = 'Incolla sul layer attivo, sotto il puntatore (Ctrl+V)';
    this.deleteButton = this.iconButton('🗑', 'Cancella', () => this.deleteSelection(), box);
    this.deleteButton.title = 'Elimina i blocchi selezionati (Canc)';

    // Riga 3: cronologia, vista, griglia, conteggio.
    const view = document.createElement('div');
    view.className = 'controls';
    this.root.appendChild(view);

    this.undoButton = this.button('↶', () => this.undo(), view);
    this.undoButton.title = 'Annulla (Ctrl+Z)';
    this.redoButton = this.button('↷', () => this.redo(), view);
    this.redoButton.title = 'Rifai (Ctrl+Shift+Z)';

    this.button('−', () => this.gestures.zoomBy(1 / ZOOM_STEP), view).title = 'Riduci';
    this.button('+', () => this.gestures.zoomBy(ZOOM_STEP), view).title = 'Ingrandisci';
    this.button('⤢', () => this.resetView(), view).title = 'Reimposta vista';

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
    view.appendChild(grid);

    view.appendChild(Object.assign(document.createElement('span'), { className: 'spacer' }));
    this.countLabel = document.createElement('span');
    view.appendChild(this.countLabel);

    // Riga 4: salvataggio ed esportazione.
    const file = document.createElement('div');
    file.className = 'controls';
    this.root.appendChild(file);

    const saveButton = this.button('💾 Salva', () => this.save(), file);
    saveButton.className = 'primary';
    saveButton.title = this.storage.available
      ? 'Salva in questo browser (Ctrl+S). Per portarlo nel gioco serve Scarica level.json'
      : 'Questo browser non permette il salvataggio locale';
    saveButton.disabled = !this.storage.available;

    this.statusLabel = document.createElement('span');
    this.statusLabel.className = 'status';
    file.appendChild(this.statusLabel);

    file.appendChild(Object.assign(document.createElement('span'), { className: 'spacer' }));

    // L'input sta nascosto e lo apre il pulsante: quello di serie non si puo'
    // impaginare e su telefono e' minuscolo.
    const picker = document.createElement('input');
    picker.type = 'file';
    picker.accept = 'application/json,.json';
    picker.className = 'hidden-input';
    picker.onchange = () => {
      const chosen = picker.files?.[0];
      // Azzerato subito: senza, riaprire lo stesso file non emette `change`.
      picker.value = '';
      if (chosen) void this.openFile(chosen);
    };
    file.appendChild(picker);
    this.button('📂 Apri', () => picker.click(), file).title =
      'Apre un level.json dal dispositivo, al posto del progetto attuale (annullabile con Ctrl+Z)';

    // Qui le parole restano anche su schermo stretto: sono le azioni che si
    // sbagliano peggio, e "scarica" e "copia" non si distinguono a icone.
    const copy = this.button('📋 Copia', () => this.copyToClipboard(copy), file);
    copy.title = 'Copia il JSON negli appunti';
    this.button('⬇ Scarica', () => this.download(), file).title =
      'Scarica level.json: è il file da caricare su GitHub, ed è questo che porta il lavoro nel gioco';

    // Da telefono, togliere ?editor=1 a mano dalla barra dell'indirizzo e'
    // scomodo: tanto vale un pulsante.
    this.button('▶ Gioca', () => {
      const url = new URL(location.href);
      url.searchParams.delete('editor');
      location.href = url.toString();
    }, file).title = 'Esce dall editor e ricarica il gioco';

    document.body.appendChild(this.root);
  }

  private buildLevelTabs(): void {
    this.tabBar = document.createElement('div');
    this.tabBar.id = 'level-tabs';

    this.tabList = document.createElement('div');
    this.tabList.className = 'tabs';
    this.tabBar.appendChild(this.tabList);

    const actions = document.createElement('div');
    actions.className = 'actions';
    this.tabBar.appendChild(actions);

    this.button('+', () => this.addLevel(), actions).title = 'Nuovo livello';
    this.button('⧉', () => this.duplicateLevel(), actions).title = 'Duplica il livello aperto';
    this.button('✎', () => this.renameLevel(), actions).title = 'Rinomina il livello aperto';
    this.button('🗑', () => void this.deleteLevel(), actions).title = 'Elimina il livello aperto';

    document.body.appendChild(this.tabBar);
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
    this.button('✎', () => this.renameActiveLayer(), actions).title = 'Rinomina il layer attivo';
    this.button('🗑', () => void this.deleteActiveLayer(), actions).title = 'Elimina il layer attivo';

    document.body.appendChild(this.layerPanel);
  }

  private renameActiveLayer(): void {
    const index = this.placement.activeLayer;
    const current = this.placement.layers[index]?.name ?? '';
    const name = window.prompt('Nome del layer', current);
    if (name === null || name.trim() === '' || name.trim() === current) return;
    this.edit(() => this.placement.renameLayer(index, name.trim()));
  }

  private async deleteActiveLayer(): Promise<void> {
    const index = this.placement.activeLayer;
    const layer = this.placement.layers[index];
    if (!layer || this.placement.layers.length <= 1) return;

    const blocks = this.placement.countOn(index);
    // Cancellare un layer pieno butta via lavoro: la conferma serve solo li'.
    if (blocks > 0) {
      const choice = await chooseDialog('Eliminare il layer?', `"${layer.name}" con ${blocks} blocchi.`, [
        { id: 'cancel', label: 'Annulla' },
        { id: 'delete', label: 'Elimina', detail: 'Si recupera con Ctrl+Z', danger: true },
      ] as const);
      if (choice !== 'delete') return;
    }
    this.edit(() => this.placement.removeLayer(index));
  }

  /** Ricostruisce le schede. Sono poche: rifarle e' piu' sicuro che aggiornarle. */
  private refreshTabs(): void {
    this.tabList.textContent = '';
    this.levels.forEach((level, index) => {
      const tab = this.button(level.name, () => this.openLevel(index), this.tabList);
      tab.setAttribute('aria-pressed', String(index === this.activeLevelIndex));
    });
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

      // L'occhio funziona su tutti, attivo compreso: se il layer attivo non
      // potesse riaccendersi, nasconderlo sarebbe una trappola senza uscita.
      const eye = this.button(layer.visible ? '👁' : '🚫', () => {
        this.placement.setLayerVisible(index, !layer.visible);
        this.refresh();
      }, row);
      eye.title = layer.visible ? 'Nascondi questo layer' : 'Mostra questo layer';
      if (!layer.visible) row.classList.add('spento');

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
    return `${JSON.stringify(this.project(), null, 2)}\n`;
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
    const selected = this.selection.count;
    this.countLabel.textContent =
      selected > 0
        ? `area: ${selected} celle, ${this.selection.blockCount} blocchi`
        : `${this.placement.count} blocchi`;

    for (const [type, button] of this.paletteButtons) {
      button.setAttribute('aria-pressed', String(this.placement.selected === type));
    }
    for (const [tool, button] of this.toolButtons) {
      button.setAttribute('aria-pressed', String(this.tool === tool));

      // Con una selezione in mano pennello e gomma diventano azioni sull'area:
      // il pulsante lo dice invece di cambiare comportamento in silenzio.
      const area = selected > 0 ? AREA_LABELS[tool] : undefined;
      const [icon, text] = area ?? TOOL_LABELS[tool];
      button.querySelector('.ico')!.textContent = icon;
      button.querySelector('.txt')!.textContent = text;
      button.title = text;
      // Su schermo stretto gli strumenti sono sole icone. Questi due pero'
      // hanno appena cambiato mestiere, e un'icona diversa non basta a dirlo:
      // la parola torna visibile proprio quando serve.
      button.classList.toggle('azione', area !== undefined);
    }
    this.undoButton.disabled = this.undoStack.length === 0;
    this.redoButton.disabled = this.redoStack.length === 0;
    // Il gruppo compare quando c'e' qualcosa da fare: una selezione in mano,
    // o degli appunti da incollare.
    this.selectionActions.hidden = selected === 0 && this.clipboard.length === 0;
    this.deleteButton.disabled = selected === 0;
    this.copyButton.disabled = selected === 0;
    this.cutButton.disabled = selected === 0;
    this.pasteButton.disabled = this.clipboard.length === 0;
    this.addLayerButton.disabled = this.placement.layers.length >= LAYERS.max;

    if (!this.storage.available) {
      this.statusLabel.textContent = 'salvataggio non disponibile';
      this.statusLabel.classList.remove('dirty');
    } else if (this.dirty) {
      this.statusLabel.textContent = '● non salvato';
      this.statusLabel.classList.add('dirty');
    } else {
      this.statusLabel.textContent = this.lastSavedAt ? `✓ salvato ${describeWhen(this.lastSavedAt)}` : '';
      this.statusLabel.classList.remove('dirty');
    }

    this.refreshTabs();
    this.refreshLayers();
  }
}
