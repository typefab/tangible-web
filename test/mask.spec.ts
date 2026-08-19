import { expect, test, type Page } from '@playwright/test';
import { openEditor } from './helpers';

/** Disegna un'immagine di prova nella pagina e la da' come file all'importer. */
async function loadProva(page: Page): Promise<void> {
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
}

/**
 * La matita, dalla parte che conta: cancellare a mano un pixel della figura lo
 * porta fino allo sprite finale. E' il senso dell'Opzione A — si lavora sui
 * pixel veri, non su un'immagine che poi verra' ricampionata.
 */
test('ritagliare a mano cancella un pixel e arriva allo sprite', async ({ page }) => {
  await openEditor(page);
  await loadProva(page);

  await page.click('#sprite-importer .ritaglia');
  await expect(page.locator('#mask-editor')).toBeVisible();

  // La gomma e' lo strumento di partenza: un colpo al centro, dov'e' il rosso.
  const box = (await page.locator('#mask-editor canvas.grid').boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.up();

  await page.click('#mask-editor .primary'); // Fatto
  await expect(page.locator('#mask-editor')).toBeHidden();

  await page.fill('#sprite-importer input[placeholder="muro_di_pietra"]', 'ritagliata');
  await page.click('#sprite-importer .primary');
  await expect
    .poll(() => page.evaluate(() => window.game.scene.keys.GameScene.textures.exists('ritagliata')))
    .toBe(true);

  // Il centro, che era rosso opaco, ora e' trasparente: il taglio e' arrivato.
  const centroAlpha = await page.evaluate(() => {
    const tex = window.game.scene.keys.GameScene.textures.get('ritagliata');
    const src = tex.getSourceImage() as HTMLCanvasElement;
    const x = src.getContext('2d')!;
    return x.getImageData((src.width / 2) | 0, (src.height / 2) | 0, 1, 1).data[3];
  });
  expect(centroAlpha).toBe(0);
});

/**
 * Le frecce del lato in pixel muovono il valore a passi, senza scrivere: e' la
 * via comoda dal telefono, dove lo spinner nativo e' minuscolo.
 */
test('le frecce del lato in pixel aumentano e diminuiscono il valore', async ({ page }) => {
  await openEditor(page);
  await loadProva(page);

  const campo = page.locator('#sprite-importer .stepper.lato input');
  const prima = Number(await campo.inputValue());

  // La seconda freccia e' il +, la prima il −.
  await page.locator('#sprite-importer .stepper.lato .freccia').last().click();
  expect(Number(await campo.inputValue())).toBe(prima + 8);

  await page.locator('#sprite-importer .stepper.lato .freccia').first().click();
  expect(Number(await campo.inputValue())).toBe(prima);
});
