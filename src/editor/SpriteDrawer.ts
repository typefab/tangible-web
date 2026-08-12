import type { BlockType } from '../config';
import { blocksByCategory, resolveBlock } from '../assets/catalog';

/**
 * Il cassetto degli sprite: il menu a tendina da cui si sceglie cosa piazzare.
 *
 * Sta in un file suo e non dentro `LevelEditor` per due motivi che vanno nella
 * stessa direzione. Il primo e' che l'editor e' gia' troppo grosso. Il secondo
 * e' che questo pannello non sa niente di layer, undo o proiezione: sa solo
 * mostrare il catalogo diviso per categoria e dire chi e' stato scelto. Tenerlo
 * separato tiene onesta quella ignoranza.
 *
 * **Non ha un renderer suo.** Le anteprime arrivano gia' pronte da chi lo crea,
 * via `textureSrc`, che pesca dal texture manager di Phaser: e' lo stesso base64
 * che usa la palette in basso, cosi' il cassetto non puo' mostrare un blocco
 * diverso da quello che il gioco disegna.
 */
export interface SpriteDrawerDeps {
  /** Il base64 dello sprite gia' caricato, per l'anteprima. Vedi `textureSrc` nell'editor. */
  textureSrc: (id: string) => string;
  /** L'id scelto: l'editor lo mette in `placement.selected`. */
  onPick: (id: BlockType) => void;
  /** Apre l'editor d'immagine per importarne uno nuovo (Strato 2). */
  onAddSprite: () => void;
  /**
   * I tipi di blocco presenti nel livello aperto, cosi' come stanno adesso.
   * Il cassetto li mostra in una sezione a parte: costruendo si torna spesso
   * sugli stessi pochi, e cercarli fra tutte le categorie e' un tocco in piu'.
   */
  usedInLevel: () => BlockType[];
}

export class SpriteDrawer {
  private readonly root: HTMLDivElement;
  private readonly body: HTMLDivElement;
  private open = false;
  /** L'id evidenziato: quello che si sta piazzando. */
  private selected: BlockType | null = null;

  constructor(private readonly deps: SpriteDrawerDeps) {
    this.root = document.createElement('div');
    this.root.id = 'sprite-drawer';
    this.root.hidden = true;
    this.root.innerHTML = `<style>${SpriteDrawer.style()}</style>`;

    const head = document.createElement('div');
    head.className = 'head';
    head.innerHTML = '<strong>Sprite</strong>';
    const add = document.createElement('button');
    add.className = 'aggiungi';
    add.innerHTML = '<span class="ico">＋</span><span>Aggiungi sprite</span>';
    add.title = 'Importa un nuovo sprite da un’immagine';
    add.onclick = () => this.deps.onAddSprite();
    head.appendChild(add);
    this.root.appendChild(head);

    this.body = document.createElement('div');
    this.body.className = 'body';
    this.root.appendChild(this.body);

    document.body.appendChild(this.root);
  }

  /** L'evidenziazione segue la scelta anche quando arriva da fuori (contagocce). */
  setSelected(id: BlockType | null): void {
    this.selected = id;
    if (this.open) this.markSelected();
  }

  toggle(): void {
    this.open ? this.close() : this.show();
  }

  show(): void {
    // Il contenuto si ricostruisce all'apertura, non a ogni pennellata: gli
    // "usati nel livello" cambiano di continuo mentre si costruisce, ma nessuno
    // guarda il cassetto mentre e' chiuso.
    this.render();
    this.open = true;
    this.root.hidden = false;
  }

  close(): void {
    this.open = false;
    this.root.hidden = true;
  }

  get isOpen(): boolean {
    return this.open;
  }

  private render(): void {
    this.body.replaceChildren();

    const used = dedupe(this.deps.usedInLevel());
    if (used.length > 0) {
      this.body.appendChild(this.section('Usati nel livello', used, 'usati'));
    }

    for (const { category, blocks } of blocksByCategory()) {
      this.body.appendChild(this.section(category, blocks.map((b) => b.id), 'categoria'));
    }

    this.markSelected();
  }

  /**
   * Una sezione titolata: l'intestazione e la griglia degli sprite che contiene.
   *
   * `kind` distingue le categorie del catalogo dalla scorciatoia "usati nel
   * livello", che ripete degli id: chi legge il cassetto per sapere cos'e' il
   * catalogo deve poter guardare solo `.categoria`.
   */
  private section(title: string, ids: BlockType[], kind: 'usati' | 'categoria'): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = `sezione ${kind}`;

