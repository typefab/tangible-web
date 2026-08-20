import { expect, test } from '@playwright/test';
import { blockAt, cellAt, drag, openEditor, state, tool } from './helpers';

/**
 * La scala del singolo blocco piazzato.
 *
 * E' la seconda leva sulla dimensione, e non va confusa con la prima: la
 * **taglia del tipo** sta nel nome del file (`albero@2.png`) e dice quanto e'
 * grande un albero; la **scala del blocco** dice che quest'albero e' meta'
 * degli altri. Per questo e' un moltiplicatore: ripensare la taglia del tipo
 * non deve invalidare i blocchi gia' messi.
 */

/** Le tre parti dello stepper della taglia. */
const meno = (p: import('@playwright/test').Page) =>
  p.locator('#editor-toolbar .stepper.scala .freccia').first();
const piu = (p: import('@playwright/test').Page) =>
  p.locator('#editor-toolbar .stepper.scala .freccia').last();
const valore = (p: import('@playwright/test').Page) =>
  p.locator('#editor-toolbar .stepper.scala .valore');

/** Larghezza a schermo del blocco in quella cella. */
function larghezza(
  page: import('@playwright/test').Page,
  col: number,
  row: number,
  layer = 0,
): Promise<number> {
  return page.evaluate(
    ([c, r, l]) => window.game.scene.keys.GameScene.placement.blockAt(c, r, l)?.displayWidth ?? 0,
    [col, row, layer] as const,
  );
}

/** I blocchi del layer 0 come finiranno nel file. */
function serializzati(
  page: import('@playwright/test').Page,
): Promise<{ col: number; row: number; type: string; scale?: number }[]> {
  return page.evaluate(
    () => window.game.scene.keys.GameScene.placement.serializeLayers()[0].blocks,
  );
}

