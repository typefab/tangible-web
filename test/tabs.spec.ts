import { expect, test } from '@playwright/test';
import { cellAt, openEditor, state } from './helpers';

const scheda = (n: number) => `#level-tabs .tabs button:nth-child(${n})`;
const azione = (titolo: string) => `#level-tabs .actions button[title^="${titolo}"]`;

/** Le schede: un file, piu' livelli, e nessuna contaminazione fra loro. */
test.describe('schede dei livelli', () => {
  test.beforeEach(async ({ page }) => {
    await openEditor(page);
  });

  test('il file di partenza ha due schede e apre la prima', async ({ page }) => {
    const s = await state(page);
    expect(s.schede).toEqual(['Livello 1', 'Livello 2']);
    expect(s.schedaAttiva).toBe(0);
    expect(s.blocchi).toBe(12);
  });

  test('cambiare scheda monta l\'altro livello', async ({ page }) => {
    await page.click(scheda(2));
    const s = await state(page);
    expect(s.schedaAttiva).toBe(1);
    expect(s.blocchi).toBe(4);
  });

  test('ogni scheda conserva i propri blocchi', async ({ page }) => {
    await page.click(scheda(2));
    const punto = await cellAt(page, 14, 14);
    await page.mouse.click(punto.x, punto.y);
    const conTratto = (await state(page)).blocchi;

    await page.click(scheda(1));
    expect((await state(page)).blocchi).toBe(12);

    await page.click(scheda(2));
    expect((await state(page)).blocchi).toBe(conTratto);
  });

  test('si aggiunge un livello vuoto e ci si sposta sopra', async ({ page }) => {
    await page.click(azione('Nuovo livello'));
    const s = await state(page);
    expect(s.schede).toHaveLength(3);
    expect(s.schedaAttiva).toBe(2);
    expect(s.blocchi).toBe(0);
  });

  test('si duplica il livello aperto', async ({ page }) => {
    await page.click(azione('Duplica'));
    const s = await state(page);
    expect(s.schede).toEqual(['Livello 1', 'Livello 1 (copia)', 'Livello 2']);
    expect(s.schedaAttiva).toBe(1);
    expect(s.blocchi).toBe(12);
  });

  test('Ctrl+Z annulla anche le operazioni sulle schede', async ({ page }) => {
    await page.click(azione('Nuovo livello'));
    expect((await state(page)).schede).toHaveLength(3);

    await page.keyboard.press('Control+z');
    expect((await state(page)).schede).toHaveLength(2);
  });

  test('eliminare una scheda chiede conferma, e si recupera', async ({ page }) => {
    await page.click(azione('Elimina'));
    await expect(page.locator('#editor-dialog')).toBeVisible();

    await page.click('#editor-dialog button:has-text("Elimina")');
    expect((await state(page)).schede).toEqual(['Livello 2']);

    await page.keyboard.press('Control+z');
    expect((await state(page)).schede).toEqual(['Livello 1', 'Livello 2']);
  });

  test('l\'esportazione contiene tutte le schede', async ({ page }) => {
    const esportato = await page.evaluate(() =>
      JSON.parse(window.game.scene.keys.GameScene.editor.serialize()),
    );
    expect(esportato.levels.map((l: { name: string }) => l.name)).toEqual(['Livello 1', 'Livello 2']);
    expect(esportato.levels[0].layers).toHaveLength(2);
  });
});
