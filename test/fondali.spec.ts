import { expect, test } from '@playwright/test';
import { openEditor, state, tool } from './helpers';

/**
 * I fondali: immagini dietro alla scena.
 *
 * La decisione che questi test proteggono e' che un fondale **non e' un
 * blocco**. Non sta in una cella, non lo tocca il pennello, non entra nella
 * selezione: vive in un elenco suo dentro il livello. E' il motivo per cui
 * pennello, gomma, selezione e appunti non hanno dovuto imparare niente.
 */

/** L'immagine di prova in src/assets/backgrounds/. */
const FONDALE = 'esempio-collina';

function fondali(page: import('@playwright/test').Page) {
  return page.evaluate(() => window.game.scene.keys.GameScene.backdrop.serialize());
}

test.describe('fondali', () => {
  test.beforeEach(async ({ page }) => {
    await openEditor(page);
    await tool(page, 'Fondale').click();
  });

  test('lo strumento cambia la palette invece di aggiungerne una', async ({ page }) => {
    // Sono la stessa domanda — "cosa piazzo" — fatta da due strumenti diversi:
    // due strisce insieme costerebbero una riga di schermo per niente.
    await expect(page.locator('#editor-toolbar .palette-strip.fondali')).toBeVisible();
    await expect(page.locator('#editor-toolbar .palette-strip:not(.fondali)')).toBeHidden();

    await tool(page, 'Pennello').click();
    await expect(page.locator('#editor-toolbar .palette-strip.fondali')).toBeHidden();
    await expect(page.locator('#editor-toolbar .palette-strip:not(.fondali)')).toBeVisible();
  });

  test('un tocco piazza, un secondo tocco sopra lo prende invece di duplicarlo', async ({ page }) => {
    await page.mouse.click(450, 300);
    expect(await fondali(page)).toHaveLength(1);

    // Stessa regola della selezione: il dito dentro sposta, il dito fuori
    // comincia qualcosa di nuovo. Nessuna modalita' da cambiare.
    await page.mouse.click(450, 300);
    expect(await fondali(page)).toHaveLength(1);

    // Lontano dal primo e ben dentro il canvas: piu' in basso ci sarebbe la
    // barra, e il tocco non arriverebbe mai alla scena.
    await page.mouse.click(140, 110);
    expect(await fondali(page)).toHaveLength(2);
  });

  test('trascinare lo sposta, e Ctrl+Z lo rimette in un colpo solo', async ({ page }) => {
    await page.mouse.click(450, 300);
    const prima = (await fondali(page))[0];

    await page.mouse.move(450, 300);
    await page.mouse.down();
    await page.mouse.move(560, 380, { steps: 8 });
    await page.mouse.up();

    const dopo = (await fondali(page))[0];
    expect(dopo.x).toBeGreaterThan(prima.x);
    expect(dopo.y).toBeGreaterThan(prima.y);

    // Un trascinamento e' un solo passo indietro, come una pennellata.
    await page.keyboard.press('Control+z');
    const annullato = (await fondali(page))[0];
    expect(annullato.x).toBe(prima.x);
    expect(annullato.y).toBe(prima.y);
  });

  test('si prende dal punto toccato, non dal centro', async ({ page }) => {
    await page.mouse.click(450, 300);
    const prima = (await fondali(page))[0];

    // Preso in un angolo e mosso di poco: se il fondale si agganciasse col
    // centro sotto il dito, salterebbe di mezza immagine al primo movimento.
    await page.mouse.move(500, 330);
    await page.mouse.down();
    await page.mouse.move(510, 330, { steps: 4 });
    await page.mouse.up();

    const dopo = (await fondali(page))[0];
    expect(Math.abs(dopo.x - prima.x)).toBeLessThan(40);
    expect(Math.abs(dopo.y - prima.y)).toBeLessThan(10);
  });

  test('si ingrandisce e si rimpicciolisce', async ({ page }) => {
    await page.mouse.click(450, 300);
    expect((await fondali(page))[0].scale).toBe(1);

    await page.click('#layer-panel button[title="Ingrandisci il fondale"]');
    expect((await fondali(page))[0].scale).toBeGreaterThan(1);

    await page.click('#layer-panel button[title="Rimpicciolisci il fondale"]');
    expect((await fondali(page))[0].scale).toBeCloseTo(1, 2);
  });

  test('i comandi compaiono solo con un fondale in mano', async ({ page }) => {
    const comandi = page.locator('#layer-panel button[title="Togli questo fondale dal livello"]');
    await expect(comandi).toBeHidden();

    await page.mouse.click(450, 300);
    await expect(comandi).toBeVisible();

    // Cambiando strumento il fondale si molla: lasciarlo in mano sarebbe uno
    // stato invisibile che riemerge tornando qui.
    await tool(page, 'Pennello').click();
    await expect(comandi).toBeHidden();
  });

  test('sta dietro ai blocchi e sotto la griglia', async ({ page }) => {
    await page.mouse.click(450, 300);

    const profondita = await page.evaluate(() => {
      const scene = window.game.scene.keys.GameScene;
      const immagine = scene.children.list.find(
        (o: { type: string; texture?: { key: string } }) =>
          o.type === 'Image' && o.texture?.key === 'esempio-collina',
      ) as { depth: number };
      return { fondale: immagine.depth, griglia: scene.gridLines.depth };
    });

    // La griglia stava gia' a -1000: mettendoci anche i fondali finivano in
    // pareggio, e a parita' di profondita' decide l'ordine di creazione —
    // cioe' il fondale copriva la griglia su cui si costruisce.
    expect(profondita.fondale).toBeLessThan(profondita.griglia);
    expect(profondita.fondale).toBeLessThan(0);
  });

  test('finisce nel file, e chi non ne usa non se ne accorge', async ({ page }) => {
    const senza = await page.evaluate(() =>
      window.game.scene.keys.GameScene.editor.serialize(),
    );
    // La chiave non c'e' proprio: un level.json fatto prima dei fondali,
    // riaperto e riscritto, deve restare identico byte a byte.
    expect(senza).not.toContain('backgrounds');

    await page.mouse.click(450, 300);
    const con = JSON.parse(
      await page.evaluate(() => window.game.scene.keys.GameScene.editor.serialize()),
    );
    expect(con.levels[0].backgrounds).toHaveLength(1);
    expect(con.levels[0].backgrounds[0].id).toBe(FONDALE);
    // Arrotondati: un fondale trascinato col dito darebbe sette decimali per
    // riga, e il diff del file va letto a mano.
    expect(Number.isInteger(con.levels[0].backgrounds[0].x)).toBe(true);
  });

  test('l\'elenco nel pannello dice quanti ce ne sono e quale si sta manovrando', async ({
    page,
  }) => {
    const righe = page.locator('#layer-panel .sezione .row');
    await expect(page.locator('#layer-panel .sezione .head strong')).toHaveText('Fondali');
    await expect(righe).toHaveCount(0);

    await page.mouse.click(450, 300);
    await expect(page.locator('#layer-panel .sezione .head strong')).toHaveText('Fondali (1)');
    await expect(righe).toHaveCount(1);
    await expect(righe.first().locator('.name')).toHaveAttribute('aria-pressed', 'true');
  });

  test('col + se ne aggiunge un altro anche quando il primo copre tutto', async ({ page }) => {
    // E' il caso vero, non un dettaglio: un fondale grande occupa quasi tutto
    // lo schermo, e da li' in poi ogni tocco prende quello invece di
    // aggiungerne uno. Senza il + nel pannello, il secondo fondale sarebbe
    // praticamente impossibile da mettere.
    await page.mouse.click(450, 300);
    await page.mouse.click(430, 320);
    expect(await fondali(page)).toHaveLength(1);

    await page.click('#layer-panel .sezione .head button');
    expect(await fondali(page)).toHaveLength(2);
    await expect(page.locator('#layer-panel .sezione .row')).toHaveCount(2);
  });

  test('si ruota, e i gradi finiscono nel file solo se non sono zero', async ({ page }) => {
    await page.mouse.click(450, 300);
    expect((await fondali(page))[0].rotation).toBeUndefined();

    await page.click('#layer-panel button[title^="Ruota di 15 gradi in senso orario"]');
    expect((await fondali(page))[0].rotation).toBe(15);

    await page.click('#layer-panel button[title^="Ruota di 15 gradi in senso antiorario"]');
    // Tornato a zero: la chiave sparisce invece di restare a 0 nel file.
    expect((await fondali(page))[0].rotation).toBeUndefined();

    // Sotto zero si gira dall'altra parte, non si va in negativo.
    await page.click('#layer-panel button[title^="Ruota di 15 gradi in senso antiorario"]');
    expect((await fondali(page))[0].rotation).toBe(345);
  });

  test('la rotazione si annulla con Ctrl+Z', async ({ page }) => {
    await page.mouse.click(450, 300);
    await page.click('#layer-panel button[title^="Ruota di 15 gradi in senso orario"]');
    expect((await fondali(page))[0].rotation).toBe(15);

    await page.keyboard.press('Control+z');
    expect((await fondali(page))[0].rotation).toBeUndefined();
  });

  test('dall\'elenco si sceglie quale manovrare', async ({ page }) => {
    await page.mouse.click(450, 300);
    await page.click('#layer-panel .sezione .head button');
    // Il piu' recente e' in cima all'elenco, come per i layer: e' quello
    // disegnato davanti.
    const righe = page.locator('#layer-panel .sezione .row .name');
    await expect(righe.first()).toHaveAttribute('aria-pressed', 'true');

    await righe.nth(1).click();
    await expect(righe.nth(1)).toHaveAttribute('aria-pressed', 'true');
    await expect(righe.first()).toHaveAttribute('aria-pressed', 'false');

    // E i comandi agiscono su quello scelto, non sull'ultimo aggiunto.
    await page.click('#layer-panel button[title^="Ruota di 15 gradi in senso orario"]');
    const dopo = await fondali(page);
    expect(dopo[0].rotation).toBe(15);
    expect(dopo[1].rotation).toBeUndefined();
  });

  test('scegliendo lo strumento il pannello si apre, se era chiuso', async ({ page }) => {
    // I comandi del fondale vivono nel pannello: su telefono parte chiuso, e
    // uno strumento che non mostra i suoi comandi sembra non fare niente.
    await page.setViewportSize({ width: 390, height: 780 });
    await page.reload();
    await page.waitForFunction(() => window.game?.scene?.keys?.GameScene?.editor !== undefined);
    await expect(page.locator('#layer-panel')).toHaveClass(/collapsed/);

    await tool(page, 'Fondale').click();
    await expect(page.locator('#layer-panel')).not.toHaveClass(/collapsed/);
  });

  test('cambiando livello il fondale resta sul suo', async ({ page }) => {
    await page.mouse.click(450, 300);
    expect(await fondali(page)).toHaveLength(1);

    await page.click('#level-tabs .elenco');
    await page.click('#level-browser .riga:has-text("Livello 2") .nome');
    expect(await fondali(page)).toHaveLength(0);

    await page.click('#level-tabs .tab:nth-child(1) .nome');
    expect(await fondali(page)).toHaveLength(1);
    expect((await state(page)).blocchi).toBe(12);
  });
});

