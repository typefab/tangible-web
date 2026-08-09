import { readdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { openEditor } from './helpers';

/**
 * La promessa del catalogo: **la cartella e' l'elenco.**
 *
 * Il test legge davvero `src/assets/blocks/` dal disco e la confronta con la
 * palette. Se qualcuno un giorno rimettesse un elenco scritto a mano, questo
 * test lo scoprirebbe al primo PNG caricato senza toccarlo.
 */
test('la palette contiene esattamente i PNG di src/assets/blocks/', async ({ page }) => {
  const suDisco = readdirSync('src/assets/blocks')
    .filter((f) => f.endsWith('.png'))
    .map((f) => f.replace(/\.png$/, ''))
    .sort();

  expect(suDisco.length).toBeGreaterThan(0);

  await openEditor(page);
  const nellaPalette = await page.evaluate(() =>
    [...document.querySelectorAll('#editor-toolbar button.palette')].map((b) =>
      b.getAttribute('title'),
    ),
  );

  // L'etichetta e' l'id reso leggibile: `red_brick` -> `Red Brick`.
  const atteso = suDisco.map((id) =>
    id.replace(/[_-]+/g, ' ').replace(/\b\p{Ll}/gu, (c) => c.toUpperCase()),
  );
  expect(nellaPalette).toEqual(atteso);
});

test('ogni blocco della palette ha un\'anteprima vera, presa dal gioco', async ({ page }) => {
  await openEditor(page);

  const anteprime = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLImageElement>('#editor-toolbar button.palette img')].map(
      (img) => ({ dati: img.src.startsWith('data:image/'), largo: img.naturalWidth }),
    ),
  );

  expect(anteprime.length).toBeGreaterThan(0);
  for (const a of anteprime) {
    expect(a.dati).toBe(true);
    // naturalWidth a 0 significa immagine rotta: e' successo davvero, riusando
    // il blob URL che Phaser revoca appena la texture e' pronta.
    expect(a.largo).toBeGreaterThan(0);
  }
});
