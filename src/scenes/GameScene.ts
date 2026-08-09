import Phaser from 'phaser';
import { GRID, ISO, TIMING, BLOCKS, Z, RANGES, PLAYER, JOYSTICK, CAMERA, type BlockType } from '../config';
import { projection, gridBounds } from '../grid/projection';
import { GridPlacement } from '../mechanics/GridPlacement';
import { GridCollision } from '../mechanics/GridCollision';
import { Player } from '../mechanics/Player';
import { VirtualJoystick } from '../mechanics/VirtualJoystick';
import { Inventory } from '../mechanics/Inventory';
import { InventoryBar } from '../ui/InventoryBar';
import { LevelEditor } from '../editor/LevelEditor';

interface LevelData {
  blocks: { col: number; row: number; type: BlockType }[];
}

/** Modalita' editor: si attiva con ?editor=1 nell'URL. */
const EDITOR_MODE = new URLSearchParams(location.search).has('editor');

export class GameScene extends Phaser.Scene {
  private placement!: GridPlacement;
  /** Le celle sono rombi, quindi l'evidenziazione e' un poligono, non un rettangolo. */
  private hitbox!: Phaser.GameObjects.Graphics;
  private gridLines!: Phaser.GameObjects.Graphics;
  private hoverCenter = new Phaser.Math.Vector2();
  private breakBar!: Phaser.GameObjects.Rectangle;
  private hud!: Phaser.GameObjects.Text;
  private editor?: LevelEditor;
  private player?: Player;
  private collision?: GridCollision;
  private joystick?: VirtualJoystick;
  private inventory?: Inventory;
  private inventoryBar?: InventoryBar;
  private keys?: Record<'up' | 'down' | 'left' | 'right', Phaser.Input.Keyboard.Key>;
  private readonly moveVector = new Phaser.Math.Vector2();
  private pointerHeld = false;

  constructor() {
    super('GameScene');
  }

  preload(): void {
    this.load.image('block_normal', 'assets/block_normal.png');
    this.load.image('block_stack', 'assets/block_stack.png');
    this.load.image(PLAYER.texture, 'assets/Gemini_Generated_Image_ic56toic56toic56-removebg-preview.png');
    this.load.image(JOYSTICK.borderTexture, 'assets/Transparent dark joystick border2.png');
    this.load.image(JOYSTICK.thumbTexture, 'assets/Transparent dark joystick thumb2.png');
    this.load.json('level', 'level.json');
  }

