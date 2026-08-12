import { LAYERS, type BlockType } from '../config';

/**
 * Il formato di `public/level.json`.
 *
 * Un file contiene **tutti** i livelli del gioco, non uno solo. E' una scelta
 * di attrito: caricare un file solo dalla UI web di GitHub e' un'operazione,
 * caricarne cinque sono cinque occasioni di sbagliare cartella. Il diff resta
 * leggibile perche' i blocchi sono ordinati.
 */

/** Un blocco piazzato. `type` e' l'id del PNG in `src/assets/blocks/`. */
export interface SerializedBlock {
  col: number;
  row: number;
  type: BlockType;
}

export interface SerializedLayer {
  name: string;
  /** Quanti piani sopra il terreno. 0 = piano piatto, sovrapposto in loco. */
  elevation: number;
  visible: boolean;
  blocks: SerializedBlock[];
}

/**
 * Un'immagine di fondale piazzata nel livello.
 *
 * **Non e' un blocco**, e non poteva esserlo: i blocchi stanno in una cella, e
 * pennello, gomma, selezione e appunti girano tutti per celle. Un'immagine ha
 * posizione e scala libere, quindi vive in un elenco suo — cosi' quegli
 * strumenti continuano a vedere solo celle e non imparano un caso speciale.
 *
 * `x` e `y` sono il centro, in coordinate del mondo.
 */
export interface SerializedBackground {
  id: string;
  x: number;
  y: number;
  scale: number;
  /**
   * Gradi, in senso orario. Assente quando e' zero, che e' il caso normale:
   * la stessa ragione per cui `backgrounds` non compare nei livelli che non ne
   * hanno — un file non deve riempirsi di campi a zero.
   */
  rotation?: number;
}

export interface SerializedLevel {
  name: string;
  layers: SerializedLayer[];
  /**
   * Assente quando non ce ne sono, e non un array vuoto: un `level.json` fatto
   * prima dei fondali, riaperto e riscritto, deve restare identico byte a byte.
   */
  backgrounds?: SerializedBackground[];
}

export interface SerializedProject {
  levels: SerializedLevel[];
}

/** Il formato con un livello solo, usato prima delle schede. */
interface OneLevelFile {
  layers?: SerializedLayer[];
}

/** Il formato piatto, usato prima dei layer. */
interface FlatFile {
  blocks?: SerializedBlock[];
}

export function emptyLayer(name = 'Terreno', elevation = 0): SerializedLayer {
  return { name, elevation, visible: true, blocks: [] };
}

export function emptyLevel(name = 'Livello 1'): SerializedLevel {
  return { name, layers: [emptyLayer()] };
}

