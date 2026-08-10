import { expect, test } from '@playwright/test';
import { blockAt, cellAt, openEditor, state, tool } from './helpers';

/**
 * I layer: si disegna su uno alla volta, la quota alza il piano, e in gioco il
 * tocco prende sempre il blocco piu' in alto.
 */
test.describe('layer', () => {
  test.beforeEach(async ({ page }) => {
    await openEditor(page);
  });

  test('il file di partenza ha due piani, il secondo alzato', async ({ page }) => {
    const s = await state(page);
    expect(s.layer.map((l) => l.nome)).toEqual(['Terreno', 'Rialzo']);
    expect(s.layer[1]!.quota).toBe(1);
    expect(s.blocchi).toBe(12);
  });

  test('il pennello dipinge solo sul layer attivo', async ({ page }) => {
    const prima = await state(page);
    const punto = await cellAt(page, 12, 12);
    await page.mouse.click(punto.x, punto.y);

    const dopo = await state(page);
    expect(dopo.layer[0]!.blocchi).toBe(prima.layer[0]!.blocchi + 1);
    expect(dopo.layer[1]!.blocchi).toBe(prima.layer[1]!.blocchi);
  });

  test('] e [ cambiano piano, e il tratto segue', async ({ page }) => {
    await page.keyboard.press(']');
    expect((await state(page)).layerAttivo).toBe(1);

    const punto = await cellAt(page, 12, 12);
    await page.mouse.click(punto.x, punto.y);
    expect((await state(page)).layer[1]!.blocchi).toBe(3);

    await page.keyboard.press('[');
    expect((await state(page)).layerAttivo).toBe(0);
  });

  test('un piano alzato sta esattamente un rombo piu\' in su', async ({ page }) => {
    // (4,6) e' occupata su entrambi i piani nel file di partenza.
    const terra = await blockAt(page, 4, 6, 0);
    const alto = await blockAt(page, 4, 6, 1);
    expect(Math.round(terra.y - alto.y)).toBe(32);
  });

  test('un layer spento sparisce e non risponde al tocco', async ({ page }) => {
    const risultato = await page.evaluate(() => {
      const p = window.game.scene.keys.GameScene.placement;
      p.setLayerVisible(1, false);
      return {
        sprite: p.blockAt(4, 6, 1).visible,
        toccato: p.topBlockAt(4, 6).layerIndex,
      };
    });
    expect(risultato.sprite).toBe(false);
    expect(risultato.toccato).toBe(0);
  });

  test('un layer nascosto resta nascosto anche selezionandolo', async ({ page }) => {
    await page.evaluate(() => window.game.scene.keys.GameScene.placement.setLayerVisible(1, false));
    await page.keyboard.press(']');

    const s = await state(page);
    expect(s.layerAttivo).toBe(1);
    // Nascondere e' una decisione che tiene: l'unico modo di rivederlo e' l'occhio.
    expect(s.layer[1]!.visibile).toBe(false);
  });

  test('l\'occhio riaccende anche il layer attivo', async ({ page }) => {
    await page.keyboard.press(']');
    // La lista e' disegnata in `column-reverse`, ma l'ordine nel DOM resta
    // quello degli indici: la riga 1 e' il layer 1.
    const occhio = page.locator('#layer-panel .row').nth(1).locator('button').first();

    await occhio.click();
    expect((await state(page)).layer[1]!.visibile).toBe(false);

    // Se l'occhio del layer attivo fosse bloccato, nasconderlo sarebbe una
    // trappola senza uscita.
    await occhio.click();
    expect((await state(page)).layer[1]!.visibile).toBe(true);
  });

  test('non si superano gli 8 piani', async ({ page }) => {
    const quanti = await page.evaluate(() => {
      const p = window.game.scene.keys.GameScene.placement;
      for (let i = 0; i < 20; i++) p.addLayer();
      return p.layers.length;
    });
    expect(quanti).toBe(8);
  });

  test('un annullamento non tocca gli altri piani', async ({ page }) => {
    await tool(page, 'Pennello').click();
    const punto = await cellAt(page, 12, 12);
    await page.mouse.click(punto.x, punto.y);
    const conTratto = await state(page);

    await page.keyboard.press('Control+z');
    const dopo = await state(page);
    expect(dopo.layer[0]!.blocchi).toBe(conTratto.layer[0]!.blocchi - 1);
    expect(dopo.layer[1]!.blocchi).toBe(conTratto.layer[1]!.blocchi);
  });
});
