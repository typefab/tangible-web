import { isRuntimeBlock, resolveBlock } from '../assets/catalog';
import { MaskEditor } from './MaskEditor';

/**
 * L'editor d'immagine: da una foto qualsiasi a uno sprite pixel-art.
 *
 * Vive in un file suo per la stessa ragione del cassetto: non sa niente di
 * layer, undo o proiezione. Sa solo prendere un'immagine, toglierle lo sfondo,
 * ridurla a pixel-art e consegnare un PNG. Chi lo apre decide cosa farne.
 *
 * **Tutto lato client, con `<canvas>`.** Nessun servizio, nessuna installazione,
 * gira anche da telefono: sono i cinque vincoli. Lo sfondo si toglie con un
 * flood-fill dai bordi — niente modelli da scaricare — e la pixel-art e' un
 * ridimensionamento a campionamento netto. Grezzo ma prevedibile, e con la
 * soglia in mano ci si arriva.
 *
 * La persistenza e' **ibrida**: "Aggiungi al livello" registra lo sprite come
 * blocco di sessione, piazzabile subito; "Scarica PNG" da' il file da committare
 * in `src/assets/blocks/`, che e' l'unico modo di renderlo davvero permanente e
 * condiviso. Il pannello lo dice, perche' la differenza non si vede.
 */
export interface ImportedSprite {
  /** L'id/nome-file: e' quello che finira' in `level.json` e nel PNG committato. */
  id: string;
  label: string;
  /** La cartella-categoria suggerita, gia' resa sicura per un nome di file. */
  category: string;
  /** Lo sprite finito, alla dimensione scelta: la sorgente della texture di sessione. */
  canvas: HTMLCanvasElement;
  /** Lo stesso, come data URI PNG, per l'anteprima e il download. */
  dataUrl: string;
}

export interface SpriteImporterDeps {
  /** Registra lo sprite come blocco di sessione e lo sceglie. Vedi l'editor. */
  onImport: (sprite: ImportedSprite) => void;
}

/**
 * Il lato piu' lungo dell'immagine di lavoro. Alto perche' gli sprite sono
 * grandi (oltre 200px): la sorgente deve tenere il dettaglio prima di ridurla,
 * altrimenti la pixel-art finale la ingrandirebbe sfocandola.
 */
const WORK_MAX = 1024;

/** Estremi e passo del lato in pixel dello sprite. Il passo e' quello delle frecce. */
const SIZE = { min: 8, max: 512, step: 8, initial: 128 } as const;

export class SpriteImporter {
  private readonly root: HTMLDivElement;
  private fileInput!: HTMLInputElement;
  private preview!: HTMLCanvasElement;
  private nameInput!: HTMLInputElement;
  private categoryInput!: HTMLInputElement;
  private toleranceInput!: HTMLInputElement;
  private sizeInput!: HTMLInputElement;
  private removeBgInput!: HTMLInputElement;
  private addButton!: HTMLButtonElement;
  private cropButton!: HTMLButtonElement;
  private pickButton!: HTMLButtonElement;
  private pickSwatch!: HTMLSpanElement;
  private pickReset!: HTMLButtonElement;
  private downloadLink!: HTMLAnchorElement;
  private note!: HTMLParagraphElement;
  private readonly maskEditor = new MaskEditor();

  /** L'immagine caricata, ridotta a `WORK_MAX`. Da qui riparte ogni ricalcolo. */
  private source: HTMLCanvasElement | null = null;
  /** Lo sprite finito dell'ultimo ricalcolo: quello che si aggiunge o si scarica. */
  private result: HTMLCanvasElement | null = null;

