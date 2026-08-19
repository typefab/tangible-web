/**
 * La matita: ritagliare a mano lo sprite, con gomma, ripristino e lazo.
 *
 * **Non modifica un'immagine: costruisce una maschera.** Il risultato e' un
 * `Uint8Array` grande quanto l'immagine, dove 1 vuol dire "questo pixel e'
 * tolto". E' il punto che tiene in piedi tutto il resto: la maschera e' un
 * passaggio della pipeline dell'importer, non un'immagine finita, quindi
 * cambiare tolleranza o lato in pixel **non cancella il ritaglio fatto a mano**.
 * Prima il ritaglio si perdeva a ogni ricalcolo, ed era il difetto piu' fastidioso.
 *
 * Il visore e' a **trasformazione**, non a scorrimento: la tela ha sempre la
 * dimensione dell'immagine e zoom e spostamento vivono in un `transform` CSS.
 * Cosi' ingrandire non ingrandisce la finestra — prima cresceva il riquadro
 * insieme alla tela — e lo spostamento funziona anche quando l'immagine e' piu'
 * piccola del visore, cosa che con lo scorrimento non poteva funzionare.
 *
 * Sta in un file suo perche' non sa niente di importer ne' di editor: prende
 * un'immagine e una maschera, restituisce una maschera.
 */
type Tool = 'erase' | 'restore' | 'lasso' | 'pan';

const TOOL_LABELS: Record<Tool, [string, string]> = {
  erase: ['🩹 Gomma', 'Cancella dove passi'],
  restore: ['↩ Ripristina', 'Riporta quello che avevi cancellato'],
  lasso: ['✂ Lazo', 'Traccia un contorno: resta solo quello che ci sta dentro'],
  pan: ['✋ Sposta', 'Trascina per spostare l’immagine'],
};

/** Estremi dello zoom. Sotto 0.05 un'immagine grande sparisce, sopra 40 e' inutile. */
const ZOOM = { min: 0.05, max: 40 } as const;

export class MaskEditor {
  private readonly root: HTMLDivElement;
  private viewport!: HTMLDivElement;
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private toolButtons = new Map<Tool, HTMLButtonElement>();
  private brushInput!: HTMLInputElement;
  private brushLabel!: HTMLSpanElement;
  private zoomLabel!: HTMLSpanElement;
  private undoButton!: HTMLButtonElement;

  private tool: Tool = 'erase';
  private brush = 6;

  /** L'immagine di riferimento: com'e' senza i tratti a mano. Il ripristino torna qui. */
  private baseData: ImageData | null = null;
  /** Quello che si vede: la base con la maschera applicata. */
  private outData: ImageData | null = null;
  /** 1 = pixel tolto a mano. E' il risultato che esce da qui. */
  private mask: Uint8Array = new Uint8Array(0);
  private undo: Uint8Array[] = [];
  private static readonly UNDO_MAX = 30;

  /** Zoom e spostamento della tela, in pixel di schermo. `transform-origin: 0 0`. */
  private view = { x: 0, y: 0, z: 1 };

  /** I diti appoggiati adesso. Due o piu' vuol dire pizzico, qualunque strumento. */
  private readonly pointers = new Map<number, { x: number; y: number }>();
  /** Il pizzico in corso: distanza e centro di partenza. */
  private pinch: { dist: number; z: number; cx: number; cy: number } | null = null;
  /** L'ultimo punto toccato, in coordinate immagine: serve a unire i tratti. */
  private last: { x: number; y: number } | null = null;
  private painting = false;
  private lasso: { x: number; y: number }[] = [];

  private resolve: ((mask: Uint8Array | null) => void) | null = null;

  constructor() {
    this.root = document.createElement('div');
    this.root.id = 'mask-editor';
    this.root.hidden = true;
    this.root.innerHTML = `<style>${MaskEditor.style()}</style>`;
    this.build();
    document.body.appendChild(this.root);
  }

