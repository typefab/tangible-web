import { ISO } from '../config';
import { projection } from '../grid/projection';

/**
 * Oltre questo scarto la figura non tocca piu' la sua cella, e il PNG che
 * servirebbe a rappresentarlo diventa il triplo della figura: da li' in poi si
 * paga nitidezza per del vuoto.
 */
export const OFFSET_MAX = 1;

/** Di quanto sposta una freccia: fine abbastanza da rifinire, grossa abbastanza da vedersi. */
const NUDGE = 0.02;

/**
 * Disegna la cella e lo sprite sopra, con le proporzioni del gioco.
 *
 * **Sta qui, in un posto solo, e la usano tutte e due le anteprime** — quella
 * piccola dentro l'importer e quella grande di questa finestra. Erano il
 * candidato perfetto per due implementazioni della stessa geometria da tenere
 * allineate a mano, che e' esattamente cio' che l'editor evita disegnando
 * attraverso la scena.
 *
 * Il rombo viene da `projection.cellOutline`: se un giorno la proiezione
 * cambia, l'anteprima cambia con lei invece di diventare una bugia.
 */
export function drawOnCell(
  canvas: HTMLCanvasElement,
  sprite: HTMLCanvasElement,
  place: { taglia: number; offset: { x: number; y: number } },
): void {
  const ctx = canvas.getContext('2d')!;
  const { width: W, height: H } = canvas;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#1b1b22';
  ctx.fillRect(0, 0, W, H);

  // Quanto sara' grande in gioco, in unita' di mondo: la larghezza la decide la
  // taglia, l'altezza segue le proporzioni dell'immagine.
  const dw = ISO.tileWidth * place.taglia;
  const dh = sprite.height * (dw / sprite.width);
  const sx = dw * place.offset.x;
  const sy = dh * place.offset.y;

  // Lo zoom fa stare dentro le celle attorno **e** lo sprite dov'e' finito:
  // senza il contributo dello scarto, spostandolo uscirebbe dal riquadro
  // proprio mentre lo si sta posizionando.
  const spanX = Math.max(dw + 2 * Math.abs(sx), ISO.tileWidth * 3.2);
  const spanY = Math.max(dh + 2 * Math.abs(sy), ISO.tileHeight * 3.2) + ISO.tileHeight * 2;
  const k = Math.min(W / spanX, H / spanY);

  const center = projection.cellToWorld(0, 0);
  const cx = W / 2;
  const cy = H * 0.62;
  const toScreen = (q: { x: number; y: number }) => ({
    x: cx + (q.x - center.x) * k,
    y: cy + (q.y - center.y) * k,
  });

  for (let row = -1; row <= 1; row++) {
    for (let col = -1; col <= 1; col++) {
      const pts = projection.cellOutline(col, row).map(toScreen);
      ctx.beginPath();
      ctx.moveTo(pts[0]!.x, pts[0]!.y);
      for (const q of pts.slice(1)) ctx.lineTo(q.x, q.y);
      ctx.closePath();
      const centrale = col === 0 && row === 0;
      ctx.fillStyle = centrale ? '#2f2f3d' : '#23232c';
      ctx.fill();
      ctx.strokeStyle = centrale ? '#ffd166' : '#3a3a48';
      ctx.lineWidth = centrale ? 2 : 1;
      ctx.stroke();
    }
  }

  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(sprite, cx + sx * k - (dw * k) / 2, cy + sy * k - (dh * k) / 2, dw * k, dh * k);
}

export interface CellPlacerDeps {
  /** Lo sprite com'e' adesso: lo tiene l'importer, che sa rifarlo. */
  sprite: () => HTMLCanvasElement | null;
  /** Quante celle e' larga la figura adesso. */
  taglia: () => number;
  /**
   * Cambia la taglia — la usa il pizzico.
   *
   * La possiede l'importer, come lo stepper che la mostra: qui dentro lo
   * stepper e' **lo stesso elemento**, prestato alla finestra e poi restituito.
   * Riscriverlo avrebbe voluto dire due widget con due gestori da tenere
   * d'accordo, e la prima cosa che diverge e' il passo.
   */
  setTaglia: (n: number) => void;
}

