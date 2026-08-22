# Condiviso — catalogo, formato, test

Il terreno comune: da dove vengono gli sprite, che forma ha un `level.json`, e
come si verifica che tutto regga.

**E' la parte da toccare con piu' attenzione.** Sul repository puo' esserci piu'
di una sessione aperta — una sul gioco, una sull'editor — e questi sono i file
che entrambe leggono: `src/assets/catalog.ts`, `src/level/`, `test/`. Una
modifica qui si sente di la'.

Il resto sta in [GIOCO.md](GIOCO.md) e [EDITOR.md](EDITOR.md); obiettivo, stato
e rischi in [../PIANO.md](../PIANO.md).

## Cosa c'e' qui

- [Catalogo degli sprite](#catalogo-degli-sprite)
- [Un file, tutti i livelli](#un-file-tutti-i-livelli)
- [I fondali non sono blocchi](#i-fondali-non-sono-blocchi)
- [La taglia di uno sprite](#la-taglia-di-uno-sprite)
- [Due leve sulla dimensione, e perche' non fanno a pugni](#due-leve-sulla-dimensione-e-perche-non-fanno-a-pugni)
- [I test guidano il gioco vero](#i-test-guidano-il-gioco-vero)

---
## Catalogo degli sprite

I tipi di blocco non sono piu' scritti in `config.ts`: sono i PNG dentro
`src/assets/blocks/`, elencati da `src/assets/catalog.ts` con `import.meta.glob`.
**La cartella decide la categoria, il nome del file decide l'id.** Caricare un
PNG e fare commit basta a farlo comparire nella palette e nell'inventario.

La regola sulla cartella e' diventata vera davvero solo con il cassetto: il glob
e' `blocks/**/*.png`, e il primo livello di sottocartella e' la categoria —
`blocks/natura/tree.png` sta in "natura". Le cartelle restano **facoltative**,
perche' la promessa non deve diventare "carichi un PNG *nel posto giusto*": un
file lasciato in `blocks/` finisce in "Generale" e compare come prima. Le
categorie sono un elenco piatto e non un albero: il cassetto e' un menu, non un
file manager.

Il prezzo e' che l'elenco esiste solo dopo la build, quindi `BlockType` non puo'
piu' essere l'unione degli id: e' `string`, e chi legge `level.json` valida a
runtime con `resolveBlock()`. Una mappa di alias tiene in vita gli id vecchi
(`block_0` -> `basic`) perche' i file gia' esportati continuino ad aprirsi.

Nota di build: `assetsInlineLimit: 0` in `vite.config.ts`. Di default Vite
converte in data URI gli asset sotto i 4 KB — e i blocchi pesano 200-300 byte —
ma il loader di Phaser scarica le immagini con XHR, che su un data URI non
funziona. Sarebbe stato un guasto solo in produzione, perche' in sviluppo Vite
non inlinea niente.

## Un file, tutti i livelli

`public/level.json` contiene l'intero progetto: `{ "levels": [ { "name", "layers" } ] }`.
Un file per livello sarebbe stato piu' ortodosso, ma il collo di bottiglia qui
non e' l'eleganza del formato, e' il caricamento a mano dalla UI web di GitHub:
un file e' un'operazione, cinque sono cinque occasioni di sbagliare cartella. Il
diff resta leggibile perche' i blocchi escono ordinati.

Il gioco sceglie con `?level=`, per numero o per nome. Un valore sconosciuto
torna al primo livello invece di dare una scena vuota: un link sbagliato non
deve sembrare un gioco rotto.

`normalizeProject()` in `src/level/project.ts` porta al formato corrente tutte e
tre le generazioni del file (`levels`, `layers`, `blocks`), e qualunque cosa non
riconosca diventa un progetto vuoto invece di un errore — l'editor deve aprirsi
comunque, altrimenti non c'e' modo di rimediare a un file rotto.

## I fondali non sono blocchi

La richiesta era mettere immagini dietro alla scena, e la proposta di partenza
era: un layer per immagine, l'immagine come oggetto dentro il layer. Meta' di
quell'idea e' giusta — un fondale ha bisogno esattamente di **ordine** e
**interruttore**, che i layer gia' danno — ma l'altra meta' costava troppo:

| Se il fondale fosse un blocco in un layer | Prezzo |
|---|---|
| ha `x`, `y` e scala libere, non una cella | pennello, gomma, selezione e appunti girano **tutti** per celle: ognuno impara un caso speciale |
| un'immagine per layer | i layer sono 8, e il numero non e' arbitrario: `max * depthStep` deve restare sotto `Z.playerDepthBias` |
| il layer ha una quota | per un'immagine non vuol dire niente, e resta un numero da ignorare |

Quindi i fondali sono un **elenco dentro il livello**, non blocchi:
`{ id, x, y, scale }`. Gli strumenti a celle non hanno imparato niente, e le
immagini si possono mettere quante se ne vuole senza consumare i piani su cui
si costruisce.

La cartella e' `src/assets/backgrounds/` e vale la stessa promessa dei blocchi:
carichi un file, fai commit, compare nella palette. Accetta anche `jpg` e
`webp`, perche' un cielo in PNG pesa quanto tutto il resto del gioco.

**Il pareggio di profondita', di nuovo.** La prima versione metteva i fondali a
`-1000`, dove stavano gia' le linee della griglia. A parita' di profondita'
decide l'ordine di creazione, quindi il fondale copriva la griglia — cioe' si
sarebbe costruito alla cieca. Ora le bande sono esplicite in `Z`, e la
relazione fra loro e' scritta:

| Profondita' | Cosa |
|---|---|
| da -2000 | fondali |
| -1000 | griglia, **sopra** ai fondali |
| da 0 | blocchi e player, `col + row` |

E' la seconda volta che un pareggio di profondita' costa un difetto: la prima
era il player sulla propria cella.

**I fondali stanno nel pannello dei layer, non nella barra.** Quel pannello e'
gia' *la struttura del livello aperto* — i piani su cui si costruisce — e un
fondale e' esattamente quello: contenuto di questo livello, non un comando
dell'editor. Due sezioni, layer sopra e fondali sotto.

Ci sono finiti anche i comandi di scala, rotazione e ordine, che prima stavano
nella barra: li' facevano crescere la barra di 54px appena si prendeva
un'immagine, e su telefono quello spazio e' la scena. Scegliendo 🖼 il pannello
si apre da solo se era chiuso — uno strumento che non mostra i suoi comandi
sembra non fare niente — ma richiuderlo resta una decisione di chi lo usa.

**Perche' l'elenco non e' un lusso.** Un fondale grande copre quasi tutto lo
schermo, e da li' in poi ogni tocco *prende quello* invece di aggiungerne un
altro: era la regola giusta, ma rendeva il secondo fondale praticamente
impossibile da mettere, e infatti sembrava che se ne potesse mettere uno solo.
Il **+** nella sezione lo aggiunge al centro della vista, ed e' la via che non
dipende da cosa c'e' gia' sotto il dito.

**Rotazione**: passi di 15 gradi, cosi' 45 e 90 cadono sul passo. Il centro
resta fermo. La chiave `rotation` non compare quando e' zero, come
`backgrounds` non compare nei livelli che non ne hanno. La presa di
un'immagine ruotata usa il rettangolo allineato agli assi che la contiene:
un po' generosa negli angoli, ma deve solo dire quale immagine si sta
indicando.

Dettagli che vengono dall'uso e non dal disegno:

- **il tocco prende il fondale che c'e', o ne mette uno se non c'e'.** Nessuna
  modalita' fra "aggiungi" e "sposta": e' la stessa regola della selezione, dove
  il dito dentro l'area la sposta e fuori ne comincia un'altra.
- **si prende dal punto toccato**, tenendo lo scarto dal centro: agganciandolo
  al centro, un'immagine presa per un angolo salterebbe di mezzo schermo al
  primo movimento.
- il trascinamento e' **un solo `Ctrl+Z`**, come una pennellata: stesso
  meccanismo di `strokeStart`.
- lo strumento **scambia la palette** invece di aggiungerne una: e' la stessa
  domanda — cosa piazzo — fatta da due strumenti diversi, e due strisce insieme
  costerebbero una riga di schermo.
- la chiave `backgrounds` **non compare** nei livelli che non ne hanno: un
  `level.json` fatto prima, riaperto e riscritto, resta identico byte a byte.

## La taglia di uno sprite

Un fatto che si e' scoperto tardi: `spawn` porta **ogni** blocco a
`ISO.tileWidth` di larghezza. La risoluzione del PNG non c'entra niente con
quanto e' grande in gioco — serve solo alla nitidezza. Quindi la strada
"esporto lo stesso oggetto in tre PNG di misure diverse" non avrebbe funzionato
comunque: sarebbero venuti fuori tre blocchi identici.

La taglia sta nel **nome del file**: `albero@2.png` e' largo due celle. La
regola che la rende innocua e' la stessa della sottocartella — **il suffisso non
entra nell'id**. `albero@2.png` e `albero@3.png` sono lo stesso blocco `albero`,
quindi ripensarci non invalida i `level.json` gia' scritti, e non serve nessun
elenco a mano da tenere allineato. Un `@` che non e' seguito da un numero
sensato resta nell'id: un file chiamato davvero cosi' deve continuare ad
aprirsi, non sparire dal catalogo.

**L'appoggio sulla cella non e' un metadato.** Uno sprite sta centrato sul
centro del rombo, e uno alto sborda sotto. Invece di aggiungere un secondo
numero da salvare accanto alla taglia, l'importer **incorpora l'appoggio nel
PNG** come spazio trasparente: aggiungere vuoto sotto alza l'immagine, sopra la
abbassa. Non c'e' niente da tenere allineato, funziona anche per chi apre il
file senza sapere di quel pannello, e i blocchi gia' piazzati non si spostano.

L'anteprima che serve a tararla disegna la cella con **`projection.cellOutline`**
e non un rombo ridisegnato a mano: se un giorno la proiezione cambia,
l'anteprima cambia con lei invece di diventare una bugia. E' lo stesso motivo
per cui l'editor disegna attraverso la scena.

## Due leve sulla dimensione, e perche' non fanno a pugni

La taglia nel nome del file risponde a "quanto e' grande un albero". Restava
senza risposta l'altra meta': "quest'albero e' piu' piccolo di quello". Sono
domande diverse e servono due leve, ma la seconda poteva facilmente rompere la
prima.

Il campo e' `scale` dentro il blocco, ed e' un **moltiplicatore** della taglia
del tipo, non una misura in celle. Sembra un dettaglio e regge l'invariante piu'
vecchia delle due: `albero@2.png` e `albero@3.png` sono lo stesso blocco
`albero`, e ripensare la taglia non deve invalidare i `level.json` gia' scritti.
Con una misura assoluta, cambiare il suffisso avrebbe lasciato mezzo livello
alla vecchia proporzione; col moltiplicatore, "meta' di un albero" resta meta'
di un albero qualunque cosa voglia dire domani.

| | Dove sta | Risponde a |
|---|---|---|
| **taglia del tipo** | nel nome del file, `albero@2.png` | quanto e' grande un albero |
| **scala del blocco** | in `level.json`, `"scale": 0.5` | quest'albero e' meta' degli altri |

Tre conseguenze che non erano ovvie:

- **il campo non compare quando vale 1.** E' la stessa regola di `rotation` sui
  fondali: un file fatto prima, riaperto e riscritto, resta identico byte a
  byte. Costa tre righe in `normalizeBlocks`, che ricostruisce i blocchi invece
  di filtrarli — cosi' una `scale` scritta male viene riportata dentro i limiti
  invece di arrivare fino allo sprite.
- **gradini e non un fattore continuo**: 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4. Con
  un fattore moltiplicativo si legge "1.5625×" dopo due tocchi, e tornare
  esattamente a 1 diventa un caso fortunato. Su una selezione **mista** ogni
  blocco parte dal **suo** gradino: appiattirli tutti sulla stessa misura
  renderebbe il pulsante inutilizzabile proprio dove serve.
- **la scala viaggia col blocco.** Spostare un'area, copiarla, incollarla in
  un'altra scheda, riprenderlo col contagocce: se anche uno solo di questi
  percorsi la perdesse, sarebbe una proprieta' che si cancella toccando le cose,
  cioe' peggio che non averla.

**Dove sta il comando, e perche' non fra gli strumenti.** La prima versione
metteva `− 1× +` nella riga degli strumenti, che e' dove sta "cosa fa il dito".
Misurato su un telefono da 390px: la riga andava a capo, e la barra tornava da
171 a 217px — 46px di scena persi per un comando che ne occupa 99 di larghezza.
Ora sta accanto agli sprite recenti, che e' anche il posto giusto per un'altra
ragione: quella riga e' la domanda "cosa piazzo", e la taglia ne e' la seconda
meta'. Col telefono girato la riga della palette e' l'elemento flessibile, e li'
lo stepper non entra nemmeno nel conto di chi va a capo: 79px, come prima.

I due pulsanti hanno la doppia funzione di pennello e gomma, per la stessa
ragione: con un'area selezionata agiscono sull'area, senza cambiano la taglia in
mano. E come per quei due, e' il numero in mezzo a dirlo — si accende e passa a
dire la taglia dei blocchi selezionati, o **misto** se ce ne sono di diverse.
Mostrare la misura del primo sarebbe una bugia che si scopre premendo.

Con una differenza rispetto a pennello e gomma, ed e' la cosa che si sarebbe
sbagliata: il criterio non e' "c'e' un'area" ma "**ci sono blocchi** nell'area".
Riempire una selezione di celle vuote ha senso, ingrandirle no: su terreno vuoto
i due pulsanti tornano a essere la taglia del pennello, che e' anche cio' che il
numero mostra. La condizione e' una sola, condivisa fra chi decide e chi
mostra — se fossero due, si potrebbe leggere "pennello" e vedere agire l'area.

Cambiare la taglia in mano **non entra nella cronologia**: e' una scelta come
scegliere un altro sprite, non una modifica della scena. Ingrandire un'area si',
ed e' un solo `Ctrl+Z`.

## I test guidano il gioco vero

`test/` con Playwright, e **nessun unit test**. Non e' pigrizia: le parti
interessanti di questo progetto sono la proiezione isometrica, l'ordine di
disegno dei layer, i gesti a due dita e un salvataggio che deve sopravvivere a
una ricarica. Un mock di `Phaser.Scene` direbbe soltanto che il mock funziona —
ed e' esattamente il tipo di verifica che aveva lasciato passare l'inversa
isometrica sbagliata al 74%.

I test leggono lo stato da `window.game`, esposto solo in sviluppo. Quindi
girano contro il server di sviluppo, non contro l'anteprima del build.

Scelte che tengono la suite affidabile:

- **si aspetta un oggetto, mai un tempo fisso.** Un `waitForTimeout` tarato su
  questa macchina diventa un test che fallisce su CI senza motivo.
- **il pinch usa eventi touch veri** via CDP: `page.touchscreen` fa solo tap, e
  un gesto a due dita simulato col mouse proverebbe un'altra cosa.
- **il test del catalogo legge la cartella dal disco** e la confronta con la
  palette. Se un giorno qualcuno rimettesse un elenco scritto a mano, verrebbe
  scoperto al primo PNG caricato.
- `CHROMIUM_PATH` permette di usare un Chromium gia' installato quando la sua
  build non coincide con quella attesa da Playwright.

**Una run senza verdetto e' peggio di una rossa.** Il 19 agosto tre run di
`test.yml` si sono impiantate sul passo *Install Chromium* — quello che scarica
il browser — e ci sono rimaste: il giorno dopo erano ancora `in_progress`, coi
tre commit senza ne' spunta ne' croce. Una croce si guarda e si capisce; una run
appesa non dice niente, e nel frattempo il commit sembra soltanto lento.

La cura sta su due piani, e sono due cose diverse:

| | Cosa fa |
|---|---|
| `timeout-minutes: 15` sul job | il tetto vero. Senza, il limite e' quello di GitHub — **sei ore** |
| `timeout-minutes: 5` su *Install Chromium* | fa cadere il fallimento **sul passo che si e' piantato**, invece di troncare il job in un punto qualunque |
| cache di `~/.cache/ms-playwright` | il browser non si riscarica: una parte in meno della strada che si e' rotta |

**Il tetto sul passo serve anche a un'altra cosa, e non era ovvia:** GitHub
pubblica i log **a job finito**. Delle tre run appese non si puo' leggere niente
— l'API risponde 404 — quindi non si sa nemmeno quale meta' di quel passo si sia
piantata, il download del browser o l'`apt` di `--with-deps`. Un passo che scade
e' un job che finisce, cioe' dei log da guardare la prossima volta.

**E la cache non elimina il rischio, lo riduce.** Misurato sulle due run: il
primo giro riempie la cache, il secondo la ritrova — *Install Chromium* passa da
23 a 17 secondi. Il resto sono le librerie di sistema, che passano da apt e
quindi dalla rete lo stesso. Il tetto resta la rete sotto, e la cache e' quello
che rende meno probabile doverla usare.

I numeri vengono dalle run vere, non a occhio: il giro normale sta in 4-5 minuti
— una ventina di secondi per il browser, il resto sono i test — e il piu' lento
mai visto e' di 8. La chiave della cache porta la versione di Playwright letta da
`package-lock.json` e non scritta nel workflow, cosi' aggiornarlo la invalida da
solo. Senza `restore-keys`: un ripiego parziale rimetterebbe il browser di
un'altra versione, che Playwright riscaricherebbe comunque.

Gli altri due workflow restano senza tetto, ed e' una scelta: `deploy-web.yml`
ha `cancel-in-progress` sul gruppo `pages`, quindi una run appesa la cancella il
push successivo, e `build-apk.yml` si avvia a mano.

**I test non bloccano il deploy.** Una scena nuova si pubblica caricando
`level.json` dalla UI web di GitHub, e quel giro deve restare di un minuto: un
test rosso per una ragione che non c'entra con un livello non deve impedire di
pubblicare il livello. Per invertire la scelta basta un `needs: test` nel job
`build` di `deploy-web.yml`.
