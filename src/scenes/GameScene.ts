import Phaser from 'phaser';
import { GRID, TIMING, BLOCKS, Z, type BlockType } from '../config';
import { GridPlacement } from '../mechanics/GridPlacement';

interface LevelData {
  blocks: { col: number; row: number; type: BlockType }[];
}

export class GameScene extends Phaser.Scene {
  private placement!: GridPlacement;
  private hitbox!: Phaser.GameObjects.Rectangle;
  private breakBar!: Phaser.GameObjects.Rectangle;
  private hud!: Phaser.GameObjects.Text;
  private pointerHeld = false;

  constructor() {
    super('GameScene');
  }

  preload(): void {
    this.load.image('block_normal', 'assets/block_normal.png');
    this.load.image('block_stack', 'assets/block_stack.png');
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

    this.bindInput();
    this.refreshHud();
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
      this.pointerHeld = true;
      const { col, row } = GridPlacement.worldToCell(p.worldX, p.worldY);
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
      const { x, y } = GridPlacement.cellToWorld(col, row);
      this.hitbox.setPosition(x, y).setVisible(true);

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

  private select(type: BlockType): void {
    this.placement.selected = type;
    this.refreshHud();
  }

  private refreshHud(): void {
    const label = BLOCKS[this.placement.selected].label;
    this.hud.setText(
      [
        `Slot: ${label}  (1 / 2 per cambiare)`,
        `Blocchi: ${this.placement.count}`,
        `Tocca vuoto = piazza | Tieni premuto ${TIMING.breakTimeMs / 1000}s = rompi`,
      ].join('\n'),
    );
  }

  override update(): void {
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
