/**
 * L'editor a matita: ritagliare a mano i bordi di uno sprite, pixel per pixel.
 *
 * L'automatico dell'importer prende lo sfondo piatto connesso ai bordi; le forme
 * complesse — e i buchi di sfondo *dentro* la sagoma — non li puo' indovinare.
 * Qui si lavora sui **pixel veri dello sprite**, quelli che verranno esportati:
 * quello che tagli e' quello che si gioca, senza il ricampionamento che una
 * modifica ad alta risoluzione si porterebbe dietro.
 *
 * Sta in un file suo perche' non sa niente di importer ne' di editor: prende un
 * canvas, restituisce lo stesso canvas ritagliato, o niente se si annulla.
 */
type Tool = 'erase' | 'restore' | 'pan';

export class MaskEditor {
  private readonly root: HTMLDivElement;
  private viewport!: HTMLDivElement;
  private canvas!: HTMLCanvasElement;
  private toolButtons = new Map<Tool, HTMLButtonElement>();
  private brushInput!: HTMLInputElement;
  private zoomLabel!: HTMLSpanElement;
  private undoButton!: HTMLButtonElement;

  private tool: Tool = 'erase';
  private brush = 2;
  private zoom = 8;

  /** L'immagine di partenza, per il "ripristina": ci si torna, non alla foto grezza. */
  private base: ImageData | null = null;
  /** L'immagine su cui si dipinge, tenuta in memoria e ridata al canvas a ogni tratto. */
  private work: ImageData | null = null;
  /** Uno scatto per tratto: annullare torna all'inizio del tratto, non del pixel. */
  private undo: Uint8ClampedArray[] = [];
  private static readonly UNDO_MAX = 40;

  /** Come chiudere la sessione corrente: risolve la promessa di `open`. */
  private resolve: ((canvas: HTMLCanvasElement | null) => void) | null = null;
  private painting = false;
  private panFrom: { x: number; y: number; left: number; top: number } | null = null;

  constructor() {
    this.root = document.createElement('div');
    this.root.id = 'mask-editor';
    this.root.hidden = true;
    this.root.innerHTML = `<style>${MaskEditor.style()}</style>`;
    this.build();
    document.body.appendChild(this.root);
  }

  /**
   * Apre l'editor su una copia di `source` e promette il risultato: il canvas
   * ritagliato se si conferma, `null` se si annulla. `source` non viene toccato.
   */
  open(source: HTMLCanvasElement): Promise<HTMLCanvasElement | null> {
    this.canvas.width = source.width;
    this.canvas.height = source.height;
    const ctx = this.canvas.getContext('2d')!;
    ctx.clearRect(0, 0, source.width, source.height);
    ctx.drawImage(source, 0, 0);

    this.base = ctx.getImageData(0, 0, source.width, source.height);
    this.work = ctx.getImageData(0, 0, source.width, source.height);
    this.undo = [];
    this.updateUndo();

    // Uno zoom di partenza che fa stare la griglia in circa 300px: da li' si
    // stringe con +. Su uno sprite grande parte basso, su uno piccolo alto.
    this.zoom = clamp(Math.floor(300 / Math.max(source.width, source.height)) || 1, 1, 40);
    this.applyZoom();
    this.chooseTool('erase');

    this.root.hidden = false;
    return new Promise((resolve) => {
      this.resolve = resolve;
    });
  }

  private done(keep: boolean): void {
    this.root.hidden = true;
    const out = keep ? this.canvas : null;
    let result: HTMLCanvasElement | null = null;
    if (out) {
      // Una copia staccata: il canvas interno viene riusato alla prossima apertura.
      result = document.createElement('canvas');
      result.width = out.width;
      result.height = out.height;
      result.getContext('2d')!.drawImage(out, 0, 0);
    }
    const resolve = this.resolve;
    this.resolve = null;
    resolve?.(result);
  }

  private build(): void {
    const box = document.createElement('div');
    box.className = 'box';
    this.root.appendChild(box);

    const head = document.createElement('div');
    head.className = 'head';
    head.innerHTML = '<h2>Ritaglia a mano</h2>';
    box.appendChild(head);

    // La griglia, ingrandita e su scacchiera per far vedere la trasparenza.
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
    strumenti.className = 'group';
    const add = (tool: Tool, label: string, title: string): void => {
      const b = document.createElement('button');
      b.textContent = label;
      b.title = title;
      b.onclick = () => this.chooseTool(tool);
      strumenti.appendChild(b);
      this.toolButtons.set(tool, b);
    };
    add('erase', '🩹 Gomma', 'Rende trasparente');
    add('restore', '↩ Ripristina', 'Riporta il pixel com’era');
    add('pan', '✋ Sposta', 'Trascina per scorrere');
    wrap.appendChild(strumenti);

    // Pennello: quanti pixel di lato tocca un colpo. Su sprite grandi conviene largo.
    const brush = document.createElement('label');
    brush.className = 'campo';
    brush.appendChild(document.createTextNode('Pennello'));
    this.brushInput = document.createElement('input');
    this.brushInput.type = 'range';
    this.brushInput.min = '1';
    this.brushInput.max = '12';
    this.brushInput.value = String(this.brush);
    this.brushInput.oninput = () => {
      this.brush = clamp(Number(this.brushInput.value), 1, 12);
    };
    brush.appendChild(this.brushInput);
    wrap.appendChild(brush);

    // Zoom a passi interi: un pixel dev'essere un quadrato netto, non sfocato.
    const zoom = document.createElement('div');
    zoom.className = 'group zoom';
    const meno = stepButton('−', () => this.zoomBy(-1));
    this.zoomLabel = document.createElement('span');
    this.zoomLabel.className = 'zoom-val';
    const piu = stepButton('+', () => this.zoomBy(1));
    zoom.append(meno, this.zoomLabel, piu);
    wrap.appendChild(zoom);

    this.undoButton = document.createElement('button');
    this.undoButton.textContent = '↶ Annulla tratto';
    this.undoButton.onclick = () => this.undoStroke();
    wrap.appendChild(this.undoButton);

    return wrap;
  }

