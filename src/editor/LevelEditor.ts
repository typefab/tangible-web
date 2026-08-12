import Phaser from 'phaser';
import { GRID, LAYERS, type BlockType } from '../config';
import { BACKGROUNDS, resolveBlock } from '../assets/catalog';
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
import { LevelBrowser, type BrowserLevel } from './LevelBrowser';
import { SpriteDrawer } from './SpriteDrawer';
import type { Backdrop } from '../scenes/Backdrop';

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
  readonly backdrop: Backdrop;
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

const TOOLS = ['brush', 'erase', 'select', 'backdrop', 'pan'] as const;
type Tool = (typeof TOOLS)[number];

/** Icona e parola separate: su schermo stretto resta solo l'icona. */
const TOOL_LABELS: Record<Tool, [icon: string, text: string]> = {
  brush: ['🖌', 'Pennello'],
  erase: ['🧽', 'Gomma'],
  select: ['⬚', 'Seleziona'],
  backdrop: ['🖼', 'Fondale'],
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
  f: 'backdrop',
  h: 'pan',
};

/** Di quanto cresce o cala un fondale a ogni tocco di − o +. */
const BACKDROP_SCALE_STEP = 1.25;

/**
 * Gradi per ogni tocco di ↺ o ↻.
 *
 * Quindici perche' 90 e 45 cadono sul passo, e sono gli angoli che si vogliono
 * davvero; piu' fine servirebbe a poco toccando un pulsante.
 */
const BACKDROP_ROTATE_STEP = 15;

/** Quanti passi indietro si possono fare. */
const UNDO_LIMIT = 60;

/**
 * Quando l'editor si stringe: comandi rari dietro ⋯ e pannello layer chiuso.
 *
 * **Due condizioni, non una.** La prima versione guardava solo la larghezza, e
 * un telefono girato la mancava in pieno: 780x390 e' largo, quindi teneva la
 * barra intera — 195px su 390 di altezza, con il pannello dei layer aperto
 * sopra quel poco che restava: il 62% dello schermo occupato dai comandi.
 *
 * La barra consuma **altezza**, ed e' quella la misura giusta. La larghezza
 * serve solo a riconoscere il telefono in verticale, dove di altezza ce n'e'
 * ma non c'e' spazio per le parole.
 *
 * Una stringa sola perche' la usano sia il CSS sia `matchMedia`: e' lo stesso
 * vincolo, e due copie prima o poi divergono.
 */
const COMPATTO = '(max-width: 600px), (max-height: 600px)';

/**
 * Quanto va tenuto premuto un blocco perche' il contagocce lo prenda.
 *
 * Mezzo secondo e' la soglia di fatto delle tastiere di sistema: piu' corta si
 * attiverebbe dipingendo piano, piu' lunga sembrerebbe che non funziona.
 */
const PICK_MS = 500;

