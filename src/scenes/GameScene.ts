import Phaser from 'phaser';
import { GRID, ISO, TIMING, Z, RANGES, INVENTORY } from '../config';
import { BACKGROUNDS, BLOCKS, CHARACTERS, UI, blockLabel } from '../assets/catalog';
import { projection } from '../grid/projection';
import { GridPlacement } from '../mechanics/GridPlacement';
import { Backdrop } from './Backdrop';
import { normalizeProject, pickLevel, type SerializedProject } from '../level/project';
import { Player } from '../mechanics/Player';
import { VirtualJoystick } from '../mechanics/VirtualJoystick';
import { Inventory } from '../mechanics/Inventory';
import { InventoryBar } from '../ui/InventoryBar';
import { LevelEditor } from '../editor/LevelEditor';

const PARAMS = new URLSearchParams(location.search);

/** Modalita' editor: si attiva con ?editor=1 nell'URL. */
const EDITOR_MODE = PARAMS.has('editor');

export class GameScene extends Phaser.Scene {
  private placement!: GridPlacement;
  /** I fondali del livello montato. Pubblico: e' l'editor a piazzarli. */
  backdrop!: Backdrop;
  /** Tutti i livelli del file: il gioco ne monta uno, l'editor li apre tutti. */
  private project!: SerializedProject;
  /** Le celle sono rombi, quindi l'evidenziazione e' un poligono, non un rettangolo. */
  private hitbox!: Phaser.GameObjects.Graphics;
  private gridLines!: Phaser.GameObjects.Graphics;
  private breakBar!: Phaser.GameObjects.Rectangle;
  private hud!: Phaser.GameObjects.Text;
  private editor?: LevelEditor;
  private player?: Player;
  private joystick?: VirtualJoystick;
  private inventory?: Inventory;
  private inventoryBar?: InventoryBar;
  private keys?: Record<'up' | 'down' | 'left' | 'right', Phaser.Input.Keyboard.Key>;
  private readonly moveVector = new Phaser.Math.Vector2();
  private pointerHeld = false;

  constructor() {
    super('GameScene');
  }

  /**
   * Nessun percorso scritto a mano: il catalogo e' generato da Vite dal
   * contenuto di `src/assets/`, e la chiave della texture e' il nome del file.
   * Un PNG nuovo in `src/assets/blocks/` e' caricato e piazzabile senza che
   * questa funzione cambi.
   */
  preload(): void {
    for (const asset of [...BLOCKS, ...BACKGROUNDS, ...CHARACTERS, ...UI]) {
      this.load.image(asset.id, asset.url);
    }
    this.load.json('level', 'level.json');
  }

  create(): void {
    this.drawGrid();

    this.placement = new GridPlacement(this);
    this.backdrop = new Backdrop(this);
    this.loadLevel();

    // Anteprima della cella sotto il dito/mouse.
    this.hitbox = this.add.graphics().setDepth(Z.placeHitbox).setVisible(false);

    // Barra di avanzamento della rottura.
    this.breakBar = this.add
      .rectangle(0, 0, ISO.tileWidth, 4, 0xff5c5c)
      .setOrigin(0, 0.5)
      .setDepth(Z.placeHitbox)
      .setVisible(false);

    this.hud = this.add
      .text(8, 8, '', { fontFamily: 'monospace', fontSize: '14px', color: '#e8e8ef' })
      .setScrollFactor(0)
      .setDepth(Z.placeHitbox);

    this.bindCellPreview();
    if (EDITOR_MODE) {
      // In editor niente personaggio: si guarda la scena dall'alto e si
      // costruisce ovunque, senza il vincolo di portata.
      this.editor = new LevelEditor(this, this.placement, this.project);
    } else {
      this.player = new Player(this, this.scale.width / 2, this.scale.height / 2);
      this.joystick = new VirtualJoystick(this);

      this.inventory = new Inventory();
      // Scorta di partenza, cosi' si puo' costruire subito. Presa dal catalogo
      // e non da un elenco cablato: un blocco caricato oggi e' in mano al
      // giocatore alla prossima build, senza toccare questa riga.
      for (const block of BLOCKS.slice(0, INVENTORY.slots)) this.inventory.add(block.id, 20);
      this.inventoryBar = new InventoryBar(this, this.inventory);

      // Il joystick deve stare sopra la barra: su telefono si sovrapporrebbero.
      const liftJoystick = () => this.joystick?.setBottomInset(this.inventoryBar?.height ?? 0);
      liftJoystick();
      // Registrato dopo quello di InventoryBar, che ricalcola prima la sua altezza.
      this.scale.on(Phaser.Scale.Events.RESIZE, liftJoystick);

      // Rompere un blocco lo restituisce all'inventario.
      this.placement.onBlockBroken = (type) => {
        this.inventory?.add(type);
        this.inventoryBar?.refresh();
        this.refreshHud();
      };

      this.keys = this.input.keyboard?.addKeys({
        up: Phaser.Input.Keyboard.KeyCodes.W,
        down: Phaser.Input.Keyboard.KeyCodes.S,
        left: Phaser.Input.Keyboard.KeyCodes.A,
        right: Phaser.Input.Keyboard.KeyCodes.D,
      }) as Record<'up' | 'down' | 'left' | 'right', Phaser.Input.Keyboard.Key> | undefined;
      this.bindInput();
    }
    this.refreshHud();
  }

