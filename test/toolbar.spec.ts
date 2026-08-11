import { expect, test } from '@playwright/test';
import { cellAt, openEditor, state } from './helpers';

/**
 * L'ingombro della toolbar, misurato sullo schermo di un telefono.
 *
 * Non e' un test estetico. La barra a quattro righe occupava 289px su 780, il
 * 37% dello schermo, e meta' di quello spazio era per comandi che si toccano
 * una volta a serata — salva, scarica, apri, griglia. Su un telefono, dove
 * questo editor viene usato davvero, il conto non tornava: si costruiva in una
 * finestra piu' piccola della barra dei comandi.
 *
 * Questi test guardano quanto schermo resta, non come e' fatto il CSS: un
 * giorno il foglio potra' diventare un pannello laterale, e devono restare
 * verdi.
 */

const TELEFONO = { width: 390, height: 780 };

/** Altezza in pixel di un elemento, 0 se non c'e' o e' nascosto. */
function altezza(page: import('@playwright/test').Page, selector: string): Promise<number> {
  return page.evaluate(
    (sel) => Math.round(document.querySelector(sel)?.getBoundingClientRect().height ?? 0),
    selector,
  );
}

test.describe('barra su telefono', () => {
  test.use({ viewport: TELEFONO });

  test('la barra lascia alla scena piu\' di due terzi dello schermo', async ({ page }) => {
    await openEditor(page);

    const barra = await altezza(page, '#editor-toolbar');
    const schede = await altezza(page, '#level-tabs');
    expect(barra).toBeLessThan(200);
    // Quello che conta e' la somma: barra sotto, schede sopra. Misurato a
    // 390x780: 171 + 47, cioe' 562px di scena — erano 444 con la barra a
    // quattro righe. La soglia sta sotto il valore vero perche' un pulsante in
    // piu' non deve far diventare rosso un test che parla di ingombro.
    expect(TELEFONO.height - barra - schede).toBeGreaterThan(TELEFONO.height * 0.7);
  });

  test('palette e strumenti restano in vista, i comandi rari no', async ({ page }) => {
    await openEditor(page);

    // Quello che si tocca ogni secondo non si nasconde mai.
    expect(await altezza(page, '#editor-toolbar .palette-strip')).toBeGreaterThan(0);
    expect(await altezza(page, '#editor-toolbar .tools')).toBeGreaterThan(0);
    expect(await altezza(page, '#editor-toolbar .sheet')).toBe(0);
    await expect(page.locator('#editor-toolbar .menu')).toBeVisible();
  });

  test('⋯ apre il foglio, e un comando lo richiude', async ({ page }) => {
    await openEditor(page);
    await page.click('#editor-toolbar .menu');

    const salva = page.locator('#editor-toolbar button:has-text("Salva")');
    await expect(salva).toBeVisible();
    await expect(page.locator('#editor-toolbar .menu')).toHaveAttribute('aria-expanded', 'true');

    await salva.click();
    // Il foglio si e' richiuso da solo: la scena torna visibile senza un
    // secondo tocco, ed e' il motivo per cui il foglio esiste.
    expect(await altezza(page, '#editor-toolbar .sheet')).toBe(0);
    expect((await state(page)).stato).toMatch(/^✓ salvato/);
  });

  test('la griglia si accende e si spegne senza far chiudere il foglio', async ({ page }) => {
    await openEditor(page);
    await page.click('#editor-toolbar .menu');

    // Si guarda la scena mentre si commuta: chiudendo, non si vedrebbe il
    // risultato di quello che si e' appena premuto.
    await page.click('#editor-toolbar button:has-text("Griglia")');
    expect(await page.evaluate(() => window.game.scene.keys.GameScene.gridVisible)).toBe(false);
    expect(await altezza(page, '#editor-toolbar .sheet')).toBeGreaterThan(0);
  });

  test("col foglio chiuso, ⋯ dice comunque che c'e' lavoro non salvato", async ({ page }) => {
    await openEditor(page);
    const menu = page.locator('#editor-toolbar .menu');
    await expect(menu).not.toHaveClass(/dirty/);

    const punto = await cellAt(page, 12, 12);
    await page.mouse.click(punto.x, punto.y);

    // Lo stato per esteso e' dentro il foglio, che qui e' chiuso: se il pallino
    // non comparisse, "non salvato" non lo direbbe piu' nessuno.
    await expect(menu).toHaveClass(/dirty/);
    expect((await state(page)).stato).toContain('non salvato');
  });

  test('il pannello dei layer parte chiuso, e si apre quando serve', async ({ page }) => {
    await openEditor(page);

    // Aperto occupa 168px sopra la scena, proprio l'angolo dove l'origine
    // isometrica mette i primi blocchi.
    const pannello = page.locator('#layer-panel');
    await expect(pannello).toHaveClass(/collapsed/);
    expect(await altezza(page, '#layer-panel')).toBeLessThan(70);

    await pannello.locator('.head button').last().click();
    await expect(pannello).not.toHaveClass(/collapsed/);
    await expect(pannello.locator('.row').first()).toBeVisible();
  });
});

test('su schermo largo la barra non cambia: niente ⋯, Salva a un tocco', async ({ page }) => {
  await openEditor(page);

  await expect(page.locator('#editor-toolbar .menu')).toBeHidden();
  await expect(page.locator('#editor-toolbar button:has-text("Salva")')).toBeVisible();
  await expect(page.locator('#layer-panel')).not.toHaveClass(/collapsed/);
});
