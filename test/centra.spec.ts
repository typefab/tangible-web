import { expect, test, type Page } from '@playwright/test';
import { openEditor } from './helpers';

/**
 * Il ritaglio al contenuto e la finestra "centra".
 *
 * Nascono da una prova su un telefono vero, ed erano due difetti con una radice
 * sola: la pipeline riduceva a pixel **tutto il fotogramma**, non la figura.
 * Quindi di 128px di nitidezza chiesti alla figura ne arrivavano trentacinque —
 * l'immagine veniva fuori molle — e la figura restava dov'era nella foto mentre
 * il gioco centra sulla cella **il PNG**, cioe' finiva fuori dalla sua cella.
 * Ingrandendo, lo scarto si moltiplicava con tutto il resto.
 */

/** Una figura piccola e spostata in un angolo, su sfondo bianco: il caso storto. */
async function importaFiguraDecentrata(page: Page): Promise<void> {
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 400;
    c.height = 400;
    const x = c.getContext('2d')!;
    x.fillStyle = '#ffffff';
    x.fillRect(0, 0, 400, 400);
    x.fillStyle = '#e0473e';
    x.beginPath();
    x.arc(110, 95, 55, 0, Math.PI * 2);
    x.fill();
    return c.toDataURL('image/png');
  });
  const buffer = Buffer.from(dataUrl.split(',')[1]!, 'base64');

  await page.click('#level-tabs .sprite-toggle');
  await page.click('#sprite-drawer .aggiungi');
  await page
    .locator('#sprite-importer input.file')
    .setInputFiles({ name: 'figura.png', mimeType: 'image/png', buffer });
  await expect(page.locator('#sprite-importer .primary')).toBeEnabled();
}

/** Dov'e' e quanto occupa la figura dentro il PNG prodotto. */
function misura(page: Page): Promise<{
  larghezza: number;
  altezza: number;
  riempimento: number;
  scartoX: number;
  scartoY: number;
}> {
  return page.evaluate(() => {
    const c = window.game.scene.keys.GameScene.editor.spriteImporter.result as HTMLCanvasElement;
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    let minX = c.width;
    let minY = c.height;
    let maxX = -1;
    let maxY = -1;
    let opachi = 0;
    for (let y = 0; y < c.height; y++) {
      for (let x = 0; x < c.width; x++) {
        if (d[(y * c.width + x) * 4 + 3]! <= 8) continue;
        opachi++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    return {
      larghezza: maxX - minX + 1,
      altezza: maxY - minY + 1,
      riempimento: opachi / (c.width * c.height),
      // Quanto il centro della figura e' lontano da quello del PNG, in frazioni
      // di PNG: e' lo scarto che il gioco si porta sulla cella.
      scartoX: Math.abs((minX + maxX) / 2 - c.width / 2) / c.width,
      scartoY: Math.abs((minY + maxY) / 2 - c.height / 2) / c.height,
    };
  });
}

test('la figura riempie il PNG invece di galleggiarci dentro', async ({ page }) => {
  await openEditor(page);
  await importaFiguraDecentrata(page);

  const m = await misura(page);
  // Prima di ritagliare al contenuto: figura 35x41 dentro un PNG 128x128, il 7%
  // di pixel opachi, e il centro spostato di un quarto di immagine.
  expect(m.riempimento).toBeGreaterThan(0.5);
  expect(m.scartoX).toBeLessThan(0.01);
  expect(m.scartoY).toBeLessThan(0.01);
  // La nitidezza chiesta arriva alla figura: il lato lungo e' quello scelto.
  expect(Math.max(m.larghezza, m.altezza)).toBe(128);
});

test('il PNG prende le proporzioni della figura, non della foto', async ({ page }) => {
  await openEditor(page);
  // Sorgente quadrata, figura larga il doppio che alta: il PNG deve seguire lei.
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 300;
    c.height = 300;
    const x = c.getContext('2d')!;
    x.fillStyle = '#ffffff';
    x.fillRect(0, 0, 300, 300);
    x.fillStyle = '#2f9e44';
    x.fillRect(30, 200, 160, 80);
    return c.toDataURL('image/png');
  });
  const buffer = Buffer.from(dataUrl.split(',')[1]!, 'base64');
  await page.click('#level-tabs .sprite-toggle');
  await page.click('#sprite-drawer .aggiungi');
  await page
    .locator('#sprite-importer input.file')
    .setInputFiles({ name: 'barra.png', mimeType: 'image/png', buffer });
  await expect(page.locator('#sprite-importer .primary')).toBeEnabled();

  const m = await misura(page);
  expect(m.larghezza / m.altezza).toBeCloseTo(2, 1);
});

