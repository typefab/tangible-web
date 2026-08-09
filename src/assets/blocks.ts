import type { BlockType } from '../config';
import { byCategory, label } from './registry';

/**
 * Il catalogo dei blocchi piazzabili, dedotto da `src/assets/blocks/`.
 *
 * Aggiungerne uno non e' una riga di codice: e' un PNG lasciato cadere nella
 * cartella. Il nome del file diventa l'id che finisce in `level.json`.
 *
 * ## Perche' sta qui e non in `config.ts`
 *
 * Perche' `import.meta.glob` e' una funzione di Vite, non di JavaScript: un
 * file che la usa gira solo dentro una build. `config.ts` invece contiene i
 * numeri, e deve restare importabile da Node puro — e' quello che permette di
 * provare griglia e collisioni senza schermo e senza Phaser. Tenere le due
 * cose separate costa un file e conserva quella proprieta'.
 */
export const BLOCKS: Record<string, { texture: string; label: string }> = Object.fromEntries(
  byCategory('blocks').map((a) => [a.id, { texture: a.key, label: label(a.id) }]),
);

/** Gli id dei blocchi, in ordine di nome file. */
export const BLOCK_IDS: readonly BlockType[] = Object.keys(BLOCKS);

/** Il primo blocco: la selezione di partenza. Stringa vuota se la cartella e' vuota. */
export const DEFAULT_BLOCK: BlockType = BLOCK_IDS[0] ?? '';
