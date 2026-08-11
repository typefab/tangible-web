/**
 * L'elenco di tutti i livelli del progetto.
 *
 * Le schede in alto mostrano solo i livelli **aperti** — tre o quattro, quelli
 * fra cui si sta andando avanti e indietro. Tutti gli altri stanno qui: e' la
 * differenza fra un progetto da due livelli e uno da cento, dove una striscia
 * di cento schede non e' navigabile e la ricerca per nome e' l'unico modo
 * sensato di ritrovare qualcosa.
 *
 * Da qui si apre un livello, e da qui si crea, si duplica, si rinomina e si
 * elimina: sono operazioni sul catalogo, non sulla scheda aperta, e stavano
 * nella barra in alto solo perche' prima il catalogo non c'era.
 */

/** Una riga dell'elenco, come la vede chi guarda. */
export interface BrowserLevel {
  name: string;
  /** Quanti blocchi ha in tutto, su tutti i layer. */
  blocks: number;
  /** Se ha una scheda aperta in alto. */
  open: boolean;
  /** Se e' quello che si sta modificando adesso. */
  active: boolean;
}

/** Quello che l'elenco chiede all'editor. L'elenco non conosce il progetto. */
export interface LevelBrowserHost {
  levels(): BrowserLevel[];
  openLevel(index: number): void;
  createLevel(): void;
  duplicateLevel(index: number): void;
  renameLevel(index: number): void;
  deleteLevel(index: number): Promise<void>;
}

const STYLE = `
  #level-browser {
    position: fixed; inset: 0; z-index: 60;
    display: flex; align-items: stretch; justify-content: center;
    padding: env(safe-area-inset-top) 12px 12px;
    background: #12121acc;
    font: 14px/1.5 system-ui, sans-serif; color: #e8e8ef;
  }
  #level-browser .box {
    width: 100%; max-width: 460px; margin: auto; max-height: 100%;
    display: flex; flex-direction: column; gap: 10px; padding: 14px;
    border-radius: 12px; border: 1px solid #3a3a48; background: #24242e;
  }
  #level-browser .head { display: flex; align-items: center; gap: 8px; }
  #level-browser .head h2 { margin: 0; font-size: 16px; flex: 1 1 auto; }
  #level-browser .head .conto { font-size: 12px; opacity: .7; }
  #level-browser input[type=search] {
    width: 100%; min-height: 42px; padding: 0 12px; box-sizing: border-box;
    border-radius: 8px; border: 1px solid #3a3a48; background: #1f1f28;
    color: #e8e8ef; font: inherit;
  }
  /* L'elenco scorre e il resto no: con cento livelli, ricerca e "nuovo" devono
     restare dove sono invece di finire fuori schermo. */
  #level-browser .list {
    flex: 1 1 auto; overflow-y: auto; display: flex; flex-direction: column; gap: 6px;
    min-height: 80px;
  }
  #level-browser .riga {
    display: flex; align-items: center; gap: 6px;
    border-radius: 8px; border: 1px solid #3a3a48; background: #2f2f3d;
  }
  #level-browser .riga.aperto { border-color: #4a5a7a; }
  #level-browser .riga.attivo { border-color: #ffd166; background: #4a4432; }
  #level-browser button {
    min-height: 44px; border: 0; background: none; color: inherit;
    font: inherit; cursor: pointer; border-radius: 8px; padding: 0 10px;
  }
  #level-browser button:hover:not(:disabled) { background: #ffffff14; }
  #level-browser button:disabled { opacity: .35; cursor: default; }
  #level-browser .riga .nome {
    flex: 1 1 auto; text-align: left; overflow: hidden;
    text-overflow: ellipsis; white-space: nowrap;
  }
  #level-browser .riga .nome .quanti { font-size: 12px; opacity: .6; margin-left: 6px; }
  #level-browser .riga .azioni { display: flex; flex: 0 0 auto; }
  #level-browser .riga .azioni button { padding: 0 8px; }
  #level-browser .vuoto { padding: 18px 4px; opacity: .6; text-align: center; }
  #level-browser .piede { display: flex; gap: 8px; }
  #level-browser .piede button {
    flex: 1 1 0; border: 1px solid #3a3a48; background: #2f2f3d;
  }
  #level-browser .piede button.primary { border-color: #4a7a5a; background: #2c4436; }
`;

export class LevelBrowser {
  private readonly host: LevelBrowserHost;
  private root: HTMLDivElement | null = null;
  private list!: HTMLDivElement;
  private search!: HTMLInputElement;
  private counter!: HTMLSpanElement;
  private filter = '';

  constructor(host: LevelBrowserHost) {
    this.host = host;
  }

  get open(): boolean {
    return this.root !== null;
  }

