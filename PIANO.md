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

### Lo storage fuori dal repository, e il gioco su invito

**Niente di questa sezione e' costruito.** E' la forma decisa parlandone il 21
agosto 2026, scritta prima del codice perche' tocca tre cose che oggi reggono il
progetto: da dove vengono gli sprite, chi puo' aprire il gioco, e cosa fa
GitHub.

Due problemi, che si sono rivelati lo stesso problema:

1. **Il giro di uno sprite passa da un commit.** Lo fai nell'editor, lo scarichi,
   lo carichi su GitHub, aspetti il deploy. Dal telefono e' il passaggio
   peggiore che c'e'.
2. **Il sito e' pubblico, e con lui gli sprite** — e la repository e' pubblica
   *perche'* il deploy lo impone: sul piano gratuito Pages pubblica solo da
   repository pubbliche. Non e' lo sviluppo a tenerla aperta, e' il deploy.

Il primo disegno faceva parlare la pagina direttamente con lo Storage Box. Non
si puo', per due motivi indipendenti — ed e' bene che restino scritti, perche'
e' la freccia che verrebbe voglia di rifare.

**Un browser non prende immagini da uno Storage Box.** Hetzner espone SFTP,
Samba e WebDAV, e non ha un posto dove configurare gli header CORS: il permesso
che il browser pretende prima di lasciar leggere da un altro dominio. Phaser
scarica le immagini con XHR — e' lo stesso motivo di `assetsInlineLimit: 0` —
quindi il ripiego del tag `<img>`, che di CORS farebbe a meno, non vale. E
l'editor d'immagine **legge i pixel**: su un'immagine arrivata senza CORS il
canvas diventa "sporco" e `getImageData` smette di funzionare, cioe' cadono
insieme flood-fill, contagocce, `trimTransparent` e la matita. Mezzo editor.

**E una pagina che sa parlare con lo storage porta dentro di se' la password
dello storage**, leggibile da chiunque la apra. Che e' l'opposto esatto di
"sprite privati".

#### Una porta sola

Il gioco viene servito da un **Worker Cloudflare**, e lo stesso Worker fa da
tramite verso Hetzner: la pagina chiede `/assets/blocks/albero@2.png` al proprio
stesso indirizzo, il Worker va a prenderlo sul box in WebDAV e lo restituisce.

```
 FABRIZIO                    GITHUB (repo privata)         CLOUDFLARE
 ────────                    ─────────────────────         ──────────
 prompt ──> Claude ──> codice ──┐
                                └── Action ──> deploy ──> Worker (il gioco)
                                                            │   ▲
 sprite ──> HETZNER STORAGE BOX <────────────────────────────┘   │
 (WebDAV, dal telefono)      ▲                                   │
                             └── la password sta qui, non        │
                                 nella pagina                    │
 check ──────────> codice via email ──> Cloudflare Access ───────┘
```

Tre conseguenze, e sono tutte e tre il punto:

- **Niente CORS**, perche' non c'e' piu' niente di cross-origin: gioco e sprite
  arrivano dallo stesso indirizzo. L'editor d'immagine continua a leggere i
  pixel.
- **La password non e' mai nella pagina.** Sta nel Worker come segreto, e chi
  scrive il codice non ha bisogno di vederla.
- **Il gioco e' privato davvero**: Cloudflare Access davanti al Worker, chi apre
  il link si fa mandare un codice via email. Sull'indirizzo `workers.dev` si
  attiva con un click, senza comprare un dominio, e vale anche per `/assets/*`
  — la stessa porta protegge il gioco e gli sprite.

Costo: **zero**. Worker, Access e il traffico degli asset statici stanno nel
piano gratuito di Cloudflare; il box Hetzner e' gia' pagato. Il vincolo "solo
servizi HTTPS e gratuiti" regge.

Cosa vuol dire "privato", detto onesto: **serve un invito per aprire la
pagina**. Chi e' invitato riceve gli sprite nel proprio browser, e quello e'
inevitabile — un gioco web manda le immagini a chi lo gioca. La leva e' chi puo'
aprire, non cosa viene mandato. Fino a 50 indirizzi, gratis.

#### Perche' non bastava rendere privata la repository

Pages da una repository privata **richiede GitHub Pro** (~4$/mese), e anche
pagando **il sito resta pubblico**: un sito Pages con l'accesso ristretto esiste
solo su Enterprise Cloud, con un account organizzazione. Quindi la strada
"repo privata + Pages" costa e non da' comunque la cosa che serviva. Spostato il
deploy, la repository diventa privata gratis.

#### Cosa cambia in `catalog.ts`: meno di quanto sembri

Il catalogo fa oggi due cose diverse, ed e' questa separazione a rendere il
cambio piccolo:

- **da dove viene l'elenco** — `import.meta.glob`, che gira alla build
- **cosa vogliono dire i nomi** — `albero@2.png` e' `albero` largo due celle, la
  sottocartella e' la categoria, `red_brick` diventa "Red Brick"

**Solo la prima cambia.** WebDAV sa elencare una cartella (`PROPFIND`), quindi
il Worker chiede al box cosa c'e' dentro e passa alla pagina lo stesso elenco
che oggi le prepara Vite. Tutte le convenzioni sui nomi valgono identiche su una
cartella Hetzner: `blocks/natura/albero@2.png` sul box vuol dire quello che vuol
dire oggi nel repo. **La promessa "carichi un PNG e compare" migliora**:
spariscono il commit e il minuto di deploy.

E il catalogo sa gia' tenere piu' sorgenti insieme — `runtimeBlocks` sta gia'
accanto a `BLOCKS`. Il box diventa **una terza sorgente, aggiunta senza togliere
niente**: gli sprite nel repository restano come riserva, cosi' se Hetzner e'
irraggiungibile il gioco si apre lo stesso e i test continuano a girare senza
rete. Il che rende la migrazione reversibile: se non funziona, si stacca.

Un dettaglio che si scoprirebbe a meta' strada, quindi meglio scritto: nel
runtime dei Worker **non c'e' `DOMParser`**, e la risposta di `PROPFIND` e' XML.
L'elenco va estratto a mano dagli `<d:href>`, non con un parser.

#### Il regalo: Salva smette di mentire

Il rischio numero uno del progetto e' che *Salva* scrive in `localStorage` e
solo *Scarica* + upload su GitHub aggiorna il gioco. Con una porta che sa anche
**scrivere**, `level.json` va sul box e Salva diventa vero. Non e' il motivo per
cui questo lavoro e' nato, ma e' la cosa che lo ripaga.

#### L'APK

L'APK deve continuare a funzionare, quindi non puo' dipendere dalla rete ne'
passare da Access. La Action che lo costruisce **si scarica gli sprite dal box
al momento della build** e li impacchetta: l'APK resta giocabile offline, ed e'
la fotografia degli sprite di quel giorno. Chi ce l'ha installato non vede gli
sprite aggiunti dopo, finche' non se lo rifa'.

#### Il prezzo, per intero

- **I minuti di Actions cominciano a contare.** Su repository pubbliche sono
  illimitati; su repository private il piano gratuito ne da' **2000 al mese**.
  `test.yml` gira a ogni push, e ha un tetto di 15 minuti a run: il conto va
  guardato, e se stringe la build del sito puo' passare a Cloudflare, che compila
  anche da repository private.
- **Tre servizi invece di uno.** Oggi il gioco cade solo se cade GitHub; domani
  anche se cade Cloudflare o Hetzner.
- **Il primo caricamento e' piu' lento**, perche' gli sprite non sono piu' dentro
  al pacchetto. La cache del Worker lo rimette a posto, ma e' da misurare — non
  da promettere.

---

## 4. Scelte tecniche

Stanno in `docs/`, divise per chi le tocca. **Il perche' di ogni scelta e' li',
non qui**: questa e' solo la porta.

| File | Cosa contiene |
|---|---|
| [`docs/GIOCO.md`](docs/GIOCO.md) | griglia isometrica, costanti, layer e profondita' di disegno |
| [`docs/EDITOR.md`](docs/EDITOR.md) | strumenti, gesti, pannelli, salvataggio locale, editor d'immagine |
| [`docs/CONDIVISO.md`](docs/CONDIVISO.md) | catalogo degli sprite, formato dei livelli, fondali, taglia e scala, test |

Erano tutte qui dentro, ed erano mille righe: chi ne cercava una sola le
leggeva tutte.

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
| Il PNG e' la figura | `editor/SpriteImporter.ts` | `trimTransparent` fra maschera e riduzione: nitido e centrato anche ritagliando da un angolo |
| Posa sulla cella | `editor/CellPlacer.ts` | anteprima in grande, si trascina col dito; ospita taglia e nitidezza |
| Test | `test/`, `playwright.config.ts` | 132 test sul gioco che gira, in CI a ogni push |
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
- il PNG che e' la figura, sul caso storto vero — una figura piccola in un
  angolo di una foto: i pixel opachi passano dal 7% al **76%** del PNG, il lato
  lungo torna a essere quello chiesto, e il centro della figura coincide con
  quello del PNG invece di stargli a un quarto di distanza; un PNG di una foto
  quadrata prende le **proporzioni della figura**, non della foto