/**
 * La finestra "centra": posizionare lo sprite sulla cella con le dita.
 *
 * Nasce da una prova su un telefono vero. Il ritaglio ai bordi del contenuto
 * mette la figura al centro **per costruzione**, e quello risolve il caso
 * storto; ma "al centro" non e' sempre dove la si vuole — un oggetto appoggiato
 * poggia piu' in basso, uno appeso sta piu' in alto — e l'anteprima piccola e'
 * troppo piccola per deciderlo col dito.
 *
 * Dentro ci stanno anche **Largo (celle)** e **Lato in pixel**: sono le due
 * domande che si fanno guardando proprio questa immagine, e tenerle fuori
 * significava regolare qui e verificare la'.
 */
export class CellPlacer {
  private readonly root: HTMLDivElement;
  private stage!: HTMLCanvasElement;
  /** Il posto dove finiscono gli stepper prestati dall'importer. */
  private slot!: HTMLDivElement;

  /** Lo scarto in corso: e' l'unica cosa che questa finestra possiede. */
  private offset = { x: 0, y: 0 };
  private tagliaLimits = { min: 0.25, max: 8, step: 0.25 };
  /** Dove rimettere gli stepper quando si chiude, e cosa ci sta dentro. */
  private lent: { controls: HTMLElement; home: HTMLElement } | null = null;

  /** I diti appoggiati adesso: due vuol dire pizzico, e il pizzico e' la taglia. */
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private drag: { x: number; y: number; from: { x: number; y: number } } | null = null;
  private pinch: { dist: number; taglia: number } | null = null;

  private resolve: ((offset: { x: number; y: number } | null) => void) | null = null;

  constructor(private readonly deps: CellPlacerDeps) {
    this.root = document.createElement('div');
    this.root.id = 'cell-placer';
    this.root.hidden = true;
    this.root.innerHTML = `<style>${CellPlacer.style()}</style>`;
    this.build();
    document.body.appendChild(this.root);
  }

  /**
   * Apre sulla posa corrente, ospitando `controls` — gli stepper dell'importer.
   *
   * Promette lo scarto nuovo, o `null` se si annulla: uscendo con l'indietro o
   * con Annulla non deve restare applicato niente di quello che si e' provato.
   * Taglia e lato in pixel invece valgono subito, perche' sono dell'importer e
   * la loro anteprima e' proprio questa: annullarli sarebbe un'altra regola da
   * spiegare, e la finestra si riapre a un tocco.
   */
  open(
    controls: HTMLElement,
    offset: { x: number; y: number },
    tagliaLimits: { min: number; max: number; step: number },
  ): Promise<{ x: number; y: number } | null> {
    this.offset = { ...offset };
    this.tagliaLimits = tagliaLimits;
    this.lent = { controls, home: controls.parentElement! };
    this.slot.appendChild(controls);
    this.root.hidden = false;
    this.refresh();
    return new Promise((resolve) => {
      this.resolve = resolve;
    });
  }

  /** Chiude annullando. `false` se non era aperta: lo chiede il tasto indietro. */
  cancel(): boolean {
    if (this.root.hidden) return false;
    this.done(null);
    return true;
  }