  /**
   * Apre sulla `base` — l'immagine come esce dall'automatico — con la maschera
   * gia' fatta, se c'e'. Promette la maschera nuova, o `null` se si annulla.
   */
  open(base: HTMLCanvasElement, mask: Uint8Array | null): Promise<Uint8Array | null> {
    const { width: w, height: h } = base;
    this.canvas.width = w;
    this.canvas.height = h;
    this.ctx = this.canvas.getContext('2d')!;
    this.ctx.drawImage(base, 0, 0);
    this.baseData = this.ctx.getImageData(0, 0, w, h);
    this.outData = this.ctx.getImageData(0, 0, w, h);

    // Una maschera di misura diversa e' di un'altra immagine: si riparte pulito
    // invece di applicarla storta.
    this.mask = mask && mask.length === w * h ? mask.slice() : new Uint8Array(w * h);
    this.undo = [];
    this.updateUndo();

    this.renderAll();
    this.fitView();
    this.chooseTool('erase');
    this.setBrush(Math.max(2, Math.round(Math.max(w, h) / 64)));

    this.root.hidden = false;
    return new Promise((resolve) => {
      this.resolve = resolve;
    });
  }

  /** Chiude annullando. `false` se non era aperto: lo chiede il tasto indietro. */
  cancel(): boolean {
    if (this.root.hidden) return false;
    this.done(false);
    return true;
  }

  private done(keep: boolean): void {
    this.root.hidden = true;
    const resolve = this.resolve;
    this.resolve = null;
    resolve?.(keep ? this.mask.slice() : null);
  }

  // ------------------------------------------------------------------ vista

  /** Porta l'immagine intera dentro il visore, centrata. */
  private fitView(): void {
    const box = this.viewport.getBoundingClientRect();
    // All'apertura il visore puo' non essere ancora misurabile: un valore di
    // ripiego evita uno zoom a zero, e il primo ridisegno mette a posto.
    const vw = box.width || 320;
    const vh = box.height || 320;
    const z = Math.min(vw / this.canvas.width, vh / this.canvas.height) * 0.92;
    this.view.z = clamp(z, ZOOM.min, ZOOM.max);
    this.view.x = (vw - this.canvas.width * this.view.z) / 2;
    this.view.y = (vh - this.canvas.height * this.view.z) / 2;
    this.applyView();
  }

  private applyView(): void {
    const { x, y, z } = this.view;
    this.canvas.style.transform = `translate(${x}px, ${y}px) scale(${z})`;
    this.zoomLabel.textContent = z >= 1 ? `${Math.round(z)}×` : `${z.toFixed(2)}×`;
  }

  /**
   * Cambia zoom tenendo fermo il punto indicato, in coordinate del visore.
   * Senza l'ancora, ingrandire farebbe scappare via cio' che si sta guardando.
   */
  private zoomAt(factor: number, px: number, py: number): void {
    const z = clamp(this.view.z * factor, ZOOM.min, ZOOM.max);
    const k = z / this.view.z;
    this.view.x = px - (px - this.view.x) * k;
    this.view.y = py - (py - this.view.y) * k;
    this.view.z = z;
    this.applyView();
  }

  private zoomFromButton(factor: number): void {
    const box = this.viewport.getBoundingClientRect();
    this.zoomAt(factor, box.width / 2, box.height / 2);
  }

  // ---------------------------------------------------------------- disegno

