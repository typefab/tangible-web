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

  test('Ctrl+C e Ctrl+V duplicano la selezione altrove', async ({ page }) => {
    await selezionaLaFila(page);
    const prima = await state(page);

    await page.keyboard.press('Control+c');
    // Il puntatore decide dove atterra: lo si porta su una zona vuota.
    const vuoto = await cellAt(page, 14, 14);
    await page.mouse.move(vuoto.x, vuoto.y);
    await page.keyboard.press('Control+v');

    const dopo = await state(page);
    expect(dopo.blocchi).toBe(prima.blocchi + prima.selezionati);
    // Quello che arriva resta selezionato, pronto da trascinare.
    expect(dopo.selezionati).toBe(prima.selezionati);
  });

  test('Ctrl+X toglie i blocchi e Ctrl+V li rimette', async ({ page }) => {
    await selezionaLaFila(page);
    const prima = await state(page);

    await page.keyboard.press('Control+x');
    expect((await state(page)).blocchi).toBe(prima.blocchi - prima.selezionati);

    const vuoto = await cellAt(page, 14, 14);
    await page.mouse.move(vuoto.x, vuoto.y);
    await page.keyboard.press('Control+v');
    expect((await state(page)).blocchi).toBe(prima.blocchi);
  });

  test('si incolla anche in un\'altra scheda', async ({ page }) => {
    await selezionaLaFila(page);
    const copiati = (await state(page)).selezionati;
    await page.keyboard.press('Control+c');

    await page.click('#level-tabs .tabs button:nth-child(2)');
    const prima = await state(page);

    const vuoto = await cellAt(page, 14, 14);
    await page.mouse.move(vuoto.x, vuoto.y);
    await page.keyboard.press('Control+v');

    expect((await state(page)).blocchi).toBe(prima.blocchi + copiati);
  });

  test('un incolla si annulla con Ctrl+Z', async ({ page }) => {
    await selezionaLaFila(page);
    const prima = await state(page);

    await page.keyboard.press('Control+c');
    const vuoto = await cellAt(page, 14, 14);
    await page.mouse.move(vuoto.x, vuoto.y);
    await page.keyboard.press('Control+v');
    await page.keyboard.press('Control+z');

    expect((await state(page)).blocchi).toBe(prima.blocchi);
  });
});

test.describe('riempimento a rettangolo', () => {
  test.beforeEach(async ({ page }) => {
    await openEditor(page);
    await tool(page, 'Riempi').click();
  });

  test('trascinando un rettangolo si riempiono le celle dentro', async ({ page }) => {
    const prima = await state(page);

    // Il rettangolo si traccia attorno a una cella vuota, con uno scarto in
    // pixel su entrambi gli assi. Prendere due celle e usarle come angoli non
    // funziona: in isometrica due celle sulla stessa diagonale hanno la stessa
    // x, e il rettangolo verrebbe largo zero.
    const centro = await cellAt(page, 14, 14);
    await drag(
      page,
      { x: centro.x - 70, y: centro.y - 45 },
      { x: centro.x + 70, y: centro.y + 45 },
    );

    const dopo = await state(page);
    expect(dopo.blocchi).toBeGreaterThan(prima.blocchi);

    const dentro = await page.evaluate(
      () => !!window.game.scene.keys.GameScene.placement.blockAt(14, 14, 0),
    );
    expect(dentro).toBe(true);
  });

  test('riempie col blocco scelto nella palette, sostituendo quello che trova', async ({ page }) => {
    await page.click('#editor-toolbar button.palette[title="Stack"]');
    await tool(page, 'Riempi').click();

    // (2,6) nel file di partenza e' un "basic": il riempimento deve coprirlo.
    const a = await cellAt(page, 2, 6);
    const b = await cellAt(page, 3, 6);
    await drag(page, { x: a.x - 20, y: a.y - 20 }, { x: b.x + 20, y: b.y + 20 });

    const tipo = await page.evaluate(() =>
      window.game.scene.keys.GameScene.placement.typeAt(2, 6, 0),
    );
    expect(tipo).toBe('stack');
  });

  test('un riempimento intero conta come un solo annullamento', async ({ page }) => {
    const prima = await state(page);

    const centro = await cellAt(page, 14, 14);
    await drag(
      page,
      { x: centro.x - 70, y: centro.y - 45 },
      { x: centro.x + 70, y: centro.y + 45 },
    );
    expect((await state(page)).blocchi).toBeGreaterThan(prima.blocchi);

    await page.keyboard.press('Control+z');
    expect((await state(page)).blocchi).toBe(prima.blocchi);
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
