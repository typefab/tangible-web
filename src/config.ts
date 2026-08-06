/**
 * Costanti di gioco, portate 1:1 dalla tabella in gdevelop_repository/CLAUDE.md.
 *
 * Questo file e' la fonte di verita' per i numeri: sono qui, in chiaro,
 * versionati in git. Nel progetto GDevelop erano sparsi dentro il JSON.
 */
export const GRID = {
  /** Dimensione della cella della griglia di piazzamento. */
  cellSize: 32,
  /** Il terreno ha 16px di offset rispetto all'origine scena. */
  offsetX: 16,
  offsetY: 16,
} as const;

export const TIMING = {
  /** Secondi di pressione continua per rompere un blocco. */
  breakTimeMs: 1500,
  /** Tempo minimo tra due piazzamenti. */
  placementCooldownMs: 100,
  /** sin(t * 18) * 10 gradi durante la rottura. */
  oscillationFrequency: 18,
  oscillationDegrees: 10,
} as const;

export const RANGES = {
  /** Distanza massima dal Player per poter piazzare. */
  placementRange: 224,
} as const;

export const Z = {
  /** Sempre sopra i blocchi ordinati per profondita'. */
  placeHitbox: 9999,
} as const;

/** Tipi di blocco. Aggiungerne uno = una riga qui. */
export const BLOCKS = {
  block_0: { texture: 'block_normal', label: 'Basic' },
  block_1: { texture: 'block_stack', label: 'Stack' },
} as const;

export type BlockType = keyof typeof BLOCKS;