  /** Dal tocco al pixel dell'immagine. Il rettangolo del canvas e' gia' trasformato. */
  private toImage(e: PointerEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * this.canvas.width,
      y: ((e.clientY - r.top) / r.height) * this.canvas.height,
    };
  }

  private viewPoint(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const r = this.viewport.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private bindPointer(): void {
    this.viewport.addEventListener('pointerdown', (e) => this.onDown(e));
    this.viewport.addEventListener('pointermove', (e) => this.onMove(e));
    for (const type of ['pointerup', 'pointercancel', 'pointerleave'] as const) {
      this.viewport.addEventListener(type, (e) => this.onUp(e as PointerEvent));
    }
    // La rotellina ingrandisce dove sta il puntatore, come ci si aspetta.
    this.viewport.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const p = this.viewPoint(e);
        this.zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, p.x, p.y);
      },
      { passive: false },
    );
  }

  private onDown(e: PointerEvent): void {
    this.viewport.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (this.pointers.size >= 2) {
      // Il secondo dito annulla il tratto appena cominciato dal primo, come nella
      // scena: non si resta con una gommata dove si e' appoggiata la mano.
      this.abortStroke();
      this.startPinch();
      return;
    }

    if (this.tool === 'pan') return;

    const p = this.toImage(e);
    if (this.tool === 'lasso') {
      this.lasso = [p];
      this.painting = true;
      return;
    }
    this.pushUndo();
    this.painting = true;
    this.last = p;
    this.dab(p.x, p.y);
  }

  private onMove(e: PointerEvent): void {
    const known = this.pointers.get(e.pointerId);
    if (!known) return;
    const prev = { ...known };
    known.x = e.clientX;
    known.y = e.clientY;

    if (this.pointers.size >= 2) {
      this.updatePinch();
      return;
    }

    if (this.tool === 'pan') {
      this.view.x += e.clientX - prev.x;
      this.view.y += e.clientY - prev.y;
      this.applyView();
      return;
    }

    if (!this.painting) return;
    const p = this.toImage(e);

    if (this.tool === 'lasso') {
      this.lasso.push(p);
      this.drawLassoHint();
      return;
    }

    // **Il tratto si unisce al precedente.** Fra due eventi il dito ha gia'
    // percorso della strada: senza questa riga la gomma lascia una fila di
    // buchi, tanto piu' evidente quanto piu' e' piccola e veloce.
    if (this.last) this.strokeTo(this.last, p);
    this.last = p;
  }

  private onUp(e: PointerEvent): void {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    if (this.pointers.size > 0) return;

    if (this.tool === 'lasso' && this.painting && this.lasso.length >= 3) {
      this.pushUndo();
      this.applyLasso();
    }
    this.lasso = [];
    this.painting = false;
    this.last = null;
    this.renderAll();
  }

  /** Butta via il tratto in corso senza toccare la maschera gia' buona. */
  private abortStroke(): void {
    if (!this.painting) return;
    this.painting = false;
    this.last = null;
    if (this.lasso.length > 0) {
      this.lasso = [];
      this.renderAll();
    } else {
      // Il tratto era gia' finito nella maschera: si disfa come un annulla.
      this.undoStroke();
    }
  }

  private startPinch(): void {
    const [a, b] = [...this.pointers.values()];
    if (!a || !b) return;
    const mid = this.viewPoint({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 });
    this.pinch = { dist: distance(a, b), z: this.view.z, cx: mid.x, cy: mid.y };
  }

  private updatePinch(): void {
    const [a, b] = [...this.pointers.values()];
    if (!a || !b || !this.pinch) return;
    const mid = this.viewPoint({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 });

    // Le due dita spostano e ingrandiscono insieme, come nella scena.
    this.view.x += mid.x - this.pinch.cx;
    this.view.y += mid.y - this.pinch.cy;
    this.pinch.cx = mid.x;
    this.pinch.cy = mid.y;
    this.applyView();

    const dist = distance(a, b);
    if (this.pinch.dist > 0) {
      const target = clamp((this.pinch.z * dist) / this.pinch.dist, ZOOM.min, ZOOM.max);
      this.zoomAt(target / this.view.z, mid.x, mid.y);
    }
  }

  /** Un tocco tondo del pennello, e il rettangolo toccato per il ridisegno. */
  private dab(cx: number, cy: number): { x0: number; y0: number; x1: number; y1: number } | null {
    if (!this.outData || !this.baseData) return null;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const r = Math.max(1, this.brush) / 2;
    const x0 = Math.max(0, Math.floor(cx - r));
    const x1 = Math.min(w - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r));
    const y1 = Math.min(h - 1, Math.ceil(cy + r));
    if (x1 < x0 || y1 < y0) return null;

    const erase = this.tool === 'erase';
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        if (dx * dx + dy * dy > r * r) continue;
        const i = y * w + x;
        this.mask[i] = erase ? 1 : 0;
        this.writePixel(i);
      }
    }
    return { x0, y0, x1, y1 };
  }

  /** Il segmento fra due tocchi, a passi piccoli: e' cio' che rende continua la linea. */
  private strokeTo(from: { x: number; y: number }, to: { x: number; y: number }): void {
    const dist = distance({ x: from.x, y: from.y }, { x: to.x, y: to.y });
    const step = Math.max(0.5, this.brush / 3);
    const n = Math.max(1, Math.ceil(dist / step));
    let box: { x0: number; y0: number; x1: number; y1: number } | null = null;
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      const b = this.dab(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t);
      box = union(box, b);
    }
    this.flush(box);
  }

  /** Porta in maschera cio' che sta **fuori** dal contorno: il lazo ritaglia. */
  private applyLasso(): void {
    const w = this.canvas.width;
    const h = this.canvas.height;
    const shape = document.createElement('canvas');
    shape.width = w;
    shape.height = h;
    const sctx = shape.getContext('2d')!;
    sctx.fillStyle = '#fff';
    sctx.beginPath();
    sctx.moveTo(this.lasso[0]!.x, this.lasso[0]!.y);
    for (const p of this.lasso.slice(1)) sctx.lineTo(p.x, p.y);
    sctx.closePath();
    sctx.fill();

    const inside = sctx.getImageData(0, 0, w, h).data;
    for (let i = 0; i < w * h; i++) {
      if (inside[i * 4 + 3] === 0) this.mask[i] = 1;
    }
  }

  /** Ridisegna il contorno del lazo mentre lo si traccia. */
  private drawLassoHint(): void {
    if (!this.outData) return;
    this.ctx.putImageData(this.outData, 0, 0);
    this.ctx.save();
    this.ctx.lineWidth = Math.max(1, 1.5 / this.view.z);
    this.ctx.strokeStyle = '#ffd166';
    this.ctx.setLineDash([6 / this.view.z, 4 / this.view.z]);
    this.ctx.beginPath();
    this.ctx.moveTo(this.lasso[0]!.x, this.lasso[0]!.y);
    for (const p of this.lasso.slice(1)) this.ctx.lineTo(p.x, p.y);
    this.ctx.closePath();
    this.ctx.stroke();
    this.ctx.restore();
  }

  /** Un pixel di `outData`: la base, o niente se la maschera lo toglie. */
  private writePixel(i: number): void {
    const out = this.outData!.data;
    const base = this.baseData!.data;
    const j = i * 4;
    if (this.mask[i]) {
      out[j + 3] = 0;
      return;
    }
    out[j] = base[j]!;
    out[j + 1] = base[j + 1]!;
    out[j + 2] = base[j + 2]!;
    out[j + 3] = base[j + 3]!;
  }

  /** Ridisegna solo il rettangolo toccato: su un'immagine grande e' la differenza. */
  private flush(box: { x0: number; y0: number; x1: number; y1: number } | null): void {
    if (!box || !this.outData) return;
    this.ctx.putImageData(
      this.outData,
      0,
      0,
      box.x0,
      box.y0,
      box.x1 - box.x0 + 1,
      box.y1 - box.y0 + 1,
    );
  }

  private renderAll(): void {
    if (!this.outData) return;
    for (let i = 0; i < this.mask.length; i++) this.writePixel(i);
    this.ctx.putImageData(this.outData, 0, 0);
  }

  // ---------------------------------------------------------------- comandi

  private pushUndo(): void {
    this.undo.push(this.mask.slice());
    if (this.undo.length > MaskEditor.UNDO_MAX) this.undo.shift();
    this.updateUndo();
  }

  private undoStroke(): void {
    const prev = this.undo.pop();
    if (!prev) return;
    this.mask = prev;
    this.renderAll();
    this.updateUndo();
  }

  private updateUndo(): void {
    this.undoButton.disabled = this.undo.length === 0;
  }

  private chooseTool(tool: Tool): void {
    this.tool = tool;
    for (const [t, b] of this.toolButtons) b.setAttribute('aria-pressed', String(t === tool));
    this.canvas.classList.toggle('pan', tool === 'pan');
    // Il pennello non c'entra col lazo ne' con lo spostamento: sparisce invece
    // di restare li' a far credere che serva.
    this.brushInput.parentElement!.hidden = tool !== 'erase' && tool !== 'restore';
  }

  private setBrush(px: number): void {
    this.brush = clamp(px, 1, 200);
    this.brushInput.value = String(this.brush);
    this.brushLabel.textContent = `${this.brush} px`;
  }

  // ------------------------------------------------------------------ pezzi

  private build(): void {
    const box = document.createElement('div');
    box.className = 'box';
    this.root.appendChild(box);

    const head = document.createElement('div');
    head.className = 'head';
    head.innerHTML = '<h2>Ritaglia a mano</h2>';
    box.appendChild(head);

    this.viewport = document.createElement('div');
    this.viewport.className = 'viewport';
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'grid';
    this.viewport.appendChild(this.canvas);
    box.appendChild(this.viewport);
    this.bindPointer();

    box.appendChild(this.tools());

    const actions = document.createElement('div');
    actions.className = 'actions';
    const annulla = document.createElement('button');
    annulla.textContent = 'Annulla';
    annulla.onclick = () => this.done(false);
    const fatto = document.createElement('button');
    fatto.className = 'primary';
    fatto.textContent = 'Fatto';
    fatto.onclick = () => this.done(true);
    actions.append(annulla, fatto);
    box.appendChild(actions);
  }

  private tools(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'controls';

    const strumenti = document.createElement('div');
    strumenti.className = 'group strumenti';
    for (const tool of ['erase', 'restore', 'lasso', 'pan'] as const) {
      const [label, title] = TOOL_LABELS[tool];
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.title = title;
      b.onclick = () => this.chooseTool(tool);
      strumenti.appendChild(b);
      this.toolButtons.set(tool, b);
    }
    wrap.appendChild(strumenti);

    const brush = document.createElement('label');
    brush.className = 'campo';
    brush.appendChild(document.createTextNode('Pennello'));
    this.brushInput = document.createElement('input');
    this.brushInput.type = 'range';
    this.brushInput.min = '1';
    this.brushInput.max = '200';
    this.brushInput.oninput = () => this.setBrush(Number(this.brushInput.value));
    this.brushLabel = document.createElement('span');
    this.brushLabel.className = 'valore';
    brush.append(this.brushInput, this.brushLabel);
    wrap.appendChild(brush);

    const zoom = document.createElement('div');
    zoom.className = 'group zoom';
    const meno = stepButton('−', () => this.zoomFromButton(1 / 1.4));
    this.zoomLabel = document.createElement('span');
    this.zoomLabel.className = 'valore';
    const piu = stepButton('+', () => this.zoomFromButton(1.4));
    const adatta = stepButton('⤢', () => this.fitView());
    adatta.title = 'Rimetti tutta l’immagine nel riquadro';
    zoom.append(meno, this.zoomLabel, piu, adatta);
    wrap.appendChild(zoom);

    this.undoButton = document.createElement('button');
    this.undoButton.type = 'button';
    this.undoButton.textContent = '↶ Annulla';
    this.undoButton.onclick = () => this.undoStroke();
    wrap.appendChild(this.undoButton);

    return wrap;
  }

  private static style(): string {
    return `
      #mask-editor {
        position: fixed; inset: 0; z-index: 130;
        display: flex; align-items: center; justify-content: center;
        padding: 16px; background: #12121ae0;
        font: 14px/1.5 system-ui, sans-serif; color: #e8e8ef;
      }
      #mask-editor[hidden] { display: none; }
      #mask-editor .box {
        width: 100%; max-width: 560px; max-height: 92vh;
        padding: 16px; border-radius: 12px; border: 1px solid #3a3a48;
        background: #24242e; display: flex; flex-direction: column; gap: 12px;
      }
      #mask-editor h2 { margin: 0; font-size: 16px; }
      /* Altezza fissa e ritaglio: la tela dentro puo' diventare enorme senza che
         il riquadro cresca con lei. Prima + e - ingrandivano anche la finestra. */
      #mask-editor .viewport {
        position: relative; overflow: hidden; touch-action: none;
        height: 55vh; min-height: 220px;
        border-radius: 8px; border: 1px solid #3a3a48;
        background-color: #20202a;
        background-image:
          linear-gradient(45deg, #2a2a34 25%, transparent 25%, transparent 75%, #2a2a34 75%),
          linear-gradient(45deg, #2a2a34 25%, transparent 25%, transparent 75%, #2a2a34 75%);
        background-size: 16px 16px; background-position: 0 0, 8px 8px;
        cursor: crosshair;
      }
      /* La tela resta grande quanto l'immagine: zoom e spostamento stanno tutti
         nel transform, quindi non toccano il layout. */
      #mask-editor canvas.grid {
        position: absolute; top: 0; left: 0; transform-origin: 0 0;
        image-rendering: pixelated; touch-action: none;
      }
      #mask-editor canvas.grid.pan { cursor: grab; }
      #mask-editor .controls { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
      #mask-editor .group { display: flex; gap: 6px; align-items: center; }
      #mask-editor .strumenti { flex-wrap: wrap; }
      #mask-editor .campo { display: flex; align-items: center; gap: 8px; font-size: 12px; opacity: .85; }
      #mask-editor .campo[hidden] { display: none; }
      #mask-editor .campo input[type=range] { width: 130px; }
      #mask-editor .valore { min-width: 3.2em; text-align: center; font-variant-numeric: tabular-nums; }
      #mask-editor button {
        min-height: 40px; padding: 0 12px; border-radius: 8px;
        border: 1px solid #3a3a48; background: #2f2f3d; color: #e8e8ef;
        font: inherit; cursor: pointer; touch-action: manipulation; white-space: nowrap;
      }
      #mask-editor button:hover:not(:disabled) { background: #3a3a48; }
      #mask-editor button:disabled { opacity: .35; cursor: default; }
      #mask-editor button[aria-pressed="true"] { border-color: #ffd166; background: #4a4432; color: #ffd166; }
      #mask-editor .actions { display: flex; gap: 8px; }
      #mask-editor .actions button { flex: 1 1 auto; min-height: 44px; }
      #mask-editor .actions .primary { border-color: #4a7a5a; background: #2c4436; }
    `;
  }
}

function stepButton(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.onclick = onClick;
  return b;
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

type Box = { x0: number; y0: number; x1: number; y1: number } | null;

/** Il rettangolo che contiene entrambi, per ridisegnare una volta sola. */
function union(a: Box, b: Box): Box {
  if (!a) return b;
  if (!b) return a;
  return {
    x0: Math.min(a.x0, b.x0),
    y0: Math.min(a.y0, b.y0),
    x1: Math.max(a.x1, b.x1),
    y1: Math.max(a.y1, b.y1),
  };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Number.isFinite(n) ? n : lo));
}