  /** Vero mentre si aspetta il tocco che indica lo sfondo. */
  private picking = false;
  /**
   * Il punto indicato col contagocce, in coordinate della **sorgente**: e' li'
   * che il colore e' ancora quello vero, e non cambia se si cambia il lato in
   * pixel. `null` = si torna a dedurlo dai quattro angoli.
   */
  private picked: { x: number; y: number } | null = null;
  /**
   * Dove e quanto ingrandito e' stato disegnato l'ultimo sprite nell'anteprima.
   * Serve a riportare indietro un tocco: ricalcolarlo a mano darebbe due conti
   * da tenere allineati, ed e' il modo di sbagliare di un pixel.
   */
  private previewFit: { x: number; y: number; scale: number; w: number; h: number } | null = null;

  constructor(private readonly deps: SpriteImporterDeps) {
    this.root = document.createElement('div');
    this.root.id = 'sprite-importer';
    this.root.hidden = true;
    this.root.innerHTML = `<style>${SpriteImporter.style()}</style>`;
    this.build();
    document.body.appendChild(this.root);
  }

  open(): void {
    this.reset();
    this.root.hidden = false;
  }

  close(): void {
    this.root.hidden = true;
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  /**
   * Chiude cio' che di suo sta piu' in alto: prima la matita, poi il pannello.
   * `false` se non c'era niente di aperto. Lo usa il tasto indietro, che scende
   * la pila un gradino per volta invece di spazzare via tutto.
   */
  cancelTopmost(): boolean {
    if (this.maskEditor.cancel()) return true;
    if (!this.isOpen) return false;
    this.close();
    return true;
  }

  private reset(): void {
    this.source = null;
    this.result = null;
    this.fileInput.value = '';
    this.nameInput.value = '';
    this.categoryInput.value = 'importati';
    this.picking = false;
    this.picked = null;
    this.previewFit = null;
    this.refreshPicker();
    this.clearPreview();
    this.setReady(false);
    this.note.textContent = 'Carica un’immagine per cominciare.';
  }

  private build(): void {
    const box = document.createElement('div');
    box.className = 'box';
    this.root.appendChild(box);

    const head = document.createElement('div');
    head.className = 'head';
    head.innerHTML = '<h2>Importa sprite</h2>';
    const chiudi = document.createElement('button');
    chiudi.className = 'chiudi';
    chiudi.textContent = '✕';
    chiudi.title = 'Chiudi';
    chiudi.onclick = () => this.close();
    head.appendChild(chiudi);
    box.appendChild(head);

    // Sorgente: dal file-picker, che su telefono e' galleria/foto/file. Niente
    // SFTP ne' servizi: e' la via compatibile coi vincoli per "parto da un'immagine".
    this.fileInput = document.createElement('input');
    this.fileInput.type = 'file';
    this.fileInput.accept = 'image/*';
    this.fileInput.className = 'file';
    this.fileInput.onchange = () => void this.onFile();
    box.appendChild(this.fileInput);

    // Anteprima su scacchiera: la trasparenza si deve vedere, altrimenti non si
    // sa se lo sfondo e' stato tolto o e' solo diventato bianco.
    this.preview = document.createElement('canvas');
    this.preview.className = 'preview';
    this.preview.width = 192;
    this.preview.height = 192;
    this.preview.onclick = (e) => this.pickFromPreview(e);
    box.appendChild(this.preview);

    box.appendChild(this.controls());

    // La matita: rifinire a mano i bordi che il flood-fill non indovina. Viene
    // dopo l'automatico, e agisce sui pixel finali — quello che tagli si gioca.
    this.cropButton = document.createElement('button');
    this.cropButton.className = 'ritaglia';
    this.cropButton.textContent = '✏️ Ritaglia a mano';
    this.cropButton.title = 'Gomma e ripristino pixel per pixel, sui bordi complessi';
    this.cropButton.onclick = () => void this.crop();
    box.appendChild(this.cropButton);

    this.note = document.createElement('p');
    this.note.className = 'note';
    box.appendChild(this.note);

    const actions = document.createElement('div');
    actions.className = 'actions';
    this.addButton = document.createElement('button');
    this.addButton.className = 'primary';
    this.addButton.textContent = 'Aggiungi al livello';
    this.addButton.title = 'Registra lo sprite per questa sessione e lo sceglie';
    this.addButton.onclick = () => this.emit();
    actions.appendChild(this.addButton);

    this.downloadLink = document.createElement('a');
    this.downloadLink.className = 'scarica';
    this.downloadLink.textContent = 'Scarica PNG';
    this.downloadLink.title = 'Il file da committare in src/assets/blocks/ per renderlo permanente';
    actions.appendChild(this.downloadLink);
    box.appendChild(actions);
  }

  private controls(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'controls';

    this.nameInput = labelledInput(wrap, 'Nome', 'text', 'muro_di_pietra');
    this.nameInput.oninput = () => this.refreshNameHints();

    this.categoryInput = labelledInput(wrap, 'Categoria', 'text', 'importati');

    // Togliere lo sfondo e' facoltativo: una PNG gia' ritagliata non deve essere
    // bucata da un flood-fill che parte da un bordo gia' trasparente.
    const bgRow = document.createElement('label');
    bgRow.className = 'check';
    this.removeBgInput = document.createElement('input');
    this.removeBgInput.type = 'checkbox';
    this.removeBgInput.checked = true;
    this.removeBgInput.onchange = () => this.recompute();
    bgRow.append(this.removeBgInput, document.createTextNode('Togli lo sfondo'));
    wrap.appendChild(bgRow);

    this.toleranceInput = labelledInput(wrap, 'Tolleranza sfondo', 'range', '');
    this.toleranceInput.min = '0';
    this.toleranceInput.max = '150';
    this.toleranceInput.value = '60';
    this.toleranceInput.oninput = () => this.recompute();

    // Lato in pixel: si scrive a mano **oppure** con le frecce, un passo per volta.
    // Il contagocce sta accanto alla tolleranza perche' sono la stessa domanda:
    // "qual e' lo sfondo" e "quanto largo lo intendo".
    const pick = document.createElement('div');
    pick.className = 'pescasfondo';
    this.pickButton = document.createElement('button');
    this.pickButton.type = 'button';
    this.pickButton.className = 'contagocce';
    this.pickButton.textContent = '💧 Indica lo sfondo';
    this.pickButton.title = 'Tocca l\u2019anteprima nel punto in cui c\u2019e\u2019 lo sfondo';
    this.pickButton.onclick = () => this.togglePicking();
    this.pickSwatch = document.createElement('span');
    this.pickSwatch.className = 'campione';
    this.pickReset = document.createElement('button');
    this.pickReset.type = 'button';
    this.pickReset.className = 'freccia';
    this.pickReset.textContent = '↺';
    this.pickReset.title = 'Torna a dedurre lo sfondo dai quattro angoli';
    this.pickReset.onclick = () => {
      this.picked = null;
      this.picking = false;
      this.recompute();
    };
    pick.append(this.pickButton, this.pickSwatch, this.pickReset);
    wrap.appendChild(pick);

    this.sizeInput = steppedNumber(wrap, 'Lato in pixel', SIZE, () => this.recompute());

    return wrap;
  }

  // ------------------------------------------------------------ contagocce

  private togglePicking(): void {
    this.picking = !this.picking;
    this.recompute();
  }

  /**
   * Riporta un tocco sull'anteprima fino al pixel della sorgente.
   *
   * Si campiona la **sorgente** e non lo sprite ridotto: dopo il ritaglio quel
   * punto puo' essere gia' trasparente, e si prenderebbe il nulla invece del
   * colore che si sta indicando.
   */
  private pickFromPreview(e: MouseEvent): void {
    if (!this.picking || !this.source || !this.previewFit) return;

    const rect = this.preview.getBoundingClientRect();
    const cx = ((e.clientX - rect.left) / rect.width) * this.preview.width;
    const cy = ((e.clientY - rect.top) / rect.height) * this.preview.height;

    const fit = this.previewFit;
    const sx = Math.floor((cx - fit.x) / fit.scale);
    const sy = Math.floor((cy - fit.y) / fit.scale);
    // Fuori dall'immagine c'e' la scacchiera: li' non si sta indicando niente.
    if (sx < 0 || sy < 0 || sx >= fit.w || sy >= fit.h) return;

    this.picked = {
      x: clampInt(((sx + 0.5) * this.source.width) / fit.w, 0, this.source.width - 1),
      y: clampInt(((sy + 0.5) * this.source.height) / fit.h, 0, this.source.height - 1),
    };
    this.picking = false;
    this.recompute();
  }

  /** Il colore indicato, come lo legge la sorgente. */
  private pickedColor(): string | null {
    if (!this.source || !this.picked) return null;
    const d = this.source.getContext('2d')!.getImageData(this.picked.x, this.picked.y, 1, 1).data;
    return `rgb(${d[0]}, ${d[1]}, ${d[2]})`;
  }

  /** Allinea pulsante, campione e ripristino a com'e' messo il contagocce. */
  private refreshPicker(): void {
    this.preview.classList.toggle('pesca', this.picking);
    this.pickButton.setAttribute('aria-pressed', String(this.picking));
    this.pickButton.textContent = this.picking ? '💧 Tocca lo sfondo' : '💧 Indica lo sfondo';

    const colore = this.pickedColor();
    this.pickSwatch.style.background = colore ?? 'transparent';
    this.pickSwatch.classList.toggle('vuoto', colore === null);
    this.pickSwatch.title = colore ? `Sfondo indicato: ${colore}` : 'Sfondo dedotto dagli angoli';
    this.pickReset.hidden = this.picked === null;
  }

  /** Legge il file scelto, lo riduce a `WORK_MAX` e ricalcola. */
  private async onFile(): Promise<void> {
    const file = this.fileInput.files?.[0];
    if (!file) return;

    this.note.textContent = 'Carico…';
    try {
      const img = await loadImage(file);
      this.source = fitCanvas(img, WORK_MAX);
      if (!this.nameInput.value) this.nameInput.value = suggestName(file.name);
      this.recompute();
    } catch {
      this.note.textContent = 'Non sono riuscito a leggere quell’immagine.';
      this.source = null;
      this.setReady(false);
    }
  }

  /** Rifa' la pipeline dalla sorgente: togli sfondo, poi riduci a pixel-art. */
  private recompute(): void {
    if (!this.source) return;

    const work = cloneCanvas(this.source);
    if (this.removeBgInput.checked) {
      removeBackground(work, Number(this.toleranceInput.value), this.picked ?? undefined);
    }

    // Gli estremi sono quelli dello stepper: erano cablati a 256, e un lato piu'
    // grande scelto con le frecce veniva zitto zitto dimezzato.
    const side = clampInt(Number(this.sizeInput.value), SIZE.min, SIZE.max);
    this.result = pixelate(work, side);
    // Col contagocce armato l'anteprima mostra i colori veri, senza il ritaglio:
    // se lo sfondo e' stato tolto male non ci sarebbe piu' niente da indicare.
    this.drawPreview(this.picking ? pixelate(this.source, side) : this.result);
    this.refreshPicker();
    this.refreshNameHints();
    this.setReady(true);
  }

  /** Disegna il risultato ingrandito a punti netti sopra la scacchiera. */
  private drawPreview(sprite: HTMLCanvasElement): void {
    const ctx = this.preview.getContext('2d')!;
    const { width: W, height: H } = this.preview;
    ctx.clearRect(0, 0, W, H);
    drawChecker(ctx, W, H);

    // Ingrandito quanto ci sta, mantenendo le proporzioni e i pixel quadrati.
    const scale = Math.floor(Math.min(W / sprite.width, H / sprite.height)) || 1;
    const dw = sprite.width * scale;
    const dh = sprite.height * scale;
    const x = (W - dw) / 2;
    const y = (H - dh) / 2;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(sprite, x, y, dw, dh);
    this.previewFit = { x, y, scale, w: sprite.width, h: sprite.height };
  }

  private clearPreview(): void {
    const ctx = this.preview.getContext('2d')!;
    ctx.clearRect(0, 0, this.preview.width, this.preview.height);
    drawChecker(ctx, this.preview.width, this.preview.height);
  }

  /** Aggiorna id, link di download e avviso di collisione col nome corrente. */
  private refreshNameHints(): void {
    const id = slugId(this.nameInput.value);
    if (this.result && id) {
      this.downloadLink.href = this.result.toDataURL('image/png');
      this.downloadLink.download = `${id}.png`;
    } else {
      this.downloadLink.removeAttribute('href');
    }

    const category = slugId(this.categoryInput.value) || 'importati';
    if (!id) {
      this.note.textContent = 'Dai un nome allo sprite.';
    } else if (isBuiltIn(id)) {
      // Sovrascrivere in sessione un id che esiste anche come file confonderebbe:
      // quello del repository tornerebbe alla ricarica, questo no.
      this.note.textContent = `“${id}” esiste gia' nel repository: scegli un altro nome.`;
    } else {
      this.note.textContent = `Committa in src/assets/blocks/${category}/${id}.png per renderlo permanente.`;
    }
  }

  private emit(): void {
    if (!this.result) return;
    const id = slugId(this.nameInput.value);
    if (!id || isBuiltIn(id)) {
      this.refreshNameHints();
      return;
    }
    const category = slugId(this.categoryInput.value) || 'importati';
    this.deps.onImport({
      id,
      label: this.nameInput.value.trim() || id,
      category,
      canvas: this.result,
      dataUrl: this.result.toDataURL('image/png'),
    });
    this.close();
  }

  /**
   * Apre la matita sul risultato corrente e, se si conferma, lo sostituisce.
   *
   * Viene dopo l'automatico di proposito: rifinisce i pixel finali. Cambiare poi
   * dimensione o tolleranza rifa' la griglia e con lei i ritocchi — lo dice la
   * nota, invece di buttarli via in silenzio.
   */
  private async crop(): Promise<void> {
    if (!this.result) return;
    const edited = await this.maskEditor.open(this.result);
    if (!edited) return;
    this.result = edited;
    this.drawPreview(edited);
    this.refreshNameHints();
    this.note.textContent =
      'Ritocchi a mano applicati. Cambiare dimensione o tolleranza li rifa’.';
  }

  /** Abilita le azioni solo quando c'e' davvero un risultato da consegnare. */
  private setReady(ready: boolean): void {
    this.addButton.disabled = !ready;
    this.cropButton.disabled = !ready;
    this.downloadLink.classList.toggle('disabled', !ready);
  }

  private static style(): string {
    return `
      #sprite-importer {
        position: fixed; inset: 0; z-index: 120;
        display: flex; align-items: center; justify-content: center;
        padding: 16px; background: #12121acc;
        font: 14px/1.5 system-ui, sans-serif; color: #e8e8ef;
      }
      #sprite-importer[hidden] { display: none; }
      #sprite-importer .box {
        width: 100%; max-width: 420px; max-height: 90vh; overflow-y: auto;
        padding: 18px; border-radius: 12px; border: 1px solid #3a3a48;
        background: #24242e; display: flex; flex-direction: column; gap: 12px;
      }
      #sprite-importer .head { display: flex; align-items: center; gap: 8px; }
      #sprite-importer .head h2 { margin: 0; font-size: 16px; flex: 1 1 auto; }
      #sprite-importer .chiudi {
        min-height: 36px; min-width: 36px; border-radius: 8px;
        border: 1px solid #3a3a48; background: #2f2f3d; color: #e8e8ef; cursor: pointer;
      }
      #sprite-importer .file { font: inherit; color: inherit; }
      #sprite-importer .preview {
        align-self: center; width: 192px; height: 192px;
        border-radius: 8px; border: 1px solid #3a3a48; background: #1b1b22;
        image-rendering: pixelated;
      }
      #sprite-importer .controls { display: flex; flex-direction: column; gap: 8px; }
      #sprite-importer label.campo { display: flex; flex-direction: column; gap: 2px; font-size: 12px; opacity: .85; }
      #sprite-importer label.check { display: flex; align-items: center; gap: 8px; }
      #sprite-importer input[type=text], #sprite-importer input[type=number] {
        min-height: 38px; padding: 0 10px; border-radius: 8px;
        border: 1px solid #3a3a48; background: #2f2f3d; color: #e8e8ef; font: inherit;
      }
      #sprite-importer input[type=range] { width: 100%; }
      #sprite-importer .pescasfondo { display: flex; gap: 6px; align-items: center; }
      #sprite-importer .contagocce {
        flex: 1 1 auto; min-height: 38px; padding: 0 12px; border-radius: 8px;
        border: 1px solid #3a3a48; background: #2f2f3d; color: #e8e8ef;
        font: inherit; cursor: pointer; touch-action: manipulation;
      }
      #sprite-importer .contagocce:hover { background: #3a3a48; }
      #sprite-importer .contagocce[aria-pressed="true"] {
        border-color: #ffd166; background: #4a4432; color: #ffd166;
      }
      /* Il campione mostra il colore preso: la scacchiera sotto dice "nessuno". */
      #sprite-importer .campione {
        flex: 0 0 auto; width: 38px; height: 38px; border-radius: 8px;
        border: 1px solid #3a3a48;
      }
      #sprite-importer .campione.vuoto {
        background-image:
          linear-gradient(45deg, #2a2a34 25%, transparent 25%, transparent 75%, #2a2a34 75%),
          linear-gradient(45deg, #2a2a34 25%, transparent 25%, transparent 75%, #2a2a34 75%);
        background-size: 12px 12px; background-position: 0 0, 6px 6px;
        background-color: #20202a;
      }
      #sprite-importer .pescasfondo .freccia[hidden] { display: none; }
      /* In modo contagocce il puntatore dice che l'anteprima e' diventata un bersaglio. */
      #sprite-importer .preview.pesca { cursor: crosshair; }
      #sprite-importer .stepper { display: flex; gap: 6px; align-items: stretch; }
      #sprite-importer .stepper input { flex: 1 1 auto; text-align: center; }
      #sprite-importer .stepper .freccia {
        flex: 0 0 auto; min-width: 44px; min-height: 38px; font-size: 18px; line-height: 1;
        border-radius: 8px; border: 1px solid #3a3a48; background: #2f2f3d; color: #e8e8ef;
        cursor: pointer; touch-action: manipulation;
      }
      #sprite-importer .stepper .freccia:hover { background: #3a3a48; }
      #sprite-importer .ritaglia {
        min-height: 42px; padding: 0 14px; border-radius: 8px; align-self: stretch;
        border: 1px solid #3a3a48; background: #2f2f3d; color: #e8e8ef;
        font: inherit; cursor: pointer; touch-action: manipulation;
      }
      #sprite-importer .ritaglia:hover:not(:disabled) { background: #3a3a48; }
      #sprite-importer .ritaglia:disabled { opacity: .35; cursor: default; }
      #sprite-importer .note { margin: 0; font-size: 12px; opacity: .7; min-height: 2.4em; }
      #sprite-importer .actions { display: flex; gap: 8px; flex-wrap: wrap; }
      #sprite-importer .actions button, #sprite-importer .actions a {
        flex: 1 1 auto; min-height: 44px; padding: 0 14px; border-radius: 8px;
        border: 1px solid #3a3a48; background: #2f2f3d; color: #e8e8ef;
        font: inherit; cursor: pointer; text-align: center;
        display: inline-flex; align-items: center; justify-content: center; text-decoration: none;
      }
      #sprite-importer .actions .primary { border-color: #4a7a5a; background: #2c4436; }
      #sprite-importer .actions button:disabled { opacity: .35; cursor: default; }
      #sprite-importer .actions a.disabled { opacity: .35; pointer-events: none; }
    `;
  }
}

/** Un campo con etichetta sopra. Torna l'input, cosi' chi chiama ci lega gli eventi. */
function labelledInput(
  parent: HTMLElement,
  label: string,
  type: string,
  placeholder: string,
): HTMLInputElement {
  const wrap = document.createElement('label');
  wrap.className = 'campo';
  wrap.appendChild(document.createTextNode(label));
  const input = document.createElement('input');
  input.type = type;
  if (placeholder) input.placeholder = placeholder;
  wrap.appendChild(input);
  parent.appendChild(wrap);
  return input;
}

/**
 * Un campo numerico con le frecce: si scrive il valore **oppure** lo si muove a
 * passi con − e +. Le frecce servono sul telefono, dove i puntini nativi dello
 * spinner sono minuscoli o non ci sono. Torna l'input.
 */
function steppedNumber(
  parent: HTMLElement,
  label: string,
  range: { min: number; max: number; step: number; initial: number },
  onChange: () => void,
): HTMLInputElement {
  const wrap = document.createElement('label');
  wrap.className = 'campo';
  wrap.appendChild(document.createTextNode(label));

  const row = document.createElement('div');
  row.className = 'stepper';
  const input = document.createElement('input');
  input.type = 'number';
  input.min = String(range.min);
  input.max = String(range.max);
  input.step = String(range.step);
  input.value = String(range.initial);

  const bump = (by: number): void => {
    input.value = String(clampInt(Number(input.value) + by, range.min, range.max));
    onChange();
  };
  const dec = stepArrow('−', () => bump(-range.step));
  const inc = stepArrow('+', () => bump(range.step));
  input.oninput = () => onChange();

  row.append(dec, input, inc);
  wrap.appendChild(row);
  parent.appendChild(wrap);
  return input;
}

/** Una freccia dello stepper. `type=button` per non far scattare il <label> attorno. */
function stepArrow(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'freccia';
  b.textContent = label;
  b.onclick = onClick;
  return b;
}

/** Carica un `File` immagine in un elemento decodificato. */
function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('immagine illeggibile'));
    };
    img.src = url;
  });
}

