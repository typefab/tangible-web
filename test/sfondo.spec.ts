import { expect, test, type Page } from '@playwright/test';
import { openEditor } from './helpers';

/**
 * Il contagocce dello sfondo.
 *
 * L'automatico prende i quattro angoli come riferimento. Quando la figura ne
 * occupa uno, il riferimento diventa la figura stessa e il ritaglio mangia
 * proprio cio' che si voleva tenere: e' il caso che questo strumento esiste per
 * rimediare, ed e' quello che questi due test mettono uno accanto all'altro.
 *
 * L'immagine di prova: sfondo bianco, quadrato rosso **appoggiato all'angolo in
 * alto a sinistra**, cosi' quell'angolo e' figura e non sfondo.
 */
async function apriConProva(page: Page): Promise<void> {
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 32;
    c.height = 32;
    const x = c.getContext('2d')!;
    x.fillStyle = '#ffffff';
    x.fillRect(0, 0, 32, 32);
    x.fillStyle = '#d21f2f';
    x.fillRect(0, 0, 16, 16);
    return c.toDataURL('image/png');
  });
  const buffer = Buffer.from(dataUrl.split(',')[1]!, 'base64');

  await page.click('#level-tabs .sprite-toggle');
  await page.click('#sprite-drawer .aggiungi');
  await page
    .locator('#sprite-importer input.file')
    .setInputFiles({ name: 'angolo.png', mimeType: 'image/png', buffer });
  await expect(page.locator('#sprite-importer .primary')).toBeEnabled();
}

/** Importa con quel nome e legge un pixel della texture che ne esce. */
async function pixel(page: Page, id: string, x: number, y: number) {
  return page.evaluate(
    ([nome, px, py]) => {
      const tex = window.game.scene.keys.GameScene.textures.get(nome as string);
      const src = tex.getSourceImage() as HTMLCanvasElement;
      const d = src.getContext('2d')!.getImageData(px as number, py as number, 1, 1).data;
      return { r: d[0], g: d[1], b: d[2], a: d[3] };
    },
    [id, x, y] as const,
  );
}

test('con un angolo occupato dalla figura, l\'automatico la mangia', async ({ page }) => {
  await openEditor(page);
  await apriConProva(page);

  await page.fill('#sprite-importer input[placeholder="muro_di_pietra"]', 'senza contagocce');
  await page.click('#sprite-importer .primary');
  await expect
    .poll(() =>
      page.evaluate(() => window.game.scene.keys.GameScene.textures.exists('senza_contagocce')),
    )
    .toBe(true);

  // Il rosso stava anche nell'angolo, quindi e' finito fra i riferimenti: sparisce.
  expect((await pixel(page, 'senza_contagocce', 32, 32)).a).toBe(0);
});

test('indicando lo sfondo col contagocce, la figura resta', async ({ page }) => {
  await openEditor(page);
  await apriConProva(page);

  await page.click('#sprite-importer .contagocce');
  await expect(page.locator('#sprite-importer .contagocce')).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  // Un tocco in basso a destra dell'anteprima, dove c'e' il bianco. L'anteprima
  // e' 192x192 e lo sprite da 128 ci sta dentro centrato: (132,132) cade nel
  // bianco, lontano dal quadrato rosso in alto a sinistra.
  await page.locator('#sprite-importer .preview').click({ position: { x: 132, y: 132 } });

  // Preso il colore, il contagocce si disarma da solo e il campione lo mostra.
  await expect(page.locator('#sprite-importer .contagocce')).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await expect(page.locator('#sprite-importer .campione')).not.toHaveClass(/vuoto/);

  await page.fill('#sprite-importer input[placeholder="muro_di_pietra"]', 'con contagocce');
  await page.click('#sprite-importer .primary');
  await expect
    .poll(() =>
      page.evaluate(() => window.game.scene.keys.GameScene.textures.exists('con_contagocce')),
    )
    .toBe(true);

  // Ora il riferimento e' il bianco soltanto: il rosso sopravvive...
  const figura = await pixel(page, 'con_contagocce', 32, 32);
  expect(figura.a).toBeGreaterThan(0);
  expect(figura.r).toBeGreaterThan(150);
  expect(figura.g).toBeLessThan(100);

  // ...e il bianco attorno se n'e' andato. Non si guarda piu' un punto lontano
  // sperando che sia rimasto vuoto: da quando la pipeline ritaglia ai bordi del
  // contenuto, li' non c'e' piu' niente perche' il PNG **e'** il quadrato
  // rosso. A dirlo e' che di bianco opaco non ne resta nemmeno un pixel.
  const bianchi = await page.evaluate(() => {
    const src = window.game.scene.keys.GameScene.textures
      .get('con_contagocce')
      .getSourceImage() as HTMLCanvasElement;
    const d = src.getContext('2d')!.getImageData(0, 0, src.width, src.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3]! > 8 && d[i]! > 200 && d[i + 1]! > 200 && d[i + 2]! > 200) n++;
    }
    return n;
  });
  expect(bianchi).toBe(0);
});
