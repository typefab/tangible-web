import type { Page } from '@playwright/test';

declare global {
  interface Window {
    /** Esposto da `src/main.ts` solo in sviluppo: e' la porta d'ingresso dei test. */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    game: any;
  }
}

/**
 * Apre la pagina e aspetta che la scena sia montata.
 *
 * Aspettare un oggetto invece di un tempo fisso: su CI la macchina e' piu'
 * lenta di questa, e un `waitForTimeout` tarato qui diventa un test che
 * fallisce la' senza motivo.
 */
export async function open(page: Page, query = ''): Promise<void> {
  await page.goto(`/${query}`);
  await page.waitForFunction(() => window.game?.scene?.keys?.GameScene?.placement !== undefined);
  // Il primo frame disegnato: da qui in poi le posizioni degli sprite sono vere.
  await page.waitForFunction(() => window.game.loop.frame > 2);
}

export async function openEditor(page: Page, query = '?editor=1'): Promise<void> {
  await open(page, query);
  await page.waitForFunction(() => window.game.scene.keys.GameScene.editor !== undefined);
}

export interface EditorState {
  blocchi: number;
  layerAttivo: number;
  layer: { nome: string; quota: number; visibile: boolean; blocchi: number }[];
  /** Tutti i livelli del progetto: il catalogo. */
  livelli: string[];
  /** Solo quelli con una scheda aperta in alto. */
  schede: string[];
  /** Indice del livello attivo dentro il catalogo. */
  livelloAttivo: number;
  /** Indice della scheda attiva fra quelle aperte. */
  schedaAttiva: number;
  /** Celle selezionate, vuote comprese. */
  selezionati: number;
  /** Quante di quelle celle hanno un blocco. */
  selBlocchi: number;
  stato: string;
  dialogo: string | null;
  inMemoria: boolean;
}

export function state(page: Page): Promise<EditorState> {
  return page.evaluate(() => {
    const scene = window.game.scene.keys.GameScene;
    const p = scene.placement;
    const e = scene.editor;
    const tabs = [...document.querySelectorAll('#level-tabs .tab')];
    return {
      blocchi: p.count,
      layerAttivo: p.activeLayer,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      layer: p.layers.map((l: any, i: number) => ({
        nome: l.name,
        quota: l.elevation,
        visibile: l.visible,
        blocchi: p.countOn(i),
      })),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      livelli: e ? e.levels.map((l: any) => l.name) : [],
      schede: tabs.map((t) => t.querySelector('.nome')?.textContent ?? ''),
      livelloAttivo: e?.activeLevelIndex ?? -1,
      schedaAttiva: tabs.findIndex((t) => t.classList.contains('attiva')),
      selezionati: e?.selection.count ?? 0,
      selBlocchi: e?.selection.blockCount ?? 0,
      stato: document.querySelector('#editor-toolbar .status')?.textContent ?? '',
      dialogo: document.querySelector('#editor-dialog h2')?.textContent ?? null,
      inMemoria: !!localStorage.getItem('tangible-web:editor:v1'),
    };
  });
}

/**
 * Dove si trova a schermo il blocco in quella cella, per poterlo toccare.
 *
 * Si legge la posizione dello **sprite** e non il centro della cella: su un
 * layer con quota i due punti non coincidono.
 */
export async function blockAt(
  page: Page,
  col: number,
  row: number,
  layer = 0,
): Promise<{ x: number; y: number }> {
  const point = await page.evaluate(
    ([c, r, l]) => {
      const scene = window.game.scene.keys.GameScene;
      const sprite = scene.placement.blockAt(c, r, l);
      if (!sprite) return null;
      const cam = scene.cameras.main;
      return { x: (sprite.x - cam.worldView.x) * cam.zoom, y: (sprite.y - cam.worldView.y) * cam.zoom };
    },
    [col, row, layer] as const,
  );
  if (!point) throw new Error(`nessun blocco in (${col},${row}) sul layer ${layer}`);
  return point;
}

/** Il punto dello schermo che corrisponde al centro di una cella del terreno. */
export function cellAt(page: Page, col: number, row: number): Promise<{ x: number; y: number }> {
  return page.evaluate(
    ([c, r]) => {
      const scene = window.game.scene.keys.GameScene;
      const cam = scene.cameras.main;
      const w = scene.placement.constructor.cellToWorld(c, r);
      return { x: (w.x - cam.worldView.x) * cam.zoom, y: (w.y - cam.worldView.y) * cam.zoom };
    },
    [col, row] as const,
  );
}

/** Sceglie uno strumento della barra per nome, che e' anche il suo `title`. */
export function tool(page: Page, name: string) {
  return page.locator(`#editor-toolbar .tools button[title="${name}"]`);
}

/** Trascina dal primo punto al secondo, passando per posizioni intermedie. */
export async function drag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
}
