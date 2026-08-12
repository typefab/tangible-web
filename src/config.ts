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

/**
 * Layer, come in GDevelop: piani sovrapposti, selezionabili uno alla volta e
 * accendibili singolarmente.
 *
 * In piu' rispetto a GDevelop, qui un layer ha un'**elevazione**: quanti passi
 * in alto sta rispetto al terreno. A elevazione 0 il layer e' un piano piatto —
 * stessa cella, stesso posto, cambia solo l'ordine di disegno, cioe' esattamente
 * il comportamento di GDevelop. Da 1 in su il piano si alza di una cella, che su
 * griglia isometrica e' quello che serve per costruire in verticale.
 *
 * Un solo numero copre i due casi, quindi non ci sono due concetti da spiegare.
 */
export const LAYERS = {
  /** Oltre questo numero il pannello diventa ingestibile su telefono. */
  max: 8,
  /**
   * Scarto di profondita' tra due layer sulla stessa cella.
   *
   * Deve solo rompere il pareggio: `max * depthStep` resta sotto
   * `Z.playerDepthBias`, altrimenti un layer alto scavalcherebbe il personaggio
   * sulla sua stessa cella.
   */
  depthStep: 0.02,
} as const;

export const PLAYER = {
  /** Id nel catalogo: `src/assets/characters/player.png`. */
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
  /**
   * Se questa texture esiste viene usata come sfondo dello slot: basta caricare
   * `src/assets/ui/inventory-slot.png`. Finche' manca, la barra disegna un
   * rettangolo come segnaposto.
   */
  slotTexture: 'inventory-slot',
  /** Quanti blocchi entrano in uno slot. */
  stackLimit: 99,
} as const;

export const JOYSTICK = {
  /** Id nel catalogo: `src/assets/ui/`. */
  borderTexture: 'joystick-border',
  thumbTexture: 'joystick-thumb',
  /** Raggio entro cui il pollice si muove, in pixel schermo. */
  radius: 56,
  /** Sotto questa frazione del raggio il movimento e' considerato fermo. */
  deadZone: 0.15,
  /** Margine dal bordo in basso a sinistra. */
  margin: 96,
} as const;

export const Z = {
  /**
   * Sotto zero ci sono due bande, e l'ordine fra loro conta:
   *
   * | Profondita' | Cosa | Perche' |
   * |---|---|---|
   * | da -2000 | fondali | dietro a tutto |
   * | -1000 | griglia | **sopra** ai fondali: si costruisce guardandola |
   * | da 0 | blocchi e player | `col + row` |
   *
   * La griglia stava gia' a -1000 quando i fondali sono arrivati, e la prima
   * versione li ha messi allo stesso numero: a parita' di profondita' decide
   * l'ordine di creazione, quindi il fondale copriva la griglia. Un pareggio
   * non e' un ordine, e qui e' la seconda volta che se ne paga uno.
   *
   * Fra loro i fondali si ordinano per posizione nell'elenco: mille immagini
   * nello stesso livello prima di toccare la griglia.
   */
  background: -2000,
  /** Le linee della griglia: sopra ai fondali, sotto a tutto il resto. */
  grid: -1000,
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
 * I tipi di blocco non stanno piu' qui: sono i PNG di `src/assets/blocks/`,
 * elencati da `src/assets/catalog.ts`. Aggiungerne uno non e' piu' una riga di
 * codice, e' un file caricato da GitHub.
 *
 * Il prezzo e' questo alias: l'elenco esiste solo alla build, quindi il tipo
 * non puo' essere l'unione degli id. Chi legge da `level.json` deve validare a
 * runtime con `resolveBlock()`.
 */
export type BlockType = string;
