import { expect, test } from '@playwright/test';
import { cellAt, openEditor, state } from './helpers';

/**
 * Il salvataggio locale.
 *
 * Il comportamento che conta non e' "salva", e' **"non decide da solo"**: se in
 * memoria c'e' qualcosa di diverso dal file pubblicato, chiede, e finche' non
 * si risponde non tocca niente. Sono test che richiedono ricariche vere, perche'
 * e' esattamente la scheda chiusa e riaperta il caso da coprire.
 */
test.describe('salvataggio e ripresa', () => {
  async function dipingiQualcosa(page: import('@playwright/test').Page): Promise<number> {
    const punto = await cellAt(page, 12, 12);
    await page.mouse.click(punto.x, punto.y);
    // L'autosave e' ritardato di 800ms: si aspetta che sia stato scritto.
    await page.waitForFunction(() => !!localStorage.getItem('tangible-web:editor:v1'));
    return (await state(page)).blocchi;
  }

  test('la prima apertura non chiede niente', async ({ page }) => {
    await openEditor(page);
    const s = await state(page);
    expect(s.dialogo).toBeNull();
    expect(s.blocchi).toBe(12);
    expect(s.inMemoria).toBe(false);
  });

  test('un tratto segna il lavoro come non salvato e scatta l\'autosave', async ({ page }) => {
    await openEditor(page);
    await dipingiQualcosa(page);

    const s = await state(page);
    expect(s.stato).toContain('non salvato');
    expect(s.inMemoria).toBe(true);
  });

  test('riaprendo chiede, e non tocca niente finche\' non si risponde', async ({ page }) => {
    await openEditor(page);
    await dipingiQualcosa(page);

    await openEditor(page);
    const s = await state(page);
    expect(s.dialogo).not.toBeNull();
    // Il file pubblicato resta a schermo mentre la domanda e' aperta.
    expect(s.blocchi).toBe(12);
  });

  test('"Riprendi" rimette il lavoro locale', async ({ page }) => {
    await openEditor(page);
    const conTratto = await dipingiQualcosa(page);

    await openEditor(page);
    await page.click('#editor-dialog button:has-text("Riprendi")');

    const s = await state(page);
    expect(s.dialogo).toBeNull();
    expect(s.blocchi).toBe(conTratto);
  });

  test('"Ricomincia" torna al file pubblicato e svuota la memoria', async ({ page }) => {
    await openEditor(page);
    await dipingiQualcosa(page);

    await openEditor(page);
    await page.click('#editor-dialog button:has-text("Ricomincia")');

    const s = await state(page);
    expect(s.blocchi).toBe(12);
    expect(s.inMemoria).toBe(false);

    // E alla riapertura successiva non c'e' piu' niente da chiedere.
    await openEditor(page);
    expect((await state(page)).dialogo).toBeNull();
  });

  test('Salva cambia lo stato da non salvato a salvato', async ({ page }) => {
    await openEditor(page);
    await dipingiQualcosa(page);
    expect((await state(page)).stato).toContain('non salvato');

    await page.click('#editor-toolbar button:has-text("Salva")');
    expect((await state(page)).stato).toMatch(/^✓ salvato/);
  });

  test('anche il salvato chiede conferma, perche\' non e\' ancora nel file pubblicato', async ({
    page,
  }) => {
    await openEditor(page);
    await dipingiQualcosa(page);
    await page.click('#editor-toolbar button:has-text("Salva")');

    await openEditor(page);
    expect((await state(page)).dialogo).not.toBeNull();
  });
});

test.describe('apertura di un file', () => {
  test('un level.json scelto dal dispositivo sostituisce il progetto, e si annulla', async ({
    page,
  }) => {
    await openEditor(page);

    await page.setInputFiles(
      '#editor-toolbar input[type=file]',
      {
        name: 'level.json',
        mimeType: 'application/json',
        buffer: Buffer.from(
          JSON.stringify({
            levels: [
              {
                name: 'Dal telefono',
                layers: [
                  {
                    name: 'Terreno',
                    elevation: 0,
                    visible: true,
                    blocks: [{ col: 5, row: 5, type: 'basic' }],
                  },
                ],
              },
            ],
          }),
        ),
      },
    );

    await expect
      .poll(async () => (await state(page)).schede)
      .toEqual(['Dal telefono']);
    expect((await state(page)).blocchi).toBe(1);

    await page.keyboard.press('Control+z');
    expect((await state(page)).schede).toEqual(['Livello 1', 'Livello 2']);
  });

  test('un file rotto lo dice invece di svuotare la scena', async ({ page }) => {
    await openEditor(page);

    await page.setInputFiles('#editor-toolbar input[type=file]', {
      name: 'rotto.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{ "levels": [ questo non e JSON'),
    });

    await expect(page.locator('#editor-dialog')).toContainText('non leggibile');
    await page.click('#editor-dialog button:has-text("Ho capito")');
    expect((await state(page)).blocchi).toBe(12);
  });
});