test.describe('taglia del blocco', () => {
  test.beforeEach(async ({ page }) => {
    await openEditor(page);
  });

  test('i gradini si leggono, e il pennello piazza a quella misura', async ({ page }) => {
    await expect(valore(page)).toHaveText('1×');

    // Gradini e non un fattore continuo: si legge "1.5×", non "1.5625×".
    await piu(page).click();
    await expect(valore(page)).toHaveText('1.5×');
    await piu(page).click();
    await expect(valore(page)).toHaveText('2×');

    // Una cella lontana da quelle gia' piene del livello pubblicato: su una
    // occupata il pennello non fa niente e si misurerebbe il blocco che c'era.
    const punto = await cellAt(page, 12, 12);
    await page.mouse.click(punto.x, punto.y);

    const normale = await larghezza(page, 2, 6);
    expect(await larghezza(page, 12, 12)).toBeCloseTo(normale * 2, 1);
  });

  test('gli estremi spengono il pulsante', async ({ page }) => {
    // I gradini sono 0.25 0.5 0.75 1 1.5 2 3 4: da 1 in su sono quattro passi,
    // e da 4 fino in fondo sette. Contarli e' anche il modo di accorgersi se un
    // giorno la scala cambia senza che la documentazione la segua.
    for (let i = 0; i < 4; i++) await piu(page).click();
    await expect(valore(page)).toHaveText('4×');
    await expect(piu(page)).toBeDisabled();

    for (let i = 0; i < 7; i++) await meno(page).click();
    await expect(valore(page)).toHaveText('0.25×');
    await expect(meno(page)).toBeDisabled();
  });

  test('il file porta la taglia solo quando non e\' quella normale', async ({ page }) => {
    await piu(page).click();
    await piu(page).click();
    const punto = await cellAt(page, 12, 12);
    await page.mouse.click(punto.x, punto.y);

    const blocchi = await serializzati(page);
    expect(blocchi.find((b) => b.col === 12 && b.row === 12)?.scale).toBe(2);
    // Il campo resta assente sugli altri: un level.json fatto prima che la
    // scala esistesse, riaperto e riscritto, non deve cambiare di una riga.
    const normale = blocchi.find((b) => b.col === 2 && b.row === 6)!;
    expect(Object.keys(normale)).toEqual(['col', 'row', 'type']);
  });

  test('serialize -> load -> serialize conserva la taglia', async ({ page }) => {
    const risultato = await page.evaluate(() => {
      const p = window.game.scene.keys.GameScene.placement;
      p.spawn(12, 12, 'basic', 0, 0.5);
      const prima = JSON.stringify(p.serializeLayers());
      p.loadLayers(JSON.parse(prima));
      return {
        uguale: prima === JSON.stringify(p.serializeLayers()),
        // Riletto dalla scena e non dal file: e' li' che si perdeva.
        larghezza: p.blockAt(12, 12, 0).displayWidth,
        riferimento: p.blockAt(2, 6, 0).displayWidth,
      };
    });
    expect(risultato.uguale).toBe(true);
    expect(risultato.larghezza).toBeCloseTo(risultato.riferimento / 2, 1);
  });

  test('un file scritto male non perde il blocco', async ({ page }) => {
    const casi = await page.evaluate(async () => {
      const { normalizeProject } = await import('/src/level/project.ts');
      const blocchi = normalizeProject({
        blocks: [
          { col: 0, row: 0, type: 'basic', scale: 0 },
          { col: 1, row: 0, type: 'basic', scale: 'grande' },
          { col: 2, row: 0, type: 'basic', scale: 99 },
          { col: 3, row: 0, type: 'basic', scale: 1 },
        ],
      }).levels[0]!.layers[0]!.blocks;
      return blocchi.map((b) => b.scale);
    });
    // Nessuno sparisce: una scala fuori scala viene riportata dentro, e una
    // scritta male vale 1 — il blocco resta un blocco.
    expect(casi).toEqual([0.25, undefined, 4, undefined]);
  });

  test('con un\'area in mano i pulsanti agiscono sui blocchi che ci sono dentro', async ({
    page,
  }) => {
    const normale = await larghezza(page, 2, 6);

    await tool(page, 'Seleziona').click();
    const a = await blockAt(page, 2, 6);
    const b = await blockAt(page, 6, 6);
    await drag(page, { x: a.x - 30, y: a.y - 25 }, { x: b.x + 30, y: b.y + 25 });
    expect((await state(page)).selBlocchi).toBeGreaterThanOrEqual(5);

    // Il numero passa a dire la taglia dell'area, e si accende: e' la stessa
    // regola di pennello e gomma, che con una selezione cambiano mestiere.
    await expect(valore(page)).toHaveText('1×');
    await piu(page).click();
    await expect(valore(page)).toHaveText('1.5×');
    await expect(page.locator('#editor-toolbar .stepper.scala')).toHaveClass(/azione/);
    expect(await larghezza(page, 2, 6)).toBeCloseTo(normale * 1.5, 1);
    expect(await larghezza(page, 6, 6)).toBeCloseTo(normale * 1.5, 1);
    // Fuori dall'area non si tocca niente.
    expect(await larghezza(page, 10, 8)).toBeCloseTo(normale, 1);

    await page.keyboard.press('Control+z');
    expect(await larghezza(page, 2, 6)).toBeCloseTo(normale, 1);
  });

  test('un\'area di taglie diverse lo dice, e ognuno parte dalla sua', async ({ page }) => {
    const normale = await larghezza(page, 2, 6);
    await page.evaluate(() => {
      window.game.scene.keys.GameScene.placement.rescale(2, 6, 0, 2);
    });

    await tool(page, 'Seleziona').click();
    const a = await blockAt(page, 2, 6);
    const b = await blockAt(page, 6, 6);
    await drag(page, { x: a.x - 40, y: a.y - 35 }, { x: b.x + 30, y: b.y + 25 });

    await expect(valore(page)).toHaveText('misto');
    // Su una selezione mista i due pulsanti restano accesi: ogni blocco ha il
    // suo margine, e sono i suoi gradini a contare.
    await expect(piu(page)).toBeEnabled();

    await piu(page).click();
    expect(await larghezza(page, 2, 6)).toBeCloseTo(normale * 3, 1);
    expect(await larghezza(page, 6, 6)).toBeCloseTo(normale * 1.5, 1);
  });

  test('su un\'area senza blocchi i pulsanti tornano al pennello', async ({ page }) => {
    await tool(page, 'Seleziona').click();
    // Terreno vuoto: l'area c'e', ma dentro non c'e' niente da ingrandire.
    const a = await cellAt(page, 14, 14);
    await drag(page, { x: a.x - 40, y: a.y - 40 }, { x: a.x + 40, y: a.y + 40 });
    expect((await state(page)).selBlocchi).toBe(0);

    // Il numero dice "pennello" e i pulsanti fanno quello: se agissero
    // sull'area sembrerebbero rotti.
    await piu(page).click();
    await expect(valore(page)).toHaveText('1.5×');
    expect(await page.evaluate(() => window.game.scene.keys.GameScene.placement.selectedScale)).toBe(
      1.5,
    );
  });

  test('il contagocce riprende la taglia insieme al tipo', async ({ page }) => {
    await page.evaluate(() => {
      window.game.scene.keys.GameScene.placement.spawn(12, 12, 'stack', 0, 2);
    });

    const punto = await cellAt(page, 12, 12);
    await page.keyboard.down('Alt');
    await page.mouse.click(punto.x, punto.y);
    await page.keyboard.up('Alt');

    const preso = await page.evaluate(() => {
      const p = window.game.scene.keys.GameScene.placement;
      return { tipo: p.selected, taglia: p.selectedScale };
    });
    expect(preso).toEqual({ tipo: 'stack', taglia: 2 });
    await expect(valore(page)).toHaveText('2×');
  });

  test('spostare e incollare non perdono la taglia', async ({ page }) => {
    const normale = await larghezza(page, 2, 6);
    await page.evaluate(() => {
      window.game.scene.keys.GameScene.placement.rescale(2, 6, 0, 2);
    });

    await tool(page, 'Seleziona').click();
    const a = await blockAt(page, 2, 6);
    await drag(page, { x: a.x - 30, y: a.y - 30 }, { x: a.x + 30, y: a.y + 20 });
    expect((await state(page)).selBlocchi).toBe(1);

    // Spostamento: una cella a destra.
    const da = await blockAt(page, 2, 6);
    const verso = await cellAt(page, 3, 6);
    await drag(page, da, verso);
    expect(await larghezza(page, 3, 6)).toBeCloseTo(normale * 2, 1);

    // Appunti: incolla altrove, e quello che arriva e' grande uguale.
    await page.keyboard.press('Control+c');
    await page.mouse.move((await cellAt(page, 12, 12)).x, (await cellAt(page, 12, 12)).y);
    await page.keyboard.press('Control+v');
    expect(await larghezza(page, 12, 12)).toBeCloseTo(normale * 2, 1);
  });

  test('con il fondale in mano lo stepper sparisce', async ({ page }) => {
    await expect(valore(page)).toBeVisible();
    await tool(page, 'Fondale').click();
    await expect(page.locator('#editor-toolbar .stepper.scala')).toBeHidden();
    await tool(page, 'Pennello').click();
    await expect(valore(page)).toBeVisible();
  });
});
