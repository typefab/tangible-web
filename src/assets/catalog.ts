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
}

/**
 * `eager` perche' l'elenco serve tutto e subito, in `preload()`.
 * `query: '?url'` perche' a Phaser va dato un percorso, non il contenuto.
 */
type UrlModules = Record<string, string>;

const blockFiles = import.meta.glob('./blocks/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as UrlModules;

const characterFiles = import.meta.glob('./characters/*.png', {
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
      return { id, label: labelFromId(id), url };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** Tutti i blocchi piazzabili, cioe' tutti i PNG in `src/assets/blocks/`. */
export const BLOCKS: readonly AssetDef[] = catalogOf(blockFiles);

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
