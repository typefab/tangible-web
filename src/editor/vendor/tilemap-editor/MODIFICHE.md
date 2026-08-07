# Cosa dobbiamo cambiare

Piano di lavoro sul codice copiato. Ogni modifica al file originale va marcata
nel codice con un commento `// TANGIBLE:` cosi' resta distinguibile da cio' che
e' dell'upstream.

Stato: **niente e' ancora stato modificato.** La copia e' identica a `758cdbb`.

---

## Una premessa onesta sulla portata

Questo editor e' **ortogonale**: disegna mappe a celle quadrate. Il nostro
gioco e' **isometrico a rombi 2:1**. Non e' una differenza di aspetto, e' una
differenza di geometria, e non si risolve con un'opzione di configurazione.

La conversione tocca il cuore del disegno in 35 punti (vedi `ARCHITETTURA.md`).
Non e' "un paio di cosette": e' la modifica principale, e le altre due sono
piccole al confronto. Meglio saperlo prima di cominciare che scoprirlo a
meta'.

La buona notizia e' che il lavoro e' **meccanico e ripetitivo**, non
concettuale: la formula da sostituire e' sempre la stessa. E l'inversa —
di solito la parte insidiosa — sta in un punto solo.

---

## M1 — Griglia isometrica

La modifica grossa. Va fatta in quest'ordine: saltare un passo rende il
risultato incomprensibile a schermo e difficile da diagnosticare.

### M1.1 Centralizzare la proiezione

Prima di cambiare geometria, dare alla geometria **un posto solo dove vivere**.
Introdurre in cima al file:

```js
// TANGIBLE: la geometria della griglia, unico punto in cui e' definita.
const PROJECTION = {
  mode: 'iso',        // 'ortho' | 'iso'
  tileWidth: 64,
  tileHeight: 32,
  originX: 480,       // deve combaciare con ISO.originX in src/config.ts
  originY: 48,
};

const cellToPixel = (col, row) => { /* ... */ };
const pixelToCell = (px, py) => { /* ... */ };
```

Poi sostituire le 35 occorrenze di `positionX * SIZE_OF_CROP * ZOOM` con
chiamate a `cellToPixel`, **lasciando `mode: 'ortho'`**. A questo punto il
comportamento deve essere identico a prima: e' un refactor a somma zero, ed e'
proprio questo che lo rende verificabile. Se qualcosa si muove, l'errore e'
nella sostituzione, non nell'isometria.

Verifica: aprire l'editor, piazzare qualche tile, controllare che sia tutto
come prima.

### M1.2 Accendere l'isometria

Solo ora passare a `mode: 'iso'`. Le formule devono corrispondere **esattamente**
a quelle di `src/grid/projection.ts`, altrimenti editor e gioco disegnano la
stessa mappa in due posti diversi:

```js
// diretta
x = originX + (col - row) * (tileWidth / 2)
y = originY + (col + row) * (tileHeight / 2)

// inversa (in getSelectedTile)
dx = (px - originX) / tileWidth
dy = (py - originY) / tileHeight
col = Math.floor(dy + dx)
row = Math.floor(dy - dx)
```

Attenzione all'inversa: si normalizza sul **vertice superiore** della cella e si
divide per il lato **intero** del tile, non per la meta'. Il perche' e'
spiegato nel commento di `worldToCell` in `projection.ts` — usando il centro
come riferimento i punti intorno cadono nella cella sbagliata, ed e' un errore
che non si vede provando i centri.

### M1.3 Ordinare il disegno per profondita'

**Questo passo si dimentica facilmente e il sintomo e' sconcertante.**

In ortogonale i tile non si sovrappongono, quindi l'ordine di disegno e'
irrilevante e il codice cicla `Object.keys(layer.tiles)` nell'ordine di
inserimento. In isometrica i rombi **si sovrappongono**: un tile disegnato dopo
copre quello davanti. Senza ordinamento, la scena appare corretta finche' non
si piazza un tile "dietro" a uno gia' esistente, e da quel momento il disegno
e' incoerente in modo che sembra casuale.

Va ordinato per `col + row` crescente (dal fondo verso chi guarda) prima di
disegnare — la stessa `depthFor` che usa il gioco.

### M1.4 Griglia a rombi

`drawGrid()` disegna rettangoli. Va fatta disegnare rombi. Si puo' riusare
l'approccio di `drawGrid` in `GameScene.ts`: tracciare il **perimetro di ogni
cella** invece di linee da bordo a bordo. Funziona con qualsiasi proiezione
senza sapere che forma abbia la cella.

### M1.5 Origine e dimensione del canvas

Le celle con `row > col` hanno x negativa e finirebbero fuori dal canvas,
tagliate. E' esattamente il motivo per cui `ISO.originX` vale 480 in
`config.ts`. Il canvas va allargato e l'origine spostata a destra di conseguenza.

---

## M2 — Ponte verso `level.json`

Nessuna modifica al core: si passa dall'API (vedi `ARCHITETTURA.md`).

### Export

Registrare un exporter in `tileMapExporters`:

```js
{
  name: "Salva level.json",
  transformer: (data) => ({
    blocks: Object.entries(data.maps[data.activeMap].layers[0].tiles)
      .map(([key, tile]) => {
        const [col, row] = key.split('-').map(Number);
        return { col, row, type: tileToBlockType(tile) };
      })
      .sort((a, b) => a.row - b.row || a.col - b.col),
  })
}
```

L'ordinamento non e' estetico: tiene stabile il diff su git, come gia' fa
`GridPlacement.list()`.

`tileToBlockType` mappa `{x, y, tilesetIdx}` verso `block_0` / `block_1`. La
corrispondenza va decisa una volta e tenuta in un punto solo — sara' il primo
posto a rompersi quando aggiungeremo un tipo di blocco.

### Import

Il percorso inverso, per riaprire un `level.json` esistente e continuare a
costruirci: da `{col, row, type}` alla struttura `maps` descritta in
`ARCHITETTURA.md`.

### Layer

Il nostro `level.json` e' piatto, l'editor ha tre layer. Per ora si usa **solo
il primo** (`layers[0]`). Se un giorno servissero blocchi impilati, i layer ci
sono gia': e' una porta lasciata aperta, non un problema da risolvere adesso.

---

## M3 — Montaggio nella nostra pagina

- Caricare `styles.css` e `tilemap-editor.js`, chiamare `TilemapEditor.init()`
  sul `div` contenitore.
- Tenere l'attivazione con `?editor=1`, che gia' funziona ed e' documentata nel
  README.
- Caricare come tileset gli sprite da `public/assets/`.
- **Decidere che fine fa `src/editor/LevelEditor.ts`.** Finche' M1 non e'
  completa, il nostro editor resta l'unico funzionante e non va cancellato.
  Toglierlo prima e' il modo migliore per restare senza editor per giorni.

---

## Ordine consigliato

1. **M3 parziale** — montarlo e vederlo comparire, ancora ortogonale e scollegato.
   Serve a validare che si integri, prima di investire su M1.
2. **M2** — il ponte con `level.json`, ancora in ortogonale. Il ciclo completo
   funziona, solo con la geometria sbagliata.
3. **M1** — l'isometria, nell'ordine dei sotto-passi qui sopra.
4. **M3 finale** — rimuovere il vecchio editor, aggiornare README e PIANO.

Il motivo di quest'ordine: le prime due danno un risultato visibile e
verificabile in poco tempo, e se l'integrazione si rivelasse impraticabile lo
scopriremmo **prima** di aver riscritto 35 punti del motore di disegno.