/** Oltre questo scarto in pixel non e' piu' un tocco fermo, e' un tratto. */
const PICK_SLOP = 8;

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
  private backgroundButtons = new Map<string, HTMLButtonElement>();
  /** Il cassetto: il catalogo intero, diviso per categoria. La palette in basso e' solo i recenti. */
  private spriteDrawer!: SpriteDrawer;
  /**
   * Gli sprite piazzati di recente, il piu' recente per primo. E' quello che
   * mostra la striscia in basso: costruendo si torna sugli stessi pochi, e
   * cercarli ogni volta nel cassetto sarebbe un tocco sprecato. Non si salva:
   * a una riapertura si ricava da cosa c'e' gia' nel livello.
   */
  private recentBlocks: BlockType[] = [];
  private static readonly RECENT_MAX = 16;
  private toolButtons = new Map<Tool, HTMLButtonElement>();
  private undoButton!: HTMLButtonElement;
  private redoButton!: HTMLButtonElement;
  private menuButton!: HTMLButtonElement;
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

  /**
   * Gli indici dei livelli con una scheda aperta, nell'ordine in cui stanno in
   * alto. Contiene sempre quello attivo, e non e' mai vuoto.
   *
   * E' lo stato dell'editor, non del progetto: non entra in `level.json`, che
   * e' il file che legge il gioco e non deve portarsi dietro quali schede erano
   * aperte mentre lo si costruiva.
   */
  private openLevels: number[] = [0];
  private readonly browser: LevelBrowser;

  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];

  /** Modifiche successive all'ultimo Salva. */
  private dirty = false;
  /** L'ultimo tentativo di scrittura e' fallito: quasi sempre quota piena. */
  private saveFailed = false;
  private lastSavedAt: number | null = null;

  /** Traccia in corso: serve a non ripetere l'operazione sulla stessa cella. */
  private strokeCell: string | null = null;
  private pointerDown = false;
  /** Lo stato prima della traccia corrente: si impila solo se qualcosa cambia. */
  private strokeStart: Snapshot | null = null;
  /**
   * Se il lavoro era gia' "non salvato" quando la traccia e' cominciata.
   *
   * Serve solo ad annullarla: una traccia disfatta riporta la scena a com'era,
   * e quindi deve riportare anche questo. Senza, appoggiare due dita o
   * prendere un colore lascerebbe scritto "non salvato" su un lavoro che
   * nessuno ha toccato.
   */
  private strokeWasDirty = false;
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

  /**
   * Il tocco lungo in corso: dove e' cominciato e che blocco c'era **prima**
   * che il pennello lo coprisse. Il tipo si legge al momento in cui il dito
   * scende, non quando scatta il contagocce: a quel punto la cella contiene
   * gia' quello che si stava dipingendo.
   */
  private press: { x: number; y: number; type: BlockType } | null = null;
  private pressTimer: number | null = null;

  /**
   * Il fondale che si sta manovrando, e da dove lo si e' preso.
   *
   * Si tiene lo scarto fra il dito e il centro dell'immagine, non la posizione
   * assoluta: senza, il primo movimento farebbe saltare il fondale col centro
   * sotto il dito, anche avendolo toccato in un angolo.
   */
  private pickedBackground?: number;
  private backgroundGrab: { dx: number; dy: number } | null = null;
  private paletteStrip!: HTMLDivElement;
  private backdropStrip!: HTMLDivElement;
  private backdropActions!: HTMLDivElement;
  private backdropList!: HTMLDivElement;
  private collapseButton!: HTMLButtonElement;
  private backdropTitle!: HTMLElement;
  private chosenBackground = '';

  constructor(scene: Phaser.Scene, placement: GridPlacement, published: SerializedProject) {
    this.scene = scene as GameSceneLike;
    this.placement = placement;
    this.gestures = new CameraGestures(scene);
    this.selection = new SelectionTool(scene, placement);
    this.browser = new LevelBrowser({
      levels: () => this.browserLevels(),
      openLevel: (i) => this.openLevel(i),
      createLevel: () => this.addLevel(),
      duplicateLevel: (i) => this.duplicateLevel(i),
      renameLevel: (i) => this.renameLevel(i),
      deleteLevel: (i) => this.deleteLevel(i),
    });

    this.spriteDrawer = new SpriteDrawer({
      textureSrc: (id) => this.textureSrc(id),
      onPick: (id) => this.chooseBlock(id),
      onAddSprite: () => void this.addSpritePlaceholder(),
      usedInLevel: () => this.blockTypesInLevel(),
    });

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

  /**
   * Il progetto intero, col livello aperto riletto dalla scena.
   *
   * **I livelli fermi non si copiano, si condividono.** Prima ognuno veniva
   * riclonato qui, e siccome questa funzione la chiama ogni snapshot dell'undo,
   * il costo di una pennellata cresceva col numero di livelli del progetto: a
   * 100 livelli erano 8,8ms e 2,1MB **per tratto**, per ricopiare 99 livelli
   * che nessuno aveva toccato.
   *
   * Regge perche' un `SerializedLevel` non si modifica mai sul posto: si
   * sostituisce. `serializeLayers()` costruisce sempre oggetti nuovi e
   * `loadLayers()` legge soltanto, quindi il livello montato nella scena non
   * puo' scrivere su quello memorizzato. Chi tocca un livello ne mette al suo
   * posto un altro, e la cronologia continua a puntare al vecchio senza che
   * nessuno glielo cambi sotto.
   */
  private project(): SerializedProject {
    const levels = this.levels.slice();
    const active: SerializedLevel = {
      name: this.levels[this.activeLevelIndex]!.name,
      layers: this.placement.serializeLayers(),
    };
    // La chiave resta assente quando non ci sono fondali: un level.json fatto
    // prima di questa funzione, riaperto e riscritto, non deve cambiare.
    const backgrounds = this.scene.backdrop.serialize();
    if (backgrounds.length > 0) active.backgrounds = backgrounds;
    levels[this.activeLevelIndex] = active;
    return { levels };
  }

  /**
   * Monta nella scena il livello attivo: blocchi **e** fondali.
   *
   * Esiste per non avere due chiamate da ricordare. Il livello si monta da sei
   * punti diversi — apertura, cambio scheda, nuovo, duplica, elimina, undo — e
   * dimenticare i fondali in uno solo darebbe un difetto che si vede solo in
   * quel percorso: la strada piu' comoda per un bug intermittente.
   */
  private mountLevel(): void {
    const level = this.levels[this.activeLevelIndex]!;
    this.placement.loadLayers(level.layers);
    this.scene.backdrop.load(level.backgrounds);
    this.pickedBackground = undefined;
    this.seedRecent();
  }

  // -------------------------------------------------- sprite recenti e cassetto

  /**
   * Sceglie il blocco da piazzare, da qualunque strada arrivi — striscia dei
   * recenti, cassetto, contagocce. Un punto solo cosi' l'evidenziazione del
   * cassetto non puo' restare indietro rispetto a quello che si sta piazzando.
   */
  private chooseBlock(type: BlockType): void {
    this.placement.selected = type;
    this.spriteDrawer.setSelected(type);
    // Scegliere un blocco significa volerlo piazzare: con la gomma attiva il
    // clic successivo cancellerebbe, che non e' quello che si intende.
    if (this.tool === 'erase' && this.selection.count === 0) this.setTool('brush');
    else this.refresh();
  }

  /** I tipi di blocco presenti nel livello aperto, per il cassetto e per il seme dei recenti. */
  private blockTypesInLevel(): BlockType[] {
    const types: BlockType[] = [];
    for (const layer of this.placement.serializeLayers()) {
      for (const block of layer.blocks) types.push(block.type);
    }
    return types;
  }

  /**
   * Segna un tipo come appena usato: in cima e senza doppioni. Da chiamare
   * quando un blocco viene davvero piazzato, non quando viene solo scelto.
   */
  private noteUsed(type: BlockType | undefined): void {
    if (!type || !resolveBlock(type)) return;
    if (this.recentBlocks[0] === type) return;
    this.recentBlocks = [type, ...this.recentBlocks.filter((t) => t !== type)].slice(
      0,
      LevelEditor.RECENT_MAX,
    );
    this.renderRecent();
  }

  /**
   * Riempie i recenti da cio' che c'e' nel livello: a una riapertura la striscia
   * non e' vuota. Se il livello e' vuoto tiene almeno il blocco attivo, cosi'
   * c'e' sempre qualcosa da toccare senza aprire il cassetto.
   */
  private seedRecent(): void {
    const inLevel = [...new Set(this.blockTypesInLevel())]
      .filter((t) => resolveBlock(t))
      .slice(0, LevelEditor.RECENT_MAX);
    this.recentBlocks =
      inLevel.length > 0 ? inLevel : this.placement.selected ? [this.placement.selected] : [];
    // Puo' arrivare dal costruttore prima che la toolbar esista: allora la
    // disegna buildToolbar da se', col seme gia' pronto.
    if (this.paletteStrip) this.renderRecent();
  }

  /** Ridisegna la striscia dei recenti. Sono pochi: rifarla e' piu' sicuro che aggiornarla. */
  private renderRecent(): void {
    this.paletteStrip.replaceChildren();
    this.paletteButtons.clear();

    if (this.recentBlocks.length === 0) {
      const hint = document.createElement('p');
      hint.className = 'hint';
      hint.textContent = 'Scegli uno sprite dal cassetto \u{1F3A8}';
      this.paletteStrip.appendChild(hint);
      return;
    }

    for (const id of this.recentBlocks) {
      const block = resolveBlock(id);
      if (!block) continue;
      const b = document.createElement('button');
      b.className = 'palette';
      b.title = block.label;
      b.innerHTML = `<img alt="" src="${this.textureSrc(block.id)}"><span>${block.label}</span>`;
      b.onclick = () => this.chooseBlock(block.id);
      this.paletteStrip.appendChild(b);
      this.paletteButtons.set(block.id, b);
    }
    // L'evidenziazione la ridara' il prossimo refresh; qui basta che i pulsanti
    // giusti esistano.
  }

  /**
   * Segnaposto dell'importazione sprite. L'editor d'immagine — rimuovi sfondo,
   * maschera pixel-art, importa — e' lo Strato 2: qui c'e' solo il bottone da
   * cui partira'.
   */
  private async addSpritePlaceholder(): Promise<void> {
    await chooseDialog(
      'Importa sprite',
      'L’editor d’immagine (rimuovi sfondo, pixel-art, ridimensiona) arriva nel prossimo passo.',
      [{ id: 'ok', label: 'Ok' }],
    );
  }

  /** Sostituisce tutto il progetto e apre il livello indicato. */
  private adopt(project: SerializedProject, levelIndex: number, open?: number[]): void {
    this.levels = clone(project.levels);
    this.activeLevelIndex = Phaser.Math.Clamp(levelIndex, 0, this.levels.length - 1);
    // Un progetto nuovo porta le sue schede o nessuna: quelle di prima
    // puntavano a livelli che non esistono piu'.
    this.openLevels = (open ?? []).filter((i) => i >= 0 && i < this.levels.length);
    this.markOpen(this.activeLevelIndex);
    this.mountLevel();
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
    if (index < 0 || index >= this.levels.length) return;
    // Aprire quello gia' aperto non e' un errore: dall'elenco e' il modo
    // naturale di dire "torna li'". Non deve pero' costare un rimontaggio
    // della scena, che a livello pieno si vede.
    if (index === this.activeLevelIndex) {
      this.markOpen(index);
      this.refresh();
      return;
    }

    this.levels = this.project().levels;
    this.activeLevelIndex = index;
    this.markOpen(index);
    this.mountLevel();
    this.selection.clear();
    // La cronologia resta valida: gli snapshot contengono il progetto intero,
    // quindi un undo dopo il cambio scheda riporta anche alla scheda giusta.
    this.touch();
  }

  /**
   * Chiude una scheda. **Non elimina il livello**: resta nell'elenco.
   *
   * E' la differenza che rende sopportabile un progetto da cento livelli: le
   * schede sono i due o tre fra cui si sta andando avanti e indietro adesso, e
   * chiuderne una deve costare quanto costa metter via un foglio.
   *
   * Una scheda resta sempre aperta, perche' la scena disegna sempre un livello:
   * senza, l'editor si troverebbe a modificare qualcosa che non e' in nessuna
   * scheda.
   */
  private closeLevel(index: number): void {
    if (this.openLevels.length <= 1) return;

    const position = this.openLevels.indexOf(index);
    if (position < 0) return;
    this.openLevels.splice(position, 1);

    if (index === this.activeLevelIndex) {
      // Si passa alla scheda che prende il suo posto, o all'ultima se era in
      // fondo: e' dove finirebbe l'occhio.
      const next = this.openLevels[Math.min(position, this.openLevels.length - 1)]!;
      this.openLevel(next);
      return;
    }
    this.refresh();
  }

  /** Aggiunge l'indice alle schede aperte, se non c'e' gia'. */
  private markOpen(index: number): void {
    if (!this.openLevels.includes(index)) this.openLevels.push(index);
  }

  /**
   * Rimappa le schede aperte dopo un cambiamento nell'elenco dei livelli.
   *
   * Le schede sono indici, e inserire o togliere un livello sposta tutti quelli
   * che vengono dopo. E' l'unico punto in cui quella contabilita' esiste: chi
   * aggiunge un'operazione sul catalogo deve passare di qui, altrimenti le
   * schede finiscono a puntare al livello sbagliato.
   *
   * @param remap indice vecchio -> indice nuovo, oppure null se sparisce.
   */
  private remapOpen(remap: (index: number) => number | null): void {
    const mapped: number[] = [];
    for (const index of this.openLevels) {
      const next = remap(index);
      if (next !== null && !mapped.includes(next)) mapped.push(next);
    }
    this.openLevels = mapped;
  }

  private addLevel(): void {
    this.edit(() => {
      this.levels = this.project().levels;
      this.levels.push(emptyLevel(`Livello ${this.levels.length + 1}`));
      // In fondo: nessun indice esistente si sposta.
      this.activeLevelIndex = this.levels.length - 1;
      this.markOpen(this.activeLevelIndex);
      this.mountLevel();
      this.selection.clear();
    });
  }

  private duplicateLevel(index = this.activeLevelIndex): void {
    if (index < 0 || index >= this.levels.length) return;

    this.edit(() => {
      this.levels = this.project().levels;
      const source = this.levels[index]!;
      this.levels.splice(index + 1, 0, {
        name: `${source.name} (copia)`,
        layers: clone(source.layers),
      });
      // La copia entra subito dopo l'originale: tutto quello che stava dopo
      // scala di uno.
      this.remapOpen((i) => (i > index ? i + 1 : i));
      this.activeLevelIndex = index + 1;
      this.markOpen(this.activeLevelIndex);
      this.mountLevel();
      this.selection.clear();
    });
  }

  private renameLevel(index = this.activeLevelIndex): void {
    const current = this.levels[index]?.name;
    if (current === undefined) return;

    const name = window.prompt('Nome del livello', current);
    if (name === null || name.trim() === '' || name.trim() === current) return;

    this.edit(() => {
      this.levels = this.project().levels;
      // Sostituito, non modificato: quel livello sta anche negli snapshot gia'
      // impilati, e scrivergli il nome addosso cambierebbe il passato.
      const level = this.levels[index]!;
      this.levels[index] = { name: name.trim(), layers: level.layers };
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

  private async deleteLevel(index = this.activeLevelIndex): Promise<void> {
    if (this.levels.length <= 1 || index < 0 || index >= this.levels.length) return;

    const level = this.levels[index]!;
    const blocks =
      index === this.activeLevelIndex
        ? this.placement.count
        : level.layers.reduce((n, layer) => n + layer.blocks.length, 0);
    const choice = await chooseDialog('Eliminare il livello?', `"${level.name}" con ${blocks} blocchi.`, [
      { id: 'cancel', label: 'Annulla' },
      { id: 'delete', label: 'Elimina', detail: 'Si recupera con Ctrl+Z', danger: true },
    ] as const);
    if (choice !== 'delete') return;

    this.edit(() => {
      this.levels = this.project().levels;
      this.levels.splice(index, 1);
      // Quello eliminato sparisce dalle schede, quelli dopo scalano di uno.
      this.remapOpen((i) => (i === index ? null : i > index ? i - 1 : i));

      if (this.activeLevelIndex > index) this.activeLevelIndex -= 1;
      else if (this.activeLevelIndex === index) {
        this.activeLevelIndex = Math.min(index, this.levels.length - 1);
      }
      // Se si e' eliminato l'ultimo livello aperto, quello su cui si atterra
      // prende comunque una scheda: la scena ne disegna sempre uno.
      this.markOpen(this.activeLevelIndex);
      this.mountLevel();
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
      this.adopt(stored.project, stored.activeLevel, stored.open);
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
    return {
      dirty,
      activeLevel: this.activeLevelIndex,
      open: this.openLevels.slice(),
      project: this.project(),
    };
  }

  /** Salva esplicito: da qui in poi questo e' lo stato buono. */
  private save(): void {
    // Se la scrittura non e' andata, `dirty` resta vero e lo stato lo dice.
    // Mettere "salvato" su un salvataggio fallito e' il modo piu' diretto di
    // far perdere del lavoro a chi si e' fidato.
    if (!this.storage.write(this.collectWork(false))) {
      this.saveFailed = true;
      this.refresh();
      return;
    }
    this.saveFailed = false;
    this.dirty = false;
    this.lastSavedAt = Date.now();
    this.refresh();
  }

  /** Una modifica qualsiasi: segna il lavoro come non salvato e programma l'autosave. */
  private touch(): void {
    this.dirty = true;
    // Lo stato si legge quando l'autosave scrive davvero, non adesso: fra i due
    // istanti ci puo' stare un Salva, o una traccia annullata che rimette il
    // lavoro come lo si era lasciato.
    this.storage.queueAutosave(() => this.collectWork(this.dirty));
    this.refresh();
  }

  // ---------------------------------------------------------------- input

  private bindInput(): void {
    const input = this.scene.input;

    // Il secondo dito annulla quello che il primo stava facendo: appoggiando
    // due dita per spostarsi non si deve restare con un blocco piazzato per
    // sbaglio dove e' atterrato il primo.
    this.gestures.onGestureStart = () => this.cancelStroke();

    input.on(Phaser.Input.Events.POINTER_DOWN, (p: Phaser.Input.Pointer) => {
      if (this.gestures.active) return;
      this.pointerDown = true;

      // Alt+clic prende il tipo di blocco senza aspettare: e' il gesto che chi
      // usa un programma di disegno ha gia' nelle dita. Su telefono l'Alt non
      // c'e', ed e' il motivo per cui esiste anche il tocco lungo.
      if (p.event instanceof MouseEvent && p.event.altKey) {
        this.pointerDown = false;
        const { col, row } = this.scene.cellUnder(p);
        this.pick(this.placement.topBlockAt(col, row)?.sprite.getData('type') as BlockType | undefined);
        return;
      }

      if (this.tool === 'pan') {
        const cam = this.scene.cameras.main;
        this.panFrom = { x: p.x, y: p.y, scrollX: cam.scrollX, scrollY: cam.scrollY };
        return;
      }

      if (this.tool === 'backdrop') {
        // Come per le tracce: lo stato di partenza si cattura qui e si impila
        // solo alla fine, cosi' un trascinamento e' un solo Ctrl+Z.
        this.strokeStart = this.snapshot();
        this.strokeWasDirty = this.dirty;
        this.touchBackdrop(p);
        return;
      }

      // Lo stato di partenza si cattura qui e si impila solo a fine traccia:
      // un trascinamento che tocca 30 celle deve costare un solo undo.
      this.strokeStart = this.snapshot();
      this.strokeWasDirty = this.dirty;
      this.strokeCell = null;

      if (this.tool === 'select') {
        this.selection.begin(this.worldOnPlane(p), this.scene.cellUnder(p));
        this.refresh();
        return;
      }
      this.armPick(p);
      this.applyAt(p);
    });

    input.on(Phaser.Input.Events.POINTER_MOVE, (p: Phaser.Input.Pointer) => {
      // Aggiornata anche a dito alzato: e' la cella dove finira' un incolla.
      this.hoverCell = this.scene.cellUnder(p);
      // Il dito si e' mosso: era un tratto, non un tocco fermo.
      if (this.press && Math.hypot(p.x - this.press.x, p.y - this.press.y) > PICK_SLOP) {
        this.disarmPick();
      }
      if (!this.pointerDown || this.gestures.active) return;

      if (this.tool === 'pan') {
        if (!this.panFrom) return;
        const cam = this.scene.cameras.main;
        // Diviso per lo zoom: a schermo il dito deve restare sullo stesso punto.
        cam.scrollX = this.panFrom.scrollX - (p.x - this.panFrom.x) / cam.zoom;
        cam.scrollY = this.panFrom.scrollY - (p.y - this.panFrom.y) / cam.zoom;
        return;
      }

      if (this.tool === 'backdrop') {
        this.dragBackdrop(p);
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

  /**
   * Abbandona il tratto in corso e rimette la scena com'era.
   *
   * Serve a due gesti diversi che hanno lo stesso problema: quando il secondo
   * dito arriva per un pinch, e quando un tocco fermo si rivela un contagocce,
   * il primo dito ha gia' dipinto. In tutti e due i casi quel blocco non era
   * voluto.
   */
  private cancelStroke(): void {
    this.pointerDown = false;
    this.panFrom = null;
    this.disarmPick();
    this.selection.cancel();
    if (this.strokeStart) {
      this.restore(this.strokeStart);
      this.strokeStart = null;
      // `restore` segna sempre "non salvato", perche' di solito arriva da un
      // undo, che e' una modifica. Qui no: la scena e' tornata identica a
      // prima del tocco, e dirlo modificata sarebbe falso.
      this.dirty = this.strokeWasDirty;
      this.refresh();
    }
  }

  // ------------------------------------------------------------- fondali

  /**
   * Cosa fa un tocco con lo strumento 🖼.
   *
   * Se sotto il dito c'e' gia' un fondale lo prende, altrimenti ne piazza uno
   * nuovo li'. Nessuna modalita' da cambiare fra "aggiungi" e "sposta": e' la
   * stessa regola della selezione, dove appoggiare il dito dentro l'area la
   * sposta e appoggiarlo fuori ne comincia un'altra.
   */
  private touchBackdrop(p: Phaser.Input.Pointer): void {
    const world = this.worldOnPlane(p);
    const existing = this.scene.backdrop.at(world.x, world.y);

    if (existing !== undefined) {
      this.pickedBackground = existing;
      const at = this.scene.backdrop.positionOf(existing)!;
      this.backgroundGrab = { dx: at.x - world.x, dy: at.y - world.y };
      this.refresh();
      return;
    }

    if (this.chosenBackground === '') return;
    const index = this.scene.backdrop.add(this.chosenBackground, world.x, world.y);
    if (index < 0) return;
    this.pickedBackground = index;
    // Preso dal centro: e' li' che l'ha appena messo il dito.
    this.backgroundGrab = { dx: 0, dy: 0 };
    this.refresh();
  }

  private dragBackdrop(p: Phaser.Input.Pointer): void {
    if (this.pickedBackground === undefined || !this.backgroundGrab) return;
    const world = this.worldOnPlane(p);
    this.scene.backdrop.move(
      this.pickedBackground,
      world.x + this.backgroundGrab.dx,
      world.y + this.backgroundGrab.dy,
    );
  }

  /** Le modifiche dai pulsanti passano dall'undo, come tutto il resto. */
  private scaleBackground(factor: number): void {
    const index = this.pickedBackground;
    if (index === undefined) return;
    this.edit(() => this.scene.backdrop.scaleBy(index, factor));
  }

  private reorderBackground(direction: 1 | -1): void {
    const index = this.pickedBackground;
    if (index === undefined) return;
    this.edit(() => {
      this.pickedBackground = this.scene.backdrop.reorder(index, direction);
    });
  }

  private removeBackground(): void {
    const index = this.pickedBackground;
    if (index === undefined) return;
    this.edit(() => {
      this.scene.backdrop.remove(index);
      this.pickedBackground = undefined;
    });
  }

  // ----------------------------------------------------------- contagocce

  /**
   * Prepara il contagocce per questo tocco.
   *
   * Si arma solo se sotto il dito c'e' gia' un blocco: su terreno vuoto non ci
   * sarebbe niente da prendere, e tenere premuto dopo una pennellata
   * cancellerebbe il blocco appena messo — che e' l'opposto di quello che si
   * sta chiedendo.
   *
   * Solo con pennello e gomma. Con ✋ e con la selezione il dito fermo ha gia'
   * un significato — si tiene premuto prima di trascinare — e rubarglielo dopo
   * mezzo secondo renderebbe quei due strumenti imprevedibili.
   */
  private armPick(p: Phaser.Input.Pointer): void {
    this.disarmPick();
    if (this.tool !== 'brush' && this.tool !== 'erase') return;

    const { col, row } = this.scene.cellUnder(p);
    const type = this.placement.topBlockAt(col, row)?.sprite.getData('type') as BlockType | undefined;
    if (!type) return;

    this.press = { x: p.x, y: p.y, type };
    this.pressTimer = window.setTimeout(() => {
      const picked = this.press?.type;
      // Prima si disfa la pennellata che il tocco aveva gia' prodotto, poi si
      // prende il tipo: chi tiene premuto sta indicando un blocco, non
      // dipingendo.
      this.cancelStroke();
      this.pick(picked);
    }, PICK_MS);
  }

  private disarmPick(): void {
    if (this.pressTimer !== null) window.clearTimeout(this.pressTimer);
    this.pressTimer = null;
    this.press = null;
  }

  /**
   * Rende scelto un tipo di blocco, come se si fosse premuto il suo pulsante.
   *
   * Con la gomma in mano si passa al pennello, per la stessa ragione della
   * palette: indicare un blocco significa volerlo piazzare. Non succede se c'e'
   * un'area selezionata, perche' li' la gomma e' "svuota l'area" ed e' una
   * scelta appena fatta.
   */
  private pick(type: BlockType | undefined): void {
    if (!type) return;

    // In cima ai recenti anche pescandolo col contagocce: cosi' la striscia in
    // basso lo mostra, ed e' li' che il lampo di conferma ha un pulsante da
    // illuminare. chooseBlock aggiorna selezione, strumento e cassetto.
    this.noteUsed(type);
    this.chooseBlock(type);

    // Il gesto non ha un pulsante da guardare: senza questo, con la palette
    // scorsa altrove, non si vedrebbe succedere niente.
    const button = this.paletteButtons.get(type);
    if (!button) return;
    button.scrollIntoView({ block: 'nearest', inline: 'center' });
    button.classList.remove('preso');
    // Rileggere una proprieta' di layout fa ripartire l'animazione anche
    // prendendo due volte di fila lo stesso blocco.
    void button.offsetWidth;
    button.classList.add('preso');
  }

  private endStroke(): void {
    const wasDown = this.pointerDown;
    this.pointerDown = false;
    this.panFrom = null;
    this.disarmPick();
    if (!wasDown) return;

    if (this.tool === 'select') {
      // Una selezione che non sposta niente non e' una modifica della scena:
      // non deve finire nella cronologia.
      const changed = this.selection.end();
      if (!changed) this.strokeStart = null;
      this.refresh();
    }
    if (this.tool === 'backdrop') {
      this.backgroundGrab = null;
      // `push()` confronta gli stati e scarta i pari: prendere un fondale
      // senza spostarlo non finisce nella cronologia da solo.
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

      if ((e.key === 'Delete' || e.key === 'Backspace') && this.pickedBackground !== undefined) {
        e.preventDefault();
        this.removeBackground();
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (this.selection.count > 0) {
          e.preventDefault();
          this.deleteSelection();
        }
        return;
      }
      if (e.key === 'Escape' && this.pickedBackground !== undefined) {
        this.pickedBackground = undefined;
        this.refresh();
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
      if (this.placement.spawn(col, row)) this.noteUsed(this.placement.selected);
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
    // Copia dell'elenco, non dei livelli: lo stesso snapshot puo' essere
    // ripristinato piu' volte — annulla, rifai, annulla — e i livelli che
    // contiene devono restare quelli. Vale la regola di `project()`: si
    // sostituiscono, non si modificano.
    this.levels = snapshot.project.levels.slice();
    this.activeLevelIndex = Phaser.Math.Clamp(snapshot.level, 0, this.levels.length - 1);
    // Le schede non stanno nella cronologia — aprirne una non e' una modifica
    // della scena — ma un undo puo' far sparire o ricomparire dei livelli:
    // quelle rimaste appese vanno tolte.
    this.remapOpen((i) => (i < this.levels.length ? i : null));
    this.markOpen(this.activeLevelIndex);
    this.mountLevel();
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
        if (tool === 'brush') {
          this.selection.fillArea(this.placement.selected);
          this.noteUsed(this.placement.selected);
        } else this.selection.clearArea();
      });
      return;
    }
    this.setTool(tool);
  }

  private setTool(tool: Tool): void {
    this.tool = tool;
    if (tool === 'select') this.selection.show();
    else this.selection.hide();
    // Il fondale in mano vale finche' si resta sullo strumento: i suoi comandi
    // spariscono, e lasciarlo selezionato in silenzio sarebbe uno stato
    // invisibile che riemerge tornando qui.
    if (tool !== 'backdrop') this.pickedBackground = undefined;
    // Su telefono il pannello parte chiuso, e i comandi del fondale stanno
    // dentro: scegliere lo strumento senza vederli sarebbe uno strumento che
    // non fa niente. Si apre solo qui, e richiuderlo resta una decisione di
    // chi lo usa.
    else this.expandLayerPanel();
    this.refresh();
  }

  private expandLayerPanel(): void {
    if (!this.layerPanel.classList.contains('collapsed')) return;
    this.layerPanel.classList.remove('collapsed');
    this.collapseButton.textContent = '▾';
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

  /**
   * Apre e chiude il foglio dei comandi rari.
   *
   * La classe sta sulla barra e non sul foglio perche' e' il CSS a decidere se
   * il foglio si nasconde: sopra i 600px resta una riga sempre visibile, e ⋯
   * non compare nemmeno. Cosi' su schermo largo non si perde un tocco per
   * arrivare a Salva, e non ci sono due comportamenti da tenere allineati nel
   * codice — ce n'e' uno solo, e una media query.
   */
  private toggleMenu(): void {
    const open = this.root.classList.toggle('menu-open');
    this.menuButton.setAttribute('aria-expanded', String(open));
  }

  private closeMenu(): void {
    this.root.classList.remove('menu-open');
    this.menuButton.setAttribute('aria-expanded', 'false');
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
        align-items: center;
      }
      /* Il display flex batte l'attributo hidden: senza questa riga le due
         palette resterebbero visibili tutte e due. */
      #editor-toolbar .palette-strip[hidden] { display: none; }
      /* Un fondale e' largo e basso: l'anteprima quadrata dei blocchi lo
         ridurrebbe a una striscia illeggibile. */
      #editor-toolbar .fondali button.palette { width: 84px; }
      #editor-toolbar .fondali button.palette img { width: 72px; height: 40px; image-rendering: auto; }
      #editor-toolbar .hint { font-size: 12px; opacity: .7; margin: 0; }
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
      /* Il contagocce non ha un pulsante da premere: il lampo sulla palette e'
         tutto quello che dice che il tocco lungo ha funzionato. */
      #editor-toolbar button.palette.preso { animation: preso .6s ease-out; }
      @keyframes preso {
        0% { border-color: #ffd166; box-shadow: 0 0 0 0 #ffd166; }
        100% { box-shadow: 0 0 0 10px #ffd16600; }
      }
      /* Chi ha chiesto di non vedere animazioni tiene comunque il bordo acceso,
         che e' l'informazione: il lampo era solo il modo di darla. */
      @media (prefers-reduced-motion: reduce) {
        #editor-toolbar button.palette.preso { animation: none; border-color: #ffd166; }
      }
      #editor-toolbar button.palette span {
        font-size: 10px; opacity: .8; max-width: 100%;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      /* Dove lo spazio c'e', il foglio e' una riga come le altre e ⋯ non serve. */
      #editor-toolbar .menu { display: none; }
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
      /* Il pulsante dell'elenco non scorre via con le schede: con cento livelli
         e' la via d'accesso a tutto il resto. */
      #level-tabs .elenco { flex: 0 0 auto; min-height: 34px; padding: 0 10px; font-size: 16px; }
      /* Una scheda e' due pulsanti attaccati: il nome apre, la × chiude. */
      #level-tabs .tab {
        display: flex; flex: 0 0 auto; align-items: stretch;
        border: 1px solid #3a3a48; border-radius: 8px; background: #2f2f3d;
      }
      #level-tabs .tab.attiva { border-color: #ffd166; background: #4a4432; }
      #level-tabs .tab button { min-height: 34px; border: 0; background: none; border-radius: 8px; }
      #level-tabs .tab .nome { padding: 0 4px 0 12px; max-width: 40vw; overflow: hidden; text-overflow: ellipsis; }
      #level-tabs .tab.attiva .nome { color: #ffd166; }
      #level-tabs .tab .chiudi { padding: 0 8px; opacity: .6; font-size: 12px; }
      #level-tabs .tab .chiudi:hover:not(:disabled) { opacity: 1; background: #ffffff14; }

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
      /* Il display flex batte l'attributo hidden, come per le due palette:
         senza questa riga i comandi del fondale resterebbero sempre in vista. */
      #layer-panel .actions[hidden] { display: none; }
      #layer-panel .actions button { flex: 1 1 0; min-height: 34px; padding: 0; }
      /* La seconda sezione del pannello: una riga sopra, e si comprime insieme
         al resto. */
      #layer-panel .sezione {
        display: flex; flex-direction: column; gap: 6px;
        padding-top: 8px; border-top: 1px solid #3a3a48;
      }
      #layer-panel .sezione .list {
        flex-direction: column; max-height: 30vh; overflow-y: auto;
      }
      #layer-panel .sezione .row .name { flex: 1 1 auto; text-align: left; }
      #layer-panel.collapsed .list,
      #layer-panel.collapsed .actions,
      #layer-panel.collapsed .sezione { display: none; }
      #layer-panel .hint { font-size: 11px; opacity: .6; }

      /* Schermo stretto o basso: vedi COMPATTO. La barra a parole occupava il
         44% di un telefono, cioe' piu' della scena che si sta costruendo. Gli
         strumenti restano solo icone: sono sei, si imparano subito. */
      @media ${COMPATTO} {
        #editor-toolbar .tools .txt { display: none; }
        #editor-toolbar .tools button.azione .txt { display: inline; }
        #editor-toolbar .tools button { padding: 0 12px; font-size: 17px; }
        #editor-toolbar button, #layer-panel button, #level-tabs button { min-height: 38px; }
        /* Il foglio si apre con ⋯. Restano sempre in vista le due righe che si
           toccano di continuo — palette e strumenti — piu' annulla, zoom e il
           conteggio dei blocchi. */
        #editor-toolbar .menu { display: inline-block; }
        #editor-toolbar:not(.menu-open) .sheet { display: none; }
        /* Chiuso, il foglio si porta dentro anche la scritta "non salvato":
           il pallino su ⋯ e' quello che resta a dirlo. */
        #editor-toolbar .menu.dirty { border-color: #ffd166; color: #ffd166; }
        /* Il nome del layer porta anche il conteggio dei blocchi: stringendo
           la riga invece del pannello, non viene tagliato. */
        #layer-panel .row button { padding: 0 4px; }
        #layer-panel .row .quota { font-size: 12px; }
      }

      /* Schermo basso ma largo: il telefono girato.
         Li' impilare le righe e' lo spreco: di altezza non ce n'e' e di
         larghezza avanza. Le tre righe vanno in fila e la barra passa da 171 a
         una riga sola; la palette prende quello che resta e scorre, come ha
         sempre fatto. Se non ci sta, il wrap la rimanda a capo da sola e si
         torna al comportamento di prima invece di rompersi. */
      @media (max-height: 600px) and (min-width: 600px) {
        #editor-toolbar { flex-direction: row; flex-wrap: wrap; align-items: center; }
        #editor-toolbar .palette-strip { flex: 1 1 90px; min-width: 0; }
        /* Base piccola di proposito: la palette scorre gia', mentre i comandi
           che vanno a capo si portano dietro un'altra riga di schermo. Con 160
           il quinto strumento faceva traboccare la riga e la barra tornava a
           125px. */
        #editor-toolbar .controls { flex: 0 0 auto; }
        /* Il foglio aperto resta una riga tutta sua: e' l'unico momento in cui
           serve spazio, e dura il tempo di un comando. */
        #editor-toolbar .sheet { flex: 1 1 100%; }
      }
    `;
  }

  private buildToolbar(): void {
    this.root = document.createElement('div');
    this.root.id = 'editor-toolbar';
    this.root.innerHTML = `<style>${LevelEditor.style()}</style>`;

    // Riga 1: gli sprite usati di recente. Il catalogo intero sta nel cassetto
    // (l'icona 🎨 in alto): qui restano i pochi su cui si torna di continuo.
    const strip = document.createElement('div');
    strip.className = 'palette-strip';
    this.root.appendChild(strip);
    this.paletteStrip = strip;
    this.renderRecent();

    // La palette dei fondali sta accanto a quella dei blocchi e si alternano:
    // sono la stessa domanda — "cosa piazzo" — fatta da due strumenti diversi,
    // e due strisce contemporanee costerebbero una riga di schermo per niente.
    this.backdropStrip = document.createElement('div');
    this.backdropStrip.className = 'palette-strip fondali';
    this.root.appendChild(this.backdropStrip);

    for (const image of BACKGROUNDS) {
      const b = document.createElement('button');
      b.className = 'palette';
      b.title = image.label;
      b.innerHTML = `<img alt="" src="${this.textureSrc(image.id)}"><span>${image.label}</span>`;
      b.onclick = () => {
        this.chosenBackground = image.id;
        this.refresh();
      };
      this.backdropStrip.appendChild(b);
      this.backgroundButtons.set(image.id, b);
    }
    if (BACKGROUNDS.length === 0) {
      // Una striscia vuota sembrerebbe un guasto. Il rimedio e' una cartella,
      // e vale la pena dirlo invece di lasciarlo indovinare.
      const hint = document.createElement('p');
      hint.className = 'hint';
      hint.textContent = 'Nessun fondale: carica un\u2019immagine in src/assets/backgrounds/';
      this.backdropStrip.appendChild(hint);
    }
    this.chosenBackground = BACKGROUNDS[0]?.id ?? '';

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

    // Apre l'ultima riga, che su telefono sta chiusa. Esiste solo li': sotto i
    // 600px la barra occupava il 37% dello schermo, cioe' quasi quanto la scena
    // che si sta costruendo, e meta' di quello spazio era per comandi che si
    // toccano una volta a serata.
    this.menuButton = this.button('⋯', () => this.toggleMenu(), view);
    this.menuButton.className = 'menu';
    this.menuButton.setAttribute('aria-expanded', 'false');

    view.appendChild(Object.assign(document.createElement('span'), { className: 'spacer' }));
    this.countLabel = document.createElement('span');
    view.appendChild(this.countLabel);

    // Riga 4: vista, salvataggio ed esportazione — il "foglio".
    // Su schermo largo e' una riga come le altre; su telefono si apre con ⋯.
    const file = document.createElement('div');
    file.className = 'controls sheet';
    this.root.appendChild(file);

    // Chiude il foglio dopo un comando, cosi' la scena torna visibile senza un
    // secondo tocco. Fanno eccezione quelli marcati `keep`: la griglia si
    // accende e si spegne guardando il risultato, e Copia scrive li' dentro se
    // ha funzionato — chiudendo, quella risposta non si leggerebbe.
    file.addEventListener('click', (e) => {
      const button = (e.target as HTMLElement).closest('button');
      if (button && !button.dataset.keep) this.closeMenu();
    });

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
    grid.dataset.keep = '1';
    syncGridLabel();
    file.appendChild(grid);

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
    copy.dataset.keep = '1';
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

    // A sinistra, prima delle schede: il cassetto degli sprite. E' la domanda
    // "cosa piazzo", e sta dal lato da cui si comincia a leggere.
    const apriSprite = this.button('🎨', () => this.spriteDrawer.toggle(), this.tabBar);
    apriSprite.className = 'elenco sprite-toggle';
    apriSprite.title = 'Sprite: scegli cosa piazzare, per categoria; importa';

    this.tabList = document.createElement('div');
    this.tabList.className = 'tabs';
    this.tabBar.appendChild(this.tabList);

    // A destra, dopo le schede che riempiono il centro: l'elenco dei livelli.
    // Con cento livelli e' da qui che si arriva a tutto, mentre crea/duplica/
    // rinomina/elimina sono finiti dentro l'elenco, dove si vede su cosa agiscono.
    const apriElenco = this.button('📚', () => this.browser.toggle(), this.tabBar);
    apriElenco.className = 'elenco';
    apriElenco.title = 'Tutti i livelli: cerca, apri, crea, elimina';

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
    this.collapseButton = collapse;

    // Dove lo schermo e' stretto o basso parte gia' chiuso: aperto occupa
    // 228x168 sopra la scena, proprio l'angolo in cui l'origine isometrica
    // mette i primi blocchi — si costruiva sotto un pannello. Dove lo spazio
    // c'e', aprirlo ogni volta sarebbe un tocco in piu' per niente.
    //
    // Si guarda una volta sola, all'apertura: girare il telefono dopo non lo
    // richiude d'autorita', perche' a quel punto aperto o chiuso l'ha deciso
    // chi lo sta usando.
    if (window.matchMedia(COMPATTO).matches) {
      this.layerPanel.classList.add('collapsed');
      collapse.textContent = '▸';
    }

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

    this.buildBackdropSection();
    document.body.appendChild(this.layerPanel);
  }

  /**
   * I fondali del livello, sotto ai layer e nello stesso pannello.
   *
   * Stanno qui e non nella barra per due ragioni. La prima e' che questo
   * pannello **e' gia' la struttura del livello aperto** — i piani su cui si
   * costruisce — e un fondale e' esattamente quello: contenuto di questo
   * livello, non un comando dell'editor. La seconda e' che un elenco dice da
   * solo che se ne puo' mettere piu' di uno, mentre con i soli pulsanti nella
   * barra bisognava scoprirlo toccando un punto vuoto.
   *
   * I comandi di scala, rotazione e ordine sono qui sotto e non nella barra
   * perche' la barra era cresciuta di 54px appena si prendeva un'immagine, e
   * su telefono quello spazio e' la scena.
   */
  private buildBackdropSection(): void {
    const section = document.createElement('div');
    section.className = 'sezione';
    this.layerPanel.appendChild(section);

    const head = document.createElement('div');
    head.className = 'head';
    this.backdropTitle = document.createElement('strong');
    this.backdropTitle.textContent = 'Fondali';
    head.appendChild(this.backdropTitle);
    section.appendChild(head);

    this.button('+', () => this.addBackgroundAtCenter(), head).title =
      'Aggiungi al centro della vista il fondale scelto nella palette';

    this.backdropList = document.createElement('div');
    this.backdropList.className = 'list';
    section.appendChild(this.backdropList);

    this.backdropActions = document.createElement('div');
    this.backdropActions.className = 'actions';
    section.appendChild(this.backdropActions);

    const bd = this.backdropActions;
    this.button('－', () => this.scaleBackground(1 / BACKDROP_SCALE_STEP), bd).title =
      'Rimpicciolisci il fondale';
    this.button('＋', () => this.scaleBackground(BACKDROP_SCALE_STEP), bd).title =
      'Ingrandisci il fondale';
    this.button('↺', () => this.rotateBackground(-BACKDROP_ROTATE_STEP), bd).title =
      `Ruota di ${BACKDROP_ROTATE_STEP} gradi in senso antiorario`;
    this.button('↻', () => this.rotateBackground(BACKDROP_ROTATE_STEP), bd).title =
      `Ruota di ${BACKDROP_ROTATE_STEP} gradi in senso orario`;
    this.button('⤓', () => this.reorderBackground(-1), bd).title =
      'Manda il fondale dietro agli altri';
    this.button('⤒', () => this.reorderBackground(1), bd).title =
      'Porta il fondale davanti agli altri fondali';
    this.button('🗑', () => this.removeBackground(), bd).title =
      'Togli questo fondale dal livello';
  }

  /**
   * Ricostruisce l'elenco dei fondali. Come per i layer: sono pochi, e rifarlo
   * e' piu' sicuro che aggiornarlo.
   */
  private refreshBackdrops(): void {
    const labels = this.scene.backdrop.labels();
    this.backdropTitle.textContent = labels.length > 0 ? `Fondali (${labels.length})` : 'Fondali';

    this.backdropList.textContent = '';
    if (labels.length === 0) {
      const hint = document.createElement('p');
      hint.className = 'hint';
      hint.textContent = 'Nessuno. Con 🖼 tocca la scena, o usa +';
      this.backdropList.appendChild(hint);
    }

    // Dall'ultimo al primo: in cima all'elenco c'e' quello disegnato davanti,
    // come per i layer.
    for (let i = labels.length - 1; i >= 0; i--) {
      const row = document.createElement('div');
      row.className = 'row';
      const pick = this.button(labels[i]!, () => this.chooseBackground(i), row);
      pick.className = 'name';
      pick.setAttribute('aria-pressed', String(i === this.pickedBackground));
      this.backdropList.appendChild(row);
    }

    this.backdropActions.hidden = this.pickedBackground === undefined;
  }

  /** Sceglie un fondale dall'elenco, e passa allo strumento che lo manovra. */
  private chooseBackground(index: number): void {
    this.pickedBackground = index;
    if (this.tool !== 'backdrop') this.setTool('backdrop');
    else this.refresh();
  }

  /**
   * Aggiunge un fondale al centro di quello che si sta guardando.
   *
   * E' la via alternativa al tocco sulla scena, e serve quando la vista e'
   * gia' coperta da un'altra immagine: li' il tocco prenderebbe quella.
   */
  private addBackgroundAtCenter(): void {
    if (this.chosenBackground === '') return;
    const cam = this.scene.cameras.main;
    const center = cam.getWorldPoint(this.scene.scale.width / 2, this.scene.scale.height / 2);

    this.edit(() => {
      const index = this.scene.backdrop.add(this.chosenBackground, center.x, center.y);
      if (index >= 0) this.pickedBackground = index;
    });
    if (this.tool !== 'backdrop') this.setTool('backdrop');
  }

  private rotateBackground(degrees: number): void {
    const index = this.pickedBackground;
    if (index === undefined) return;
    this.edit(() => this.scene.backdrop.rotateBy(index, degrees));
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
  /**
   * Ricostruisce le schede: **solo i livelli aperti**, non tutti.
   *
   * Con cento livelli una striscia da cento pulsanti non e' navigabile, e
   * nemmeno con venti. Le schede sono i due o tre fra cui si sta andando avanti
   * e indietro; per gli altri c'e' 📚.
   */
  private refreshTabs(): void {
    this.tabList.textContent = '';
    for (const index of this.openLevels) {
      const level = this.levels[index];
      if (!level) continue;

      const tab = document.createElement('div');
      tab.className = 'tab';
      if (index === this.activeLevelIndex) tab.classList.add('attiva');

      const apri = this.button(level.name, () => this.openLevel(index), tab);
      apri.className = 'nome';
      apri.setAttribute('aria-pressed', String(index === this.activeLevelIndex));

      // La × chiude la scheda e non tocca il livello, che resta nell'elenco.
      // L'ultima non si chiude: la scena disegna sempre un livello.
      const chiudi = this.button('✕', () => this.closeLevel(index), tab);
      chiudi.className = 'chiudi';
      chiudi.title = `Chiudi la scheda "${level.name}" (il livello resta)`;
      chiudi.disabled = this.openLevels.length <= 1;

      this.tabList.appendChild(tab);
    }
    this.browser.refresh();
  }

  /** L'elenco come lo vede il pannello 📚. */
  private browserLevels(): BrowserLevel[] {
    return this.levels.map((level, index) => ({
      name: level.name,
      // Il livello aperto si conta dalla scena: e' li' che sta il lavoro non
      // ancora riletto, e un conteggio vecchio di una pennellata si nota.
      blocks:
        index === this.activeLevelIndex
          ? this.placement.count
          : level.layers.reduce((n, layer) => n + layer.blocks.length, 0),
      open: this.openLevels.includes(index),
      active: index === this.activeLevelIndex,
    }));
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

    // La palette dice cosa si sta per piazzare, e dipende dallo strumento.
    const fondali = this.tool === 'backdrop';
    this.paletteStrip.hidden = fondali;
    this.backdropStrip.hidden = !fondali;
    for (const [type, button] of this.paletteButtons) {
      button.setAttribute('aria-pressed', String(this.placement.selected === type));
    }
    for (const [id, button] of this.backgroundButtons) {
      button.setAttribute('aria-pressed', String(this.chosenBackground === id));
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

    // Su telefono lo stato per esteso e' dentro il foglio chiuso: senza questo,
    // "non salvato" non lo direbbe piu' nessuno.
    this.menuButton.classList.toggle('dirty', this.dirty);
    this.menuButton.title = this.dirty
      ? 'Altri comandi — lavoro non salvato'
      : 'Altri comandi: griglia, salva, apri, scarica';

    if (this.saveFailed) {
      // Non e' un dettaglio da nascondere in un angolo: da qui in poi l'unico
      // posto sicuro dove mettere il lavoro e' il file scaricato.
      this.statusLabel.textContent = '⚠ memoria piena: usa Scarica';
      this.statusLabel.classList.add('dirty');
    } else if (!this.storage.available) {
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
    this.refreshBackdrops();
  }
}