  private chooseTool(tool: Tool): void {
    this.tool = tool;
    for (const [t, b] of this.toolButtons) b.setAttribute('aria-pressed', String(t === tool));
    this.canvas.classList.toggle('pan', tool === 'pan');
  }

  private zoomBy(delta: number): void {
    this.zoom = clamp(this.zoom + delta, 1, 40);
    this.applyZoom();
  }

  private applyZoom(): void {
    this.canvas.style.width = `${this.canvas.width * this.zoom}px`;
    this.canvas.style.height = `${this.canvas.height * this.zoom}px`;
    this.zoomLabel.textContent = `${this.zoom}×`;
  }

  // ------------------------------------------------------------------ disegno

  private bindPointer(): void {
    this.canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    this.canvas.addEventListener('pointermove', (e) => this.onMove(e));
    // Sul window e non sul canvas: un tratto puo' finire fuori dalla griglia.
    window.addEventListener('pointerup', () => this.onUp());
  }

  private onDown(e: PointerEvent): void {
    e.preventDefault();
    if (this.tool === 'pan') {
      this.panFrom = {
        x: e.clientX,
        y: e.clientY,
        left: this.viewport.scrollLeft,
        top: this.viewport.scrollTop,
      };
      return;
    }
    this.pushUndo();
    this.painting = true;
    this.paintAt(e);
  }

  private onMove(e: PointerEvent): void {
    if (this.tool === 'pan' && this.panFrom) {
      this.viewport.scrollLeft = this.panFrom.left - (e.clientX - this.panFrom.x);
      this.viewport.scrollTop = this.panFrom.top - (e.clientY - this.panFrom.y);
      return;
    }
    if (this.painting) this.paintAt(e);
  }

  private onUp(): void {
    this.painting = false;
    this.panFrom = null;
  }

  /** Dipinge il pennello centrato sul pixel sotto il puntatore. */
  private paintAt(e: PointerEvent): void {
    if (!this.work || !this.base) return;
    const rect = this.canvas.getBoundingClientRect();
    const gx = Math.floor(((e.clientX - rect.left) / rect.width) * this.canvas.width);
    const gy = Math.floor(((e.clientY - rect.top) / rect.height) * this.canvas.height);
    const r = this.brush - 1;
    const w = this.canvas.width;
    const h = this.canvas.height;

    for (let y = gy - r; y <= gy + r; y++) {
      for (let x = gx - r; x <= gx + r; x++) {
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const i = (y * w + x) * 4;
        if (this.tool === 'erase') {
          this.work.data[i + 3] = 0;
        } else {
          // Ripristina: torna al pixel della base, colore e opacita' insieme.
          this.work.data[i] = this.base.data[i]!;
          this.work.data[i + 1] = this.base.data[i + 1]!;
          this.work.data[i + 2] = this.base.data[i + 2]!;
          this.work.data[i + 3] = this.base.data[i + 3]!;
        }
      }
    }
    this.canvas.getContext('2d')!.putImageData(this.work, 0, 0);
  }

  private pushUndo(): void {
    if (!this.work) return;
    this.undo.push(this.work.data.slice());
    if (this.undo.length > MaskEditor.UNDO_MAX) this.undo.shift();
    this.updateUndo();
  }

  private undoStroke(): void {
    const prev = this.undo.pop();
    if (!prev || !this.work) return;
    this.work.data.set(prev);
    this.canvas.getContext('2d')!.putImageData(this.work, 0, 0);
    this.updateUndo();
  }

  private updateUndo(): void {
    this.undoButton.disabled = this.undo.length === 0;
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
        width: 100%; max-width: 520px; max-height: 92vh; overflow: hidden;
        padding: 16px; border-radius: 12px; border: 1px solid #3a3a48;
        background: #24242e; display: flex; flex-direction: column; gap: 12px;
      }
      #mask-editor h2 { margin: 0; font-size: 16px; }
      #mask-editor .viewport {
        overflow: auto; flex: 1 1 auto; min-height: 240px; max-height: 55vh;
        border-radius: 8px; border: 1px solid #3a3a48;
        /* Scacchiera dietro: fa vedere dove la griglia e' trasparente. */
        background-color: #20202a;
        background-image:
          linear-gradient(45deg, #2a2a34 25%, transparent 25%, transparent 75%, #2a2a34 75%),
          linear-gradient(45deg, #2a2a34 25%, transparent 25%, transparent 75%, #2a2a34 75%);
        background-size: 16px 16px; background-position: 0 0, 8px 8px;
        display: grid; place-content: center;
      }
      #mask-editor canvas.grid {
        image-rendering: pixelated; touch-action: none; cursor: crosshair;
        /* Il canvas puo' essere piu' grande del viewport: lo scroll lo raggiunge. */
      }
      #mask-editor canvas.grid.pan { cursor: grab; }
      #mask-editor .controls { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
      #mask-editor .group { display: flex; gap: 6px; align-items: center; }
      #mask-editor .campo { display: flex; align-items: center; gap: 6px; font-size: 12px; opacity: .85; }
      #mask-editor .zoom-val { min-width: 2.4em; text-align: center; font-variant-numeric: tabular-nums; }
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
  b.textContent = label;
  b.onclick = onClick;
  return b;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(Number.isFinite(n) ? n : lo)));
}
