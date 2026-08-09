/**
 * L'indice degli sprite, costruito da solo al momento della build.
 *
 * ## Due regole, e nient'altro da imparare
 *
 * **La cartella decide la categoria. Il nome del file decide l'id.**
 *
 * Un PNG lasciato cadere in `src/assets/blocks/dirt.png` diventa il blocco
 * `dirt`, compare nella palette dell'editor e si puo' piazzare, senza toccare
 * una riga di codice. Rinominarlo lo rinomina ovunque; spostarlo in un'altra
 * cartella ne cambia la categoria.
 *
 * ## Perche' gli sprite stanno in `src/` e non in `public/`
 *
 * Una pagina web non puo' elencare il contenuto di una cartella. Da `public/`
 * servirebbe un elenco scritto a mano, da tenere allineato ogni volta — cioe'
 * esattamente il lavoro che questo file esiste per eliminare. Da `src/` e'
 * Vite a generare l'elenco quando compila. Il prezzo e' che serve una build:
 * il tempo del deploy, non un'installazione.
 *
 * ## Cosa resta fuori
 *
 * Le cartelle che iniziano con `_` non finiscono nell'indice. Servono a
 * parcheggiare quello che non e' ancora stato classificato senza che compaia
 * nel gioco.
 */

/**
 * `eager` perche' l'indice serve gia' al `preload()` di Phaser, che non puo'
 * aspettare una import dinamica. `?url` perche' a Phaser va passato un
 * indirizzo da caricare, non il contenuto del file.
 */
const files = import.meta.glob('./**/*.{png,jpg,jpeg,webp}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

export interface Asset {
  /** Nome del file senza estensione: `basic`, `warrior`, `flat-dark-border`. */
  readonly id: string;
  /** Cartella che lo contiene: `blocks`, `characters`, `ui/joystick`. */
  readonly category: string;
  /** Chiave con cui e' registrato in Phaser: `blocks/basic`. Unica per costruzione. */
  readonly key: string;
  /** Indirizzo da cui caricarlo, con l'impronta che Vite aggiunge in build. */
  readonly url: string;
}

function parse(path: string, url: string): Asset | null {
  // './ui/joystick/flat-dark-border.png' -> ['ui','joystick','flat-dark-border.png']
  const parts = path.replace(/^\.\//, '').split('/');
  const filename = parts.pop() as string;
  const category = parts.join('/');

  // Cartelle di servizio: parcheggio, non contenuto di gioco.
  if (parts.some((p) => p.startsWith('_'))) return null;

  const id = filename.replace(/\.[^.]+$/, '');
  return { id, category, key: category ? `${category}/${id}` : id, url };
}

/** Tutti gli sprite indicizzati, ordinati per chiave: l'ordine e' stabile fra build. */
export const assets: readonly Asset[] = Object.entries(files)
  .map(([path, url]) => parse(path, url))
  .filter((a): a is Asset => a !== null)
  .sort((a, b) => a.key.localeCompare(b.key));

/** Gli sprite di una categoria, nell'ordine dei nomi. */
export function byCategory(category: string): readonly Asset[] {
  return assets.filter((a) => a.category === category);
}

/** Uno sprite preciso. `undefined` se il file non c'e': chi chiama decide se e' grave. */
export function assetKey(category: string, id: string): string | undefined {
  return assets.find((a) => a.category === category && a.id === id)?.key;
}

/**
 * Come si chiama in italiano corrente uno sprite, per le etichette a schermo:
 * `flat-dark-border` -> `Flat dark border`.
 */
export function label(id: string): string {
  const words = id.replace(/[-_]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
