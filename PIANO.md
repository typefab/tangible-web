# Piano di lavoro — Tangible Cushion

Documento di riferimento su scelte di architettura, stato e prossimi passi.
Ultimo aggiornamento: 20 agosto 2026.

---

## 1. Obiettivo

Sostituire la pipeline attuale (progetto GDevelop monolitico, modificato con
script Python) con un flusso in cui **GitHub e' il ponte** tra chi cura grafica
e scene e chi scrive le meccaniche.

### Divisione dei ruoli

| Chi | Fa cosa | Tocca |
|---|---|---|
| **Fabrizio** | Sprite, creazione scene, disposizione, test | `public/`, in futuro `src/assets/` |
| **Claude Code (browser)** | Oggetti e meccaniche, come codice | `src/` |
| **GitHub** | Il ponte tra i due | tutto |

Il codice resta leggibile e ispezionabile da GitHub in qualsiasi momento, ma
non e' Fabrizio a scriverlo.

### Vincoli non negoziabili

1. **Zero installazioni locali.** Tutto deve avvenire nel browser.
2. **Ponte su GitHub.** L'LLM lavora sul repository, non su file passati a mano.
3. **Editor di scene online, sempre apribile.** Serve per costruire i livelli.
4. **Output**: giocabile online **e** APK installabile su telefono.
5. Solo servizi **HTTPS e gratuiti**.

---

## 2. Perche' questa architettura

I vincoli 1 + 2 insieme escludono tutti gli engine con editor visuale nel
browser: salvano i progetti nel proprio cloud e non sanno leggere o scrivere su
un repository GitHub.

| Engine | Editor online | Salva su GitHub | Test online / APK | Esito |
|---|:---:|:---:|:---:|---|
| GDevelop web | si | **no** | si / si | escluso |
| microStudio | si | **no** | si / parziale | escluso |
| Construct 3 | si | **no** | si / si | escluso |
| Godot web editor | si | **no** | parziale / no | escluso |
| PlayCanvas | si | si | si / da incartare | unico alternativo |
| **Repo + editor nostro** | costruito | si | si / si | **scelto** |

Note di verifica:

