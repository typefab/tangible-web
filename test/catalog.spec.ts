import { readdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { openEditor } from './helpers';

/**
 * La promessa del catalogo: **la cartella e' l'elenco.**
 *
 * Il test legge davvero `src/assets/blocks/` dal disco e la confronta col
 * cassetto degli sprite. Se qualcuno un giorno rimettesse un elenco scritto a
 * mano, questo test lo scoprirebbe al primo PNG caricato senza toccarlo.
 *
 * Si guardano solo le sezioni `.categoria`: la scorciatoia "usati nel livello"
 * ripete degli id, e non e' il catalogo — e' un sottoinsieme comodo.
 */
test('il cassetto contiene esattamente i PNG di src/assets/blocks/', async ({ page }) => {
  const suDisco = readdirSync('src/assets/blocks', { recursive: true })
    .map(String)
    .filter((f) => f.endsWith('.png'))
    .map((f) => f.slice(f.lastIndexOf('/') + 1).replace(/\.png$/, ''))
    .sort();

  expect(suDisco.length).toBeGreaterThan(0);

  await openEditor(page);
  await page.click('#level-tabs .sprite-toggle');

  const nelCassetto = await page.evaluate(() =>
    [...document.querySelectorAll('#sprite-drawer .sezione.categoria button.sprite')]
      .map((b) => b.getAttribute('title'))
      .sort(),
  );

  // L'etichetta e' l'id reso leggibile: `red_brick` -> `Red Brick`.
  const atteso = suDisco
    .map((id) => id.replace(/[_-]+/g, ' ').replace(/\b\p{Ll}/gu, (c) => c.toUpperCase()))
    .sort();
  expect(nelCassetto).toEqual(atteso);
});

test('ogni sprite del cassetto ha un\'anteprima vera, presa dal gioco', async ({ page }) => {
  await openEditor(page);
  await page.click('#level-tabs .sprite-toggle');

  // L'anteprima e' un data URI creato all'apertura del cassetto: si aspetta che
  // sia decodificata, altrimenti `naturalWidth` sarebbe zero solo per fretta.
  await page.waitForFunction(() => {
    const imgs = [
      ...document.querySelectorAll<HTMLImageElement>('#sprite-drawer .sezione.categoria button.sprite img'),
    ];
    return imgs.length > 0 && imgs.every((img) => img.complete);
  });

  const anteprime = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLImageElement>(
      '#sprite-drawer .sezione.categoria button.sprite img',
    )].map((img) => ({ dati: img.src.startsWith('data:image/'), largo: img.naturalWidth })),
  );

  expect(anteprime.length).toBeGreaterThan(0);
  for (const a of anteprime) {
    expect(a.dati).toBe(true);
    // naturalWidth a 0 significa immagine rotta: e' successo davvero, riusando
    // il blob URL che Phaser revoca appena la texture e' pronta.
    expect(a.largo).toBeGreaterThan(0);
  }
});
