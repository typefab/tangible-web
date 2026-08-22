# L'editor — costruire con un dito

Tutto cio' che vive in `src/editor/`: gli strumenti, i gesti, i pannelli, il
salvataggio locale, e l'editor d'immagine che fa gli sprite dentro al browser.

E' la meta' piu' grande del progetto perche' e' quella che si usa con le mani.
Molte di queste sezioni sono nate **dopo** aver provato l'editor con un dito
vero, e lo dicono: quando una scelta e' figlia di una prova, la prova e'
raccontata.

Come si disegna il mondo sta in [GIOCO.md](GIOCO.md), il catalogo e il formato
dei file in [CONDIVISO.md](CONDIVISO.md). Obiettivo, stato e rischi restano in
[../PIANO.md](../PIANO.md).

## Cosa c'e' qui

- [Salvataggio: ricordare senza decidere](#salvataggio-ricordare-senza-decidere)
- [Navigazione: due dita, non uno](#navigazione-due-dita-non-uno)
- [La selezione e' un'area, non un insieme di blocchi](#la-selezione-e-un-area-non-un-insieme-di-blocchi)
- [Il contagocce, e il tratto che era gia' partito](#il-contagocce-e-il-tratto-che-era-gia-partito)
- [Quanto schermo resta per costruire](#quanto-schermo-resta-per-costruire)
- [Il cassetto: la striscia non e' il catalogo](#il-cassetto-la-striscia-non-e-il-catalogo)
- [Sprite fatti nel browser, e l'ibrido che ne consegue](#sprite-fatti-nel-browser-e-l-ibrido-che-ne-consegue)
- [La matita, rifatta dopo averla usata](#la-matita-rifatta-dopo-averla-usata)
- [Il PNG e' la figura, non il fotogramma](#il-png-e-la-figura-non-il-fotogramma)
- [Centrare con le dita, non con uno slider](#centrare-con-le-dita-non-con-uno-slider)
- [Indietro non vuol dire uscire](#indietro-non-vuol-dire-uscire)
- [Riprendere non deve costare del lavoro](#riprendere-non-deve-costare-del-lavoro)
- [Cento livelli: catalogo e schede sono due cose diverse](#cento-livelli-catalogo-e-schede-sono-due-cose-diverse)
- [Uno snapshot che non cresce col progetto](#uno-snapshot-che-non-cresce-col-progetto)
- [Salva non deve mentire](#salva-non-deve-mentire)
- [Nascondere un layer e' una decisione che tiene](#nascondere-un-layer-e-una-decisione-che-tiene)

---
## Salvataggio: ricordare senza decidere

Fra il costruire e il vedere il lavoro nel gioco c'e' un passaggio manuale
(scarica, carica su GitHub), e in mezzo ci sta una scheda chiusa per sbaglio.
Quindi l'editor **ricorda** in `localStorage`, ma **non ripristina mai in
silenzio**.

| Stato | Significato |
|---|---|
| `dirty: true` | autosave, modifiche mai confermate |
| `dirty: false` | ha premuto Salva: lo stato buono l'ha deciso lui |

All'apertura, se quello che c'e' in memoria differisce da `level.json`, si apre
una domanda con due strade: *riprendi* o *ricomincia dal file pubblicato*.
Ripristinare da soli sarebbe sbagliato in entrambi i versi — chi ha appena
caricato un `level.json` nuovo non capirebbe perche' vede il vecchio, e chi ha
chiuso per sbaglio si vedrebbe sovrascritto senza accorgersene.

Distinzione che la UI insiste a tenere separata: **Salva** scrive nel browser,
**Scarica** produce il file che porta il lavoro nel gioco. Confonderle e' il
modo piu' facile di perdere una serata di lavoro.

## Navigazione: due dita, non uno

Un dito e' gia' preso — disegna, cancella, seleziona — quindi il gesto libero e'
a due dita: trascinare sposta, allargare ingrandisce, e funziona in qualsiasi
strumento senza cambiare modalita'. Chi vuole il dito singolo ha ✋, a un tocco.

Due dettagli che sembrano piccoli e non lo sono:

- **il secondo dito annulla il tratto del primo.** Appoggiando la mano per fare
  pinch, il primo dito ha gia' toccato: senza questo si resterebbe con un blocco
  piazzato dove e' atterrato il pollice.
- **lo zoom e' ancorato al punto sotto le dita**, non al centro dello schermo,
  altrimenti ogni ingrandimento richiede un riposizionamento.

## La selezione e' un'area, non un insieme di blocchi

E' la decisione che tiene insieme mezzo editor, ed e' arrivata in due passi.

Prima la selezione raccoglieva i blocchi dentro il rettangolo, e c'era uno
strumento separato — il secchiello — per riempire. Poi il secchiello e' passato
da contiguita' a rettangolo, e a quel punto **faceva lo stesso gesto della
selezione**: due strumenti, un gesto solo, e la differenza da spiegare.

Ora la selezione raccoglie **celle**, vuote comprese, e sono pennello e gomma ad
agire sull'area:

| Con una selezione in mano | Fa |
|---|---|
| 🖌 Pennello | riempie tutte le celle dell'area col blocco scelto |
| 🧽 Gomma | svuota l'area |

Il secchiello e' sparito, e con lui un concetto. Il pennello e la gomma
**cambiano etichetta** quando c'e' una selezione — "Riempi area", "Svuota area" —
perche' un pulsante che fa due cose diverse a seconda dello stato deve dire
quale delle due sta per fare.

Conseguenze che non erano ovvie:

- **svuotare non annulla la selezione.** L'area resta in mano: dopo aver
  svuotato, quasi sempre si vuole riempire con qualcos'altro.
- si puo' riempire **terreno vuoto**, cosa che con una selezione di soli blocchi
  sarebbe stata impossibile — ed era il motivo per cui esisteva il secchiello.
- `count` conta celle e `blockCount` conta blocchi: nella barra si legge quanti
  blocchi ci sono nell'area, non quante celle.

Il test di appartenenza usa il **centro della cella** dentro il rettangolo di
schermo, alla quota del layer attivo. Per le stesse ragioni di prima: su griglia
isometrica si prende il rombo che si vede.

Lo spostamento toglie tutti i blocchi di partenza **prima** di ripiazzarli:
facendolo uno alla volta, spostare una fila di uno a destra cancellerebbe il
vicino appena scritto.

Gli **appunti** tengono i blocchi in coordinate relative al loro angolo, non
assolute: solo cosi' un incolla puo' atterrare su un'altra cella, un altro layer
o un'altra scheda mantenendo la forma. Vivono in memoria e non nel progetto
salvato — sopravvivono al cambio di scheda, che e' il caso che conta, ma non a
una ricarica. L'incolla atterra **sotto il puntatore** e non dove stava
l'originale: incollare sopra se stesso sembra non aver fatto niente.

## Il contagocce, e il tratto che era gia' partito

Riprendere un blocco gia' posato voleva dire ritrovarlo nella palette. Con due
sprite non e' un problema; e' il tipo di attrito che cresce da solo, e la
palette e' fatta apposta per crescere.

Il gesto e' **tenere premuto mezzo secondo** su un blocco, piu' `Alt+clic` da
computer. Non e' un nuovo strumento: uno strumento in piu' e' una modalita' in
piu' da spegnere, e questo e' un gesto che si fa **dentro** il pennello, mentre
si dipinge.

Il problema vero non e' riconoscere il tocco lungo: e' che a mezzo secondo **il
pennello ha gia' dipinto**. La cella sotto il dito contiene ormai il blocco che
si stava piazzando, non quello che si voleva prendere. Da qui due conseguenze:

- **il tipo si legge quando il dito scende**, non quando scatta il contagocce;
- **il tratto viene disfatto**, con lo stesso meccanismo che gia' annullava la
  pennellata quando arriva il secondo dito per un pinch. Era scritto dentro il
  gestore del pinch: ora e' `cancelStroke()`, e i due gesti condividono la
  risposta invece di averne due.

Dove il gesto **non** si attiva, ed e' la parte che si sarebbe sbagliata:

| Strumento | Perche' |
|---|---|
| 🖌 Pennello, 🧽 Gomma | si attiva: il dito fermo li' non significa niente |
| ✋ Sposta, ⬚ Seleziona | no: tenere fermo vuol gia' dire "sto per trascinare" |
| su cella vuota | non si arma nemmeno: non c'e' niente da prendere, e disfare il tratto cancellerebbe il blocco appena messo |

Con la gomma in mano il contagocce passa al pennello, per la stessa regola della
palette: indicare un blocco significa volerlo piazzare.

**Un difetto trovato dai test, che c'era gia'.** `restore()` marca sempre il
lavoro come "non salvato", perche' di solito lo chiama un undo. Ma le tracce
annullate riportano la scena **identica** a com'era: dopo un contagocce — e
anche dopo ogni pinch, da sempre — l'editor dichiarava modifiche che non
esistevano. Ora chi annulla una traccia rimette anche lo stato di prima. Nessuno
se n'era accorto perche' nell'uso normale si e' quasi sempre gia' "non salvato".

## Quanto schermo resta per costruire

Su un telefono da 390x780 la barra a quattro righe occupava **289px, il 37%**, e
le schede altre 47: restavano 444px di scena, meno di due terzi. Peggio, il
pannello dei layer galleggiava aperto sull'angolo in alto a destra — 228x168,
proprio dove l'origine isometrica mette i primi blocchi, che finivano sotto.

Il criterio per decidere cosa resta in vista e' **quante volte si tocca**:

| Sempre in vista | Dietro **⋯** |
|---|---|
| palette, strumenti, annulla/rifai, zoom, ⤢, conteggio | griglia, Salva, Apri, Copia, Scarica, Gioca |

Sono 171px invece di 289: **562px di scena invece di 444**. Dove lo spazio c'e'
non cambia niente — il foglio resta una riga come le altre e ⋯ non compare
nemmeno — perche' li' un tocco in piu' per arrivare a Salva sarebbe solo un
peggioramento.

**La soglia sbagliata, corretta dopo la prima prova su un telefono vero.** La
regola guardava la larghezza: `max-width: 600px`. Un telefono **girato** la
mancava in pieno, perche' 780x390 e' "schermo largo" — restava la barra intera
su uno schermo alto 390, col pannello dei layer aperto sopra il poco che
avanzava. La barra consuma **altezza**, ed e' quella la misura giusta:

| | Barra + schede | Scena |
|---|---|---|
| 780x390, prima | 62% | 148px |
| 780x390, con la soglia sull'altezza | 56% | 172px |
| 780x390, **con le righe in fila** | **32%** | **264px** |

Il secondo passo e' la conseguenza del primo: girato, il telefono ha larghezza
in abbondanza e non ha altezza, quindi impilare le righe e' esattamente lo
spreco da evitare. In fila stanno in una riga sola, 79px invece di 195, e la
palette prende lo spazio che resta — se non ci sta va a capo da sola, tornando
al comportamento di prima invece di rompersi.

Tre dettagli che non erano ovvi:

- **il foglio si richiude da solo dopo un comando**, altrimenti resterebbe
  aperto sopra la scena. Fanno eccezione la griglia e Copia: la prima si
  commuta guardando il risultato, la seconda scrive proprio li' se ha
  funzionato.
- **il pallino giallo su ⋯**. Lo stato "non salvato" sta dentro il foglio: a
  foglio chiuso, senza il pallino, non lo direbbe piu' nessuno — ed e' il
  rischio piu' vecchio del progetto.
- **su telefono il pannello dei layer parte chiuso.** Si apre quando serve,
  invece di coprire l'angolo in cui si sta costruendo.

## Il cassetto: la striscia non e' il catalogo

La palette elencava **tutti** i blocchi in una striscia in fondo alla barra. Con
due sprite di prova funziona; con un catalogo vero e' la stessa storia delle
schede — una striscia che scorre all'infinito non e' navigabile, e non c'e'
posto per dire che un blocco appartiene a una famiglia.

La divisione e' fra due domande diverse:

- **"cosa esiste"** — il cassetto 🎨, aperto da sinistra: il catalogo intero,
  diviso per categoria, piu' una sezione **usati nel livello**;
- **"cosa sto usando adesso"** — la striscia in basso, che ora tiene solo gli
  sprite **usati di recente**, il piu' recente per primo.

I recenti si riempiono dal **piazzamento vero** (pennello, riempi area,
contagocce), non dalla semplice selezione: aver guardato uno sprite non e'
averlo usato. All'apertura di un livello si seminano da cio' che c'e' gia'
dentro, altrimenti riaprendo un lavoro la striscia sarebbe vuota proprio dove
serve.

Il cassetto sta in `editor/SpriteDrawer.ts` e non dentro `LevelEditor`: non sa
niente di layer, undo o proiezione, e tenerlo separato tiene onesta quella
ignoranza. Come tutto il resto dell'editor **non ha un renderer proprio** — le
anteprime sono il base64 del texture manager di Phaser, lo stesso della palette,
quindi non puo' mostrare un blocco diverso da quello che il gioco disegna.

Anche il pulsante dei livelli si e' spostato: 🎨 a sinistra, 📚 a destra. Sono le
due domande piu' grosse dell'editor — cosa piazzo, e dove — e stanno agli
estremi invece di contendersi lo stesso angolo.

## Sprite fatti nel browser, e l'ibrido che ne consegue

Serviva partire da un'immagine qualunque e arrivare a uno sprite. Il vincolo
"zero installazioni" esclude un editor d'immagine desktop, e "solo HTTPS
gratuiti" esclude i servizi: quindi la pipeline gira in `<canvas>`, dentro la
pagina. `editor/SpriteImporter.ts`: si carica dal file-picker — che su telefono
e' galleria, fotocamera o file — si toglie lo sfondo, si riduce a pixel-art.

Lo sfondo si toglie con un **flood-fill dai bordi**, non con una sostituzione
globale del colore: un colore uguale allo sfondo ma *dentro* la figura non deve
sparire, perche' non e' connesso al bordo. Il riferimento sono i quattro angoli,
e la tolleranza dice quanto ci si puo' allontanare. Niente modelli da scaricare:
sarebbero megabyte e una dipendenza esterna, per un problema che su sfondi
piatti si risolve cosi'.

L'automatico pero' sbaglia in un modo preciso: se la figura occupa un angolo,
quel colore entra fra i riferimenti e il ritaglio mangia proprio cio' che si
voleva tenere. Da qui il **contagocce**: si tocca l'anteprima nel punto in cui
c'e' lo sfondo, e quel colore diventa l'unico riferimento. Il punto indicato fa
anche da seme, oltre ai bordi, quindi cade pure una zona di sfondo chiusa dentro
la figura — il buco nel manico della tazza — che partendo dai soli bordi non si
raggiunge.

Due dettagli che decidono se funziona. Il colore si campiona sulla **sorgente**,
non sullo sprite gia' ridotto: dopo un ritaglio sbagliato quel punto e' spesso
gia' trasparente, e si prenderebbe il nulla. E il punto si tiene in coordinate
della sorgente, cosi' cambiare il lato in pixel non lo sposta. Finche' il
contagocce e' armato l'anteprima mostra i colori veri, senza ritaglio: su uno
sfondo tolto male non ci sarebbe piu' niente da indicare.

Restano i bordi complessi, che nessun riferimento di colore puo' indovinare.

## La matita, rifatta dopo averla usata

La prima versione e' stata provata a mano e ne sono usciti sei difetti in fila.
Tre avevano la stessa radice, ed e' il motivo per cui la cura non e' stata una
toppa per sintomo ma un cambio di impianto.

| Difetto | Radice |
|---|---|
| + e − ingrandivano anche la finestra | lo zoom scriveva `style.width/height`: la tela **era** l'elemento di layout, e il riquadro cresceva con lei |
| Sposta non faceva niente | il visore scorreva, ma un contenuto centrato con `place-content: center` che deborda non e' raggiungibile con lo scorrimento |
| lo sprite usciva dal bordo dell'anteprima, e "ingrandiva" alzando il lato | `Math.floor(scala) \|\| 1`: sopra i 192px del riquadro la scala intera e' 0, si ripiegava su 1x e l'immagine veniva disegnata a grandezza piena |
| la gomma lasciava una fila di buchi | si dipingeva solo dove capitava un evento del puntatore: fra due eventi il dito ha gia' percorso della strada |
| niente pizzico a due dita | la matita non li ascoltava |
| il ritaglio spariva cambiando dimensione | `recompute` ricostruisce dalla sorgente, e i tratti a mano non erano nella pipeline |

Le due decisioni che chiudono tutto:

**Il visore e' a trasformazione, non a scorrimento.** La tela resta grande quanto
l'immagine e vive dentro un riquadro di altezza fissa; zoom e spostamento stanno
in un `transform` CSS. Non toccando il layout, ingrandire non puo' piu' far
crescere la finestra, e spostare funziona anche quando l'immagine e' piu' piccola
del visore — cosa che con lo scorrimento non poteva funzionare per definizione.
Da qui vengono gratis il pizzico a due dita e la rotella, con lo zoom **ancorato**
al punto che si sta guardando invece che al centro.

**La matita non produce un'immagine: produce una maschera.** Un `Uint8Array`
grande quanto la sorgente, dove 1 vuol dire "tolto", che l'importer applica
**dopo** lo sfondo e **prima** della riduzione. Cambiare tolleranza o lato in
pixel rifa' tutto il resto ma non tocca la maschera, quindi il ritaglio resta.
E il ripristino torna alla base — cioe' a cio' che dice l'automatico in quel
momento — invece che a un'immagine congelata.

Il prezzo, dichiarato: si ritaglia alla risoluzione della **sorgente** e non a
quella finale. Si perde la rifinitura al singolo pixel dello sprite ridotto; si
guadagna un ritaglio che sopravvive a tutto il resto, ed era quello che serviva.

Il **lazo** e' arrivato con la stessa passata: si traccia un contorno e resta
solo cio' che ci sta dentro. E' la richiesta "ritagliare con delle linee", ed e'
anche la risposta piu' rapida a una sagoma complicata — dove la gomma sarebbe
lavoro di minuti. Per
quelli c'e' `editor/MaskEditor.ts`, la matita: gomma, ripristino, pennello,
zoom, annulla per tratto. Lavora sui **pixel finali** e non sull'immagine ad alta
risoluzione: un ritaglio fatto prima della riduzione verrebbe ricampionato, e il
bordo che si e' disegnato non sarebbe quello che finisce nel gioco. Il prezzo e'
che cambiare dimensione o tolleranza rifa' la griglia e con lei i ritocchi —
detto da una nota, invece di buttarli via in silenzio.

**La persistenza e' un ibrido, ed e' la parte che va spiegata.** Un editor che
gira su Pages non puo' scrivere nel repository: il sito e' statico, e "GitHub e'
il ponte" e' un vincolo, non un dettaglio. Quindi:

| | Dove vive | Fin quando |
|---|---|---|
| **Aggiungi al livello** | texture di sessione + voce di catalogo runtime | solo in quel browser; sopravvive alla ricarica, entro il tetto di spazio |
| **Scarica PNG** | il file da committare in `src/assets/blocks/<categoria>/` | per sempre, e per tutti |

I blocchi runtime stanno in un elenco separato dai `BLOCKS` di build apposta:
mescolarli avrebbe fatto sembrare permanente una cosa che non lo e'. Da quando
viaggiano con l'autosave — vedi "Riprendere non deve costare del lavoro" — la
distinzione conta ancora di piu': sopravvivono a una ricarica, quindi sembrano
definitivi, ma esistono solo in quel browser. Il pannello
scrive il percorso esatto in cui committare, perche' la differenza fra le due
meta' non si vede guardando lo schermo — si vede solo dopo, quando qualcun altro
apre il livello e trova un buco.

Un id gia' presente nel repository non si puo' sovrascrivere in sessione: quello
del file tornerebbe alla ricarica e quello di sessione no, e la confusione
sarebbe garantita. Rifare un import con lo stesso nome di un altro import,
invece, si puo': li' sostituire e' esattamente cio' che si intende.

## Il PNG e' la figura, non il fotogramma

Provato su un telefono vero, ed e' il difetto che ha ripagato la prova. Ritagli
una parte di una foto, quella parte sta fuori dal centro, e sulla cella esce
**molle e spostata** — tanto piu' spostata quanto piu' la ingrandisci, fino a
uscire del tutto dalla sua cella.

Sembravano due difetti e la radice era una sola: `pixelate` riduceva **tutto il
fotogramma**, non la figura. Misurato sul caso di prova, una figura in un angolo
di una foto quadrata:

| | prima | dopo |
|---|---|---|
| PNG | 128x128 | 108x128 |
| figura dentro | 35x41, il **7%** | 108x128, il **76%** |
| centro figura / centro PNG | (35,33) / (64,64) | coincidono |

Da qui tutte e due le facce. Dei 128 pixel di nitidezza chiesti alla figura ne
arrivavano trentacinque, e il resto andava a descrivere del vuoto: ecco il
"fuori fuoco". E il gioco appoggia sulla cella il **centro del PNG**, non quello
della figura, quindi una figura ritagliata da un angolo si vedeva in un angolo;
ingrandendo, quello scarto veniva moltiplicato insieme al resto.

Il rimedio e' un passo in mezzo alla pipeline — `trimTransparent`, fra la
maschera e la riduzione — e vale la pena dire perche' sta **li'**: prima della
riduzione, cosi' i pixel chiesti vanno tutti alla figura; dopo la maschera, cosi'
segue anche il ritaglio fatto a mano invece del solo flood-fill. Il PNG diventa
la figura, e "centrato" smette di essere una fortuna dell'inquadratura.

Ha un prezzo dichiarato: **il vuoto attorno non e' piu' un modo di rimpicciolire
uno sprite**. Chi inquadrava largo per ottenere un oggetto piccolo nella cella
ora si trova la figura che riempie la cella, e per rimpicciolirla usa `Largo
(celle)` — che e' esplicito, mentre l'altro modo era un effetto collaterale
dell'inquadratura.

Tre test lo hanno seguito, e come sono cambiati e' la parte interessante:
guardavano tutti **un angolo del PNG**, aspettandosi vuoto. Con il ritaglio
quell'angolo e' figura, ed e' giusto che lo sia. Ognuno e' stato riscritto
attorno a cio' che intendeva davvero — nessun bianco opaco rimasto, nessuna
colonna vuota, il segno blu fuori dal lazo che non c'e' piu' — che sono
asserzioni piu' vicine all'intenzione di quanto fosse un pixel a coordinate
fisse.

## Centrare con le dita, non con uno slider

Il ritaglio al contenuto mette la figura al centro per costruzione, ma "al
centro" non e' sempre dove la si vuole: un oggetto appoggiato poggia piu' in
basso, uno appeso sta piu' in alto. C'era gia' un comando per questo — lo slider
"Appoggio sulla cella" — e la prova col dito ha detto che non bastava: si regola
un numero e si verifica in un'anteprima di 240x170, che su un telefono e' un
francobollo.

Quindi **🎯 Centra**: la stessa anteprima in grande, dove lo sprite si trascina
col dito, due dita lo allargano, quattro frecce lo rifiniscono e ⌖ lo rimette al
centro. Lo slider e' sparito, e con lui un concetto: non c'e' piu' un "appoggio"
da capire, c'e' dove lo metti.

Tre decisioni che tengono in piedi il resto:

- **la finestra non possiede taglia e nitidezza: se le fa prestare.** `Largo
  (celle)` e `Lato in pixel` sono gli **stessi due elementi** del pannello,
  spostati dentro la finestra all'apertura e restituiti alla chiusura.
  Ricostruirli avrebbe voluto dire due widget con due gestori da tenere
  d'accordo, e la prima cosa che diverge e' il passo. Stanno li' perche' sono le
  domande che ci si fa guardando **quella** immagine.
- **il disegno della cella e' uno solo**, in `CellPlacer.drawOnCell`, e lo usano
  tutte e due le anteprime. Erano il candidato ideale per due implementazioni
  della stessa geometria da tenere allineate a mano — esattamente cio' che
  l'editor evita disegnando attraverso la scena.
- **lo scarto non e' un metadato**: all'esportazione diventa spazio trasparente
  su un lato del PNG, come faceva l'appoggio. E' la stessa regola di sempre —
  cio' che si vede sta nel file, non in un numero che qualcuno deve tenere
  allineato.

**Spostare di lato costa, e il conto lo fa l'editor.** Il gioco centra il PNG
sulla cella, quindi l'unico modo di far stare la figura altrove e' del vuoto
dalla parte opposta: il PNG diventa piu' largo della figura. Senza fare niente,
la figura si rimpicciolirebbe da sola man mano che la si sposta — posizionare
costerebbe dimensione. Percio' `Largo (celle)` resta **quanto e' larga la
figura**, e il numero scritto nel nome del file e' quello del **PNG**, calcolato:
`albero@1.8.png` per un albero largo una cella spostato di mezza figura. In
verticale non succede niente, perche' il vuoto sopra e sotto non cambia la
larghezza — ed e' il caso normale.

## Indietro non vuol dire uscire

Sul telefono indietro e' il gesto con cui si chiude qualcosa: un pannello, una
finestra, un pentimento. Nell'editor chiudeva la scheda — e con la scheda se ne
andava il lavoro non ancora scaricato. Il momento peggiore possibile: succedeva
**mentre si cercava di chiudere un pannello**, cioe' quando nessuno se lo aspetta.

Una pagina non puo' disattivare quel tasto, ma puo' dargli qualcosa da mangiare:
`BackGuard` spinge nella cronologia una voce sentinella, che non cambia
l'indirizzo. Il primo indietro consuma quella invece di lasciare la pagina, e
arriva come `popstate` — dove diventa una decisione:

1. c'e' un pannello aperto -> si chiude quello, e la sentinella si rimette;
2. non c'e' niente da chiudere -> **"Vuoi chiudere la scheda?"**;
3. si conferma -> si fa l'indietro vero, quello che il telefono avrebbe fatto.

L'ordine di chiusura e' quello dei piani di sovrapposizione — matita, importer,
cassetto, catalogo, foglio ⋯ — perche' e' anche l'ordine in cui uno se li
aspetta: si toglie di mezzo cio' che copre il resto. Una domanda gia' aperta
consuma l'indietro senza fare altro: va risposta, non scavalcata.

Due cose che questa strada **non** puo' fare, e vanno dette. Una pagina non
chiude una scheda che non ha aperto lei: il passo 3 e' un `history.back()`, che
chiude la scheda solo se l'editor era la prima pagina — altrimenti si torna
dov'era prima, che e' comunque cio' che il tasto avrebbe fatto. E mentre la
domanda e' aperta la sentinella non c'e': un secondo indietro dato in quel
momento esce davvero. E' una scelta — rimetterla li' avrebbe reso l'uscita un
salto all'indietro che il browser rifiuta quando davanti non ha niente, cioe'
un "Chiudi" che non chiude. L'autosave su `beforeunload` resta la rete sotto.

## Riprendere non deve costare del lavoro

Provando davvero il giro completo e' saltato fuori il difetto peggiore di tutta
la sessione. Importi uno sprite, ci costruisci, ricarichi, scegli "Riprendi": lo
sprite non c'e' piu' — ed era voluto — ma **spariscono anche i blocchi piazzati
con lui**, e il primo autosave li cancella per sempre.

La catena e' corta e vale la pena scriverla, perche' non e' evidente:
`loadLayers` chiede a `spawn` di disegnare ogni blocco; un id sconosciuto non
produce nessuno sprite; `serializeLayers` si rilegge **dalla scena**; quindi al
salvataggio successivo quei blocchi non esistono piu'. Nessun messaggio, nessun
modo di accorgersene.

Il corollario riguarda anche il repository, e non solo gli sprite di sessione:
**cancellare un PNG da `src/assets/blocks/` cancellava i blocchi** di ogni
livello che lo usava, alla prima riapertura.

Due rimedi, che rispondono a due domande diverse.

**Un blocco che non si sa disegnare non si butta.** `GridPlacement` tiene gli id
sconosciuti in un elenco a parte e li riscrive nel salvataggio: invisibili ma
vivi. Committato il PNG, ricompaiono da soli. Costruirci sopra o passarci la
gomma li toglie, perche' li' l'intenzione e' chiara.

**Gli sprite di sessione viaggiano con l'autosave.** E' un cambio dichiarato
dell'invariante "vive solo in quella sessione": ora sopravvive alla ricarica *in
questo browser*, mentre resta vero — e va detto — che per chiunque altro non
esiste finche' il PNG non e' committato.

Il prezzo e' quello previsto dal primo giorno: un PNG in base64 pesa un centinaio
di KB, e il `localStorage` sta in ~5 MB **per tutta l'origine**. Da qui il tetto:
gli sprite entrano finche' ci stanno, e quelli che restano fuori vengono detti
per nome nella barra. La cosa che non si puo' perdere e' il progetto, quindi e'
lui ad avere la precedenza sullo spazio.

## Cento livelli: catalogo e schede sono due cose diverse

Le schede elencavano **tutti** i livelli. Con due va bene; con venti la striscia
non e' navigabile, con cento e' inutilizzabile. Ma il punto non era la striscia:
era che "livello che esiste" e "livello che sto modificando adesso" erano la
stessa cosa.

| | Cos'e' | Dove sta |
|---|---|---|
| **Catalogo** | tutti i livelli del progetto, anche cento | dietro 📚, con la ricerca per nome |
| **Schede** | i due o tre aperti adesso | in alto, con la × per chiudere |

**Chiudere una scheda non elimina niente**, ed e' la distinzione che rende
sopportabile un progetto grande: costa quanto mettere via un foglio. Crea,
duplica, rinomina ed elimina sono passati nell'elenco, dove si vede su quale
livello agiscono; prima stavano nella barra in alto solo perche' il catalogo
non c'era.

Due conseguenze che non erano ovvie:

- **una scheda resta sempre aperta**, perche' la scena disegna sempre un
  livello: senza, l'editor modificherebbe qualcosa che non e' in nessuna scheda.
- **le schede non entrano nella cronologia.** Aprire un livello non e' una
  modifica della scena. Un undo pero' puo' far sparire un livello, quindi dopo
  ogni ripristino le schede rimaste appese vengono tolte.

Le schede aperte stanno in `localStorage` e **non** in `level.json`: quello e'
il file che legge il gioco, e non deve portarsi dietro com'era disposto
l'editor mentre lo si costruiva.

## Uno snapshot che non cresce col progetto

Il costo vero di cento livelli non era l'interfaccia. `project()` **riclonava
ogni livello fermo**, e la chiama ogni snapshot dell'undo: il prezzo di una
pennellata cresceva col numero di livelli del progetto, non con quello che si
stava disegnando.

| Livelli | Prima | Dopo |
|---|---|---|
| 100 | **5,14 ms** a snapshot | **0,02 ms** |

Misurato sull'editor che gira, non su un modello. Ora i livelli fermi finiscono
nello snapshot **per riferimento**: si copia l'elenco, non i livelli.

Regge su un'invariante da non rompere: **un `SerializedLevel` non si modifica
mai sul posto, si sostituisce.** `serializeLayers()` costruisce sempre oggetti
nuovi e `loadLayers()` legge soltanto, quindi il livello montato nella scena non
puo' scrivere su quello memorizzato. Chi tocca un livello ne mette al suo posto
un altro, e la cronologia continua a puntare al vecchio senza che nessuno
glielo cambi sotto. Il primo posto dove la regola stava per saltare e' stato
`renameLevel()`, che scriveva il nome addosso all'oggetto — cioe' cambiava
anche il passato.

Cosi' e' caduto anche il rischio "undo a snapshot dell'intero progetto": lo
snapshot resta l'intero progetto — e quindi `Ctrl+Z` continua ad annullare
anche le operazioni sul catalogo — ma costa come se fosse un livello solo.

## Salva non deve mentire

`write()` ingoiava l'errore di quota e **Salva metteva comunque "✓ salvato"**.
Con due livelli non ci si arriva mai; con cento pieni — circa 2 MB contro i ~5
di `localStorage` — e' la strada normale per perdere una serata credendo di
averla al sicuro. Ora `write()` dice se ha scritto, e se non ci riesce lo stato
diventa "⚠ memoria piena: usa Scarica", che e' il consiglio giusto: da li' in
poi l'unico posto sicuro e' il file scaricato.

Scritto il test, e' saltato fuori un secondo difetto nella correzione stessa:
`store?.setItem(...)` dentro il `try` non scrive **e non lancia** quando lo
store non c'e', quindi tornava "scritto" senza aver scritto.

## Nascondere un layer e' una decisione che tiene

All'inizio selezionare un layer nascosto lo riaccendeva, per non far disegnare
alla cieca. Provandolo e' emerso il difetto: **la decisione di nascondere non
teneva**, bastava sfiorare il layer e tornava visibile.

Ora nascondere e' appiccicoso, e l'occhio funziona su tutti i layer — attivo
compreso. Quell'ultima parte non e' un dettaglio: se l'occhio del layer attivo
restasse bloccato, nasconderlo sarebbe una trappola senza uscita, perche' per
riaccenderlo bisognerebbe selezionarlo e selezionandolo diventa attivo.

Il prezzo accettato e' che si puo' dipingere su un piano spento. La riga del
pannello lo dice: nome sbiadito in corsivo e occhio sbarrato.