test('la finestra si apre, ospita i due stepper e poi li restituisce', async ({ page }) => {
  await openEditor(page);
  await importaFiguraDecentrata(page);

  // Prima stanno nel pannello.
  expect(await page.locator('#sprite-importer .stepper.lato').count()).toBe(1);
  expect(await page.locator('#cell-placer .stepper.taglia').count()).toBe(0);

  await page.click('#sprite-importer .centra');
  await expect(page.locator('#cell-placer')).toBeVisible();
  // Dentro la finestra: sono gli stessi elementi, spostati, non due copie.
  expect(await page.locator('#cell-placer .stepper.lato').count()).toBe(1);
  expect(await page.locator('#cell-placer .stepper.taglia').count()).toBe(1);
  expect(await page.locator('#sprite-importer .stepper.lato').count()).toBe(0);

  await page.click('#cell-placer .primary');
  await expect(page.locator('#cell-placer')).toBeHidden();
  // E tornano da dove sono venuti: devono funzionare anche a finestra chiusa.
  expect(await page.locator('#sprite-importer .stepper.lato').count()).toBe(1);
  expect(await page.locator('#sprite-importer .stepper.taglia').count()).toBe(1);
});

/** Trascina sul palco della finestra, dal centro verso uno scarto. */
async function trascina(page: Page, dx: number, dy: number): Promise<void> {
  const palco = (await page.locator('#cell-placer canvas.palco').boundingBox())!;
  const x = palco.x + palco.width / 2;
  const y = palco.y + palco.height * 0.45;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 8 });
  await page.mouse.up();
}

function offset(page: Page): Promise<{ x: number; y: number }> {
  return page.evaluate(() => window.game.scene.keys.GameScene.editor.spriteImporter.offset);
}

test('trascinare sposta lo sprite, e ⌖ lo rimette al centro', async ({ page }) => {
  await openEditor(page);
  await importaFiguraDecentrata(page);
  await page.click('#sprite-importer .centra');

  await trascina(page, 0, 40);
  await page.click('#cell-placer .primary');
  const giu = await offset(page);
  expect(giu.y).toBeGreaterThan(0.1);
  expect(giu.x).toBe(0);

  await page.click('#sprite-importer .centra');
  await page.click('#cell-placer .croce .centra');
  await page.click('#cell-placer .primary');
  expect(await offset(page)).toEqual({ x: 0, y: 0 });
});

test('annullare la finestra non lascia applicato lo spostamento', async ({ page }) => {
  await openEditor(page);
  await importaFiguraDecentrata(page);

  await page.click('#sprite-importer .centra');
  await trascina(page, 0, 40);
  // Annulla e non Fatto: quello che si stava provando non deve restare.
  await page.click('#cell-placer button:has-text("Annulla")');
  await expect(page.locator('#cell-placer')).toBeHidden();
  expect(await offset(page)).toEqual({ x: 0, y: 0 });
});

test('alzare lo sprite non lo rimpicciolisce: il nome del file non cambia', async ({ page }) => {
  await openEditor(page);
  await importaFiguraDecentrata(page);
  await page.fill('#sprite-importer input[placeholder="muro_di_pietra"]', 'palo');
  expect(await page.getAttribute('#sprite-importer .scarica', 'download')).toBe('palo.png');

  // In verticale il PNG non cambia larghezza, quindi la taglia resta quella.
  await page.click('#sprite-importer .centra');
  await trascina(page, 0, -40);
  await page.click('#cell-placer .primary');
  expect(await page.getAttribute('#sprite-importer .scarica', 'download')).toBe('palo.png');

  // Di lato invece il PNG si allarga per far posto al vuoto, e la taglia scritta
  // nel nome cresce con lui: e' quello che tiene la **figura** larga come prima
  // invece di farla rimpicciolire man mano che la si sposta.
  await page.click('#sprite-importer .centra');
  await trascina(page, 60, 0);
  await page.click('#cell-placer .primary');
  const nome = await page.getAttribute('#sprite-importer .scarica', 'download');
  expect(nome).toMatch(/^palo@[\d.]+\.png$/);
  expect(Number(nome!.replace('palo@', '').replace('.png', ''))).toBeGreaterThan(1);
});

test('il tasto indietro chiude la finestra, non la scheda', async ({ page }) => {
  await openEditor(page);
  await importaFiguraDecentrata(page);
  await page.click('#sprite-importer .centra');
  await expect(page.locator('#cell-placer')).toBeVisible();

  await page.goBack();
  // Chiusa lei, e il pannello dietro resta aperto: si scende la pila un gradino
  // per volta. Senza la voce in `cancelTopmost` l'indietro avrebbe chiuso
  // l'importer sotto, lasciando questa finestra appesa sopra il nulla.
  await expect(page.locator('#cell-placer')).toBeHidden();
  await expect(page.locator('#sprite-importer')).toBeVisible();
  expect(page.url()).toContain('editor=1');
});
