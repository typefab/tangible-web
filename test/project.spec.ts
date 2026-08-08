import { expect, test } from '@playwright/test';
import { open, openEditor, state } from './helpers';

/**
 * Il formato del file: piu' livelli in uno, e le tre generazioni precedenti che
 * devono continuare ad aprirsi. Sono i file che vivono sul telefono di chi li
 * ha esportati: non si possono migrare a distanza.
 */
test.describe('formato del progetto', () => {
  test('serialize -> load -> serialize non cambia niente', async ({ page }) => {
    await openEditor(page);
    const uguale = await page.evaluate(() => {
      const p = window.game.scene.keys.GameScene.placement;
      const prima = JSON.stringify(p.serializeLayers());
      p.loadLayers(JSON.parse(prima));
      return prima === JSON.stringify(p.serializeLayers());
    });
    expect(uguale).toBe(true);
  });

  test('il formato piatto di prima dei layer si apre, con gli id tradotti', async ({ page }) => {
    await openEditor(page);
    const progetto = await page.evaluate(async () => {
      const { normalizeProject } = await import('/src/level/project.ts');
      return normalizeProject({
        blocks: [
          { col: 1, row: 1, type: 'block_0' },
          { col: 2, row: 1, type: 'block_1' },
        ],
      });
    });

    expect(progetto.levels).toHaveLength(1);
    expect(progetto.levels[0].layers).toHaveLength(1);

    // Gli alias si applicano al momento di piazzare, non alla normalizzazione.
    const tipi = await page.evaluate((layers) => {
      const p = window.game.scene.keys.GameScene.placement;
      p.loadLayers(layers);
      return p.serializeLayers()[0].blocks.map((b: { type: string }) => b.type);
    }, progetto.levels[0].layers);
    expect(tipi).toEqual(['basic', 'stack']);
  });

  test('un file irriconoscibile non lascia la scena senza piani', async ({ page }) => {
    await openEditor(page);
    const casi = await page.evaluate(async () => {
      const { normalizeProject } = await import('/src/level/project.ts');
      return {
        vuoto: normalizeProject({ layers: [] }).levels[0].layers.length,
        spazzatura: normalizeProject('non sono un progetto').levels.length,
        nullo: normalizeProject(null).levels[0].layers.length,
      };
    });
    expect(casi.vuoto).toBe(1);
    expect(casi.spazzatura).toBe(1);
    expect(casi.nullo).toBe(1);
  });

  test('un blocco con id inesistente viene scartato, non diventa invisibile', async ({ page }) => {
    await openEditor(page);
    const quanti = await page.evaluate(() => {
      const p = window.game.scene.keys.GameScene.placement;
      p.loadLayers([
        { name: 'X', elevation: 0, visible: true, blocks: [{ col: 3, row: 3, type: 'inesistente' }] },
      ]);
      return p.count;
    });
    expect(quanti).toBe(0);
  });

  test('?level sceglie il livello, per numero e per nome', async ({ page }) => {
    await open(page, '?level=2');
    expect((await state(page)).blocchi).toBe(4);

    await open(page, '?level=Livello%201');
    expect((await state(page)).blocchi).toBe(12);
  });

  test('un ?level sbagliato torna al primo invece di dare una scena vuota', async ({ page }) => {
    await open(page, '?level=Caverna%20che%20non%20esiste');
    expect((await state(page)).blocchi).toBe(12);
  });
});
