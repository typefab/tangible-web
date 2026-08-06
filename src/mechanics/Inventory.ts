import { INVENTORY, type BlockType } from '../config';

export interface Slot {
  type: BlockType | null;
  count: number;
}

/**
 * Inventario a 8 slot.
 *
 * Solo stato e regole: non disegna nulla. La resa grafica sta in
 * `src/ui/InventoryBar.ts`, cosi' le regole si possono testare senza schermo.
 *
 * Nel progetto GDevelop questa logica viveva in eventi che dovevano ciclare
 * su 8 istanze di `inventario_block` con ForEach e confronti su SlotIndex.
 * Qui e' un array.
 */
export class Inventory {
  private readonly slots: Slot[] = Array.from({ length: INVENTORY.slots }, () => ({
    type: null,
    count: 0,
  }));

  private selectedIndex = 0;

  get selected(): number {
    return this.selectedIndex;
  }

  /** Il tipo di blocco nello slot selezionato, null se vuoto. */
  get selectedType(): BlockType | null {
    return this.slots[this.selectedIndex]!.type;
  }

  /** Copia di sola lettura, per la UI. */
  view(): readonly Slot[] {
    return this.slots.map((s) => ({ ...s }));
  }

  select(index: number): void {
    if (index < 0 || index >= INVENTORY.slots) return;
    this.selectedIndex = index;
  }

  countOf(type: BlockType): number {
    return this.slots.reduce((sum, s) => (s.type === type ? sum + s.count : sum), 0);
  }

  /**
   * Aggiunge un blocco raccolto. Prima riempie uno stack gia' aperto dello
   * stesso tipo, poi occupa il primo slot libero.
   *
   * @returns false se l'inventario e' pieno: il blocco non va perso in silenzio.
   */
  add(type: BlockType, amount = 1): boolean {
    const existing = this.slots.find((s) => s.type === type && s.count < INVENTORY.stackLimit);
    if (existing) {
      existing.count = Math.min(existing.count + amount, INVENTORY.stackLimit);
      return true;
    }

    const empty = this.slots.find((s) => s.type === null);
    if (!empty) return false;

    empty.type = type;
    empty.count = Math.min(amount, INVENTORY.stackLimit);
    return true;
  }

  /**
   * Consuma un blocco dallo slot selezionato.
   * @returns il tipo consumato, oppure null se lo slot e' vuoto.
   */
  consumeSelected(): BlockType | null {
    const slot = this.slots[this.selectedIndex]!;
    if (!slot.type || slot.count <= 0) return null;

    const type = slot.type;
    slot.count -= 1;
    // Slot esaurito: si libera, cosi' puo' accogliere un altro tipo.
    if (slot.count === 0) slot.type = null;
    return type;
  }
}
