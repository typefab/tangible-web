# Piano di lavoro — Tangible Cushion

Documento di riferimento su scelte di architettura, stato e prossimi passi.
Ultimo aggiornamento: 10 agosto 2026.

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
| Test | `test/`, `playwright.config.ts` | 67 test sul gioco che gira, in CI a ogni push |
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
- catalogo: un PNG copiato in `src/assets/blocks/` compare nella palette con
  etichetta e anteprima corrette **senza toccare il codice**
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
  blocks/        basic.png, stack.png…   -> palette e inventario, automatici
  characters/    player.png
  ui/            joystick-border.png, joystick-thumb.png
public/
  level.json     <- prodotto dall'editor
  assets/        <- archivio del progetto GDevelop, non usato dal codice
```

Due regole: **la cartella decide la categoria, il nome del file decide l'id.**

Sono stati spostati solo i 5 sprite effettivamente usati. Gli altri 51 restano
in `public/assets/`: sono varianti di joystick e prove mai entrate nel gioco, e
non si buttano via i disegni di qualcun altro senza chiedere. Vanno tolti quando
Fabrizio conferma che non servono — oggi finiscono nel deploy come peso morto.

`props/` non esiste ancora: si crea quando ci sara' il primo prop, insieme al
codice che lo usa. Una cartella vuota non aiuta nessuno.

---

## 7. Prossimi passi

1. ~~Ristrutturazione cartelle~~ — **fatta**
2. ~~Pannello sprite con miniature + pennello~~ — **fatto**, la palette si genera
   dal catalogo e scorre invece di crescere in altezza
3. ~~Selezione e spostamento di aree~~ — **fatto**
4. ~~Salvataggio locale e apertura di un file~~ — **fatto**
5. ~~Pinch-zoom~~ — **fatto**, insieme al pan a due dita
6. ~~Test automatici~~ — **fatto**, 39 test in CI
7. ~~Copia e incolla della selezione~~ — **fatto**, anche fra schede
8. ~~Produrre il primo APK~~ — **fatto**, 6,5 MB negli Artifacts. Resta da
   **installarlo su un telefono vero**
9. **Provare l'editor con un dito vero.** Resta il buco piu' grande: gesti,
   selezione e dimensione dei pulsanti sono tarati su un viewport, non su una
   mano. L'ingombro della barra, che era il lato misurabile senza avere il
   telefono in mano, e' stato ridotto — vedi "Quanto schermo resta per costruire"
10. Arte dei blocchi ridisegnata a rombo (vedi rischi)

---

## 8. Rischi aperti

| Rischio | Note |
|---|---|
| **L'arte non e' isometrica** | `basic.png` e' una cassa frontale. Su griglia a rombi le facce non combaciano, e con i layer si vede di piu': impilando due blocchi le facce laterali non si allineano. E' lavoro di grafica |
| **Il player e' minuscolo** | Visto a schermo: 26x64px su celle da 64x32, e' una macchiolina. La proporzione `317/788` dello sprite sorgente e' rispettata, ma l'altezza scelta (2 celle) e' troppo poca. Da ritarare guardando, ora che si puo' |
| Quota e altezza dello sprite scollegate | Un passo di quota vale `tileHeight` (32px), ma gli sprite dei blocchi sono piu' alti della cella. Su arte isometrica vera i due numeri devono coincidere, altrimenti restano fessure o sovrapposizioni |
| Il sito e' pubblico, e con lui gli sprite | Un gioco web manda le immagini al browser che lo gioca: "sprite privati" e "link pubblico" non possono essere veri insieme. Se serve riservatezza, l'unica leva e' chi puo' aprire la pagina |
| 51 PNG inutilizzati nel deploy | Archivio in `public/assets/`. Da togliere quando Fabrizio conferma |
| **Salva non porta il lavoro nel gioco** | Salva scrive in `localStorage`, solo Scarica + upload su GitHub aggiorna il gioco. La UI lo dice in tre punti, ma resta il modo piu' facile di perdere una serata |
| Il lavoro locale vive in un browser solo | Cambiando telefono o svuotando i dati del sito sparisce. Non e' un backup: il backup e' il commit su GitHub |
| Undo a snapshot dell'intero progetto | Con molti livelli pieni ogni passo costa qualche decina di kB. A queste dimensioni non si vede; con venti livelli grandi andra' rivisto |
| Ciclo commit -> gioco live ~1 minuto | Accettato: e' il prezzo del vincolo "zero installazioni" |