  toggle(): void {
    if (this.root) this.close();
    else this.show();
  }

  close(): void {
    this.root?.remove();
    this.root = null;
  }

  show(): void {
    if (this.root) return;

    const root = document.createElement('div');
    this.root = root;
    root.id = 'level-browser';
    root.innerHTML = `<style>${STYLE}</style>`;
    // Toccare fuori dal riquadro chiude: qui non si decide niente di
    // irreversibile, e su telefono un velo che non si chiude e' una trappola.
    root.onclick = (e) => {
      if (e.target === root) this.close();
    };

    const box = document.createElement('div');
    box.className = 'box';
    root.appendChild(box);

    const head = document.createElement('div');
    head.className = 'head';
    head.innerHTML = '<h2>Livelli</h2>';
    this.counter = document.createElement('span');
    this.counter.className = 'conto';
    head.appendChild(this.counter);
    const chiudi = document.createElement('button');
    chiudi.textContent = '✕';
    chiudi.title = 'Chiudi l\'elenco';
    chiudi.onclick = () => this.close();
    head.appendChild(chiudi);
    box.appendChild(head);

    this.search = document.createElement('input');
    this.search.type = 'search';
    this.search.placeholder = 'Cerca per nome';
    this.search.value = this.filter;
    this.search.oninput = () => {
      this.filter = this.search.value;
      this.refresh();
    };
    box.appendChild(this.search);

    this.list = document.createElement('div');
    this.list.className = 'list';
    box.appendChild(this.list);

    const piede = document.createElement('div');
    piede.className = 'piede';
    const nuovo = document.createElement('button');
    nuovo.className = 'primary';
    nuovo.textContent = '+ Nuovo livello';
    nuovo.onclick = () => {
      // Un livello nuovo si apre subito: crearlo per poi doverlo cercare
      // nell'elenco sarebbe un passaggio in piu' per niente.
      this.host.createLevel();
      this.close();
    };
    piede.appendChild(nuovo);
    box.appendChild(piede);

    document.body.appendChild(root);
    this.refresh();
    this.search.focus();
  }

  /** Ricostruisce le righe. Sono poche anche con cento livelli, e filtrate. */
  refresh(): void {
    if (!this.root) return;

    const tutti = this.host.levels();
    const cerca = this.filter.trim().toLowerCase();
    const mostrati = tutti
      .map((level, index) => ({ level, index }))
      .filter(({ level }) => level.name.toLowerCase().includes(cerca));

    this.counter.textContent =
      cerca === ''
        ? `${tutti.length}`
        : `${mostrati.length} di ${tutti.length}`;

    this.list.textContent = '';
    if (mostrati.length === 0) {
      const vuoto = document.createElement('p');
      vuoto.className = 'vuoto';
      vuoto.textContent = `Nessun livello con "${this.filter.trim()}"`;
      this.list.appendChild(vuoto);
      return;
    }

    for (const { level, index } of mostrati) {
      const riga = document.createElement('div');
      riga.className = 'riga';
      if (level.open) riga.classList.add('aperto');
      if (level.active) riga.classList.add('attivo');

      const apri = document.createElement('button');
      apri.className = 'nome';
      apri.innerHTML =
        `${escape(level.name)}<span class="quanti">${level.blocks} blocchi` +
        `${level.open && !level.active ? ' · aperto' : ''}</span>`;
      apri.title = level.active ? 'Gia' + "' aperto e in modifica" : `Apri "${level.name}"`;
      apri.onclick = () => {
        this.host.openLevel(index);
        this.close();
      };
      riga.appendChild(apri);

      const azioni = document.createElement('div');
      azioni.className = 'azioni';
      riga.appendChild(azioni);

      const bottone = (label: string, title: string, onClick: () => void): HTMLButtonElement => {
        const b = document.createElement('button');
        b.textContent = label;
        b.title = title;
        b.onclick = onClick;
        azioni.appendChild(b);
        return b;
      };

      bottone('✎', `Rinomina "${level.name}"`, () => {
        this.host.renameLevel(index);
        this.refresh();
      });
      bottone('⧉', `Duplica "${level.name}"`, () => {
        this.host.duplicateLevel(index);
        this.close();
      });
      const elimina = bottone('🗑', `Elimina "${level.name}"`, () => {
        void this.host.deleteLevel(index).then(() => this.refresh());
      });
      // L'ultimo livello non si elimina: un progetto senza livelli non si
      // potrebbe piu' modificare, e non ci sarebbe niente da disegnare.
      elimina.disabled = tutti.length <= 1;

      this.list.appendChild(riga);
    }
  }
}

/** I nomi dei livelli li scrive chi li crea: non finiscono nell'HTML come sono. */
function escape(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
