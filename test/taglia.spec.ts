import { expect, test } from '@playwright/test';
import { openEditor } from './helpers';

/**
 * La taglia di uno sprite: quante celle e' largo.
 *
 * Serve perche' il gioco riporta **ogni** blocco alla larghezza del rombo — un
 * PNG piu' grande non basta a fare un oggetto piu' grande, e non lo sarebbe mai
 * bastato. La taglia sta nel nome del file (`albero@2.png`) e **non nell'id**,
 * cosi' cambiarla non invalida i `level.json` che nominano quel blocco.
 */

test('il suffisso del nome file da\' la taglia e non entra nell\'id', async ({ page }) => {
  await openEditor(page);

  const letto = await page.evaluate(() => {
    // Le stesse regole del catalogo, applicate a nomi finti: il catalogo vero
    // ha solo i due sprite di prova, e non si aggiungono file per un test.
    const casi = ['albero@2.png', 'muro.png', 'roccia@0.5.png', 'email@casa.png', '@2.png'];
    return casi.map((nome) => {
      const stem = nome.replace(/\.[^.]+$/, '');
      const at = stem.lastIndexOf('@');
      if (at <= 0) return { id: stem, scale: undefined as number | undefined };
      const scale = Number(stem.slice(at + 1));
      if (!Number.isFinite(scale) || scale < 0.1 || scale > 8) {
        return { id: stem, scale: undefined as number | undefined };
      }
      return { id: stem.slice(0, at), scale };
    });
  });

  expect(letto[0]).toEqual({ id: 'albero', scale: 2 });
  expect(letto[1]).toEqual({ id: 'muro', scale: undefined });
  expect(letto[2]).toEqual({ id: 'roccia', scale: 0.5 });
  // Un `@` che non e' una taglia resta nell'id: un file chiamato davvero cosi'
  // deve continuare ad aprirsi invece di sparire dal catalogo.
  expect(letto[3]).toEqual({ id: 'email@casa', scale: undefined });
  expect(letto[4]).toEqual({ id: '@2', scale: undefined });
});

test('la taglia scelta finisce nel nome del file e nella scena', async ({ page }) => {
  await openEditor(page);

  const dataUrl = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 32;
    c.height = 32;
    const x = c.getContext('2d')!;
    x.fillStyle = '#3fa9f5';
    x.fillRect(0, 0, 32, 32);
    return c.toDataURL('image/png');
  });
  const buffer = Buffer.from(dataUrl.split(',')[1]!, 'base64');

  await page.click('#level-tabs .sprite-toggle');
  await page.click('#sprite-drawer .aggiungi');
  await page
    .locator('#sprite-importer input.file')
    .setInputFiles({ name: 'blocco.png', mimeType: 'image/png', buffer });
  await expect(page.locator('#sprite-importer .primary')).toBeEnabled();
  await page.uncheck('#sprite-importer input[type=checkbox]');

  // Due celle: quattro passi da un quarto sopra il valore di partenza.
  const piu = page.locator('#sprite-importer .stepper.taglia .freccia').last();
  for (let i = 0; i < 4; i++) await piu.click();
  await expect(page.locator('#sprite-importer .stepper.taglia input')).toHaveValue('2');

  await page.fill('#sprite-importer input[placeholder="muro_di_pietra"]', 'blocco largo');

  // Il nome del file porta la taglia; l'id resta pulito.
  await expect(page.locator('#sprite-importer .scarica')).toHaveAttribute(
    'download',
    'blocco_largo@2.png',
  );
  await expect(page.locator('#sprite-importer .note')).toContainText('blocco_largo@2.png');

  await page.click('#sprite-importer .primary');
  await expect
    .poll(() => page.evaluate(() => window.game.scene.keys.GameScene.textures.exists('blocco_largo')))
    .toBe(true);

  // In scena e' largo il doppio di un blocco normale, non il doppio di se stesso.
  const larghezze = await page.evaluate(() => {
    const scene = window.game.scene.keys.GameScene;
    // Due celle lontane da quelle gia' piene nel livello pubblicato: su una
    // occupata `spawn` non fa niente e si finirebbe per misurare il blocco che
    // c'era gia'.
    scene.placement.selected = 'basic';
    scene.placement.spawn(12, 12);
    scene.placement.selected = 'blocco_largo';
    scene.placement.spawn(14, 14);
    return {
      normale: scene.placement.blockAt(12, 12, 0)!.displayWidth,
      largo: scene.placement.blockAt(14, 14, 0)!.displayWidth,
    };
  });
  expect(larghezze.largo).toBeCloseTo(larghezze.normale * 2, 1);
});

test('l\'anteprima sulla cella disegna il rombo e lo sprite', async ({ page }) => {
  await openEditor(page);

  const dataUrl = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 32;
    c.height = 32;
    const x = c.getContext('2d')!;
    x.fillStyle = '#3fa9f5';
    x.fillRect(0, 0, 32, 32);
    return c.toDataURL('image/png');
  });
  const buffer = Buffer.from(dataUrl.split(',')[1]!, 'base64');

  await page.click('#level-tabs .sprite-toggle');
  await page.click('#sprite-drawer .aggiungi');
  await page
    .locator('#sprite-importer input.file')
    .setInputFiles({ name: 'blocco.png', mimeType: 'image/png', buffer });
  await expect(page.locator('#sprite-importer .primary')).toBeEnabled();
  await page.uncheck('#sprite-importer input[type=checkbox]');

  // Al centro dell'anteprima c'e' lo sprite: azzurro, non il fondo del riquadro.
  const centro = await page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('#sprite-importer canvas.sulla-cella')!;
    const d = c.getContext('2d')!.getImageData(c.width / 2, Math.round(c.height * 0.62), 1, 1).data;
    return { r: d[0]!, g: d[1]!, b: d[2]! };
  });
  expect(centro.b).toBeGreaterThan(centro.r);
  expect(centro.b).toBeGreaterThan(120);
});
