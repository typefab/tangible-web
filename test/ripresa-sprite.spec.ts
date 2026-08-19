import { expect, test } from '@playwright/test';
import { cellAt, openEditor, state } from './helpers';

/**
 * Il giro che ha fatto perdere del lavoro: importo uno sprite, ci costruisco,
 * ricarico e scelgo "Riprendi".
 *
 * Prima succedevano due cose, e solo la prima era voluta: lo sprite spariva
 * (vive in quella sessione finche' non si committa il PNG) **e i blocchi
 * piazzati con lui venivano cancellati per sempre**, perche' il salvataggio si
 * rilegge dalla scena e quelli non erano stati disegnati.
 */
async function importaSprite(page: import('@playwright/test').Page, nome: string): Promise<void> {
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 32;
    c.height = 32;
    const x = c.getContext('2d')!;
    x.fillStyle = '#7ed321';
    x.fillRect(0, 0, 32, 32);
    return c.toDataURL('image/png');
  });
  const buffer = Buffer.from(dataUrl.split(',')[1]!, 'base64');

  await page.click('#level-tabs .sprite-toggle');
  await page.click('#sprite-drawer .aggiungi');
  await page
    .locator('#sprite-importer input.file')
    .setInputFiles({ name: 'verde.png', mimeType: 'image/png', buffer });
  await expect(page.locator('#sprite-importer .primary')).toBeEnabled();
  await page.uncheck('#sprite-importer input[type=checkbox]');
  await page.fill('#sprite-importer input[placeholder="muro_di_pietra"]', nome);
  await page.click('#sprite-importer .primary');
}

test('riprendendo, lo sprite importato e i suoi blocchi ci sono ancora', async ({ page }) => {
  await openEditor(page);
  await importaSprite(page, 'verde prova');
  await expect
    .poll(() => page.evaluate(() => window.game.scene.keys.GameScene.textures.exists('verde_prova')))
    .toBe(true);

  // Un blocco con quello sprite, e si aspetta che l'autosave sia stato scritto.
  const cella = await cellAt(page, 14, 14);
  await page.mouse.move(cella.x, cella.y);
  await page.mouse.down();
  await page.mouse.up();
  const conteggio = (await state(page)).blocchi;
  await page.waitForFunction(() => {
    const raw = localStorage.getItem('tangible-web:editor:v1');
    return raw !== null && raw.includes('verde_prova');
  });

  await page.reload();
  await page.waitForFunction(() => window.game?.scene?.keys?.GameScene?.editor !== undefined);
  await page.click('#editor-dialog button:has-text("Riprendi")');

  // Lo sprite e' tornato, e con lui il blocco: nessun buco, nessun avviso.
  await expect
    .poll(() => page.evaluate(() => window.game.scene.keys.GameScene.textures.exists('verde_prova')))
    .toBe(true);
  await expect
    .poll(async () => (await state(page)).blocchi)
    .toBe(conteggio);
  expect((await state(page)).dialogo).toBeNull();
});

test('un blocco con uno sprite sconosciuto non si perde nel salvataggio', async ({ page }) => {
  await openEditor(page);

  // Un livello che nomina uno sprite che non esiste: e' il caso del PNG
  // cancellato dal repository, e quello dello sprite di sessione svanito.
  const rimasto = await page.evaluate(() => {
    const scene = window.game.scene.keys.GameScene;
    scene.placement.loadLayers([
      {
        name: 'Terreno',
        elevation: 0,
        visible: true,
        blocks: [
          { col: 2, row: 2, type: 'basic' },
          { col: 5, row: 5, type: 'sprite_che_non_esiste' },
        ],
      },
    ]);
    // Il giro che prima cancellava: si rilegge dalla scena e si riscrive.
    const dopo = scene.placement.serializeLayers();
    return {
      tipi: dopo[0].blocks.map((b: { type: string }) => b.type).sort(),
      mancanti: scene.placement.orphanTypes(),
    };
  });

  expect(rimasto.tipi).toEqual(['basic', 'sprite_che_non_esiste']);
  expect(rimasto.mancanti).toEqual(['sprite_che_non_esiste']);
});