  /**
   * Ridisegna: lo chiama l'importer a ogni ricalcolo, perche' cambiare il lato
   * in pixel qui dentro rifa' lo sprite. Se e' chiusa non costa niente.
   */
  refreshIfOpen(): void {
    if (!this.root.hidden) this.refresh();
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  /** Lo scarto che si sta provando adesso: lo legge l'importer per il PNG. */
  get current(): { x: number; y: number } {
    return { ...this.offset };
  }

  private done(offset: { x: number; y: number } | null): void {
    this.root.hidden = true;
    this.pointers.clear();
    this.drag = null;
    this.pinch = null;
    // Gli stepper tornano da dove sono venuti: sono dell'importer, e devono
    // funzionare anche a finestra chiusa.
    if (this.lent) this.lent.home.appendChild(this.lent.controls);
    this.lent = null;
    const resolve = this.resolve;
    this.resolve = null;
    resolve?.(offset);
  }

  // ------------------------------------------------------------- costruzione

  private build(): void {
    const box = document.createElement('div');
    box.className = 'box';
    this.root.appendChild(box);

    const head = document.createElement('div');
    head.className = 'head';
    head.innerHTML = '<h2>Centra sulla cella</h2>';
    box.appendChild(head);

    this.stage = document.createElement('canvas');
    this.stage.className = 'palco';
    this.stage.width = 480;
    this.stage.height = 360;
    box.appendChild(this.stage);
    this.bindPointer();

    const aiuto = document.createElement('p');
    aiuto.className = 'aiuto';
    aiuto.textContent = 'Trascina lo sprite dove lo vuoi. Due dita per allargarlo.';
    box.appendChild(aiuto);

    // Le frecce: la rifinitura che il dito non prende. Disposte a croce perche'
    // e' l'unica forma in cui "su" sta in alto senza doverlo leggere.
    const croce = document.createElement('div');
    croce.className = 'croce';
    const nudge = (dx: number, dy: number, label: string, titolo: string) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.title = titolo;
      b.onclick = () => this.nudge(dx, dy);
      return b;
    };
    const centra = document.createElement('button');
    centra.type = 'button';
    centra.className = 'centra';
    centra.textContent = '⌖';
    centra.title = 'Rimetti lo sprite al centro della cella';
    centra.onclick = () => {
      this.offset = { x: 0, y: 0 };
      this.refresh();
    };
    croce.append(
      spacer(),
      nudge(0, -1, '↑', 'Alza lo sprite'),
      spacer(),
      nudge(-1, 0, '←', 'Sposta a sinistra'),
      centra,
      nudge(1, 0, '→', 'Sposta a destra'),
      spacer(),
      nudge(0, 1, '↓', 'Abbassa lo sprite'),
      spacer(),
    );
    box.appendChild(croce);

    // Le due misure — Largo (celle) e Lato in pixel — vengono ospitate qui, non
    // ricostruite: sono le domande che ci si fa guardando **questa** immagine, e
    // tenerle fuori voleva dire regolare qui e verificare di la'.
    this.slot = document.createElement('div');
    this.slot.className = 'misure';
    box.appendChild(this.slot);

    const actions = document.createElement('div');
    actions.className = 'actions';
    const annulla = document.createElement('button');
    annulla.type = 'button';
    annulla.textContent = 'Annulla';
    annulla.onclick = () => this.done(null);
    const conferma = document.createElement('button');
    conferma.type = 'button';
    conferma.className = 'primary';
    conferma.textContent = 'Fatto';
    conferma.onclick = () => this.done({ ...this.offset });
    actions.append(annulla, conferma);
    box.appendChild(actions);
  }

  // ------------------------------------------------------------------ gesti

  private bindPointer(): void {
    this.stage.addEventListener('pointerdown', (e) => this.onDown(e));
    this.stage.addEventListener('pointermove', (e) => this.onMove(e));
    for (const type of ['pointerup', 'pointercancel', 'pointerleave'] as const) {
      this.stage.addEventListener(type, (e) => this.onUp(e as PointerEvent));
    }
  }

  private onDown(e: PointerEvent): void {
    this.stage.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    // Il secondo dito abbandona il trascinamento del primo: appoggiando la mano
    // per allargare non si deve restare con lo sprite spostato dove e' atterrato
    // il pollice. E' la stessa regola della scena.
    if (this.pointers.size >= 2) {
      this.drag = null;
      this.startPinch();
      return;
    }
    this.drag = { x: e.clientX, y: e.clientY, from: { ...this.offset } };
  }

  private onMove(e: PointerEvent): void {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (this.pointers.size >= 2) {
      this.updatePinch();
      return;
    }
    if (!this.drag || !this.deps.sprite()) return;

    // Da pixel di schermo a frazioni di figura: si divide per quanto e' grande
    // la figura **a schermo adesso**, altrimenti trascinare vorrebbe dire cose
    // diverse a taglie diverse.
    const rect = this.stage.getBoundingClientRect();
    const scala = rect.width / this.stage.width;
    const fig = this.figureOnStage();
    this.offset = {
      x: clamp(this.drag.from.x + (e.clientX - this.drag.x) / scala / fig.w, -OFFSET_MAX, OFFSET_MAX),
      y: clamp(this.drag.from.y + (e.clientY - this.drag.y) / scala / fig.h, -OFFSET_MAX, OFFSET_MAX),
    };
    this.refresh();
  }

  private onUp(e: PointerEvent): void {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    if (this.pointers.size === 0) this.drag = null;
  }

  private startPinch(): void {
    const [a, b] = [...this.pointers.values()];
    if (!a || !b) return;
    this.pinch = { dist: distance(a, b), taglia: this.deps.taglia() };
  }

  private updatePinch(): void {
    const [a, b] = [...this.pointers.values()];
    if (!a || !b || !this.pinch || this.pinch.dist === 0) return;

    const { step, min, max } = this.tagliaLimits;
    const voluta = this.pinch.taglia * (distance(a, b) / this.pinch.dist);
    // Agganciata al passo dello stepper: il pizzico e le frecce devono poter
    // arrivare agli stessi numeri, altrimenti "1" diventa irraggiungibile col
    // dito e la taglia scritta nel nome del file avrebbe due code di decimali.
    this.deps.setTaglia(clamp(Math.round(voluta / step) * step, min, max));
    this.refresh();
  }