/** Disegna l'immagine in un canvas col lato lungo a `max`, proporzioni intatte. */
function fitCanvas(img: HTMLImageElement, max: number): HTMLCanvasElement {
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function cloneCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = src.width;
  canvas.height = src.height;
  canvas.getContext('2d')!.drawImage(src, 0, 0);
  return canvas;
}

/**
 * Rende trasparente lo sfondo con un flood-fill dai bordi.
 *
 * Lo sfondo e' cio' che tocca il bordo ed e' vicino di colore ai quattro
 * angoli: si parte da li' e si dilaga finche' il colore resta simile. Un
 * flood-fill e non una sostituzione globale apposta — un colore uguale a quello
 * dello sfondo ma *dentro* la figura non deve sparire, perche' non e' connesso
 * al bordo.
 */
function removeBackground(
  canvas: HTMLCanvasElement,
  tolerance: number,
  picked?: { x: number; y: number },
): void {
  const ctx = canvas.getContext('2d')!;
  const { width: w, height: h } = canvas;
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;

  // Il riferimento: il colore indicato col contagocce, se c'e', altrimenti i
  // quattro angoli. Indicarlo serve quando gli angoli non sono sfondo — con la
  // figura che ne occupa uno, il riferimento automatico e' la figura stessa, e
  // il ritaglio mangia proprio cio' che si voleva tenere.
  const reference = picked
    ? [sampleRGB(d, (clampInt(picked.y, 0, h - 1) * w + clampInt(picked.x, 0, w - 1)) * 4)]
    : [
        [0, 0],
        [w - 1, 0],
        [0, h - 1],
        [w - 1, h - 1],
      ].map(([x, y]) => sampleRGB(d, (y * w + x) * 4));

  const near = (i: number): boolean =>
    reference.some((c) => colorDist(d, i * 4, c) <= tolerance);

  const visited = new Uint8Array(w * h);
  const stack: number[] = [];
  const seed = (x: number, y: number): void => {
    const i = y * w + x;
    if (!visited[i] && near(i)) {
      visited[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < w; x++) {
    seed(x, 0);
    seed(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    seed(0, y);
    seed(w - 1, y);
  }
  // Il punto indicato e' un seme anche se non tocca nessun bordo: e' cosi' che
  // cade una zona di sfondo chiusa dentro la figura — il buco nel manico della
  // tazza — che partendo dai soli bordi non si raggiunge.
  if (picked) seed(clampInt(picked.x, 0, w - 1), clampInt(picked.y, 0, h - 1));

  while (stack.length > 0) {
    const i = stack.pop()!;
    d[i * 4 + 3] = 0; // trasparente
    const x = i % w;
    const y = (i / w) | 0;
    if (x > 0) seed(x - 1, y);
    if (x < w - 1) seed(x + 1, y);
    if (y > 0) seed(x, y - 1);
    if (y < h - 1) seed(x, y + 1);
  }

  ctx.putImageData(img, 0, 0);
}

function sampleRGB(d: Uint8ClampedArray, i: number): [number, number, number] {
  return [d[i]!, d[i + 1]!, d[i + 2]!];
}

/** Distanza euclidea in RGB fra il pixel `i` e un colore. */
function colorDist(d: Uint8ClampedArray, i: number, c: [number, number, number]): number {
  const dr = d[i]! - c[0];
  const dg = d[i + 1]! - c[1];
  const db = d[i + 2]! - c[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

/**
 * Riduce l'immagine a una griglia di lato `side` (il lato lungo), a
 * campionamento netto: e' quello che le da' l'aspetto a pixel. La trasparenza
 * passa, cosi' lo sfondo tolto resta tolto.
 */
function pixelate(src: HTMLCanvasElement, side: number): HTMLCanvasElement {
  const scale = side / Math.max(src.width, src.height);
  const w = Math.max(1, Math.round(src.width * scale));
  const h = Math.max(1, Math.round(src.height * scale));
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const ctx = out.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(src, 0, 0, w, h);
  return out;
}

/** Scacchiera dietro l'anteprima, per far vedere dove l'immagine e' trasparente. */
function drawChecker(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const s = 8;
  for (let y = 0; y < h; y += s) {
    for (let x = 0; x < w; x += s) {
      ctx.fillStyle = ((x / s + y / s) & 1) === 0 ? '#2a2a34' : '#20202a';
      ctx.fillRect(x, y, s, s);
    }
  }
}

/** `Muro di Pietra!` -> `muro_di_pietra`: l'id deve essere un nome di file valido. */
function slugId(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** `foto_muro.png` -> `foto muro`, per riempire il nome senza estensione ne' underscore. */
function suggestName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
}

/**
 * True se l'id e' gia' un blocco vero del repository. Un id di sessione gia'
 * registrato non conta: rifare un import con lo stesso nome deve poterlo
 * sostituire, mentre pestare un file del repository lo si vieta — quello
 * tornerebbe alla ricarica e questo no, e la confusione sarebbe garantita.
 */
function isBuiltIn(id: string): boolean {
  return resolveBlock(id) !== undefined && !isRuntimeBlock(id);
}

function clampInt(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(Number.isFinite(n) ? n : lo)));
}
