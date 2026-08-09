# Decisione: riferimento, non base di partenza

**Questo codice non verra' modificato.** Serve da consultazione.

La prima idea era convertire questo editor a griglia isometrica e usarlo al
posto del nostro. Misurando il lavoro sul codice vero e' emerso che conveniva
il contrario, e la scelta e' stata invertita prima di scrivere una riga.

## Perche'

La cosa costosa da una parte e' la cosa gratuita dall'altra:

| | Convertire questo | Arricchire il nostro |
|---|---|---|
| Isometria | 35 punti nel motore di disegno, piu' ordinamento per profondita', griglia a rombi, origine del canvas | gia' fatta |
| Resa fedele al gioco | secondo renderer da tenere allineato a mano | e' il gioco stesso |
| `level.json` | ponte da scrivere nei due sensi | output nativo |
| Undo, riempimento, trascinamento, zoom | gia' presenti | ~250 righe |

Il punto che ha deciso non e' il conteggio delle righe: e' che questo editor
disegna su un canvas proprio, con una sua proiezione. Adottarlo significa
tenere **due implementazioni della stessa geometria** allineate a mano — la
prima stesura di questo documento conteneva gia' l'avvertenza *"deve combaciare
con `ISO.originX` in `src/config.ts`"*, che era il sintomo del problema.

Il nostro editor invece disegna attraverso `GameScene`: stessi sprite, stessa
`projection.ts`, stesso ordinamento in profondita'. Quello che si vede mentre
si costruisce e' quello che si vedra' giocando, per costruzione e non per
diligenza.

In piu' meta' della ricchezza di questo progetto — tile animati, flip, tileset
multipli, tre layer, import da Tiled — serve a mappe RPG ortogonali, non a due
tipi di blocco su una griglia isometrica.

## Cosa abbiamo preso davvero

Le idee, non il codice. Portate in `src/editor/LevelEditor.ts`:

| Da qui | Da noi |
|---|---|
| strumenti pennello / gomma / secchiello / sposta | stessi quattro, con le stesse scorciatoie |
| `fillEmptyOrSameTiles()` | riempimento per contiguita': su cella vuota riempie l'area vuota, su cella piena sostituisce l'area dello stesso tipo |
| undo stack a stati interi | `GridPlacement.clear()` + ricostruzione da snapshot |
| un solo passo di undo per tratto | la traccia si registra al rilascio, non a ogni cella |
| anteprime dei tile nella palette | `textures.getBase64()` dal texture manager di Phaser |

Nessuna riga e' stata copiata alla lettera, quindi non ci sono obblighi di
attribuzione oltre a quelli gia' assolti in `UPSTREAM.md`. Se un giorno
prendessimo una funzione intera, la licenza MIT lo consente citando l'autore.

## Cosa resta da consultare

`ARCHITETTURA.md` mappa il codice. I punti utili se serviranno altre
funzionalita':

- **selezione multipla di tile** dal tileset (`getSelectedTile`, riga 564) —
  utile se un giorno vorremo pennelli piu' larghi di una cella
- **tile animati** (`animatedTiles`) — se i blocchi dovranno avere frame
- ~~**layer**~~ — fatti, e senza guardare qui: i tre layer fissi di questo
  editor sono piani di disegno, mentre i nostri hanno una quota e servono a
  impilare blocchi su griglia isometrica. Il problema non era lo stesso
- **import da Tiled** (`importer-tiled.js`) — se adotteremo quel formato

## Quando cancellarlo

Sono 92 KB di codice altrui che non gira. Se passeranno alcune iterazioni senza
che nessuno apra questi file, vanno tolti: un sorgente inutilizzato dentro
`src/` fa credere a chi legge che serva a qualcosa.
