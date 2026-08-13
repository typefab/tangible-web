/**
 * Catalogo degli sprite del progetto.
 *
 * **La cartella decide la categoria, il nome del file decide l'id.**
 *
 * L'elenco non e' scritto a mano: `import.meta.glob` lo fa generare a Vite al
 * momento della build. Caricare `src/assets/blocks/dirt.png` e fare commit
 * basta a far comparire "Dirt" nella palette dell'editor e a renderlo
 * piazzabile — nessuna riga di codice da toccare.
 *
 * Il motivo per cui gli sprite stanno qui e non in `public/`: una pagina web
 * non puo' elencare il contenuto di una cartella remota. Da `public/` servirebbe
 * un elenco scritto a mano, che e' esattamente la cosa che divergerebbe.
 */

/** Uno sprite del catalogo, gia' risolto nel percorso servito dal browser. */
export interface AssetDef {
  /** Il nome del file senza estensione: e' l'id usato in `level.json`. */
  readonly id: string;
  /** Etichetta leggibile, derivata dall'id. */
  readonly label: string;
  /** URL da dare a `this.load.image()`. */
  readonly url: string;
  /**
   * La sottocartella in cui sta il PNG, se ce n'e' una: `blocks/natura/tree.png`
   * -> `natura`. E' quello che il cassetto dell'editor usa per raggruppare. Un
   * file messo direttamente in `blocks/` non ha categoria e finisce in quella
   * di default: la promessa "carichi un PNG, fai commit, compare" resta valida
   * anche senza cartelle.
   */
  readonly category?: string;
}

/**
 * `eager` perche' l'elenco serve tutto e subito, in `preload()`.
 * `query: '?url'` perche' a Phaser va dato un percorso, non il contenuto.
 */
type UrlModules = Record<string, string>;