- **GDevelop**: alla richiesta esplicita di un'opzione "salva su GitHub", il
  manutentore ha risposto che non arrivera', perche' git e' gia' usabile con
  GDevelop — cioe' dal desktop.
  ([discussione #7542](https://github.com/4ian/GDevelop/discussions/7542))
- **microStudio**: nessuna integrazione git nella documentazione ufficiale. Il
  tab "Sync" sincronizza un progetto microStudio con un altro progetto
  microStudio, non con repository esterni.
- **PlayCanvas**: alternativa reale e verificata. Integrazione GitHub ufficiale
  e tool `pcsync` bidirezionale (`push`/`pull`), che gira anche in CI con una
  API key. Scartato perche' e' un engine 3D/WebGL usato per un gioco 2D, perche'
  il `push` sovrascrive il remoto (rischio di perdere lavoro modificando da
  entrambi i lati), e perche' il piano gratuito rende i progetti pubblici.
  ([pcsync](https://github.com/playcanvas/playcanvas-sync))

**La scelta**: il repository non e' la copia del progetto, **e' il progetto**.
Phaser e' una libreria dentro il repo, non un'applicazione da cui esportare.

### L'editor di scene

Il vincolo 3 non e' soddisfatto da questa scelta, quindi l'editor e' stato
costruito: una **modalita' editor dentro il gioco stesso**, sullo stesso URL.

Perche' regge: e' online e sempre apribile, scrive esattamente i file che
l'LLM legge, gira sul dominio gia' in uso (nessun servizio nuovo di cui
fidarsi) e riusa il codice di gioco gia' testato.

L'obiezione standard ("non reinventarlo, usa Tiled o LDtk") non si applica:
sono entrambi desktop, esclusi dal vincolo 1.

---

## 3. Il ciclo di lavoro

```
 FABRIZIO (browser)                  GITHUB                   CLAUDE CODE
 ──────────────────                  ──────                   ───────────
 sprite: piskelapp.com  ┐
                        ├──> upload drag&drop ──> repo <────── codice (src/)
 scene: editor del      ┘                          │
        gioco stesso                               │
        (?editor=1)                                │
                                  GitHub Actions <─┘
                                   ├── Pages ──> si gioca al link
                                   └── APK ────> si installa sul telefono
```

**Accesso all'editor:** `https://<utente>.github.io/<repo>/?editor=1`

**Sincronizzazione con Claude Code online:** si collega il repository su
`claude.ai/code`. E' la stessa `main` su cui si lavora da locale: non c'e'
niente da configurare.

---

## 4. Scelte tecniche

### Griglia isometrica

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

### Costanti

Le costanti di gioco stanno in `src/config.ts`, portate 1:1 dalla tabella di
`gdevelop_repository/CLAUDE.md`: break 1,5s, cooldown 100ms, portata 224px,
oscillazione `sin(t*18)*10` gradi, 8 slot di inventario.

### Catalogo degli sprite

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

### Layer

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

### Un file, tutti i livelli

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

### Salvataggio: ricordare senza decidere

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

### Navigazione: due dita, non uno

Un dito e' gia' preso — disegna, cancella, seleziona — quindi il gesto libero e'
a due dita: trascinare sposta, allargare ingrandisce, e funziona in qualsiasi
strumento senza cambiare modalita'. Chi vuole il dito singolo ha ✋, a un tocco.

Due dettagli che sembrano piccoli e non lo sono:

- **il secondo dito annulla il tratto del primo.** Appoggiando la mano per fare
  pinch, il primo dito ha gia' toccato: senza questo si resterebbe con un blocco
  piazzato dove e' atterrato il pollice.
- **lo zoom e' ancorato al punto sotto le dita**, non al centro dello schermo,
  altrimenti ogni ingrandimento richiede un riposizionamento.

### La selezione e' un'area, non un insieme di blocchi

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

### Il contagocce, e il tratto che era gia' partito

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

### Quanto schermo resta per costruire

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

### I fondali non sono blocchi

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

### Il cassetto: la striscia non e' il catalogo

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

### Sprite fatti nel browser, e l'ibrido che ne consegue

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

### La taglia di uno sprite

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

### Due leve sulla dimensione, e perche' non fanno a pugni

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

### La matita, rifatta dopo averla usata

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

### Indietro non vuol dire uscire

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

### Riprendere non deve costare del lavoro

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

### Cento livelli: catalogo e schede sono due cose diverse

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

### Uno snapshot che non cresce col progetto

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

### Salva non deve mentire

`write()` ingoiava l'errore di quota e **Salva metteva comunque "✓ salvato"**.
Con due livelli non ci si arriva mai; con cento pieni — circa 2 MB contro i ~5
di `localStorage` — e' la strada normale per perdere una serata credendo di
averla al sicuro. Ora `write()` dice se ha scritto, e se non ci riesce lo stato
diventa "⚠ memoria piena: usa Scarica", che e' il consiglio giusto: da li' in
poi l'unico posto sicuro e' il file scaricato.

Scritto il test, e' saltato fuori un secondo difetto nella correzione stessa:
`store?.setItem(...)` dentro il `try` non scrive **e non lancia** quando lo
store non c'e', quindi tornava "scritto" senza aver scritto.

### Nascondere un layer e' una decisione che tiene

All'inizio selezionare un layer nascosto lo riaccendeva, per non far disegnare
alla cieca. Provandolo e' emerso il difetto: **la decisione di nascondere non
teneva**, bastava sfiorare il layer e tornava visibile.

Ora nascondere e' appiccicoso, e l'occhio funziona su tutti i layer — attivo
compreso. Quell'ultima parte non e' un dettaglio: se l'occhio del layer attivo
restasse bloccato, nasconderlo sarebbe una trappola senza uscita, perche' per
riaccenderlo bisognerebbe selezionarlo e selezionandolo diventa attivo.

Il prezzo accettato e' che si puo' dipingere su un piano spento. La riga del
pannello lo dice: nome sbiadito in corsivo e occhio sbarrato.

### I test guidano il gioco vero

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

**I test non bloccano il deploy.** Una scena nuova si pubblica caricando
`level.json` dalla UI web di GitHub, e quel giro deve restare di un minuto: un
test rosso per una ragione che non c'entra con un livello non deve impedire di
pubblicare il livello. Per invertire la scelta basta un `needs: test` nel job
`build` di `deploy-web.yml`.

---

## 5. Stato attuale

### Fatto e verificato

| Componente | File | Note |
|---|---|---|
| Piazzamento e rottura su griglia | `mechanics/GridPlacement.ts` | cooldown, break progressivo, callback di raccolta |
| Proiezione isometrica | `grid/projection.ts` | ortogonale disponibile come alternativa |
| Player | `mechanics/Player.ts` | sprite dal progetto GDevelop, origine ai piedi |
| Joystick virtuale | `mechanics/VirtualJoystick.ts` | multitouch, sprite `Transparent dark` |
| Inventario 8 slot | `mechanics/Inventory.ts` | solo stato e regole, testabile senza schermo |
| Barra inventario | `ui/InventoryBar.ts` | segnaposto se manca lo sprite, si adatta a schermi stretti |
| Editor di scene | `editor/LevelEditor.ts` | `?editor=1`, esporta `level.json` |
| Catalogo sprite | `assets/catalog.ts` | elenco generato dalle cartelle, alias per gli id vecchi |
| Layer | `mechanics/GridPlacement.ts` | nome, visibilita', quota; pannello in `LevelEditor.ts` |
| Formato progetto | `level/project.ts` | piu' livelli in un file, normalizzazione dei formati vecchi |
| Salvataggio locale | `editor/EditorStorage.ts` | autosave e Salva, con `dialog.ts` per la domanda all'apertura |
| Gesti | `editor/CameraGestures.ts` | pan e pinch a due dita, zoom ancorato al dito |
| Selezione ad area | `editor/SelectionTool.ts` | rettangolo, riempimento, svuotamento, spostamento, appunti |
| Contagocce | `editor/LevelEditor.ts` | tocco lungo o Alt+clic, con la pennellata disfatta |
| Apertura file | `editor/LevelEditor.ts` | legge un `level.json` dal dispositivo, annullabile |
| Formato progetto | `level/project.ts` | piu' livelli in un file; i livelli sono valori immutabili |
| Catalogo dei livelli | `editor/LevelBrowser.ts` | elenco con ricerca; le schede sono solo gli aperti |
| Fondali | `scenes/Backdrop.ts` | immagini dietro la scena, per livello; strumento 🖼 nell'editor |
| Matita e lazo | `editor/MaskEditor.ts` | gomma, ripristino, lazo e pizzico; produce una maschera, non un'immagine |
| Taglia e anteprima sulla cella | `editor/SpriteImporter.ts`, `assets/catalog.ts` | `albero@2.png` e' largo due celle; il rombo dell'anteprima viene da `projection.ts` |
| Scala del singolo blocco | `level/project.ts`, `mechanics/GridPlacement.ts` | `scale` moltiplica la taglia del tipo, assente quando vale 1; `− 1× +` sul pennello o sull'area |
| Tasto indietro | `editor/BackGuard.ts` | chiude il pannello in cima, e chiede prima di lasciare la scheda |
| Cassetto degli sprite | `editor/SpriteDrawer.ts` | catalogo per categoria e usati nel livello; in basso restano i recenti |
| Editor d'immagine | `editor/SpriteImporter.ts` | togli sfondo, pixel-art, sprite di sessione + PNG da committare |
| Ritaglio a mano | `editor/MaskEditor.ts` | gomma e ripristino sui pixel finali, con zoom e annulla per tratto |
| Test | `test/`, `playwright.config.ts` | 125 test sul gioco che gira, in CI a ogni push |
| Istruzioni | `CLAUDE.md` | confini fra sessioni e invarianti da non rompere |

Test principali superati:

- inversa isometrica: **0 errori su 8000 punti campionati** con test di
  punto-in-poligono; round-trip sui centri: 0 errori su 625 celle
- layer, verificati sul gioco che gira in Chromium: il pennello dipinge solo sul
  layer attivo; `[`/`]` cambiano piano; l'undo di un tratto non tocca gli altri
  layer; la stessa cella e' occupabile su due piani e il piano 1 sta 32px piu'
  in alto; `topBlockAt` ignora i layer spenti; il limite di 8 layer regge a 20
  tentativi di aggiunta
- `serialize -> load -> serialize` identico byte a byte; un `level.json` nel
  vecchio formato piatto si apre come layer "Terreno" con gli id tradotti;
  `"layers": []` non lascia la scena senza piani; un blocco con id inesistente
  viene scartato invece di diventare uno sprite invisibile
- catalogo: un PNG copiato in `src/assets/blocks/` compare nel cassetto con
  etichetta e anteprima corrette **senza toccare il codice**. Il test legge la
  cartella dal disco e la confronta con quello che l'editor mostra, sottocartelle
  comprese: un elenco scritto a mano tornerebbe rosso al primo PNG aggiunto
- editor d'immagine, sulla pipeline vera dentro il browser: un'immagine caricata
  come file diventa uno sprite **piazzabile subito** — texture registrata, voce
  nel cassetto, blocco che si posa sulla griglia; togliendo lo sfondo gli angoli
  restano a `alpha` 0 e la figura al centro resta opaca e del suo colore
- ripresa del lavoro, col giro vero — importa, costruisci, ricarica, "Riprendi":
  lo sprite importato **e i suoi blocchi** ci sono ancora, e non compare nessun
  avviso; e un livello che nomina uno sprite inesistente, riletto e riscritto,
  **conserva quel blocco** invece di perderlo
- tasto indietro, con l'indietro vero del browser: col cassetto aperto lo chiude
  e non chiede niente; lo stesso col catalogo dei livelli; senza niente aperto
  compare "Vuoi chiudere la scheda?" e **"Resta qui" tiene la pagina**; la
  domanda torna anche al secondo indietro, cioe' la sentinella si rimette; con
  una pennellata non salvata la domanda lo dice
- contagocce dello sfondo, sui due casi messi uno accanto all'altro: con la
  figura appoggiata a un angolo l'automatico **la mangia** — il pixel della
  figura esce trasparente — mentre indicando lo sfondo col contagocce la figura
  resta rossa e opaca e il bianco attorno se ne va
- la taglia: il suffisso del nome file si scioglie in id e misura, e un `@` che
  non e' una taglia resta nell'id; scelta la taglia, il nome proposto per il
  commit diventa `blocco_largo@2.png` e in scena quel blocco e' **largo il
  doppio** di uno normale; l'anteprima disegna la cella e ci mette sopra lo
  sprite
- la scala del blocco: col pennello a `2×` il blocco piazzato e' **largo il
  doppio** di uno normale, e nel file porta `"scale": 2` mentre gli altri
  restano `{col,row,type}` e basta; `serialize -> load -> serialize` non cambia
  niente e il blocco riletto **dalla scena** e' ancora della sua misura; con
  un'area in mano i due pulsanti agiscono sui blocchi che ci sono dentro e non
  su quelli fuori, e `Ctrl+Z` li rimette; su un'area mista la barra dice
  **misto** e ognuno parte dal suo gradino; spostamento, copia-incolla e
  contagocce **conservano la taglia**; una `scale` a 0, a 99 o scritta a parole
  non fa sparire il blocco; ai due estremi della scala il pulsante si spegne;
  su un'area **senza blocchi** i due pulsanti tornano a essere la taglia del
  pennello, come dice il numero
- la matita, sui sei difetti trovati usandola: un tratto veloce **da un capo
  all'altro in un solo salto** lascia una linea continua e non una fila di buchi;
  il ritaglio **resta dopo aver cambiato il lato in pixel**, e il resto
  dell'immagine resta con lui; ingrandire quattro volte **non cambia di un pixel**
  la finestra; Sposta muove davvero la tela; il lazo tiene cio' che sta dentro il
  contorno e toglie gli angoli; con un lato da 512 l'anteprima **ci sta dentro**
  invece di uscire dal bordo
- ritaglio a mano: una gommata al centro della griglia arriva **fino alla texture
  finale**, che li' torna trasparente; le frecce del lato in pixel muovono il
  valore di un passo in su e in giu'
- schede: due livelli dallo stesso file, il cambio scheda monta l'altro livello
  e ognuno conserva i propri blocchi; crea, duplica ed elimina; **Ctrl+Z annulla
  anche le operazioni sulle schede**, perche' lo snapshot contiene il progetto
  intero e non solo il livello aperto
- salvataggio, pilotando il browser attraverso ricariche vere: dopo un tratto lo
  stato dice "non salvato" e l'autosave e' scritto; riaprendo compare la domanda
  e **finche' non si risponde resta il file pubblicato**; "Riprendi" rimette il
  lavoro, "Ricomincia" torna al pubblicato e svuota la memoria; alla ricarica
  successiva non chiede piu' niente
- selezione: il rettangolo prende gli estremi e lascia fuori il blocco lontano;
  trascinandola si sposta di una cella e `Ctrl+Z` la rimette; `Canc` elimina
  esattamente i selezionati, ne' uno di piu' ne' uno di meno
- contagocce: il tocco lungo prende il tipo **e disfa la pennellata** che il
  tocco stesso aveva fatto — la cella resta com'era e il conteggio non cambia;
  muovendo il dito e' un tratto e non scatta; su cella vuota non si arma;
  con la gomma passa al pennello; con la selezione il dito fermo resta suo;
  provato anche con eventi touch veri, non solo col mouse
- ingombro della barra, misurato a 390x780 sull'editor che gira: la scena passa
  da 444 a 562px; ⋯ apre il foglio e un comando lo richiude, la griglia no; a
  foglio chiuso il pallino dice "non salvato"; **sopra i 600px non cambia
  niente**, Salva resta a un tocco
- pinch, con eventi touch veri via CDP: due dita che si allargano portano lo
  zoom da 1.00 a 1.87, e **il secondo dito annulla il blocco che il primo aveva
  gia' piazzato** — il conteggio resta identico
- bilancio inventario chiuso: 20 -> piazza -> 19 -> tentativi bloccati che non
  consumano -> rompi -> 20
- rottura: progresso 0.5 a 750ms, oscillazione 8.04 gradi, distruzione a 1500ms
- cooldown: 99ms rifiutato, 101ms accettato
- movimento: 190px in 1s, -95px in 0.5s
- joystick: deadzone, diagonale normalizzata a 0.71, pollice clampato a 56px,
  secondo dito che non ruba il controllo
- nessuna sovrapposizione barra/joystick a 375x812 (48px di margine)
- la build passa su Linux: `npm ci`, `npm run build`, upload artefatto

### Bug trovati e corretti

1. **`time.now === 0` dentro `create()`**: il cooldown scartava anche il primo
   piazzamento, quindi il livello caricava 0 blocchi. Risolto separando il
   caricamento batch (`spawn`) dall'input del giocatore (`place`).
2. **Inversa isometrica sbagliata**: normalizzava sul centro della cella invece
   che sul vertice superiore, e divideva per meta' tile invece che per il tile
   intero. Il round-trip sui centri tornava lo stesso, ma **il 74% dei punti
   finiva nel rombo sbagliato**. Scoperto campionando l'area, non i centri.
3. **Sovrapposizione barra/joystick su telefono**: visibile solo a 375x812.
   Il joystick ora si alza dell'altezza della barra.
4. **CRLF nelle GitHub Actions**: Git su Windows avrebbe convertito gli script
   shell, che sul runner Linux falliscono con `\r: command not found`. Prevenuto
   con `.gitattributes`.
5. **Due pulsanti con la stessa classe, e 13 test rossi letti come verdi.** Il
   cassetto degli sprite era nato con `class="elenco"`, la stessa del catalogo
   dei livelli: `#level-tabs .elenco` — come lo cercano i test — ha cominciato a
   prendere il cassetto, e tredici prove su schede, fondali e selezione sono
   andate in timeout. Il cassetto ha una classe sua, e `elenco` e' tornata a
   voler dire una cosa sola.

   L'errore vero pero' e' stato nel **leggere l'esito**: `83 passed` in fondo
   all'output e' stato preso per "tutto verde" senza confrontarlo col totale, e
   la riga stava sotto l'elenco dei falliti. Due PR sono state mergiate cosi'.
   Regola imparata, finita anche in `CLAUDE.md`: il numero che conta e' quello
   dei test **eseguiti contro quelli esistenti**, e `passed` da solo non dice
   niente.

### Il gioco e' stato visto girare — 8 agosto 2026

Cade il punto aperto piu' vecchio del progetto. Pilotando Chromium con
Playwright (`--use-angle=swiftshader`) il game loop gira davvero: `frames: 180`,
`running: true`, tutte le texture caricate, i 12 blocchi del livello sulla
griglia. Griglia isometrica, blocchi, barra dell'inventario, joystick e pannello
dei layer sono stati guardati a 900x620 e a 390x780.

Due difetti visibili solo guardando, corretti subito:

1. Su telefono il pannello dei layer copriva l'HUD di Phaser in alto a sinistra.
   In editor l'HUD ora sparisce: la toolbar dice gia' tutto quello che diceva lui.
2. La vista si apriva su (0,0) mentre l'origine isometrica sta a x=480, quindi su
   uno schermo da telefono la scena era fuori campo e bisognava cercarla
   trascinando. Ora l'editor parte inquadrato sul centro della griglia, e **⤢**
   ci riporta.

Falso allarme da mettere a verbale: negli screenshot compariva una fascia bianca
sopra il canvas. Con il rendering software sparisce — era un artefatto di
compositing GPU della cattura headless, non un difetto della pagina.

### Le Actions girano, e l'APK esiste — 8 agosto 2026

Cadono gli ultimi punti aperti dai tempi dell'avaria.

**Rettifica.** Questo documento ha continuato a dire *"le Actions non hanno mai
completato una run"* anche dopo che due deploy erano andati a buon fine (run #4
e #5, del 7 agosto). L'affermazione risaliva all'avaria del 6 e nessuno l'aveva
riletta. Vale come promemoria: una riga su cosa "non e' mai successo" scade in
fretta, e va riverificata prima di ripeterla.

| Workflow | Esito | Durata |
|---|---|---|
| `test.yml` | verde, 39 test su 39 | 1m41s |
| `build-apk.yml` | verde, **APK da 6,5 MB** negli Artifacts | 1m59s |
| `deploy-web.yml` | verde, sito pubblicato | 35s |

L'APK e' il primo mai prodotto dal progetto. Si scarica dagli *Artifacts* della
run e scade dopo 90 giorni; sul telefono va autorizzata l'installazione da
origini sconosciute, perche' e' un APK debug non firmato.

Il build APK ci mette due minuti, non i dieci che ci si aspetterebbe da Gradle:
`npx cap add android` genera un progetto minimo e il runner ha gia' l'SDK.

### Non verificato

- **Il tocco su un telefono vero** resta il buco principale (vedi sotto).
- **Il tocco non e' mai stato provato su un telefono vero**, solo su un viewport
  da 390x780 con il mouse — e i test toccano lo schermo via protocollo, che non
  e' la stessa cosa di un dito.
- **L'APK non e' mai stato installato**: e' stato prodotto, non provato.
- **Il flood-fill non e' mai stato provato su una foto vera.** I test lo
  inchiodano su immagini sintetiche — sfondo pieno, figura netta — cioe' il caso
  in cui non puo' sbagliare. Su uno sfondo sfumato o rumoroso puo' mangiare
  troppo o troppo poco; il contagocce sposta il riferimento ma non rende
  uniforme uno sfondo che non lo e'.
- **La matita su un telefono vero.** Il pizzico a due dita e lo spostamento sono
  scritti e provati col protocollo, non con una mano: restano da guardare. Il
  lazo tracciato col dito su una sagoma complicata e' l'altra cosa che nessun
  test dice.
- **La scala del blocco e' stata guardata, non toccata.** I gradini, il numero
  che cambia mestiere con la selezione e l'ingombro della barra sono misurati
  sull'editor che gira e in uno screenshot a 390x780; quanto siano comodi da
  centrare col dito — sono i due pulsanti piu' stretti della barra — lo dira'
  solo una mano.
- **Nessuno sprite importato e' ancora stato committato e ripreso dal gioco.**
  Il giro completo dell'ibrido — scarica, commit, deploy, il blocco che torna
  come sprite di build — e' costruito ma non percorso fino in fondo.

### Avaria GitHub del 6 agosto 2026

Actions e Pages in `major_outage` dalle 15:22 UTC, impatto `critical`.
Sintomi osservati e corrispondenza con i bollettini ufficiali:

| Osservato | Bollettino |
|---|---|
| Run `cancelled` con zero step | "workflow runs failing to start" |
| Job appeso con tutti gli step verdi | "jobs may remain queued... or may time out" |
| API `cancel` che risponde 502 | "requests to the Actions API are returning errors" |
| Sito 404 | Pages in major_outage |

Pagina: <https://www.githubstatus.com/incidents/qcvjkzcs7j74>

Nessuna azione correttiva possibile: quando rientra, il deploy riparte al
primo push.

---

## 6. Struttura dei file — fatta

```
src/assets/
  catalog.ts     <- l'elenco, generato da import.meta.glob
  blocks/        basic.png, stack.png…   -> cassetto e inventario, automatici
    <categoria>/ una sottocartella = una categoria del cassetto (facoltativa)
    albero@2.png una taglia nel nome = largo due celle; l'id resta `albero`
  characters/    player.png
  ui/            joystick-border.png, joystick-thumb.png
src/editor/
  LevelEditor.ts    il grosso: barra, strumenti, schede, undo, salvataggio
  SpriteDrawer.ts   il cassetto: catalogo per categoria e usati nel livello
  SpriteImporter.ts da un'immagine a uno sprite: sfondo, taglia, anteprima
  MaskEditor.ts     la matita: gomma, ripristino, lazo; produce una maschera
  SelectionTool.ts  la selezione come area di celle
  LevelBrowser.ts   il catalogo dei livelli, con ricerca
  CameraGestures.ts pan e pinch a due dita
  EditorStorage.ts  autosave e Salva, sprite di sessione compresi
  BackGuard.ts      il tasto indietro: chiude un pannello, poi chiede
  dialog.ts         la finestrella di scelta
public/
  level.json     <- prodotto dall'editor
  assets/        <- archivio del progetto GDevelop, non usato dal codice
```

Tre regole: **la cartella decide la categoria, il nome del file decide l'id, e
il suffisso `@n` decide la taglia** — senza entrare nell'id.

Sono stati spostati solo i 5 sprite effettivamente usati. Gli altri 51 restano
in `public/assets/`: sono varianti di joystick e prove mai entrate nel gioco, e
non si buttano via i disegni di qualcun altro senza chiedere. Vanno tolti quando
Fabrizio conferma che non servono — oggi finiscono nel deploy come peso morto.

`props/` non esiste ancora: si crea quando ci sara' il primo prop, insieme al
codice che lo usa. Una cartella vuota non aiuta nessuno.

---

## 7. Prossimi passi

### Fatti

1. ~~Ristrutturazione cartelle~~
2. ~~Pannello sprite con miniature + pennello~~ — la palette si genera dal
   catalogo invece di crescere in altezza
3. ~~Selezione e spostamento di aree~~
4. ~~Salvataggio locale e apertura di un file~~
5. ~~Pinch-zoom~~ — insieme al pan a due dita
6. ~~Test automatici~~ — oggi 125, in CI a ogni push
7. ~~Copia e incolla della selezione~~ — anche fra schede
8. ~~Produrre il primo APK~~ — 6,5 MB negli Artifacts, mai installato
9. ~~Cassetto degli sprite per categoria~~ — catalogo diviso per cartella, e in
   basso restano i recenti
10. ~~Fare uno sprite da un'immagine, dentro il browser~~ — togli sfondo,
    pixel-art, ritaglio a mano, ibrido sessione/commit
11. ~~Contagocce per lo sfondo~~ — si indica il colore invece di dedurlo dagli
    angoli, e il punto indicato fa da seme anche dentro la figura
12. ~~Sprite di dimensioni diverse senza rifare il PNG~~ — la taglia sta nel
    nome del file, con l'anteprima sulla cella per sceglierla
13. ~~Scala del singolo blocco piazzato~~ — `scale` facoltativo in `level.json`,
    moltiplicatore della taglia del tipo; `− 1× +` vale sul pennello o sull'area

### Da riprendere, in ordine

14. **Provare l'editor con un dito vero.** Resta il buco piu' grande: gesti,
    selezione e dimensione dei pulsanti sono tarati su un viewport, non su una
    mano. Il ritaglio e' stato provato da Fabrizio e va; il pizzico dentro la
    matita no.
15. **Mettere un `timeout-minutes` a `test.yml`**, piu' una cache di
    `~/.cache/ms-playwright`. Vedi l'episodio del 19 agosto: senza timeout un
    download impiantato lascia il commit senza verdetto per sei ore.
16. **Percorrere il giro completo di uno sprite importato**: scarica, commit,
    deploy, e ritrovarlo come blocco di build. E' l'unica prova che l'ibrido
    chiude il cerchio.
17. **Spezzare `LevelEditor.ts`**, sopra i 100 KB. Cassetto, importer, matita e
    sentinella sono nati fuori, ma il file non si e' ridotto.
18. **Arte dei blocchi ridisegnata a rombo** (vedi rischi) — lavoro di grafica.

---

## 8. Rischi aperti

| Rischio | Note |
|---|---|
| **L'arte non e' isometrica** | `basic.png` e' una cassa frontale. Su griglia a rombi le facce non combaciano, e con i layer si vede di piu': impilando due blocchi le facce laterali non si allineano. E' lavoro di grafica |
| **Il player e' minuscolo** | Visto a schermo: 26x64px su celle da 64x32, e' una macchiolina. La proporzione `317/788` dello sprite sorgente e' rispettata, ma l'altezza scelta (2 celle) e' troppo poca. Da ritarare guardando, ora che si puo' |
| Quota e altezza dello sprite scollegate | Un passo di quota vale `tileHeight` (32px), ma gli sprite dei blocchi sono piu' alti della cella. Su arte isometrica vera i due numeri devono coincidere, altrimenti restano fessure o sovrapposizioni |
| Il sito e' pubblico, e con lui gli sprite | Un gioco web manda le immagini al browser che lo gioca: "sprite privati" e "link pubblico" non possono essere veri insieme. Se serve riservatezza, l'unica leva e' chi puo' aprire la pagina |
| 51 PNG inutilizzati nel deploy | Archivio in `public/assets/`. Da togliere quando Fabrizio conferma |
| **Il peso dei fondali** | Un blocco pesa 300 byte, un fondale a schermo intero puo' pesarne un milione. Finiscono nel sito **e nell'APK**, e chi apre la pagina se li scarica. Vanno tenuti piccoli, in `jpg` o `webp` |
| **Salva non porta il lavoro nel gioco** | Salva scrive in `localStorage`, solo Scarica + upload su GitHub aggiorna il gioco. La UI lo dice in tre punti, ma resta il modo piu' facile di perdere una serata |
| **`localStorage` sta in ~5 MB** | Un progetto da cento livelli pieni ci arriva (~2 MB, ma cresce). Ora Salva lo dice invece di fingere, e resta Scarica; la soluzione vera e' IndexedDB |
| **Uno sprite grande copre celle che non occupa** | La profondita' resta `col + row` della sua unica cella: un albero largo due puo' finire davanti a qualcosa che dovrebbe stargli davanti. E' come funziona l'isometrica, non un difetto da correggere — ma si vede, e con l'arte a rombi ancora in sospeso conviene saperlo. Vale identico per la scala del singolo blocco, che e' l'altra strada per fare un blocco piu' largo della sua cella |
| La scala non passa dall'inventario | In gioco, rompere un blocco ne restituisce il **tipo**: l'inventario tiene tipi, non misure, quindi ripiazzandolo torna a taglia normale. In editor non succede — li' i blocchi non si rompono — ma se un giorno il gioco dovesse conservarla, la leva e' l'inventario, non il piazzamento |
| Il lavoro locale vive in un browser solo | Cambiando telefono o svuotando i dati del sito sparisce. Non e' un backup: il backup e' il commit su GitHub |
| **Uno sprite di sessione sembra permanente** | Ora sopravvive alla ricarica in questo browser, il che lo fa sembrare ancora piu' definitivo di prima: per chiunque altro, e nel gioco pubblicato, non esiste finche' il PNG non e' committato. Il pannello dice dove metterlo, ma resta un avviso da leggere contro un'interfaccia che non lo mostra |
| **Sprite grandi e peso del PNG** | Il lato in pixel arriva a 1024 e la sorgente di lavoro a 2048. Uno sprite a quella risoluzione non pesa piu' come i 300 byte di `basic.png`, e finisce nel sito e nell'APK come i fondali. Vale la stessa regola: tenerli piccoli quanto basta |
| Lo sfondo tolto in automatico e' grezzo | Flood-fill con una soglia: sugli sfondi piatti va, sulle foto vere non e' detto. Il contagocce sposta il riferimento e la matita e' la scialuppa, ma su un ritaglio complesso resta lavoro manuale |
| ~~Undo a snapshot dell'intero progetto~~ | **Caduto.** Lo snapshot resta l'intero progetto, ma i livelli fermi ci finiscono per riferimento: 0,02 ms con cento livelli, contro 5,14 |
| Ciclo commit -> gioco live ~1 minuto | Accettato: e' il prezzo del vincolo "zero installazioni" |