  /** True se la cella e' abbastanza vicina al Player per costruirci. */
  private inRange(col: number, row: number): boolean {
    if (!this.player) return true;
    const { x, y } = GridPlacement.cellToWorld(col, row);
    return Phaser.Math.Distance.Between(this.player.x, this.player.y, x, y) <= RANGES.placementRange;
  }

  /** Direzione di marcia: joystick se attivo, altrimenti WASD. */
  private readMoveVector(): Phaser.Math.Vector2 {
    const v = this.moveVector.set(0, 0);

    if (this.joystick && (this.joystick.direction.x !== 0 || this.joystick.direction.y !== 0)) {
      return v.copy(this.joystick.direction);
    }

    if (this.keys) {
      if (this.keys.left.isDown) v.x -= 1;
      if (this.keys.right.isDown) v.x += 1;
      if (this.keys.up.isDown) v.y -= 1;
      if (this.keys.down.isDown) v.y += 1;
      if (v.x !== 0 || v.y !== 0) v.normalize();
    }
    return v;
  }

  /**
   * Griglia di riferimento. Disegna il perimetro di ogni cella invece di
   * linee da bordo a bordo: cosi' funziona con qualsiasi proiezione, rombi
   * compresi, senza sapere che forma abbiano.
   */
  private drawGrid(): void {
    this.gridLines = this.add.graphics().setDepth(Z.grid);
    this.gridLines.lineStyle(1, 0x2f2f3d, 1);

    for (let row = GRID.drawFrom; row <= GRID.drawTo; row++) {
      for (let col = GRID.drawFrom; col <= GRID.drawTo; col++) {
        const points = projection.cellOutline(col, row);
        this.gridLines.strokePoints(points, true);
      }
    }
  }

  /** Mostra o nasconde le linee della griglia. Usato dal bottone nell'editor. */
  setGridVisible(visible: boolean): void {
    this.gridLines.setVisible(visible);
  }

  get gridVisible(): boolean {
    return this.gridLines.visible;
  }

  /**
   * Evidenzia il rombo della cella indicata.
   *
   * `yOffset` alza il contorno all'altezza del layer su cui si sta costruendo:
   * senza, con un layer elevato il cursore resterebbe a terra e si costruirebbe
   * alla cieca.
   */
  private highlightCell(col: number, row: number, color: number, yOffset = 0): void {
    this.hitbox.clear();
    this.hitbox.lineStyle(2, color, 1);
    const outline = projection.cellOutline(col, row).map((p) => ({ x: p.x, y: p.y + yOffset }));
    this.hitbox.strokePoints(outline, true);
    this.hitbox.setVisible(true);
  }

  /**
   * Carica il progetto da `level.json` e monta il livello richiesto.
   *
   * Il file contiene tutti i livelli; `?level=` sceglie quale giocare, per
   * nome o per numero. La normalizzazione accetta anche i formati vecchi, e la
   * validazione dei tipi di blocco sta dentro `spawn()`: gli id esistono solo
   * alla build, quindi un file che nomina un blocco cancellato va scartato a
   * runtime, non dal compilatore.
   */
  private loadLevel(): void {
    this.project = normalizeProject(this.cache.json.get('level'));
    const level = pickLevel(this.project, PARAMS.get('level'));
    this.placement.loadLayers(level.layers);
    // Anche in gioco, non solo in editor: e' la stessa ragione per cui
    // l'editor disegna attraverso questa scena.
    this.backdrop.load(level.backgrounds);
  }

