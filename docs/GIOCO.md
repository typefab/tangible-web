# Il gioco — come il mondo si disegna e si comporta

Le regole che valgono a schermo: che forma ha una cella, quanto e' grande, e chi
sta davanti a chi.

**L'editor le eredita.** Non ha un renderer proprio — disegna attraverso
`GameScene` — quindi cambiare qualcosa qui cambia anche quello che si vede
costruendo. E' voluto: e' il motivo per cui costruire e giocare mostrano la
stessa cosa per costruzione, non per diligenza.

Qui va cio' che riguarda `src/grid/`, `src/config.ts`, `src/mechanics/`,
`src/scenes/`, `src/ui/`. Gli strumenti dell'editor stanno in
[EDITOR.md](EDITOR.md), il catalogo e il formato dei livelli in
[CONDIVISO.md](CONDIVISO.md). Obiettivo, stato e rischi restano in
[../PIANO.md](../PIANO.md).

E' il file piu' corto dei tre, e non e' un caso: la complessita' di questo
progetto sta quasi tutta nell'editor.

## Cosa c'e' qui

- [Griglia isometrica](#griglia-isometrica)
- [Costanti](#costanti)
- [Layer](#layer)

---
## Griglia isometrica

La griglia e' **isometrica a rombi, rapporto 2:1 (64x32)**. Il progetto
GDevelop usava una griglia ortogonale 32x32; e' stata cambiata su richiesta.

Non si usa l'isometria geometricamente esatta (30 gradi, 1.732:1) perche' su
pixel art produce bordi frastagliati: con il 2:1 le diagonali cadono su pixel
interi.

La geometria e' isolata in `src/grid/projection.ts` dietro un'unica interfaccia
(`cellToWorld`, `worldToCell`, `depthFor`, `cellOutline`). Nessun altro file sa
che forma abbia una cella: cambiare proiezione significa cambiare una riga.
L'implementazione ortogonale resta disponibile come alternativa.

Conseguenze: la griglia disegna il perimetro di ogni cella invece di linee da
bordo a bordo; l'evidenziazione della cella e' un poligono; la profondita' e'
`col + row`.

## Costanti

Le costanti di gioco stanno in `src/config.ts`, portate 1:1 dalla tabella di
`gdevelop_repository/CLAUDE.md`: break 1,5s, cooldown 100ms, portata 224px,
oscillazione `sin(t*18)*10` gradi, 8 slot di inventario.

## Layer

Piani sovrapposti, selezionabili e accendibili uno alla volta, come in GDevelop.
In piu' ogni layer ha una **quota**: quanti passi sta sopra il terreno.

| Quota | Comportamento | A cosa serve |
|---|---|---|
| 0 | stesso posto, cambia solo l'ordine di disegno | e' il layer di GDevelop: decori sopra il terreno |
| 1, 2, … | il piano si alza di un rombo (32px) | costruire in verticale sulla griglia isometrica |

Un solo numero copre i due casi, quindi non ci sono due concetti da spiegare.

Due decisioni che tengono in piedi il resto:

- **I blocchi sono indicizzati per id di layer, non per posizione nell'elenco.**
  Con l'indice, riordinare o cancellare un layer avrebbe rimescolato i blocchi
  di tutti gli altri.
- **La quota non entra nella profondita' di disegno**, che resta `col + row` piu'
  uno scarto minimo per layer. A dire chi sta davanti e' la distanza da chi
  guarda, non l'altezza: un blocco alzato non deve scavalcare quello della cella
  davanti solo perche' sta piu' in su.

In gioco non esiste un layer attivo: il tocco prende il blocco **piu' in alto**
sulla cella, e il piazzamento va sul primo piano libero della pila.
