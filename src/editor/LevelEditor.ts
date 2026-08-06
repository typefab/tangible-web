import Phaser from 'phaser';
import { BLOCKS, type BlockType } from '../config';
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
 */
export class LevelEditor {
  private readonly scene: Phaser.Scene;
  private readonly placement: GridPlacement;
  private root!: HTMLDivElement;
  private countLabel!: HTMLSpanElement;
  private paletteButtons = new Map<BlockType, HTMLButtonElement>();

  constructor(scene: Phaser.Scene, placement: GridPlacement) {
    this.scene = scene;
    this.placement = placement;

    this.buildToolbar();
    this.bindInput();
    this.refresh();
  }

  /** In editor il tocco e' immediato: cella vuota piazza, cella piena rimuove. */
  private bindInput(): void {
    this.scene.input.on(Phaser.Input.Events.POINTER_DOWN, (p: Phaser.Input.Pointer) => {
      const { col, row } = GridPlacement.worldToCell(p.worldX, p.worldY);
      if (col < 0 || row < 0) return;

      if (this.placement.isOccupied(col, row)) {
        this.placement.remove(col, row);
      } else {
        // spawn e non place: in editor il cooldown darebbe solo fastidio.
        this.placement.spawn(col, row);
      }
      this.refresh();
    });
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
        #editor-toolbar button:hover { background: #3a3a48; }
        #editor-toolbar button[aria-pressed="true"] {
          border-color: #ffd166; background: #4a4432; color: #ffd166;
        }
        #editor-toolbar .spacer { flex: 1 1 auto; }
        #editor-toolbar .hint { opacity: .7; }
      </style>
    `;

    for (const type of Object.keys(BLOCKS) as BlockType[]) {
      const b = document.createElement('button');
      b.textContent = BLOCKS[type].label;
      b.setAttribute('aria-pressed', String(this.placement.selected === type));
      b.onclick = () => {
        this.placement.selected = type;
        this.refresh();
      };
      this.root.appendChild(b);
      this.paletteButtons.set(type, b);
    }

    const hint = document.createElement('span');
    hint.className = 'hint';
    hint.textContent = 'tocca per piazzare · ritocca per togliere';
    this.root.appendChild(hint);

    const spacer = document.createElement('span');
    spacer.className = 'spacer';
    this.root.appendChild(spacer);

    this.countLabel = document.createElement('span');
    this.root.appendChild(this.countLabel);

    const copy = document.createElement('button');
    copy.textContent = 'Copia JSON';
    copy.onclick = () => this.copyToClipboard(copy);
    this.root.appendChild(copy);

    const save = document.createElement('button');
    save.textContent = 'Scarica level.json';
    save.onclick = () => this.download();
    this.root.appendChild(save);

    document.body.appendChild(this.root);
  }

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
  }
}