export function emptyProject(): SerializedProject {
  return { levels: [emptyLevel()] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeLayer(raw: unknown, index: number): SerializedLayer {
  if (!isRecord(raw)) return emptyLayer(`Layer ${index}`, index);

  return {
    name: typeof raw.name === 'string' && raw.name !== '' ? raw.name : `Layer ${index}`,
    // `?? index` e non `?? 0`: un file scritto a mano che elenca i piani senza
    // quota quasi sempre intende una pila, non tre piani sovrapposti in loco.
    elevation: typeof raw.elevation === 'number' ? Math.max(0, Math.round(raw.elevation)) : index,
    visible: raw.visible !== false,
    blocks: Array.isArray(raw.blocks) ? (raw.blocks.filter(isBlock) as SerializedBlock[]) : [],
  };
}

function isBlock(raw: unknown): boolean {
  return (
    isRecord(raw) &&
    typeof raw.col === 'number' &&
    typeof raw.row === 'number' &&
    typeof raw.type === 'string'
  );
}

/** Scarta quello che non e' un fondale scritto bene, invece di far saltare tutto. */
function normalizeBackgrounds(raw: unknown): SerializedBackground[] {
  if (!Array.isArray(raw)) return [];

  const items: SerializedBackground[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    if (typeof entry.id !== 'string' || entry.id === '') continue;
    if (typeof entry.x !== 'number' || typeof entry.y !== 'number') continue;
    // Una scala nulla o negativa darebbe un'immagine invisibile o ribaltata:
    // e' piu' probabile un file scritto male che un'intenzione.
    const scale = typeof entry.scale === 'number' && entry.scale > 0 ? entry.scale : 1;
    const item: SerializedBackground = { id: entry.id, x: entry.x, y: entry.y, scale };
    // Riportata dentro il giro: un file scritto a mano con 400 gradi non deve
    // dare un'immagine che si comporta diversamente da una a 40.
    if (typeof entry.rotation === 'number' && Number.isFinite(entry.rotation)) {
      const rotation = ((entry.rotation % 360) + 360) % 360;
      if (rotation !== 0) item.rotation = rotation;
    }
    items.push(item);
  }
  return items;
}

function normalizeLevel(raw: unknown, index: number): SerializedLevel {
  if (!isRecord(raw)) return emptyLevel(`Livello ${index + 1}`);

  const layers = Array.isArray(raw.layers) ? raw.layers.slice(0, LAYERS.max).map(normalizeLayer) : [];
  const backgrounds = normalizeBackgrounds(raw.backgrounds);
  const level: SerializedLevel = {
    name: typeof raw.name === 'string' && raw.name !== '' ? raw.name : `Livello ${index + 1}`,
    // Un livello senza piani non e' modificabile: non ci sarebbe dove disegnare.
    layers: layers.length > 0 ? layers : [emptyLayer()],
  };
  if (backgrounds.length > 0) level.backgrounds = backgrounds;
  return level;
}

/**
 * Porta qualsiasi versione del file al formato corrente.
 *
 * Tre generazioni di `level.json` devono continuare ad aprirsi, perche' i file
 * gia' esportati vivono sul telefono di chi li ha fatti e non si possono
 * migrare a distanza:
 *
 * | Forma | Da quando | Diventa |
 * |---|---|---|
 * | `{ "levels": [...] }` | schede | se stessa |
 * | `{ "layers": [...] }` | layer | un progetto con un livello |
 * | `{ "blocks": [...] }` | prototipo | un progetto, un livello, un layer |
 *
 * Tutto cio' che non si riconosce diventa un progetto vuoto invece di un
 * errore: l'editor deve aprirsi comunque, altrimenti non c'e' modo di
 * rimediare a un file rotto.
 */
export function normalizeProject(data: unknown): SerializedProject {
  if (!isRecord(data)) return emptyProject();

  if (Array.isArray(data.levels)) {
    const levels = data.levels.map(normalizeLevel);
    return { levels: levels.length > 0 ? levels : [emptyLevel()] };
  }

  if (Array.isArray((data as OneLevelFile).layers)) {
    return { levels: [normalizeLevel({ name: 'Livello 1', layers: data.layers }, 0)] };
  }

  const flat = (data as FlatFile).blocks;
  if (Array.isArray(flat)) {
    return {
      levels: [{ name: 'Livello 1', layers: [{ ...emptyLayer(), blocks: flat.filter(isBlock) }] }],
    };
  }

  return emptyProject();
}

/**
 * Il livello indicato da `?level=`: un indice (`?level=2`, dal secondo) oppure
 * un nome (`?level=Caverna`). Fuori intervallo o sconosciuto si torna al primo,
 * perche' un link sbagliato non deve dare una schermata vuota.
 */
export function pickLevel(project: SerializedProject, wanted: string | null): SerializedLevel {
  if (wanted) {
    const byName = project.levels.find((l) => l.name === wanted);
    if (byName) return byName;

    const index = Number(wanted);
    if (Number.isInteger(index) && index >= 1 && index <= project.levels.length) {
      return project.levels[index - 1]!;
    }
  }
  return project.levels[0]!;
}