/**
 * Il gioco, non l'editor. Il `level.json` servito viene sostituito al volo:
 * e' l'unico modo di provare il percorso vero — quello che monta i fondali
 * per chi apre il link e basta — senza toccare il file di Fabrizio.
 */
test.describe('fondali in gioco', () => {
  async function serviLivello(
    page: import('@playwright/test').Page,
    backgrounds: unknown[],
  ): Promise<void> {
    await page.route('**/level.json', (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          levels: [
            {
              name: 'Con fondale',
              layers: [{ name: 'Terreno', elevation: 0, visible: true, blocks: [] }],
              backgrounds,
            },
          ],
        }),
      }),
    );
  }

  test('chi apre il link vede il fondale, senza passare dall\'editor', async ({ page }) => {
    await serviLivello(page, [{ id: FONDALE, x: 400, y: 300, scale: 2 }]);
    await page.goto('/');
    await page.waitForFunction(() => window.game?.scene?.keys?.GameScene?.backdrop !== undefined);
    await page.waitForFunction(() => window.game.loop.frame > 2);

    expect(await page.evaluate(() => window.game.scene.keys.GameScene.backdrop.count)).toBe(1);
  });

  test('un fondale che non esiste piu\' viene scartato, non lascia un buco', async ({ page }) => {
    // Stessa regola dei blocchi: l'elenco delle immagini esiste solo dopo la
    // build, quindi un file che nomina un PNG cancellato dal repository non
    // puo' essere fermato dal compilatore.
    await serviLivello(page, [
      { id: 'immagine-cancellata', x: 400, y: 300, scale: 1 },
      { id: FONDALE, x: 200, y: 200, scale: 1 },
    ]);
    await page.goto('/');
    await page.waitForFunction(() => window.game?.scene?.keys?.GameScene?.backdrop !== undefined);
    await page.waitForFunction(() => window.game.loop.frame > 2);

    expect(await page.evaluate(() => window.game.scene.keys.GameScene.backdrop.count)).toBe(1);
  });
});
