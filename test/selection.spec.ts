import { expect, test } from '@playwright/test';
import { blockAt, cellAt, drag, openEditor, state, tool } from './helpers';

/**
 * Selezione, appunti e gesti a due dita.
 *
 * Due cose da tenere a mente leggendo questi test:
 *
 * - **la selezione e' un'area di celle**, vuote comprese. `selezionati` conta
 *   celle, `selBlocchi` conta quante di quelle celle hanno un blocco.
 * - il rettangolo e' una figura **sullo schermo**, quindi su griglia isometrica
 *   copre un rombo di celle. Per questo i test non contano celle a mano ma
 *   verificano che gli estremi ci siano e che i blocchi lontani restino fuori.
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

    expect((await state(page)).selBlocchi).toBeGreaterThanOrEqual(5);
    const dentro = await page.evaluate(() => {
      const sel = window.game.scene.keys.GameScene.editor.selection;
      const c = (col: number, row: number) =>
        sel.cells.some((x: { col: number; row: number }) => x.col === col && x.row === row);
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

  test('Canc svuota l\'area, ma l\'area resta selezionata', async ({ page }) => {
    await selezionaLaFila(page);
    const prima = await state(page);

    await page.keyboard.press('Delete');
    const dopo = await state(page);
    expect(dopo.blocchi).toBe(prima.blocchi - prima.selBlocchi);
    expect(dopo.selBlocchi).toBe(0);
    // L'area rimane in mano: dopo aver svuotato si vuole quasi sempre riempire.
    expect(dopo.selezionati).toBe(prima.selezionati);
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
    expect(dopo.blocchi).toBe(prima.blocchi + prima.selBlocchi);
    // Quello che arriva resta selezionato, pronto da trascinare.
    expect(dopo.selBlocchi).toBe(prima.selBlocchi);
  });

  test('Ctrl+X toglie i blocchi e Ctrl+V li rimette', async ({ page }) => {
    await selezionaLaFila(page);
    const prima = await state(page);

    await page.keyboard.press('Control+x');
    expect((await state(page)).blocchi).toBe(prima.blocchi - prima.selBlocchi);

    const vuoto = await cellAt(page, 14, 14);
    await page.mouse.move(vuoto.x, vuoto.y);
    await page.keyboard.press('Control+v');
    expect((await state(page)).blocchi).toBe(prima.blocchi);
  });

  test('si incolla anche in un\'altra scheda', async ({ page }) => {
    await selezionaLaFila(page);
    const copiati = (await state(page)).selBlocchi;
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

test.describe('pennello e gomma sull\'area selezionata', () => {
  test.beforeEach(async ({ page }) => {
    await openEditor(page);
    await tool(page, 'Seleziona').click();
  });

  /** Traccia un rettangolo attorno a una cella vuota e restituisce l'area presa. */
  async function selezionaZonaVuota(page: import('@playwright/test').Page): Promise<number> {
    // Due celle come angoli non funzionano: in isometrica le celle sulla stessa
    // diagonale hanno la stessa x, e il rettangolo verrebbe largo zero.
    const centro = await cellAt(page, 14, 14);
    await drag(
      page,
      { x: centro.x - 70, y: centro.y - 45 },
      { x: centro.x + 70, y: centro.y + 45 },
    );
    return (await state(page)).selezionati;
  }

  test('il pennello riempie l\'area, celle vuote comprese', async ({ page }) => {
    const prima = await state(page);
    const celle = await selezionaZonaVuota(page);
    expect(celle).toBeGreaterThan(1);
    // Zona vuota: nessun blocco dentro, eppure si deve poter riempire.
    expect((await state(page)).selBlocchi).toBe(0);

    await tool(page, 'Riempi area').click();

    const dopo = await state(page);
    expect(dopo.blocchi).toBe(prima.blocchi + celle);
    expect(await page.evaluate(() => !!window.game.scene.keys.GameScene.placement.blockAt(14, 14, 0))).toBe(true);
  });

  test('riempie col blocco scelto nella palette', async ({ page }) => {
    await page.click('#editor-toolbar button.palette[title="Stack"]');
    await selezionaZonaVuota(page);
    await tool(page, 'Riempi area').click();

    const tipo = await page.evaluate(() =>
      window.game.scene.keys.GameScene.placement.typeAt(14, 14, 0),
    );
    expect(tipo).toBe('stack');
  });

  test('la gomma svuota l\'area e il pennello la ripristina', async ({ page }) => {
    const celle = await selezionaZonaVuota(page);
    await tool(page, 'Riempi area').click();
    const pieno = (await state(page)).blocchi;

    await tool(page, 'Svuota area').click();
    expect((await state(page)).blocchi).toBe(pieno - celle);

    await tool(page, 'Riempi area').click();
    expect((await state(page)).blocchi).toBe(pieno);
  });

  test('senza selezione i pulsanti tornano a essere strumenti', async ({ page }) => {
    // Con la selezione i due pulsanti si chiamano diversamente.
    await selezionaZonaVuota(page);
    await expect(tool(page, 'Riempi area')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(tool(page, 'Pennello')).toBeVisible();

    // E tornano a cambiare strumento invece di agire.
    await tool(page, 'Pennello').click();
    const attivo = await page.evaluate(() => window.game.scene.keys.GameScene.editor.tool);
    expect(attivo).toBe('brush');
  });

  test('un riempimento intero conta come un solo annullamento', async ({ page }) => {
    const prima = await state(page);
    await selezionaZonaVuota(page);
    await tool(page, 'Riempi area').click();
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
