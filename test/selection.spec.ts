import { expect, test } from '@playwright/test';
import { blockAt, cellAt, drag, openEditor, state, tool } from './helpers';

/**
 * Selezione a rettangolo e gesti a due dita.
 *
 * Nota sul rettangolo: e' una figura **sullo schermo**, quindi su griglia
 * isometrica copre un rombo di celle, non un blocco di righe e colonne. Prende
 * quello che ci si vede dentro — che e' il punto — e per questo i test non
 * contano celle a mano ma verificano che gli estremi ci siano e che i blocchi
 * lontani restino fuori.
 */
test.describe('selezione', () => {
  test.beforeEach(async ({ page }) => {
    await openEditor(page);
    await tool(page, 'Seleziona').click();
  });

  /** Trascina un rettangolo che copre la fila (2,6)..(6,6) del terreno. */
  async function selezionaLaFila(page: import('@playwright/test').Page): Promise<void> {
    const a = await blockAt(page, 2, 6);
    const b = await blockAt(page, 6, 6);
    await drag(page, { x: a.x - 30, y: a.y - 25 }, { x: b.x + 30, y: b.y + 25 });
  }

  test('il rettangolo prende quello che ci sta dentro', async ({ page }) => {
    await selezionaLaFila(page);

    expect((await state(page)).selezionati).toBeGreaterThanOrEqual(5);
    const dentro = await page.evaluate(() => {
      const sel = window.game.scene.keys.GameScene.editor.selection;
      const c = (col: number, row: number) =>
        sel.selected.some((b: { col: number; row: number }) => b.col === col && b.row === row);
      return { estremi: c(2, 6) && c(6, 6), lontano: c(10, 8) };
    });
    expect(dentro.estremi).toBe(true);
    expect(dentro.lontano).toBe(false);
  });

  test('trascinando la selezione, i blocchi si spostano', async ({ page }) => {
    await selezionaLaFila(page);

    const da = await blockAt(page, 2, 6);
    const a = await cellAt(page, 3, 6);
    await drag(page, da, a);

    const dopo = await page.evaluate(() => {
      const p = window.game.scene.keys.GameScene.placement;
      return { partenzaLibera: !p.blockAt(2, 6, 0), arrivoOccupato: !!p.blockAt(7, 6, 0) };
    });
    expect(dopo.partenzaLibera).toBe(true);
    expect(dopo.arrivoOccupato).toBe(true);

    await page.keyboard.press('Control+z');
    const tornato = await page.evaluate(
      () => !!window.game.scene.keys.GameScene.placement.blockAt(2, 6, 0),
    );
    expect(tornato).toBe(true);
  });

  test('Canc elimina esattamente i selezionati', async ({ page }) => {
    await selezionaLaFila(page);
    const prima = await state(page);

    await page.keyboard.press('Delete');
    const dopo = await state(page);
    expect(dopo.blocchi).toBe(prima.blocchi - prima.selezionati);
    expect(dopo.selezionati).toBe(0);
  });

  test('Esc annulla la selezione', async ({ page }) => {
    await selezionaLaFila(page);
    expect((await state(page)).selezionati).toBeGreaterThan(0);

    await page.keyboard.press('Escape');
    expect((await state(page)).selezionati).toBe(0);
  });

  test('cambiare layer annulla la selezione', async ({ page }) => {
    await selezionaLaFila(page);
    await page.keyboard.press(']');
    expect((await state(page)).selezionati).toBe(0);
  });
});

test.describe('gesti a due dita', () => {
  test('allargando due dita si ingrandisce, e il tratto del primo dito viene annullato', async ({
    page,
    context,
  }) => {
    await openEditor(page);
    await tool(page, 'Pennello').click();

    const prima = await state(page);
    const zoomPrima = await page.evaluate(
      () => window.game.scene.keys.GameScene.cameras.main.zoom,
    );

    // Il touch multiplo non passa da page.touchscreen: serve il protocollo.
    const cdp = await context.newCDPSession(page);
    const touch = (type: string, punti: { x: number; y: number }[]) =>
      cdp.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: punti.map((p, id) => ({ x: p.x, y: p.y, id })),
      });

    await touch('touchStart', [{ x: 380, y: 300 }]);
    await touch('touchStart', [
      { x: 380, y: 300 },
      { x: 520, y: 300 },
    ]);
    for (let i = 1; i <= 6; i++) {
      await touch('touchMove', [
        { x: 380 - i * 12, y: 300 },
        { x: 520 + i * 12, y: 300 },
      ]);
    }
    await touch('touchEnd', [{ x: 308, y: 300 }]);
    await touch('touchEnd', []);

    const zoomDopo = await page.evaluate(
      () => window.game.scene.keys.GameScene.cameras.main.zoom,
    );
    expect(zoomDopo).toBeGreaterThan(zoomPrima * 1.2);

    // Il primo dito aveva gia' toccato la scena: quel blocco non deve restare.
    expect((await state(page)).blocchi).toBe(prima.blocchi);
  });
});
