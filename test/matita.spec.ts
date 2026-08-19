import { expect, test, type Page } from '@playwright/test';
import { openEditor } from './helpers';

/**
 * I difetti della matita, segnalati usandola davvero. Ognuno ha il suo test,
 * perche' erano tutti invisibili a chi guardava solo il risultato finale.
 */

/** Un quadrato rosso pieno: senza sfondo da togliere, si vede solo cio' che fa la matita. */
async function apriMatita(page: Page, lato = 64): Promise<void> {
  const dataUrl = await page.evaluate((n) => {
    const c = document.createElement('canvas');
    c.width = n;
    c.height = n;
    const x = c.getContext('2d')!;
    x.fillStyle = '#d21f2f';
    x.fillRect(0, 0, n, n);
    return c.toDataURL('image/png');
  }, lato);
  const buffer = Buffer.from(dataUrl.split(',')[1]!, 'base64');

  await page.click('#level-tabs .sprite-toggle');
  await page.click('#sprite-drawer .aggiungi');
  await page
    .locator('#sprite-importer input.file')
    .setInputFiles({ name: 'pieno.png', mimeType: 'image/png', buffer });
  await expect(page.locator('#sprite-importer .primary')).toBeEnabled();

  // Niente rimozione automatica: un'immagine tutta di un colore verrebbe via
  // intera, e non si distinguerebbe piu' cosa ha fatto la matita.
  await page.uncheck('#sprite-importer input[type=checkbox]');
  await page.click('#sprite-importer .ritaglia');
  await expect(page.locator('#mask-editor')).toBeVisible();
}

/** Conferma il ritaglio, importa con quel nome e restituisce come leggere i pixel. */
async function concludi(page: Page, id: string, slug: string): Promise<void> {
  await page.click('#mask-editor .primary');
  await expect(page.locator('#mask-editor')).toBeHidden();
  await page.fill('#sprite-importer input[placeholder="muro_di_pietra"]', id);
  await page.click('#sprite-importer .primary');
  await expect
    .poll(() => page.evaluate((n) => window.game.scene.keys.GameScene.textures.exists(n), slug))
    .toBe(true);
}

/** L'alfa in una posizione data in frazione della texture: 0.5,0.5 e' il centro. */
function alphaAt(page: Page, slug: string, fx: number, fy: number): Promise<number> {
  return page.evaluate(
    ([n, ax, ay]) => {
      const tex = window.game.scene.keys.GameScene.textures.get(n as string);
      const src = tex.getSourceImage() as HTMLCanvasElement;
      const x = Math.min(src.width - 1, Math.floor(src.width * (ax as number)));
      const y = Math.min(src.height - 1, Math.floor(src.height * (ay as number)));
      return src.getContext('2d')!.getImageData(x, y, 1, 1).data[3]!;
    },
    [slug, fx, fy] as const,
  );
}

test('un tratto veloce lascia una linea continua, non una fila di buchi', async ({ page }) => {
  await openEditor(page);
  await apriMatita(page);

  // Un solo salto da sinistra a destra: e' il gesto che prima lasciava buchi,
  // perche' si dipingeva solo dove capitava un evento del puntatore.
  const box = (await page.locator('#mask-editor canvas.grid').boundingBox())!;
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width * 0.1, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.9, y);
  await page.mouse.up();

  await concludi(page, 'linea continua', 'linea_continua');

  // Lungo tutta la riga di mezzo non deve restare niente.
  for (const fx of [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]) {
    expect(await alphaAt(page, 'linea_continua', fx, 0.5), `buco a ${fx}`).toBe(0);
  }
});