  private bindInput(): void {
    this.input.on(Phaser.Input.Events.POINTER_DOWN, (p: Phaser.Input.Pointer) => {
      // Il dito che guida il joystick non piazza e non rompe.
      if (this.joystick?.owns(p)) return;

      this.pointerHeld = true;
      const { col, row } = this.cellUnder(p);
      if (!this.inRange(col, row)) return;

      // Cella occupata -> inizia a rompere il blocco piu' in alto.
      // Cella vuota -> piazza subito.
      if (this.placement.topBlockAt(col, row)) {
        this.placement.beginBreak(col, row);
        return;
      }

      // In gioco non esiste un "layer attivo": il blocco va dove poggerebbe,
      // cioe' sul primo piano libero della pila.
      const layer = this.placement.nextStackLayer(col, row);
      if (layer === undefined) return;

      // Si controlla prima se il piazzamento e' possibile: altrimenti il
      // blocco verrebbe scalato dall'inventario e perso.
      if (!this.placement.canPlace(col, row, layer)) return;

      const type = this.inventory?.consumeSelected();
      if (!type) return;

      this.placement.place(col, row, type, layer);
      this.inventoryBar?.refresh();
      this.refreshHud();
    });

    this.input.on(Phaser.Input.Events.POINTER_UP, () => {
      this.pointerHeld = false;
      this.placement.cancelBreak();
      this.refreshHud();
    });

    this.input.on(Phaser.Input.Events.POINTER_MOVE, (p: Phaser.Input.Pointer) => {
      const { col, row } = this.cellUnder(p);

      // Se il dito scivola su un'altra cella, la rottura riparte da capo.
      if (this.pointerHeld && this.placement.topBlockAt(col, row)) {
        this.placement.beginBreak(col, row);
      } else if (this.pointerHeld) {
        this.placement.cancelBreak();
      }
    });

    // La selezione degli slot (tasti 1..8) e' gestita da InventoryBar.
  }

  /** Di quanti pixel e' alzato il piano su cui si sta lavorando. */
  get activeElevationY(): number {
    const layer = this.placement.layers[this.placement.activeLayer];
    return projection.elevationOffsetY(layer?.elevation ?? 0);
  }

  /**
   * La cella sotto il puntatore, letta **sul piano attivo**.
   *
   * Su un layer alzato la cella che si vede sotto il dito non e' quella che sta
   * a terra in quel punto dello schermo: va tolta l'alzata prima di invertire
   * la proiezione. In gioco il piano attivo e' il terreno, quindi l'alzata e'
   * zero e questa e' la conversione di sempre.
   */
  cellUnder(p: Phaser.Input.Pointer): { col: number; row: number } {
    return GridPlacement.worldToCell(p.worldX, p.worldY - this.activeElevationY);
  }

  /** Evidenzia la cella sotto il puntatore. Attiva in entrambe le modalita'. */
  private bindCellPreview(): void {
    this.input.on(Phaser.Input.Events.POINTER_MOVE, (p: Phaser.Input.Pointer) => {
      if (this.joystick?.owns(p)) return;

      const { col, row } = this.cellUnder(p);
      // Giallo se ci puoi costruire, rosso se sei troppo lontano.
      this.highlightCell(col, row, this.inRange(col, row) ? 0xffd166 : 0xff5c5c, this.activeElevationY);
    });
  }

  private refreshHud(): void {
    if (this.editor) {
      // In editor l'HUD sparisce: su telefono finiva sotto il pannello dei
      // layer, e la toolbar dice gia' tutto quello che diceva lui.
      this.hud.setVisible(false);
      return;
    }

    const type = this.inventory?.selectedType;
    const label = type ? blockLabel(type) : 'vuoto';
    this.hud.setText(
      [
        `Slot ${(this.inventory?.selected ?? 0) + 1}: ${label}  (tasti 1-8)`,
        `Blocchi in scena: ${this.placement.count}`,
        `Tocca vuoto = piazza | Tieni premuto ${TIMING.breakTimeMs / 1000}s = rompi`,
        `Muoviti col joystick o WASD | portata ${RANGES.placementRange}px`,
      ].join('\n'),
    );
  }

  override update(_time: number, delta: number): void {
    this.player?.update(delta, this.readMoveVector());
    this.placement.update();

    const progress = this.placement.breakProgress;
    // La barra segue il blocco e non la cella: su un layer alzato i due punti
    // non coincidono piu'.
    const center = this.placement.breakTargetCenter;
    if (progress > 0 && center) {
      this.breakBar
        .setVisible(true)
        .setPosition(center.x - ISO.tileWidth / 2, center.y + ISO.tileHeight / 2 + 6)
        .setDisplaySize(ISO.tileWidth * progress, 4);
    } else {
      this.breakBar.setVisible(false);
    }
  }
}
