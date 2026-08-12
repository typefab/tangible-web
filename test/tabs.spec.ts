import { expect, test } from '@playwright/test';
import { cellAt, openEditor, state } from './helpers';

/**
 * Livelli e schede, che da qui in poi sono due cose diverse.
 *
 * Il **catalogo** sono tutti i livelli del progetto, e puo' arrivare a cento.
 * Le **schede** sono i due o tre aperti adesso, fra cui si va avanti e
 * indietro. Chiudere una scheda non elimina niente: e' l'unica cosa che rende
 * sopportabile un progetto grande, e quasi tutti i test qui girano intorno a
 * quella distinzione.
 */

const scheda = (n: number) => `#level-tabs .tab:nth-child(${n})`;
const elenco = '#level-tabs .elenco';
const riga = (nome: string) => `#level-browser .riga:has-text("${nome}")`;

/** Apre l'elenco e preme un'azione sulla riga di un livello. */
async function azioneSuRiga(
  page: import('@playwright/test').Page,
  nome: string,
  titolo: string,
): Promise<void> {
  await page.click(elenco);
  await page.click(`${riga(nome)} button[title^="${titolo}"]`);
}

test.describe('livelli e schede', () => {
  test.beforeEach(async ({ page }) => {
    await openEditor(page);
  });

  test('il file di partenza ha due livelli, ma una scheda sola', async ({ page }) => {
    const s = await state(page);
    expect(s.livelli).toEqual(['Livello 1', 'Livello 2']);
    // Aprire una scheda per livello non scalerebbe: con cento livelli sarebbero
    // cento schede, che e' il problema da cui si parte.
    expect(s.schede).toEqual(['Livello 1']);
    expect(s.livelloAttivo).toBe(0);
    expect(s.blocchi).toBe(12);
  });

  test('dall\'elenco si apre un livello, e prende una scheda', async ({ page }) => {
    await page.click(elenco);
    await expect(page.locator('#level-browser')).toBeVisible();
    await page.click(`${riga('Livello 2')} .nome`);

    const s = await state(page);
    expect(s.schede).toEqual(['Livello 1', 'Livello 2']);
    expect(s.livelloAttivo).toBe(1);
    expect(s.blocchi).toBe(4);
    // L'elenco si chiude da solo: si e' scelto, non serve piu'.
    await expect(page.locator('#level-browser')).toBeHidden();
  });

  test('la ricerca filtra per nome', async ({ page }) => {
    await page.click(elenco);
    await page.fill('#level-browser input[type=search]', 'llo 2');

    await expect(page.locator('#level-browser .riga')).toHaveCount(1);
    await expect(page.locator('#level-browser .conto')).toHaveText('1 di 2');
  });

  test('chiudere una scheda non elimina il livello', async ({ page }) => {
    await page.click(elenco);
    await page.click(`${riga('Livello 2')} .nome`);
    expect((await state(page)).schede).toHaveLength(2);

    await page.click(`${scheda(2)} .chiudi`);

    const s = await state(page);
    expect(s.schede).toEqual(['Livello 1']);
    // Il catalogo non si e' accorto di niente.
    expect(s.livelli).toEqual(['Livello 1', 'Livello 2']);
  });

  test('chiudendo la scheda attiva si atterra su un\'altra', async ({ page }) => {
    await page.click(elenco);
    await page.click(`${riga('Livello 2')} .nome`);
    expect((await state(page)).livelloAttivo).toBe(1);

    await page.click(`${scheda(2)} .chiudi`);

    const s = await state(page);
    expect(s.schede).toEqual(['Livello 1']);
    // Non si resta a modificare un livello che non ha piu' una scheda.
    expect(s.livelloAttivo).toBe(0);
    expect(s.blocchi).toBe(12);
  });

  test('l\'ultima scheda non si chiude: la scena disegna sempre un livello', async ({ page }) => {
    expect((await state(page)).schede).toHaveLength(1);
    await expect(page.locator(`${scheda(1)} .chiudi`)).toBeDisabled();
  });

  test('ogni livello conserva i propri blocchi', async ({ page }) => {
    await page.click(elenco);
    await page.click(`${riga('Livello 2')} .nome`);
    const punto = await cellAt(page, 14, 14);
    await page.mouse.click(punto.x, punto.y);
    const conTratto = (await state(page)).blocchi;

    await page.click(`${scheda(1)} .nome`);
    expect((await state(page)).blocchi).toBe(12);

    await page.click(`${scheda(2)} .nome`);
    expect((await state(page)).blocchi).toBe(conTratto);
  });

  test('si aggiunge un livello vuoto e ci si sposta sopra', async ({ page }) => {
    await page.click(elenco);
    await page.click('#level-browser .piede button');

    const s = await state(page);
    expect(s.livelli).toHaveLength(3);
    expect(s.livelloAttivo).toBe(2);
    expect(s.schede).toEqual(['Livello 1', 'Livello 3']);
    expect(s.blocchi).toBe(0);
  });

  test('duplicare inserisce dopo l\'originale senza spostare le schede aperte', async ({ page }) => {
    // Con "Livello 2" aperto, la copia di "Livello 1" si infila in mezzo: se
    // gli indici delle schede non venissero rimappati, la scheda di
    // "Livello 2" finirebbe a puntare alla copia.
    await page.click(elenco);
    await page.click(`${riga('Livello 2')} .nome`);
    await azioneSuRiga(page, 'Livello 1', 'Duplica');

    const s = await state(page);
    expect(s.livelli).toEqual(['Livello 1', 'Livello 1 (copia)', 'Livello 2']);
    expect(s.schede).toEqual(['Livello 1', 'Livello 2', 'Livello 1 (copia)']);
    expect(s.livelloAttivo).toBe(1);
    expect(s.blocchi).toBe(12);
  });

  test('eliminare chiede conferma, chiude la sua scheda e si recupera', async ({ page }) => {
    await page.click(elenco);
    await page.click(`${riga('Livello 2')} .nome`);
    expect((await state(page)).schede).toHaveLength(2);

    await azioneSuRiga(page, 'Livello 1', 'Elimina');
    await expect(page.locator('#editor-dialog')).toBeVisible();
    await page.click('#editor-dialog button:has-text("Elimina")');

    const s = await state(page);
    expect(s.livelli).toEqual(['Livello 2']);
    expect(s.schede).toEqual(['Livello 2']);
    // Il livello eliminato non era quello attivo: si resta dov'era il lavoro.
    expect(s.blocchi).toBe(4);

    await page.keyboard.press('Control+z');
    expect((await state(page)).livelli).toEqual(['Livello 1', 'Livello 2']);
  });

  test('Ctrl+Z annulla anche le operazioni sul catalogo', async ({ page }) => {
    await page.click(elenco);
    await page.click('#level-browser .piede button');
    expect((await state(page)).livelli).toHaveLength(3);

    await page.keyboard.press('Control+z');
    expect((await state(page)).livelli).toHaveLength(2);
    // Nessuna scheda resta appesa a un livello che non esiste piu'.
    expect((await state(page)).schede).toEqual(['Livello 1']);
  });

  test('l\'esportazione contiene tutti i livelli, aperti o no', async ({ page }) => {
    const esportato = await page.evaluate(() =>
      JSON.parse(window.game.scene.keys.GameScene.editor.serialize()),
    );
    expect(esportato.levels.map((l: { name: string }) => l.name)).toEqual(['Livello 1', 'Livello 2']);
    expect(esportato.levels[0].layers).toHaveLength(2);
    // Le schede aperte sono roba dell'editor: nel file che legge il gioco non
    // devono comparire.
    expect(JSON.stringify(esportato)).not.toContain('open');
  });
});

