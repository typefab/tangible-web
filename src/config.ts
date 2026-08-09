/**
 * Costanti di gioco, portate 1:1 dalla tabella in gdevelop_repository/CLAUDE.md.
 *
 * Questo file e' la fonte di verita' per i numeri: sono qui, in chiaro,
 * versionati in git. Nel progetto GDevelop erano sparsi dentro il JSON.
 *
 * Gli sprite non si dichiarano qui: li indicizza `assets/registry.ts` leggendo
 * le cartelle, e il catalogo dei blocchi sta in `assets/blocks.ts`. Qui resta
 * *quale* sprite usare, mai l'elenco di quelli esistenti — cosi' questo file
 * non dipende da Vite e resta importabile da Node puro, che e' quello che
 * permette di provare griglia e collisioni senza schermo.
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
  /** Chiave nell'indice: `src/assets/characters/warrior.png`. */
  texture: 'characters/warrior',
  /** Lo sprite sorgente e' 317x788: due celle di altezza, larghezza in proporzione. */
  height: GRID.cellSize * 2,
  width: Math.round(GRID.cellSize * 2 * (317 / 788)),
  /** Pixel al secondo. */
  speed: 190,
  /**
   * Ingombro per le collisioni: mezzo lato in unita' di cella.
   *
   * Non e' in pixel perche' i conti di collisione si fanno in spazio di cella,
   * dove ogni cella e' un quadrato unitario (vedi `GridCollision`). Sullo
   * schermo 0.3 diventa un rombo di 38x19 px ai piedi del personaggio, che e'
   * poco piu' del suo sprite (26px di larghezza).
   *
   * Deve restare sotto 0.5, altrimenti non passa in un varco di una cella.
   */
  colliderRadius: 0.3,
} as const;

export const CAMERA = {
  /**
   * Quanto la camera recupera il ritardo sul personaggio a ogni frame.
   *
   * 1 la incolla addosso (ogni passo scuote lo schermo), valori bassi la
   * fanno arrivare in ritardo. 0.12 e' il compromesso fra "non si stacca" e
   * "non da' la nausea".
   */
  lerp: 0.12,
  /**
   * Riquadro morto al centro: finche' il personaggio ci resta dentro, la
   * camera non si muove affatto. Senza, ogni singolo passo produce uno
   * scorrimento e su pixel art si vede tremolare tutta la scena.
   */
  deadZoneWidth: 200,
  deadZoneHeight: 140,
  /** Celle di respiro oltre il bordo della griglia, per non incollare la vista al bordo. */
  boundsPaddingCells: 1,
} as const;

export const INVENTORY = {
  /** 8 slot, come nel progetto GDevelop (SlotIndex 0-7). */
  slots: 8,
  /** Lato dello slot a schermo pieno; su telefono viene ridotto in proporzione. */
  slotSize: 96,
  /** Se questa texture esiste viene usata come sfondo dello slot. */
  slotTexture: 'ui/inventory-slot',
  /** Quanti blocchi entrano in uno slot. */
  stackLimit: 99,
} as const;

export const JOYSTICK = {
  /** Il pack ha 4 stili x 2 tinte: cambiare variante = cambiare queste due righe. */
  borderTexture: 'ui/joystick/transparent-dark-border',
  thumbTexture: 'ui/joystick/transparent-dark-thumb',
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
  /**
   * Spinta in avanti del personaggio a parita' di cella.
   *
   * Player e blocchi condividono la stessa scala di profondita' (col+row),
   * quindi sulla propria cella finirebbero in pareggio e l'ordine dipenderebbe
   * da chi e' stato creato prima. Mezza cella basta a metterlo davanti al
   * blocco su cui poggia senza scavalcare quello della cella successiva.
   */
  playerDepthBias: 0.5,
} as const;

/**
 * L'id di un tipo di blocco.
 *
 * E' `string` e non piu' un'unione chiusa, perche' l'elenco vive nella
 * cartella `assets/blocks/` e non nel codice: il compilatore non puo'
 * conoscerlo. In cambio va convalidato quando arriva da fuori, ed e' quello
 * che fa gia' il caricamento di `level.json`.
 */
export type BlockType = string;
