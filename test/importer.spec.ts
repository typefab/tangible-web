import { expect, test } from '@playwright/test';
import { cellAt, openEditor } from './helpers';

/**
 * L'editor d'immagine dello Strato 2, dalla parte che conta: un'immagine
 * qualsiasi diventa uno sprite piazzabile **in questa sessione**, senza passare
 * dal repository. La pipeline vera — togli sfondo, riduci a pixel-art — gira nel
 * browser, quindi si prova nel browser: un mock direbbe solo che il mock va.
 */
test('un\'immagine importata diventa uno sprite piazzabile subito', async ({ page }) => {
  await openEditor(page);

  // Immagine di prova disegnata nella pagina: sfondo bianco pieno, quadrato
  // rosso al centro. Cosi' il file e' vero senza doverlo forgiare a mano.
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 32;
    c.height = 32;
    const x = c.getContext('2d')!;
    x.fillStyle = '#ffffff';
    x.fillRect(0, 0, 32, 32);
    x.fillStyle = '#d21f2f';
    x.fillRect(8, 8, 16, 16);
    return c.toDataURL('image/png');
  });
  const buffer = Buffer.from(dataUrl.split(',')[1]!, 'base64');

  // Dal cassetto si apre l'importer.
  await page.click('#level-tabs .sprite-toggle');
  await page.click('#sprite-drawer .aggiungi');
  await expect(page.locator('#sprite-importer')).toBeVisible();

  await page
    .locator('#sprite-importer input.file')
    .setInputFiles({ name: 'prova.png', mimeType: 'image/png', buffer });

  // Il bottone si abilita solo quando la pipeline ha prodotto un risultato:
  // aspettare quello e' aspettare un oggetto, non un tempo.
  await expect(page.locator('#sprite-importer .primary')).toBeEnabled();

  await page.fill('#sprite-importer input[placeholder="muro_di_pietra"]', 'prova rossa');
  await page.click('#sprite-importer .primary');

  // Registrato come blocco di sessione, con la texture nel gioco e gia' scelto.
  await expect
    .poll(() => page.evaluate(() => window.game.scene.keys.GameScene.placement.selected))
    .toBe('prova_rossa');
  expect(
    await page.evaluate(() => window.game.scene.keys.GameScene.textures.exists('prova_rossa')),
  ).toBe(true);

  // Compare nel cassetto, che era rimasto aperto dietro l'importer.
  await expect(
    page.locator('#sprite-drawer button.sprite[title="prova rossa"]'),
  ).toBeVisible();

  // E si piazza come qualunque altro blocco: un tratto su una cella vuota
  // aggiunge un blocco al livello.
  const prima = await page.evaluate(() => window.game.scene.keys.GameScene.placement.count);
  const cella = await cellAt(page, 14, 14);
  await page.mouse.move(cella.x, cella.y);
  await page.mouse.down();
  await page.mouse.up();
  const dopo = await page.evaluate(() => window.game.scene.keys.GameScene.placement.count);
  expect(dopo).toBe(prima + 1);
});

/**
 * Lo sfondo si toglie davvero: gli angoli bianchi diventano trasparenti, il
 * rosso al centro resta. E' l'unica parte della pipeline con una risposta giusta
 * e una sbagliata, quindi e' quella che vale la pena inchiodare.
 */
test('togliere lo sfondo rende trasparenti gli angoli e tiene la figura', async ({ page }) => {
  await openEditor(page);

  const dataUrl = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 32;
    c.height = 32;
    const x = c.getContext('2d')!;
    x.fillStyle = '#ffffff';
    x.fillRect(0, 0, 32, 32);
    x.fillStyle = '#d21f2f';
    x.fillRect(8, 8, 16, 16);
    return c.toDataURL('image/png');
  });
  const buffer = Buffer.from(dataUrl.split(',')[1]!, 'base64');

  await page.click('#level-tabs .sprite-toggle');
  await page.click('#sprite-drawer .aggiungi');
  await page
    .locator('#sprite-importer input.file')
    .setInputFiles({ name: 'prova.png', mimeType: 'image/png', buffer });
  await expect(page.locator('#sprite-importer .primary')).toBeEnabled();

  await page.fill('#sprite-importer input[placeholder="muro_di_pietra"]', 'prova rossa');
  await page.click('#sprite-importer .primary');
  await expect
    .poll(() => page.evaluate(() => window.game.scene.keys.GameScene.textures.exists('prova_rossa')))
    .toBe(true);

  // Si legge la texture di sessione. Il bianco attorno non c'e' piu' in due
  // sensi: e' diventato trasparente, e poi il ritaglio ai bordi del contenuto
  // l'ha tolto di mezzo — quindi **il PNG e' il quadrato rosso**. E' per questo
  // che non si guarda l'angolo: li' adesso c'e' la figura, ed e' giusto cosi'.
  const campioni = await page.evaluate(() => {
    const tex = window.game.scene.keys.GameScene.textures.get('prova_rossa');
    const src = tex.getSourceImage() as HTMLCanvasElement;
    const x = src.getContext('2d')!;
    const w = src.width;
    const h = src.height;
    const centro = x.getImageData((w / 2) | 0, (h / 2) | 0, 1, 1).data;
    // Quante colonne del PNG sono tutte trasparenti: dopo il ritaglio, nessuna.
    let vuote = 0;
    for (let cx = 0; cx < w; cx++) {
      const col = x.getImageData(cx, 0, 1, h).data;
      let piena = false;
      for (let cy = 0; cy < h; cy++) if (col[cy * 4 + 3]! > 8) piena = true;
      if (!piena) vuote++;
    }
    return { centro: [...centro], vuote, quadrato: Math.abs(w - h) <= 1 };
  });

  // Rosso vero al centro: R alto, G e B bassi, e opaco.
  expect(campioni.centro[3]).toBeGreaterThan(0);
  expect(campioni.centro[0]).toBeGreaterThan(150);
  expect(campioni.centro[1]).toBeLessThan(100);
  // Il bianco attorno e' sparito del tutto: nessuna colonna vuota, e il PNG ha
  // ripreso le proporzioni del quadrato rosso invece di quelle della foto.
  expect(campioni.vuote).toBe(0);
  expect(campioni.quadrato).toBe(true);
});
