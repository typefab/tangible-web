import Phaser from 'phaser';
import { INVENTORY, Z } from '../config';
import { DEFAULT_BLOCK_ID } from '../assets/catalog';
import type { Inventory } from '../mechanics/Inventory';

interface SlotView {
  background: Phaser.GameObjects.Rectangle | Phaser.GameObjects.Image;
  icon: Phaser.GameObjects.Image;
  count: Phaser.GameObjects.Text;
}

/**
 * Barra dell'inventario, ancorata in basso al centro.
 *
 * Gli sprite degli slot non sono ancora stati caricati: se la texture
 * `inventory_slot` non esiste viene disegnato un rettangolo come segnaposto.
 * Quando il PNG arriva in public/assets la barra lo usa da sola, senza
 * modifiche al codice.
 */
export class InventoryBar {
  private readonly scene: Phaser.Scene;
  private readonly inventory: Inventory;
  private readonly slotViews: SlotView[] = [];
  // Esplicitamente number: INVENTORY e' `as const`, quindi verrebbe inferito
  // il tipo letterale 96 e il ridimensionamento non compilerebbe.
  private slotSize: number = INVENTORY.slotSize;

  constructor(scene: Phaser.Scene, inventory: Inventory) {
    this.scene = scene;
    this.inventory = inventory;

    this.build();
    this.layout();
    this.refresh();

    scene.scale.on(Phaser.Scale.Events.RESIZE, () => {
      this.layout();
      this.refresh();
    });
  }

  /** Spazio verticale occupato dalla barra, margine incluso. */
  get height(): number {
    return this.slotSize + 16;
  }

  private get hasSlotTexture(): boolean {
    return this.scene.textures.exists(INVENTORY.slotTexture);
  }

  private build(): void {
    for (let i = 0; i < INVENTORY.slots; i++) {
      const background = this.hasSlotTexture
        ? this.scene.add.image(0, 0, INVENTORY.slotTexture)
        : this.scene.add.rectangle(0, 0, 1, 1, 0x24242e, 0.85).setStrokeStyle(2, 0x3a3a48);

      // Una texture qualsiasi come segnaposto: l'icona parte nascosta e prende
      // quella giusta al primo refresh. Il tipo di blocco e' anche la chiave
      // della sua texture, quindi non serve nessuna tabella di conversione.
      const icon = this.scene.add.image(0, 0, DEFAULT_BLOCK_ID).setVisible(false);

      const count = this.scene.add
        .text(0, 0, '', { fontFamily: 'monospace', fontSize: '12px', color: '#e8e8ef' })
        .setOrigin(1, 1);

      for (const o of [background, icon, count]) {
        o.setScrollFactor(0).setDepth(Z.placeHitbox);
      }

      this.slotViews.push({ background, icon, count });
    }

    // Tasti 1..8 per selezionare lo slot.
    for (let i = 0; i < INVENTORY.slots; i++) {
      this.scene.input.keyboard?.on(`keydown-${['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT'][i]}`, () => {
        this.inventory.select(i);
        this.refresh();
      });
    }
  }

  /**
   * Posiziona la barra. Su telefono 8 slot da 96px non ci stanno (768px su uno
   * schermo da 375), quindi lo slot si rimpicciolisce fino a farli entrare.
   */
  private layout(): void {
    const { width, height } = this.scene.scale;
    const margin = 8;
    const available = width - margin * 2;
    this.slotSize = Math.min(INVENTORY.slotSize, Math.floor(available / INVENTORY.slots) - 4);

    const gap = 4;
    const totalWidth = INVENTORY.slots * this.slotSize + (INVENTORY.slots - 1) * gap;
    const startX = (width - totalWidth) / 2 + this.slotSize / 2;
    const y = height - this.slotSize / 2 - margin;

    this.slotViews.forEach((view, i) => {
      const x = startX + i * (this.slotSize + gap);
      view.background.setPosition(x, y);
      if (view.background instanceof Phaser.GameObjects.Rectangle) {
        view.background.setSize(this.slotSize, this.slotSize);
      } else {
        view.background.setDisplaySize(this.slotSize, this.slotSize);
      }
      view.icon.setPosition(x, y).setDisplaySize(this.slotSize * 0.6, this.slotSize * 0.6);
      view.count.setPosition(x + this.slotSize / 2 - 4, y + this.slotSize / 2 - 2);
    });
  }

  /** Riallinea la grafica allo stato dell'inventario. */
  refresh(): void {
    const slots = this.inventory.view();

    slots.forEach((slot, i) => {
      const view = this.slotViews[i]!;
      const isSelected = i === this.inventory.selected;

      if (view.background instanceof Phaser.GameObjects.Rectangle) {
        view.background.setStrokeStyle(2, isSelected ? 0xffd166 : 0x3a3a48);
      } else {
        view.background.setTint(isSelected ? 0xffd166 : 0xffffff);
      }

      if (slot.type) {
        view.icon.setTexture(slot.type).setVisible(true);
        view.count.setText(slot.count > 1 ? String(slot.count) : '');
      } else {
        view.icon.setVisible(false);
        view.count.setText('');
      }
    });
  }
}
