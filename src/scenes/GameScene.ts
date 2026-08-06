import Phaser from 'phaser';
import { GRID, TIMING, BLOCKS, Z, RANGES, PLAYER, JOYSTICK, type BlockType } from '../config';
import { GridPlacement } from '../mechanics/GridPlacement';
import { Player } from '../mechanics/Player';
import { VirtualJoystick } from '../mechanics/VirtualJoystick';
import { LevelEditor } from '../editor/LevelEditor';

interface LevelData {
  blocks: { col: number; row: number; type: BlockType }[];
}

/** Modalita' editor: si attiva con ?editor=1 nell'URL. */
const EDITOR_MODE = new URLSearchParams(location.search).has('editor');

export class GameScene extends Phaser.Scene {
  private placement!: GridPlacement;
  private hitbox!: Phaser.GameObjects.Rectangle;
  private breakBar!: Phaser.GameObjects.Rectangle;
  private hud!: Phaser.GameObjects.Text;
  private editor?: LevelEditor;
  private player?: Player;
  private joystick?: VirtualJoystick;
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
    this.hitbox = this.add
      .rectangle(0, 0, GRID.cellSize, GRID.cellSize)
      .setStrokeStyle(2, 0xffd166)
      .setDepth(Z.placeHitbox)
      .setVisible(false);

    // Barra di avanzamento della rottura.
    this.breakBar = this.add
      .rectangle(0, 0, GRID.cellSize, 4, 0xff5c5c)
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
      this.player = new Player(this, this.scale.width / 2, this.scale.height / 2);
      this.joystick = new VirtualJoystick(this);
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

  /** Griglia di riferimento, allineata all'offset (16,16) del terreno. */
  private drawGrid(): void {
    const g = this.add.graphics().setDepth(-1000);
    g.lineStyle(1, 0x2f2f3d, 1);

    const { width, height } = this.scale;
    for (let x = GRID.offsetX; x <= width; x += GRID.cellSize) {
      g.lineBetween(x, 0, x, height);
    }
    for (let y = GRID.offsetY; y <= height; y += GRID.cellSize) {
      g.lineBetween(0, y, width, y);
    }
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

      // Cella occupata -> inizia a rompere. Cella vuota -> piazza subito.
      if (this.placement.isOccupied(col, row)) {
        this.placement.beginBreak(col, row);
      } else {
        this.placement.place(col, row);
        this.refreshHud();
      }
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

    // 1 / 2 per cambiare slot di inventario.
    this.input.keyboard?.on('keydown-ONE', () => this.select('block_0'));
    this.input.keyboard?.on('keydown-TWO', () => this.select('block_1'));
  }

  /** Evidenzia la cella sotto il puntatore. Attiva in entrambe le modalita'. */
  private bindCellPreview(): void {
    this.input.on(Phaser.Input.Events.POINTER_MOVE, (p: Phaser.Input.Pointer) => {
      if (this.joystick?.owns(p)) return;

      const { col, row } = GridPlacement.worldToCell(p.worldX, p.worldY);
      const { x, y } = GridPlacement.cellToWorld(col, row);
      // Giallo se ci puoi costruire, rosso se sei troppo lontano.
      this.hitbox
        .setPosition(x, y)
        .setVisible(true)
        .setStrokeStyle(2, this.inRange(col, row) ? 0xffd166 : 0xff5c5c);
    });
  }

  private select(type: BlockType): void {
    this.placement.selected = type;
    this.refreshHud();
  }

  private refreshHud(): void {
    if (this.editor) {
      this.hud.setText(`MODALITA EDITOR\nesci togliendo ?editor=1 dall URL`);
      return;
    }

    const label = BLOCKS[this.placement.selected].label;
    this.hud.setText(
      [
        `Slot: ${label}  (1 / 2 per cambiare)`,
        `Blocchi: ${this.placement.count}`,
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
        .setPosition(this.hitbox.x - GRID.cellSize / 2, this.hitbox.y + GRID.cellSize / 2 + 6)
        .setDisplaySize(GRID.cellSize * progress, 4);
    } else {
      this.breakBar.setVisible(false);
    }
  }
}