test('il ritaglio resta anche cambiando il lato in pixel', async ({ page }) => {
  await openEditor(page);
  await apriMatita(page);

  const box = (await page.locator('#mask-editor canvas.grid').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.up();
  await page.click('#mask-editor .primary');

  // Il cambio di dimensione prima ricostruiva tutto dalla sorgente, e il
  // ritaglio spariva senza dire niente.
  await page.locator('#sprite-importer .stepper .freccia').last().click();
  await page.locator('#sprite-importer .stepper .freccia').last().click();

  await page.fill('#sprite-importer input[placeholder="muro_di_pietra"]', 'ritaglio tenuto');
  await page.click('#sprite-importer .primary');
  await expect
    .poll(() =>
      page.evaluate(() => window.game.scene.keys.GameScene.textures.exists('ritaglio_tenuto')),
    )
    .toBe(true);

  expect(await alphaAt(page, 'ritaglio_tenuto', 0.5, 0.5)).toBe(0);
  // E il resto dell'immagine e' ancora li': non si e' persa nell'altro senso.
  expect(await alphaAt(page, 'ritaglio_tenuto', 0.05, 0.05)).toBeGreaterThan(0);
});

test('ingrandire non fa crescere la finestra', async ({ page }) => {
  await openEditor(page);
  await apriMatita(page);

  const box = page.locator('#mask-editor .box');
  const prima = (await box.boundingBox())!;

  for (let i = 0; i < 4; i++) await page.click('#mask-editor .zoom button:nth-child(3)');

  const dopo = (await box.boundingBox())!;
  // La tela cresce dentro al visore, non trascinandosi dietro il riquadro.
  expect(dopo.width).toBeCloseTo(prima.width, 0);
  expect(dopo.height).toBeCloseTo(prima.height, 0);
});

test('Sposta muove l\'immagine', async ({ page }) => {
  await openEditor(page);
  await apriMatita(page);

  const canvas = page.locator('#mask-editor canvas.grid');
  const prima = (await canvas.boundingBox())!;

  await page.click('#mask-editor button[title="Trascina per spostare l’immagine"]');
  await page.mouse.move(prima.x + prima.width / 2, prima.y + prima.height / 2);
  await page.mouse.down();
  await page.mouse.move(prima.x + prima.width / 2 + 40, prima.y + prima.height / 2 + 25, {
    steps: 5,
  });
  await page.mouse.up();

  const dopo = (await canvas.boundingBox())!;
  expect(dopo.x - prima.x).toBeGreaterThan(20);
  expect(dopo.y - prima.y).toBeGreaterThan(10);
});

test('il lazo tiene quello che sta dentro il contorno', async ({ page }) => {
  await openEditor(page);
  await apriMatita(page);

  await page.click('#mask-editor button[title^="Traccia un contorno"]');

  // Un quadrato attorno al centro, tracciato col dito.
  const box = (await page.locator('#mask-editor canvas.grid').boundingBox())!;
  const p = (fx: number, fy: number) => ({
    x: box.x + box.width * fx,
    y: box.y + box.height * fy,
  });
  const angoli = [p(0.35, 0.35), p(0.65, 0.35), p(0.65, 0.65), p(0.35, 0.65)];
  await page.mouse.move(angoli[0]!.x, angoli[0]!.y);
  await page.mouse.down();
  for (const a of angoli.slice(1)) await page.mouse.move(a.x, a.y, { steps: 4 });
  await page.mouse.up();

  await concludi(page, 'lazo', 'lazo');

  // Dentro resta, fuori se ne va: e' il ritaglio, non la gomma.
  expect(await alphaAt(page, 'lazo', 0.5, 0.5)).toBeGreaterThan(0);
  expect(await alphaAt(page, 'lazo', 0.05, 0.05)).toBe(0);
  expect(await alphaAt(page, 'lazo', 0.95, 0.95)).toBe(0);
});

test('con un lato grande l\'anteprima ci sta dentro invece di uscire dal bordo', async ({
  page,
}) => {
  await openEditor(page);

  // Rettangolare apposta: su un quadrato l'immagine riempirebbe il riquadro
  // comunque, e il difetto non si vedrebbe.
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 100;
    c.height = 50;
    const x = c.getContext('2d')!;
    x.fillStyle = '#d21f2f';
    x.fillRect(0, 0, 100, 50);
    return c.toDataURL('image/png');
  });
  const buffer = Buffer.from(dataUrl.split(',')[1]!, 'base64');

  await page.click('#level-tabs .sprite-toggle');
  await page.click('#sprite-drawer .aggiungi');
  await page
    .locator('#sprite-importer input.file')
    .setInputFiles({ name: 'largo.png', mimeType: 'image/png', buffer });
  await expect(page.locator('#sprite-importer .primary')).toBeEnabled();
  await page.uncheck('#sprite-importer input[type=checkbox]');

  // Un lato ben piu' grande dei 192px dell'anteprima: prima `floor` dava 0, si
  // ripiegava su 1x e lo sprite veniva disegnato a grandezza piena, mezzo fuori.
  await page.fill('#sprite-importer .stepper input', '512');
  await page.dispatchEvent('#sprite-importer .stepper input', 'input');

  // In alto al centro ci deve essere la scacchiera, non lo sprite: se lo sprite
  // esce dal riquadro, quel punto e' rosso.
  const sopra = await page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('#sprite-importer .preview')!;
    const d = c.getContext('2d')!.getImageData(c.width / 2, 3, 1, 1).data;
    return { r: d[0]!, g: d[1]!, b: d[2]! };
  });
  expect(sopra.r).toBeLessThan(120);
});