- la finestra "centra": si apre, **ospita** i due stepper — sono gli stessi
  elementi, non due copie, e alla chiusura tornano nel pannello — trascinare
  sposta lo sprite e ⌖ lo rimette al centro; **Annulla non lascia applicato**
  niente di cio' che si stava provando; alzarlo non cambia il nome del file,
  spostarlo di lato si' e la taglia scritta cresce; il tasto indietro chiude la
  finestra e **non** il pannello sotto
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
- **Il tetto di `test.yml` non e' ancora scattato.** La cache si': provata su
  due run di fila, la seconda la ritrova. Che il timeout tronchi davvero una run
  impiantata lo dira' solo la prossima volta che si impianta — cioe' si spera
  mai. Restano appese le tre run del 19 agosto: nessuno le ha cancellate, e non
  si cancellano da sole.
- **La prova col dito e' cominciata, e non e' finita.** Fabrizio ha usato
  l'editor su un telefono vero: ne e' uscito il difetto del PNG che non era la
  figura, corretto. Restano da provare con una mano tutto il resto — i gesti
  della scena, la selezione, e la finestra "centra" stessa, che e' nata da
  quella prova ma e' stata verificata col protocollo.
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
  CellPlacer.ts     la finestra "centra": lo sprite sulla cella, col dito
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
6. ~~Test automatici~~ — oggi 132, in CI a ogni push
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
14. ~~Un tetto al tempo di `test.yml`, e la cache del browser~~ — 15 minuti sul
    job, 5 sul passo che si e' impiantato tre volte, piu' `~/.cache/ms-playwright`
    con la chiave sulla versione di Playwright

### Da riprendere, in ordine

15. **Finire di provare l'editor con un dito vero.** La prima prova c'e' stata,
    e ha ripagato subito: ne e' uscito il PNG che non era la figura — sprite
    molli e fuori dalla loro cella — e la finestra "centra" che ne e' il rimedio.
    Restano da provare con una mano i gesti della scena, la selezione, il pizzico
    dentro la matita, e la finestra nuova, che e' nata da quella prova ma
    verificata col protocollo.
16. **Percorrere il giro completo di uno sprite importato**: scarica, commit,
    deploy, e ritrovarlo come blocco di build. E' l'unica prova che l'ibrido
    chiude il cerchio.
17. **Spezzare `LevelEditor.ts`**, sopra i 100 KB. Cassetto, importer, matita e
    sentinella sono nati fuori, ma il file non si e' ridotto.
18. **Arte dei blocchi ridisegnata a rombo** (vedi rischi) — lavoro di grafica.

### La pipeline nuova, in ordine di rischio crescente

Vanno fatti in questa sequenza perche' ognuno si puo' fermare senza rompere
quello prima: fino al 21 il gioco pubblicato oggi continua a funzionare
identico, e il 22 e' l'unico che non torna indietro da solo.

19. **Il Worker che serve il gioco**, al posto di Pages. Stesso gioco, stesso
    contenuto, indirizzo nuovo. Se qualcosa non torna, `deploy-web.yml` e'
    ancora li'.
20. **La porta verso il box**: `/assets/*` che legge in WebDAV, e il catalogo che
    unisce le tre sorgenti — repository, box, sessione. Il repository resta la
    riserva, quindi un box irraggiungibile non spegne niente.
21. **Access davanti al Worker**, con la lista degli indirizzi. E' il passo che
    rende privati insieme il gioco e gli sprite.
22. **La repository diventa privata**, e `deploy-web.yml` si spegne. Da qui in
    poi i minuti di Actions contano: e' il momento di guardare il conto.
23. **La Action dell'APK si scarica gli sprite dal box** prima di impacchettare.
24. **Salva scrive `level.json` sul box** — il rischio numero uno cade solo qui.

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
| **Tre servizi invece di uno** | Con la pipeline nuova il gioco cade se cade GitHub, **o** Cloudflare, **o** Hetzner. Oggi il punto di guasto e' uno solo. E' il prezzo di avere gli sprite fuori dal repository |
| **I minuti di Actions con la repo privata** | Su repository pubbliche sono illimitati, su private il piano gratuito ne da' 2000 al mese. `test.yml` gira a ogni push col suo tetto di 15 minuti: se stringe, la build del sito passa a Cloudflare |
| **Un APK e' la fotografia di un giorno** | Gli sprite ci finiscono dentro al momento della build. Chi lo ha installato non vede quelli aggiunti dopo, e non ha modo di accorgersene |
| **"Privato" vuol dire su invito, non invisibile** | Chi e' nella lista riceve gli sprite nel proprio browser: e' come funziona il web. La leva e' chi puo' aprire la pagina, non cosa le viene mandato |
| Un segreto in piu' da custodire | La password del box vive nel Worker e nei segreti delle Action. Conviene un sotto-account Hetzner limitato alla cartella del gioco, cosi' se sfugge non tocca il resto del box |
| Ciclo commit -> gioco live ~1 minuto | Accettato: e' il prezzo del vincolo "zero installazioni" |
