import { expect, test } from '@playwright/test';
import { cellAt, openEditor, state } from './helpers';

/**
 * Il tasto indietro del telefono. Prima chiudeva la scheda — e con la scheda il
 * lavoro non ancora scaricato — proprio mentre si cercava di chiudere un
 * pannello. Ora scende la pila un gradino per volta, e solo in fondo chiede.
 *
 * `page.goBack()` e' l'indietro del browser, lo stesso evento del tasto del
 * telefono: la sentinella nella cronologia lo intercetta uguale.
 */
test.describe('tasto indietro', () => {
  test('col cassetto aperto lo chiude, senza chiedere niente', async ({ page }) => {
    await openEditor(page);
    await page.click('#level-tabs .sprite-toggle');
    await expect(page.locator('#sprite-drawer')).toBeVisible();

    await page.goBack();

    await expect(page.locator('#sprite-drawer')).toBeHidden();
    // Nessuna domanda: l'indietro e' servito a chiudere, e basta.
    expect((await state(page)).dialogo).toBeNull();
    // E si resta nell'editor, che e' il punto di tutto.
    expect(await page.evaluate(() => window.game !== undefined)).toBe(true);
  });

  test('col catalogo dei livelli aperto chiude quello', async ({ page }) => {
    await openEditor(page);
    await page.click('#level-tabs .elenco');
    await expect(page.locator('#level-browser')).toBeVisible();

    await page.goBack();

    await expect(page.locator('#level-browser')).toBeHidden();
    expect((await state(page)).dialogo).toBeNull();
  });

  test('senza niente aperto chiede, e "Resta qui" tiene la pagina', async ({ page }) => {
    await openEditor(page);

    await page.goBack();

    await expect(page.locator('#editor-dialog')).toBeVisible();
    expect((await state(page)).dialogo).toBe('Vuoi chiudere la scheda?');

    await page.click('#editor-dialog button:has-text("Resta qui")');
    await expect(page.locator('#editor-dialog')).toBeHidden();
    expect(await page.evaluate(() => window.game !== undefined)).toBe(true);
  });

  test('la domanda torna anche al secondo indietro', async ({ page }) => {
    await openEditor(page);

    await page.goBack();
    await page.click('#editor-dialog button:has-text("Resta qui")');
    await expect(page.locator('#editor-dialog')).toBeHidden();

    // La sentinella si rimette dopo ogni "resta": senza, il secondo indietro
    // uscirebbe in silenzio ed e' il caso che si voleva evitare.
    await page.goBack();
    await expect(page.locator('#editor-dialog')).toBeVisible();
    expect((await state(page)).dialogo).toBe('Vuoi chiudere la scheda?');
  });

  test('con lavoro non salvato la domanda lo dice', async ({ page }) => {
    await openEditor(page);

    // Una pennellata su una cella vuota: da li' in poi c'e' roba non salvata.
    const cella = await cellAt(page, 14, 14);
    await page.mouse.move(cella.x, cella.y);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForFunction(
      () => document.querySelector('#editor-toolbar .status')?.classList.contains('dirty') === true,
    );

    await page.goBack();

    await expect(page.locator('#editor-dialog')).toContainText('non salvate');
  });
});
