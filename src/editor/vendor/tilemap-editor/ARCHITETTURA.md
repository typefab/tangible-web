# Come e' fatto dentro

Mappa del codice di `tilemap-editor.js` (2014 righe, JS vanilla, zero
dipendenze). Serve a orientarsi prima di toccare qualcosa.

I numeri di riga si riferiscono al commit `758cdbb` **non modificato**. Appena
inizieremo a editare slitteranno: usa i nomi delle funzioni come ancora, non i
numeri.

## Il modello dei dati

Tutto ruota attorno a `maps`, dichiarato a riga 349:

```js
maps = {
  "nomeMappa": {
    gridColor: "...",
    layers: [
      {
        name: "bottom",
        opacity: 1,
        visible: true,
        tiles: {
          "3-7": { x: 2, y: 0, tilesetIdx: 0, isFlippedX: false },
          //  ^      ^^^^^^^^^^^^  ^^^^^^^^^^^
          //  |      quale tile nel tileset (in celle)
          //  colonna-riga sulla mappa
        },
        animatedTiles: { ... }
      }
    ]
  }
}
```

Le due cose da capire:

- **La chiave `"col-row"` e' la posizione sulla mappa.** Stringa, non oggetto.
  Si costruisce con `` `${x}-${y}` `` e si rilegge con `key.split('-')`.
- **Il valore `{x, y, tilesetIdx}` e' *quale* tile disegnare**, espresso in
  coordinate di cella dentro l'immagine del tileset.

Questa separazione e' comoda per noi: la chiave e' gia' esattamente il nostro
`{col, row}`, e il valore identifica il tipo di blocco. Il ponte verso
`level.json` e' quindi una trasformazione diretta, non una riscrittura.

## L'API pubblica

Il file e' un modulo UMD (righe 1-12): si appende a `window.TilemapEditor`.
L'ingresso e' `exports.init` (riga 1405):

```js
TilemapEditor.init(attachToId, {
  tileMapData,      // i dati iniziali (la struttura `maps` qui sopra)
  tileSize,
  mapWidth, mapHeight,
  tileSetImages,    // le immagini dei tileset
  applyButtonText,
  onApply,          // <- callback: qui intercettiamo il salvataggio
  tileSetLoaders,   // sorgenti da cui caricare tileset
  tileMapExporters, // <- qui aggiungiamo l'export verso level.json
  tileMapImporters,
  onUpdate,         // chiamato a ogni modifica
  onMouseUp,
  appState
})
```

`onApply` e `tileMapExporters` sono i due punti di innesto per collegarlo al
nostro formato **senza toccare il core**. `tileMapExporters` accetta oggetti
`{name, transformer}` (vedi righe 1435-1450 per come vengono registrati quelli
predefiniti).

## Il disegno

`draw()` (intorno a riga 590) ridisegna tutto il canvas a ogni modifica: niente
dirty-rect, niente diffing. Per una mappa di poche centinaia di tile va bene.

Sequenza:

1. `drawGrid(...)` — le linee della griglia
2. per ogni layer visibile, per ogni tile in `layer.tiles`:
   `ctx.drawImage(tileset, sorgente..., destinazione...)`
3. i tile animati, con lo stesso schema ma con offset di frame

## Il punto che ci interessa: la proiezione

Qui sta il lavoro vero, ed e' bene saperlo prima di cominciare.

**Cella → pixel (diretta).** Non esiste una funzione. La formula e' scritta a
mano, **35 volte**, sempre nella forma:

```js
positionX * SIZE_OF_CROP * ZOOM
positionY * SIZE_OF_CROP * ZOOM
```

Trovale tutte con:

```bash
grep -n "SIZE_OF_CROP \* ZOOM" tilemap-editor.js
```

**Pixel → cella (inversa).** Questa invece e' in **un solo posto**:
`getSelectedTile()`, riga 564:

```js
const { x, y } = event.target.getBoundingClientRect();
const tileSize = tileSets[tilesetDataSel.value].tileSize * ZOOM;
const tx = Math.floor(Math.max(event.clientX - x, 0) / tileSize);
const ty = Math.floor(Math.max(event.clientY - y, 0) / tileSize);
```

L'asimmetria e' la notizia importante: **l'inversa si cambia in un punto, la
diretta in trentacinque.** E' l'opposto di come e' organizzato il nostro
`src/grid/projection.ts`, dove la geometria sta dietro un'interfaccia e si
cambia in una riga.

## Gli strumenti

`TOOLS` con `ACTIVE_TOOL`; lo smistamento e' in `toggleTile()` (riga 865):

| Strumento | Cosa fa |
|---|---|
| `BRUSH` | piazza il tile selezionato (`addTile`) |
| `ERASE` | cancella (`removeTile`) — anche con Shift+click |
| `FILL` | riempie celle vuote o uguali (`fillEmptyOrSameTiles`, riga 797) |
| `RAND` | piazza un tile a caso dalla selezione |
| `PICK` | preleva il tile sotto il cursore — anche con Ctrl o tasto destro |
| `PAN` | sposta la vista |

`addToUndoStack()` viene chiamata alla fine di ogni operazione: **undo/redo
esiste gia'** ed e' uno dei motivi per cui adottiamo questo editor invece di
riscrivere il nostro.

## Cosa c'e' gia' e non dobbiamo rifare

- Undo/redo
- Layer multipli con opacita' e visibilita'
- Secchiello, gomma, contagocce, pennello, pan
- Zoom
- Selezione multipla di tile dal tileset
- Tile animati, flip orizzontale
- Interfaccia responsive che scende in verticale su telefono
- Import da Tiled (`importer-tiled.js`)

E' esattamente la lista di ci&ograve; che mancava al nostro editor fatto in casa.