    const label = document.createElement('div');
    label.className = 'titolo';
    label.textContent = title;
    wrap.appendChild(label);

    const grid = document.createElement('div');
    grid.className = 'griglia';
    for (const id of ids) {
      // Un id senza blocco nel catalogo si scarta invece di mostrare un buco:
      // "usati nel livello" puo' contenere un id di un file cancellato.
      const block = resolveBlock(id);
      if (!block) continue;
      grid.appendChild(this.cell(block.id, block.label));
    }
    wrap.appendChild(grid);
    return wrap;
  }

  private cell(id: BlockType, label: string): HTMLButtonElement {
    const b = document.createElement('button');
    b.className = 'sprite';
    b.dataset.id = id;
    b.title = label;
    b.innerHTML = `<img alt="" src="${this.deps.textureSrc(id)}"><span>${label}</span>`;
    b.onclick = () => {
      this.deps.onPick(id);
      this.setSelected(id);
      // Scelto uno, il cassetto si toglie di mezzo: su telefono copre mezza
      // scena, e la scelta successiva e' un tocco sulla tela, non qui.
      this.close();
    };
    return b;
  }

  private markSelected(): void {
    for (const cell of this.body.querySelectorAll<HTMLButtonElement>('button.sprite')) {
      cell.setAttribute('aria-pressed', String(cell.dataset.id === this.selected));
    }
  }

  private static style(): string {
    return `
      #sprite-drawer {
        position: fixed; z-index: 11;
        left: calc(8px + env(safe-area-inset-left));
        top: calc(56px + env(safe-area-inset-top));
        width: 280px; max-width: calc(100vw - 16px);
        max-height: 70vh; display: flex; flex-direction: column;
        border-radius: 10px; border: 1px solid #3a3a48; background: #24242ef2;
        font: 13px/1.4 system-ui, sans-serif; color: #e8e8ef;
        box-shadow: 0 8px 24px #0007;
      }
      #sprite-drawer[hidden] { display: none; }
      #sprite-drawer .head {
        display: flex; align-items: center; gap: 8px; padding: 8px;
        border-bottom: 1px solid #3a3a48;
      }
      #sprite-drawer .head strong { flex: 1 1 auto; font-weight: 600; }
      #sprite-drawer .aggiungi {
        display: inline-flex; align-items: center; gap: 6px;
        min-height: 36px; padding: 0 12px; border-radius: 8px;
        border: 1px solid #4a7a5a; background: #2c4436; color: #e8e8ef;
        font: inherit; cursor: pointer; touch-action: manipulation; white-space: nowrap;
      }
      #sprite-drawer .aggiungi:hover { background: #34503f; }
      #sprite-drawer .aggiungi .ico { font-size: 16px; }
      #sprite-drawer .body { overflow-y: auto; padding: 8px; scrollbar-width: thin; }
      #sprite-drawer .sezione + .sezione { margin-top: 12px; }
      #sprite-drawer .titolo {
        font-size: 11px; text-transform: uppercase; letter-spacing: .04em;
        opacity: .6; margin-bottom: 6px;
      }
      #sprite-drawer .griglia {
        display: grid; grid-template-columns: repeat(auto-fill, 64px); gap: 6px;
      }
      #sprite-drawer button.sprite {
        display: flex; flex-direction: column; align-items: center; gap: 2px;
        width: 64px; min-height: 64px; padding: 4px;
        border-radius: 8px; border: 1px solid #3a3a48; background: #2f2f3d;
        color: #e8e8ef; font: inherit; cursor: pointer; touch-action: manipulation;
      }
      #sprite-drawer button.sprite:hover { background: #3a3a48; }
      #sprite-drawer button.sprite[aria-pressed="true"] {
        border-color: #ffd166; background: #4a4432; color: #ffd166;
      }
      #sprite-drawer button.sprite img {
        width: 36px; height: 36px; object-fit: contain; image-rendering: pixelated;
      }
      #sprite-drawer button.sprite span {
        font-size: 10px; opacity: .8; max-width: 100%;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
    `;
  }
}

/** Toglie i doppioni tenendo il primo: l'ordine e' informazione, qui. */
function dedupe(ids: BlockType[]): BlockType[] {
  return [...new Set(ids)];
}