/**
 * Il caso che ha motivato tutto: un progetto grande.
 *
 * Cento livelli si costruiscono scrivendo nello stato dell'editor invece che
 * dall'interfaccia — servono cento livelli, non un modo comodo di crearli.
 */
test.describe('progetto da cento livelli', () => {
  test.beforeEach(async ({ page }) => {
    await openEditor(page);
    await page.evaluate(() => {
      const ed = window.game.scene.keys.GameScene.editor;
      ed.levels = Array.from({ length: 100 }, (_, i) => ({
        name: `Livello ${i + 1}`,
        layers: [{ name: 'Terreno', elevation: 0, visible: true, blocks: [] }],
      }));
      ed.openLevels = [0];
      ed.activeLevelIndex = 0;
      ed.placement.loadLayers(ed.levels[0].layers);
      ed.refresh();
    });
  });

  test('cento livelli nell\'elenco, una scheda sola in alto', async ({ page }) => {
    const s = await state(page);
    expect(s.livelli).toHaveLength(100);
    expect(s.schede).toHaveLength(1);

    await page.click(elenco);
    await expect(page.locator('#level-browser .riga')).toHaveCount(100);
    await expect(page.locator('#level-browser .conto')).toHaveText('100');
  });

  test('uno snapshot non costa piu' + ' di quanto costerebbe con due livelli', async ({ page }) => {
    // La misura vera e' il tempo, ma un tempo su CI e' rumore. Si verifica la
    // proprieta' che lo rende veloce: i livelli fermi finiscono nello snapshot
    // **per riferimento**, non ricopiati. Era 5,14ms a snapshot, ora 0,02.
    const condivisi = await page.evaluate(() => {
      const ed = window.game.scene.keys.GameScene.editor;
      const s = ed.snapshot();
      return {
        fermoCondiviso: s.project.levels[50] === ed.levels[50],
        attivoRiletto: s.project.levels[0] !== ed.levels[0],
      };
    });
    expect(condivisi.fermoCondiviso).toBe(true);
    expect(condivisi.attivoRiletto).toBe(true);
  });

  test('la ricerca trova un livello in mezzo agli altri', async ({ page }) => {
    await page.click(elenco);
    await page.fill('#level-browser input[type=search]', 'Livello 73');

    await expect(page.locator('#level-browser .riga')).toHaveCount(1);
    await page.click('#level-browser .riga .nome');

    const s = await state(page);
    expect(s.livelloAttivo).toBe(72);
    expect(s.schede).toEqual(['Livello 1', 'Livello 73']);
  });
});