  create(): void {
    this.drawGrid();

    this.placement = new GridPlacement(this);
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
      this.editor = new LevelEditor(this, this.placement);
    } else {
      // I blocchi diventano invalicabili, e con loro il bordo della griglia.
      // Il predicato interroga GridPlacement dal vivo, quindi un blocco
      // piazzato adesso ferma subito, e uno rotto libera subito il passaggio:
      // nessuna mappa di collisione da tenere allineata.
      this.collision = new GridCollision(
        (col, row) => !GameScene.insideGrid(col, row) || this.placement.isOccupied(col, row),
        PLAYER.colliderRadius,
      );

      const spawn = this.spawnPoint();
      this.player = new Player(this, spawn.x, spawn.y, this.collision);
      this.setupCamera(this.player.sprite);
      this.joystick = new VirtualJoystick(this);

      this.inventory = new Inventory();
      // Scorta di partenza, cosi' si puo' costruire subito.
      this.inventory.add('block_0', 20);
      this.inventory.add('block_1', 5);
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

  /** True se la cella cade dentro la griglia disegnata. Fuori c'e' solo vuoto. */
  private static insideGrid(col: number, row: number): boolean {
    return (
      col >= GRID.drawFrom && col <= GRID.drawTo && row >= GRID.drawFrom && row <= GRID.drawTo
    );
  }

  /**
   * La camera insegue il personaggio.
   *
   * Tre scelte, tutte per lo stesso motivo — che l'inseguimento non si noti:
   *
   * - il **riquadro morto** al centro fa si' che camminare avanti e indietro
   *   di poco non muova affatto la vista;
   * - il **ritardo** (`lerp`) evita che ogni passo scuota lo schermo;
   * - `roundPixels` tiene la camera su coordinate intere: su pixel art una
   *   camera frazionaria fa tremolare i bordi di ogni sprite.
   *
   * I limiti impediscono di inquadrare il vuoto oltre la griglia. Non tocca
   * la modalita' editor, che la camera se la guida da sola (zoom e
   * trascinamento della vista).
   */
  private setupCamera(target: Phaser.GameObjects.Sprite): void {
    const cam = this.cameras.main;
    const pad = CAMERA.boundsPaddingCells;
    const b = gridBounds(
      GRID.drawFrom - pad,
      GRID.drawTo + pad,
      GRID.drawFrom - pad,
      GRID.drawTo + pad,
    );

    cam.setBounds(b.x, b.y, b.width, b.height);
    cam.setDeadzone(CAMERA.deadZoneWidth, CAMERA.deadZoneHeight);
    cam.startFollow(target, true, CAMERA.lerp, CAMERA.lerp);
  }

  /**
   * Dove compare il personaggio.
   *
   * Prima era il centro dello schermo, che con la camera ferma coincideva col
   * centro del mondo. Ora che la camera segue, quel punto dipendeva dalla
   * dimensione dello schermo: su telefono si compariva in una cella diversa
   * che su desktop. Si parte invece dal baricentro dei blocchi del livello,
   * cosi' la prima inquadratura mostra quello che e' stato costruito invece
   * di un angolo di griglia vuota. Se `findFreeSpot` trova occupato, si
   * sposta lui.
   */
  private spawnPoint(): { x: number; y: number } {
    const blocks = this.placement.list();
    if (blocks.length === 0) {
      const middle = Math.round((GRID.drawFrom + GRID.drawTo) / 2);
      return GridPlacement.cellToWorld(middle, middle);
    }

    const col = blocks.reduce((sum, b) => sum + b.col, 0) / blocks.length;
    const row = blocks.reduce((sum, b) => sum + b.row, 0) / blocks.length;
    return GridPlacement.cellToWorld(Math.round(col), Math.round(row));
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
    this.gridLines = this.add.graphics().setDepth(-1000);
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

  /** Evidenzia il rombo della cella indicata. */
  private highlightCell(col: number, row: number, color: number): void {
    this.hitbox.clear();
    this.hitbox.lineStyle(2, color, 1);
    this.hitbox.strokePoints(projection.cellOutline(col, row), true);
    this.hitbox.setVisible(true);
  }

  /** Carica la disposizione iniziale da level.json. */
  private loadLevel(): void {
    const level = this.cache.json.get('level') as LevelData | undefined;
    if (!level?.blocks) return;

    for (const b of level.blocks) {
      if (b.type in BLOCKS) this.placement.spawn(b.col, b.row, b.type);
    }
  }

  private bindInput(): void {
    this.input.on(Phaser.Input.Events.POINTER_DOWN, (p: Phaser.Input.Pointer) => {
      // Il dito che guida il joystick non piazza e non rompe.
      if (this.joystick?.owns(p)) return;

      this.pointerHeld = true;
      const { col, row } = GridPlacement.worldToCell(p.worldX, p.worldY);
      if (!this.inRange(col, row)) return;
      // Fuori dalla griglia il bordo e' invalicabile: un blocco piazzato li'
      // non si potrebbe piu' ne' raggiungere ne' rompere.
      if (!GameScene.insideGrid(col, row)) return;

      // Cella occupata -> inizia a rompere. Cella vuota -> piazza subito.
      if (this.placement.isOccupied(col, row)) {
        this.placement.beginBreak(col, row);
        return;
      }

      // Non ci si mura addosso: la cella su cui si poggia resta libera.
      // Senza questo controllo, ora che i blocchi fermano, ci si potrebbe
      // chiudere dentro il proprio stesso piazzamento.
      if (this.player && this.collision?.touches(this.player.x, this.player.y, col, row)) return;

      // Si controlla prima se il piazzamento e' possibile: altrimenti il
      // blocco verrebbe scalato dall'inventario e perso.
      if (!this.placement.canPlace(col, row)) return;

      const type = this.inventory?.consumeSelected();
      if (!type) return;

      this.placement.place(col, row, type);
      this.inventoryBar?.refresh();
      this.refreshHud();
    });

    this.input.on(Phaser.Input.Events.POINTER_UP, () => {
      this.pointerHeld = false;
      this.placement.cancelBreak();
      this.refreshHud();
    });

    this.input.on(Phaser.Input.Events.POINTER_MOVE, (p: Phaser.Input.Pointer) => {
      const { col, row } = GridPlacement.worldToCell(p.worldX, p.worldY);

      // Se il dito scivola su un'altra cella, la rottura riparte da capo.
      if (this.pointerHeld && this.placement.isOccupied(col, row)) {
        this.placement.beginBreak(col, row);
      } else if (this.pointerHeld) {
        this.placement.cancelBreak();
      }
    });

    // La selezione degli slot (tasti 1..8) e' gestita da InventoryBar.
  }

  /** Evidenzia la cella sotto il puntatore. Attiva in entrambe le modalita'. */
  private bindCellPreview(): void {
    this.input.on(Phaser.Input.Events.POINTER_MOVE, (p: Phaser.Input.Pointer) => {
      if (this.joystick?.owns(p)) return;

      const { col, row } = GridPlacement.worldToCell(p.worldX, p.worldY);
      const { x, y } = GridPlacement.cellToWorld(col, row);
      this.hoverCenter.set(x, y);
      // Giallo se ci puoi costruire, rosso se sei troppo lontano o fuori griglia.
      const buildable = this.inRange(col, row) && (this.editor !== undefined || GameScene.insideGrid(col, row));
      this.highlightCell(col, row, buildable ? 0xffd166 : 0xff5c5c);
    });
  }

  private refreshHud(): void {
    if (this.editor) {
      this.hud.setText(`MODALITA EDITOR\nesci togliendo ?editor=1 dall URL`);
      return;
    }

    const type = this.inventory?.selectedType;
    const label = type ? BLOCKS[type].label : 'vuoto';
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
    if (progress > 0) {
      this.breakBar
        .setVisible(true)
        .setPosition(this.hoverCenter.x - ISO.tileWidth / 2, this.hoverCenter.y + ISO.tileHeight / 2 + 6)
        .setDisplaySize(ISO.tileWidth * progress, 4);
    } else {
      this.breakBar.setVisible(false);
    }
  }
}
