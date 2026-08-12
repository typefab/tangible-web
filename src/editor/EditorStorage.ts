import type { SerializedProject } from '../level/project';

/**
 * Il lavoro dell'editor conservato nel browser.
 *
 * Serve perche' fra il momento in cui si costruisce e il momento in cui il
 * lavoro arriva davvero nel gioco c'e' un passaggio manuale — scarica il file,
 * caricalo su GitHub — e in mezzo ci sta una scheda chiusa per sbaglio.
 *
 * `dirty` distingue le due cose che l'utente vive come diverse:
 *
 * - `true`  -> autosave: modifiche che non ha mai confermato
 * - `false` -> ha premuto Salva: ha deciso lui che quello e' lo stato buono
 *
 * Non si ripristina mai niente in silenzio. All'apertura, se quello che c'e'
 * qui non coincide con `public/level.json`, la scelta la fa lui.
 */
export interface StoredWork {
  /** Millisecondi epoch dell'ultima scrittura. */
  savedAt: number;
  /** True se ci sono modifiche successive all'ultimo Salva. */
  dirty: boolean;
  /** La scheda su cui stava lavorando. */
  activeLevel: number;
  /**
   * Gli indici dei livelli che aveva aperti in schede.
   *
   * Facoltativo perche' i record scritti prima delle schede chiudibili non ce
   * l'hanno, e un lavoro salvato ieri deve continuare ad aprirsi: senza,
   * riparte con la sola scheda attiva.
   */
  open?: number[];
  project: SerializedProject;
}

/** La `v1` c'e' perche' un cambio di formato non deve leggere dati vecchi. */
const KEY = 'tangible-web:editor:v1';

/** Quanto si aspetta dopo l'ultima modifica prima di scrivere l'autosave. */
const AUTOSAVE_DELAY_MS = 800;

export class EditorStorage {
  private timer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Lo `localStorage` puo' non esserci (navigazione privata su alcuni browser,
   * quota piena, `file://` con restrizioni). Non e' un motivo per non far
   * partire l'editor: si perde il salvataggio, non il programma.
   */
  private static get store(): Storage | null {
    try {
      const probe = window.localStorage;
      probe.setItem(`${KEY}:probe`, '1');
      probe.removeItem(`${KEY}:probe`);
      return probe;
    } catch {
      return null;
    }
  }

  /** True se il browser ci lascia salvare: l'editor lo dice nella toolbar. */
  readonly available: boolean = EditorStorage.store !== null;

  read(): StoredWork | null {
    const raw = EditorStorage.store?.getItem(KEY);
    if (!raw) return null;

    try {
      const parsed = JSON.parse(raw) as StoredWork;
      // Un record senza progetto e' spazzatura: meglio ignorarlo che aprire
      // l'editor su un livello vuoto facendo credere di aver perso tutto.
      if (!parsed?.project?.levels?.length) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  /**
   * @returns false se non ha scritto — quasi sempre quota piena.
   *
   * Prima l'errore veniva ingoiato e basta: l'editor continuava a funzionare
   * ma non ricordava piu' niente, e **Salva diceva comunque "salvato"**. Con
   * due livelli non ci si arriva mai; con cento — 2 MB su un `localStorage` da
   * 5 — e' la strada normale per perdere una serata credendo di averla al
   * sicuro. Chi chiama decide cosa dire, ma deve saperlo.
   */
  write(work: Omit<StoredWork, 'savedAt'>): boolean {
    // Lo store si prende in una variabile: con `store?.setItem(...)` dentro il
    // try, quando lo store non c'e' non viene scritto niente e non viene
    // lanciato niente — cioe' si tornava "scritto" senza aver scritto.
    const store = EditorStorage.store;
    if (!store) return false;

    try {
      store.setItem(KEY, JSON.stringify({ ...work, savedAt: Date.now() }));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Rimanda la scrittura di poco. Senza, ogni cella di un trascinamento
   * serializzerebbe l'intero progetto.
   */
  queueAutosave(collect: () => Omit<StoredWork, 'savedAt'>): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.write(collect());
    }, AUTOSAVE_DELAY_MS);
  }

  /** Scrive subito quello che era in coda. Da chiamare prima di uscire. */
  flush(collect: () => Omit<StoredWork, 'savedAt'>): void {
    if (!this.timer) return;
    clearTimeout(this.timer);
    this.timer = null;
    this.write(collect());
  }

  clear(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    try {
      EditorStorage.store?.removeItem(KEY);
    } catch {
      // Vedi write(): niente di recuperabile da fare.
    }
  }
}

/** "oggi alle 14:32" / "il 6 agosto alle 14:32", per il dialogo di ripresa. */
export function describeWhen(epochMs: number): string {
  const date = new Date(epochMs);
  const time = date.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  const sameDay = new Date().toDateString() === date.toDateString();
  return sameDay
    ? `oggi alle ${time}`
    : `il ${date.toLocaleDateString('it-IT', { day: 'numeric', month: 'long' })} alle ${time}`;
}
