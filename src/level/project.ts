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

export interface SerializedLevel {
  name: string;
  layers: SerializedLayer[];
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

function normalizeLevel(raw: unknown, index: number): SerializedLevel {
  if (!isRecord(raw)) return emptyLevel(`Livello ${index + 1}`);

  const layers = Array.isArray(raw.layers) ? raw.layers.slice(0, LAYERS.max).map(normalizeLayer) : [];
  return {
    name: typeof raw.name === 'string' && raw.name !== '' ? raw.name : `Livello ${index + 1}`,
    // Un livello senza piani non e' modificabile: non ci sarebbe dove disegnare.
    layers: layers.length > 0 ? layers : [emptyLayer()],
  };
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
