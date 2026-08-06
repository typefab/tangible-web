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
  /** Intervallo di celle disegnate come griglia di riferimento. */
  drawFrom: 0,
  drawTo: 24,
} as const;

/**
 * Griglia isometrica a rombi.
 *
 * Rapporto 2:1 (64x32): e' lo standard nei giochi perche' le diagonali cadono
 * su pixel interi. L'isometria geometricamente esatta sarebbe 1.732:1 (30
 * gradi), che su pixel art produce bordi frastagliati.
 *
 * L'origine e' il punto dove si trova il vertice superiore della cella (0,0).
 * Va spostata a destra perche' le celle con row > col hanno x negativa.
 */
export const ISO = {
  tileWidth: 64,
  tileHeight: 32,
  originX: 480,
  originY: 48,
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

export const PLAYER = {
  texture: 'player',
  /** Lo sprite sorgente e' 317x788: due celle di altezza, larghezza in proporzione. */
  height: GRID.cellSize * 2,
  width: Math.round(GRID.cellSize * 2 * (317 / 788)),
  /** Pixel al secondo. */
  speed: 190,
} as const;

export const INVENTORY = {
  /** 8 slot, come nel progetto GDevelop (SlotIndex 0-7). */
  slots: 8,
  /** Lato dello slot a schermo pieno; su telefono viene ridotto in proporzione. */
  slotSize: 96,
  /** Se questa texture esiste viene usata come sfondo dello slot. */
  slotTexture: 'inventory_slot',
  /** Quanti blocchi entrano in uno slot. */
  stackLimit: 99,
} as const;

export const JOYSTICK = {
  borderTexture: 'joystick_border',
  thumbTexture: 'joystick_thumb',
  /** Raggio entro cui il pollice si muove, in pixel schermo. */
  radius: 56,
  /** Sotto questa frazione del raggio il movimento e' considerato fermo. */
  deadZone: 0.15,
  /** Margine dal bordo in basso a sinistra. */
  margin: 96,
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