// `**` e non `*`: una sottocartella di `blocks/` diventa una categoria del
// cassetto. I file lasciati direttamente in `blocks/` continuano a comparire,
// senza categoria: aggiungere le cartelle non e' obbligatorio.
const blockFiles = import.meta.glob('./blocks/**/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as UrlModules;

const characterFiles = import.meta.glob('./characters/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as UrlModules;

/**
 * I fondali. Stessa promessa dei blocchi: un PNG in `src/assets/backgrounds/`,
 * un commit, e compare nella palette dello strumento 🖼.
 *
 * `jpg` e `webp` oltre a `png` perche' un fondale e' grande: un cielo in PNG
 * pesa quanto tutto il resto del gioco messo insieme.
 */
const backgroundFiles = import.meta.glob('./backgrounds/*.{png,jpg,jpeg,webp}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as UrlModules;

const uiFiles = import.meta.glob('./ui/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as UrlModules;

/** `./blocks/red_brick.png` -> `red_brick` */
function idFromPath(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '');
}

/**
 * `./blocks/natura/tree.png` -> `natura`; `./blocks/tree.png` -> `undefined`.
 *
 * Prende solo il primo livello di sottocartella: le categorie sono un elenco
 * piatto, non un albero, perche' il cassetto e' un menu e non un file manager.
 */
function categoryFromPath(path: string): string | undefined {
  const parts = path.replace(/^\.\//, '').split('/');
  // parts = [cartella-radice, ...eventuali categorie, nomefile]: la categoria
  // e' il segmento subito dopo la radice, se prima del file ce n'e' uno.
  return parts.length >= 3 ? parts[1] : undefined;
}

/** `red_brick` -> `Red Brick`. Serve solo a farlo leggere nella palette. */
function labelFromId(id: string): string {
  return id
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/\b\p{Ll}/gu, (c) => c.toUpperCase());
}

/** Ordinato per id: cosi' la palette non cambia ordine tra una build e l'altra. */
function catalogOf(files: UrlModules): AssetDef[] {
  return Object.entries(files)
    .map(([path, url]) => {
      const id = idFromPath(path);
      return { id, label: labelFromId(id), url, category: categoryFromPath(path) };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** L'etichetta della categoria per i blocchi senza sottocartella. */
export const DEFAULT_CATEGORY = 'Generale';

/**
 * Blocchi creati dall'editor d'immagine, vivi solo in questa sessione.
 *
 * E' la meta' "runtime" dell'ibrido dello Strato 2: un PNG fatto nel browser si
 * puo' piazzare subito, ma non e' nel repository. A una ricarica sparisce, e un
 * `level.json` che lo usa mostra un buco per chiunque altro finche' il file non
 * viene committato in `src/assets/blocks/`. Restano un elenco separato dai
 * `BLOCKS` di build apposta per non far credere il contrario.
 */
const runtimeBlocks: AssetDef[] = [];

/**
 * I blocchi raggruppati per categoria, per il cassetto dell'editor.
 *
 * L'ordine delle categorie e' alfabetico ma con la default sempre in coda: sta
 * li' la roba non ancora ordinata in cartelle, ed e' giusto che non rubi il
 * primo posto a chi le cartelle le ha fatte.
 */
export function blocksByCategory(): { category: string; blocks: AssetDef[] }[] {
  const groups = new Map<string, AssetDef[]>();
  for (const block of [...BLOCKS, ...runtimeBlocks]) {
    const key = block.category ?? DEFAULT_CATEGORY;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(block);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => {
      if (a === DEFAULT_CATEGORY) return 1;
      if (b === DEFAULT_CATEGORY) return -1;
      return a.localeCompare(b);
    })
    .map(([category, blocks]) => ({ category, blocks }));
}

/** Tutti i blocchi piazzabili, cioe' tutti i PNG in `src/assets/blocks/`. */
export const BLOCKS: readonly AssetDef[] = catalogOf(blockFiles);

/** Tutti i fondali piazzabili, cioe' tutte le immagini in `src/assets/backgrounds/`. */
export const BACKGROUNDS: readonly AssetDef[] = catalogOf(backgroundFiles);

/** Personaggi e interfaccia: qui l'elenco serve solo a risolvere gli URL. */
export const CHARACTERS: readonly AssetDef[] = catalogOf(characterFiles);
export const UI: readonly AssetDef[] = catalogOf(uiFiles);

const blocksById = new Map(BLOCKS.map((b) => [b.id, b]));

/**
 * Id di blocco usati prima che il catalogo esistesse.
 *
 * Servono a non invalidare i `level.json` gia' esportati: un file salvato
 * quando i blocchi si chiamavano `block_0` deve continuare ad aprirsi.
 * Quando non ne resteranno in giro, questa mappa si cancella.
 */
const LEGACY_IDS: Record<string, string> = {
  block_0: 'basic',
  block_1: 'stack',
};

/**
 * Il blocco selezionato di partenza. E' il primo del catalogo in ordine
 * alfabetico, non un id cablato: se un giorno `basic.png` sparisse, l'editor
 * si aprirebbe comunque su qualcosa.
 */
export const DEFAULT_BLOCK_ID: string = BLOCKS[0]?.id ?? '';

/** Risolve un id di `level.json` in un blocco del catalogo, alias compresi. */
export function resolveBlock(id: string): AssetDef | undefined {
  return blocksById.get(id) ?? blocksById.get(LEGACY_IDS[id] ?? '');
}

/** L'id canonico da usare al posto di quello letto dal file. */
export function canonicalBlockId(id: string): string | undefined {
  return resolveBlock(id)?.id;
}

export function blockLabel(id: string): string {
  return resolveBlock(id)?.label ?? id;
}

/**
 * Registra (o sostituisce) un blocco di sessione, cosi' `resolveBlock` e il
 * cassetto lo vedono. La texture vera va aggiunta a parte al gioco: qui c'e'
 * solo la voce di catalogo. Torna la def registrata.
 */
export function registerRuntimeBlock(def: AssetDef): AssetDef {
  const i = runtimeBlocks.findIndex((b) => b.id === def.id);
  if (i >= 0) runtimeBlocks[i] = def;
  else runtimeBlocks.push(def);
  blocksById.set(def.id, def);
  return def;
}

/** True se l'id e' un blocco di sessione e non un file del repository. */
export function isRuntimeBlock(id: string): boolean {
  return runtimeBlocks.some((b) => b.id === id);
}

const backgroundsById = new Map(BACKGROUNDS.map((b) => [b.id, b]));

/**
 * Risolve l'id di un fondale letto da `level.json`.
 *
 * Come per i blocchi, l'elenco esiste solo dopo la build: un file che nomina
 * un'immagine cancellata dal repository va scartato a runtime, non puo'
 * accorgersene il compilatore.
 */
export function resolveBackground(id: string): AssetDef | undefined {
  return backgroundsById.get(id);
}

/** L'URL di uno sprite non-blocco, per nome del file. */
export function assetUrl(catalog: readonly AssetDef[], id: string): string | undefined {
  return catalog.find((a) => a.id === id)?.url;
}

if (BLOCKS.length === 0) {
  // Non e' un caso da gestire: e' un errore di contenuto del repository, e
  // senza un messaggio esplicito si presenterebbe come una palette vuota
  // senza spiegazione.
  console.error(
    'Nessun blocco in src/assets/blocks/. Carica almeno un PNG in quella cartella.',
  );
}