  /**
   * Quanto e' grande la figura dentro il palco, in pixel di tela.
   *
   * Rifatto con gli stessi conti di `drawOnCell` invece di leggerli da li':
   * sono tre righe, e passarseli vorrebbe dire che disegnare e misurare
   * possono divergere di nascosto. Se un giorno diventassero di piu', vanno
   * restituiti dal disegno.
   */
  private figureOnStage(): { w: number; h: number } {
    const sprite = this.deps.sprite()!;
    const dw = ISO.tileWidth * this.deps.taglia();
    const dh = sprite.height * (dw / sprite.width);
    const sx = dw * this.offset.x;
    const sy = dh * this.offset.y;
    const spanX = Math.max(dw + 2 * Math.abs(sx), ISO.tileWidth * 3.2);
    const spanY = Math.max(dh + 2 * Math.abs(sy), ISO.tileHeight * 3.2) + ISO.tileHeight * 2;
    const k = Math.min(this.stage.width / spanX, this.stage.height / spanY);
    return { w: dw * k, h: dh * k };
  }

  // ---------------------------------------------------------------- comandi

  private nudge(dx: number, dy: number): void {
    this.offset = {
      x: clamp(this.offset.x + dx * NUDGE, -OFFSET_MAX, OFFSET_MAX),
      y: clamp(this.offset.y + dy * NUDGE, -OFFSET_MAX, OFFSET_MAX),
    };
    this.refresh();
  }

  private refresh(): void {
    const sprite = this.deps.sprite();
    if (sprite) drawOnCell(this.stage, sprite, { taglia: this.deps.taglia(), offset: this.offset });
  }

  private static style(): string {
    return `
      #cell-placer {
        position: fixed; inset: 0; z-index: 140;
        display: flex; align-items: center; justify-content: center;
        padding: 16px; background: #12121ae0;
        font: 14px/1.5 system-ui, sans-serif; color: #e8e8ef;
      }
      #cell-placer[hidden] { display: none; }
      #cell-placer .box {
        width: 100%; max-width: 520px; max-height: 92vh; overflow-y: auto;
        padding: 16px; border-radius: 12px; border: 1px solid #3a3a48;
        background: #24242e; display: flex; flex-direction: column; gap: 12px;
      }
      #cell-placer h2 { margin: 0; font-size: 16px; }
      /* touch-action: none, altrimenti il primo trascinamento lo mangia lo
         scorrimento della pagina e lo sprite non si muove. */
      #cell-placer canvas.palco {
        width: 100%; height: auto; touch-action: none; cursor: grab;
        border-radius: 8px; border: 1px solid #3a3a48; background: #1b1b22;
      }
      #cell-placer .aiuto { margin: 0; font-size: 12px; opacity: .7; }
      /* A croce: "su" sta in alto, e non c'e' niente da leggere. */
      #cell-placer .croce {
        display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px;
        max-width: 200px; margin: 0 auto;
      }
      #cell-placer .croce span { display: block; }
      #cell-placer .misure { display: flex; flex-direction: column; gap: 8px; }
      #cell-placer .stepper { display: flex; align-items: center; gap: 8px; }
      #cell-placer .stepper .etichetta { flex: 1 1 auto; font-size: 12px; opacity: .85; }
      #cell-placer .stepper .valore {
        min-width: 3.4em; text-align: center; font-variant-numeric: tabular-nums;
      }
      #cell-placer button {
        min-height: 44px; padding: 0 12px; border-radius: 8px;
        border: 1px solid #3a3a48; background: #2f2f3d; color: #e8e8ef;
        font: inherit; cursor: pointer; touch-action: manipulation; white-space: nowrap;
      }
      #cell-placer button:hover:not(:disabled) { background: #3a3a48; }
      #cell-placer button:disabled { opacity: .35; cursor: default; }
      #cell-placer .croce .centra { border-color: #ffd166; color: #ffd166; }
      #cell-placer .actions { display: flex; gap: 8px; }
      #cell-placer .actions button { flex: 1 1 auto; }
      #cell-placer .actions .primary { border-color: #4a7a5a; background: #2c4436; }
    `;
  }
}

function spacer(): HTMLSpanElement {
  return document.createElement('span');
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

