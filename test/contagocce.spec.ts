import { expect, test } from '@playwright/test';
import { cellAt, openEditor, state, tool } from './helpers';

/**
 * Il contagocce: tenere premuto un blocco per prenderne il tipo.
 *
 * Il caso interessante non e' che funzioni, e' che il pennello **ha gia'
 * dipinto** quando il tocco diventa lungo. Meta' di questi test verificano che
 * quella pennellata venga disfatta, e l'altra meta' che il gesto non si
 * attivi dove il dito fermo ha gia' un significato.
 *
 * Sui casi negativi qui si aspetta un tempo fisso, contro la regola del
 * progetto. E' l'eccezione che la regola tollera: si sta verificando che
 * **non** succeda niente, e su una macchina lenta un'attesa corta puo' solo
 * far passare il test per sbaglio, mai renderlo rosso su CI.
 */

/** Quanto aspettare per essere sicuri che il contagocce sia scattato, o no. */
const OLTRE_LA_SOGLIA = 900;

function scelto(page: import('@playwright/test').Page): Promise<string> {
  return page.evaluate(() => window.game.scene.keys.GameScene.placement.selected);
}

/** Il tipo di blocco in una cella del terreno, o null. */
function tipoIn(
  page: import('@playwright/test').Page,
  col: number,
  row: number,
): Promise<string | null> {
  return page.evaluate(
    ([c, r]) => window.game.scene.keys.GameScene.placement.typeAt(c, r, 0) ?? null,
    [col, row] as const,
  );
}

/** Tiene premuto fermo su un punto, e poi alza. */
async function tieniPremuto(
  page: import('@playwright/test').Page,
  punto: { x: number; y: number },
  attesa: number | (() => Promise<unknown>),
): Promise<void> {
  await page.mouse.move(punto.x, punto.y);
  await page.mouse.down();
  if (typeof attesa === 'number') await page.waitForTimeout(attesa);
  else await attesa();
  await page.mouse.up();
}

test.describe('contagocce', () => {
  test.beforeEach(async ({ page }) => {
    await openEditor(page);
    // Il livello di partenza ha "stack" in (10,7) e "basic" in (9,8), sul
    // terreno e senza niente sopra: sono le due celle usate qui.
    expect(await scelto(page)).toBe('basic');
  });

  test('tenendo premuto un blocco, quel tipo diventa quello scelto', async ({ page }) => {
    const prima = await state(page);

    await tieniPremuto(page, await cellAt(page, 10, 7), () =>
      page.waitForFunction(
        () => window.game.scene.keys.GameScene.placement.selected === 'stack',
      ),
    );

    expect(await scelto(page)).toBe('stack');
    // La pennellata che il tocco aveva gia' fatto e' stata disfatta: la cella
    // ha ancora il suo blocco, non quello che si stava dipingendo.
    expect(await tipoIn(page, 10, 7)).toBe('stack');
    expect((await state(page)).blocchi).toBe(prima.blocchi);
  });

  test('il tocco lungo non lascia niente da annullare', async ({ page }) => {
    await tieniPremuto(page, await cellAt(page, 10, 7), () =>
      page.waitForFunction(
        () => window.game.scene.keys.GameScene.placement.selected === 'stack',
      ),
    );

    // Prendere un colore non e' una modifica della scena: se finisse nella
    // cronologia, Ctrl+Z tornerebbe indietro senza che si veda cambiare nulla.
    const s = await state(page);
    expect(s.stato).not.toContain('non salvato');
  });

  test('muovendo il dito e\' un tratto, non un contagocce', async ({ page }) => {
    const da = await cellAt(page, 9, 8);
    const a = await cellAt(page, 12, 12);

    await page.mouse.move(da.x, da.y);
    await page.mouse.down();
    await page.mouse.move(a.x, a.y, { steps: 8 });
    await page.waitForTimeout(OLTRE_LA_SOGLIA);
    await page.mouse.up();

    expect(await scelto(page)).toBe('basic');
    // E il tratto e' rimasto: il blocco dipinto in fondo alla trascinata c'e'.
    expect(await tipoIn(page, 12, 12)).toBe('basic');
  });

  test('su terreno vuoto non scatta, e il blocco appena dipinto resta', async ({ page }) => {
    const vuota = await cellAt(page, 14, 14);

    await tieniPremuto(page, vuota, OLTRE_LA_SOGLIA);

    // Il contagocce non si arma nemmeno: se lo facesse, tenere fermo il dito
    // dopo una pennellata cancellerebbe il blocco appena messo.
    expect(await tipoIn(page, 14, 14)).toBe('basic');
    expect(await scelto(page)).toBe('basic');
  });

  test('con la gomma prende il tipo, passa al pennello e non cancella', async ({ page }) => {
    await tool(page, 'Gomma').click();
    const prima = await state(page);

    await tieniPremuto(page, await cellAt(page, 10, 7), () =>
      page.waitForFunction(
        () => window.game.scene.keys.GameScene.placement.selected === 'stack',
      ),
    );

    // Indicare un blocco significa volerlo piazzare, come premere il suo
    // pulsante nella palette: restare con la gomma in mano cancellerebbe al
    // tocco successivo.
    await expect(tool(page, 'Pennello')).toHaveAttribute('aria-pressed', 'true');
    expect(await tipoIn(page, 10, 7)).toBe('stack');
    expect((await state(page)).blocchi).toBe(prima.blocchi);
  });

  test('con la selezione il dito fermo resta della selezione', async ({ page }) => {
    await tool(page, 'Seleziona').click();
    const punto = await cellAt(page, 10, 7);

    await page.mouse.move(punto.x, punto.y);
    await page.mouse.down();
    await page.waitForTimeout(OLTRE_LA_SOGLIA);
    await page.mouse.up();

    // Li' il dito fermo vuol dire "sto per trascinare l'area": rubarglielo
    // renderebbe lo strumento imprevedibile.
    expect(await scelto(page)).toBe('basic');
  });

  test('Alt+clic prende il tipo senza aspettare', async ({ page }) => {
    const prima = await state(page);
    const punto = await cellAt(page, 10, 7);

    await page.keyboard.down('Alt');
    await page.mouse.click(punto.x, punto.y);
    await page.keyboard.up('Alt');

    expect(await scelto(page)).toBe('stack');
    // Alt+clic non dipinge nemmeno per un istante: qui non c'e' niente da
    // disfare, il tratto non comincia proprio.
    expect((await state(page)).blocchi).toBe(prima.blocchi);
    expect((await state(page)).stato).not.toContain('non salvato');
  });

  test('col dito vero: tocco lungo, con eventi touch', async ({ page, context }) => {
    const punto = await cellAt(page, 10, 7);
    const cdp = await context.newCDPSession(page);
    const touch = (type: string, punti: { x: number; y: number }[]) =>
      cdp.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: punti.map((p, id) => ({ x: p.x, y: p.y, id })),
      });

    await touch('touchStart', [punto]);
    await page.waitForFunction(
      () => window.game.scene.keys.GameScene.placement.selected === 'stack',
    );
    await touch('touchEnd', []);

    expect(await scelto(page)).toBe('stack');
    expect(await tipoIn(page, 10, 7)).toBe('stack');
  });
});
