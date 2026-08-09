# Piano di lavoro — Tangible Cushion

Documento di riferimento su scelte di architettura, stato e prossimi passi.
Ultimo aggiornamento: 9 agosto 2026.

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

### Collisioni: i conti si fanno in spazio di cella

Far collidere il personaggio contro un rombo vorrebbe dire ritagliare poligoni.
Ma `projection.toCellSpace()` — la versione non arrotondata di `worldToCell` —
porta il mondo in uno spazio dove **ogni cella e' il quadrato unitario**: li' i
muri sono le rette `col = intero` e `row = intero`, e la collisione torna a
essere quella classica rettangolo-contro-griglia.

Ne segue che separare il movimento sui due assi `col` e `row` non e'
un'approssimazione ma la cosa esatta: le facce dei blocchi sono perpendicolari
a quegli assi. E' quello che produce lo scivolamento lungo il muro invece
dell'incastro nell'angolo.

Due conseguenze pratiche:

- `GridCollision` riceve un predicato `isSolid`, non i blocchi: si prova senza
  schermo e senza Phaser. La scena gli passa `placement.isOccupied`, letto dal
  vivo, quindi **non esiste una mappa di collisione da tenere allineata** —
  un blocco piazzato ferma subito, uno rotto libera subito.
- L'ingombro del personaggio e' in unita' di cella (`PLAYER.colliderRadius`,
  0.3), non in pixel. Deve restare sotto 0.5, altrimenti non passa in un varco
  di una cella sola.

La regola "se sei gia' dentro un blocco, passi" e' voluta: senza, chi si
ritrova un blocco addosso resterebbe murato per sempre.

### La camera che insegue

Tre regolazioni, tutte per lo stesso scopo — che l'inseguimento **non si
noti**: un riquadro morto al centro (camminare avanti e indietro di poco non
muove affatto la vista), un ritardo nel recupero (`lerp`, altrimenti ogni
passo scuote lo schermo) e `roundPixels` (su pixel art una camera a
coordinate frazionarie fa tremolare i bordi di ogni sprite).

Una camera che insegue tira dietro due conseguenze, senza le quali la cosa
resta mezza rotta:

1. **Il mondo ha un bordo.** Prima si vedeva sempre e solo la griglia
   disegnata; ora seguendo il personaggio si inquadrerebbe il vuoto oltre.
   I limiti della camera si ricavano da `gridBounds()`, che passa dai
   perimetri veri delle celle e quindi vale per qualsiasi proiezione. E il
   personaggio non deve poterci uscire: si e' ottenuto **senza codice nuovo**,
   dichiarando solide le celle fuori griglia nello stesso predicato che
   gia' risponde per i blocchi.
2. **La comparsa non puo' piu' essere "il centro dello schermo".** Con la
   camera ferma quel punto era anche il centro del mondo; ora dipendeva dalla
   dimensione dello schermo, e su telefono si compariva in una cella diversa
   che su desktop (verificato: prima (6,15) contro (10,8)). Si parte invece
   dal baricentro dei blocchi del livello, cosi' la prima inquadratura mostra
   quello che e' stato costruito.

Nota misurata: la griglia 25x25 in isometrica e' **1728x864 px**, cioe' larga
e bassa. Su un desktop 1100x700 restano 628px di scorrimento orizzontale ma
solo 164 verticali, e su telefono 375x812 il verticale e' praticamente nullo.
Se serve piu' respiro e' `GRID.drawTo`.

### Costanti

Le costanti di gioco stanno in `src/config.ts`, portate 1:1 dalla tabella di
`gdevelop_repository/CLAUDE.md`: break 1,5s, cooldown 100ms, portata 224px,
oscillazione `sin(t*18)*10` gradi, 8 slot di inventario.

---

## 5. Stato attuale

### Fatto e verificato

| Componente | File | Note |
|---|---|---|
| Piazzamento e rottura su griglia | `mechanics/GridPlacement.ts` | cooldown, break progressivo, callback di raccolta |
| Proiezione isometrica | `grid/projection.ts` | ortogonale disponibile come alternativa |
| Player | `mechanics/Player.ts` | sprite dal progetto GDevelop, origine ai piedi |
| Collisioni con i blocchi | `mechanics/GridCollision.ts` | conti in spazio di cella, scivolamento sui muri, mai murati |
| Camera che insegue | `scenes/GameScene.ts` | riquadro morto, ritardo, limiti sulla griglia; non tocca l'editor |
| Indice degli sprite | `assets/registry.ts` | cartella = categoria, nome file = id; un PNG basta |
| Joystick virtuale | `mechanics/VirtualJoystick.ts` | multitouch, sprite `Transparent dark` |
| Inventario 8 slot | `mechanics/Inventory.ts` | solo stato e regole, testabile senza schermo |
| Barra inventario | `ui/InventoryBar.ts` | segnaposto se manca lo sprite, si adatta a schermi stretti |
| Editor di scene | `editor/LevelEditor.ts` | `?editor=1`, esporta `level.json` |

Test principali superati:

- inversa isometrica: **0 errori su 8000 punti campionati** con test di
  punto-in-poligono; round-trip sui centri: 0 errori su 625 celle
- bilancio inventario chiuso: 20 -> piazza -> 19 -> tentativi bloccati che non
  consumano -> rompi -> 20
- rottura: progresso 0.5 a 750ms, oscillazione 8.04 gradi, distruzione a 1500ms
- cooldown: 99ms rifiutato, 101ms accettato
- movimento: 190px in 1s, -95px in 0.5s
- joystick: deadzone, diagonale normalizzata a 0.71, pollice clampato a 56px,
  secondo dito che non ruba il controllo
- nessuna sovrapposizione barra/joystick a 375x812 (48px di margine)
- la build passa su Linux: `npm ci`, `npm run build`, upload artefatto

Collisioni — 18 prove headless sulla logica (isometrica **e** ortogonale):

- round-trip mondo -> cella -> mondo: errore massimo `2e-13` su 20.000 punti;
  `worldToCell` coincide con il `floor` di `toCellSpace` su tutti
- muro: 600 frame di spinta contro la parete, mai un frame dentro il blocco;
  si ferma a `col = 4.6999`, cioe' appoggiato alla faccia meno lo spessore
- diagonale contro il muro: l'asse bloccato si ferma, quello libero avanza
  tutto (`row` fa esattamente i suoi 0.2)
- varco di una cella sola: ci passa
- gia' dentro un blocco: esce, non resta murato
- labirinto di 300 blocchi, 20.000 passi casuali: **0 violazioni**

E 7 prove pilotando il gioco vero in Chromium:

- il game loop gira (34 frame), nessun errore in console
- comparsa: con `level.json` caricato il centro schermo cade dentro il blocco
  (10,8); `findFreeSpot` sposta il personaggio su (9,7), libero
- scatola chiusa di 16 blocchi, spinta in 8 direzioni per 400 frame l'una:
  non ne esce e non entra mai in un blocco
- muro lungo: non lo attraversa e ci scivola lungo per 280px
- rotto il muro, la stessa camminata avanza di 10 celle in piu'

Camera — 17 prove nel browser, su desktop 1100x700, telefono 375x812 e editor:

- inseguimento attivo, riquadro morto 200x140
- comparsa su (5,7), cella libera accanto al baricentro dei blocchi (5.8, 6.3),
  e **identica sulle due dimensioni di schermo**
- camminata di 900 frame verso est: `scrollX` da -134 a 244, che e' esattamente
  il limite della griglia
- camminata di 900 frame verso sud: arriva al limite verticale (180), perche'
  la griglia isometrica e' bassa
- su 1800 frame: **0 frame con la camera fuori dai limiti, 0 col personaggio
  fuori dall'inquadratura**
- il bordo della griglia ferma il personaggio in tutte e 8 le direzioni
- in `?editor=1` nessun inseguimento: la vista spostata a mano resta dov'e'
- nessun errore in console (resta solo il 404 di `/favicon.ico`, cosmetico)

Indice degli sprite — 15 prove nel browser, in sviluppo **e sulla build di
produzione** (dove Vite incorpora i file piccoli come data URI e rinomina gli
altri con l'impronta: e' un comportamento diverso, e va provato a parte):

- 28 sprite indicizzati, tutti caricati, nessuna texture rotta
- chiavi tutte nella forma `categoria/nome`; niente da `_da-classificare/`
- `level.json` migrato carica i suoi 10 blocchi coi nuovi id
- `orange.png`, aggiunto alla cartella e basta, **e' diventato un blocco vero**:
  compare in palette con etichetta "Orange" e nell'inventario di partenza
- un tipo di blocco inesistente viene saltato con un avviso, gli altri passano:
  nessun crash se rinomini un PNG citato da un livello gia' scritto
- in produzione: nessun errore, nessuna risorsa mancante, e lo screenshot
  mostra una scena vera (769 colori, il piu' diffuso copre l'83%)

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

### Il gioco visto sullo schermo (8 agosto 2026)

L'aspetto visivo era il grande non verificato: il game loop non girava nel
pannello browser usato prima. Pilotando Chromium il loop gira, e per la prima
volta si e' guardato lo schermo. Cosa si vede:

- la griglia a rombi, il joystick e la barra a 8 slot con le anteprime dei
  blocchi sono al loro posto, senza sovrapposizioni a 1100x700
- **conferma del rischio noto: l'arte non e' isometrica.** I blocchi sono
  casse frontali quadrate su una griglia a rombi. Non combaciano tra loro e
  non seguono la diagonale delle celle: una fila di blocchi si legge come una
  scala di quadrati staccati, non come un muro. E' lavoro di grafica
- **il personaggio e' troppo piccolo e troppo scuro** per leggersi sul fondo
  `#1b1b22`: 26x64px, quasi invisibile accanto ai blocchi da 64px. Da decidere
  se e' la scala (`PLAYER.height`, oggi due celle) o lo sprite

### Non verificato

- **Le GitHub Actions non hanno mai completato una run.** Il job `build` ha
  eseguito tutti i 15 step con successo, ma la pubblicazione non e' mai
  avvenuta a causa dell'avaria (vedi sotto).
- **L'APK non e' mai stato prodotto.**

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

## 6. Struttura degli sprite

Fatta il 9 agosto 2026. Prima `public/assets/` era un mucchio piatto di 56 file
con nomi come `NewSprite10.png` e `Transparent dark joystick border2.png`.

```
src/assets/
  blocks/        basic.png  stack.png  orange.png
  characters/    warrior.png  mage.png
  props/         shop-building.png
  backgrounds/   marble-diamond-tiles.jpg  wood-panel.jpg
  ui/buttons/    menu.png  triangle-1..3.png
  ui/joystick/   {flat,line,shaded,transparent}-{dark,light}-{border,thumb}.png
  _da-classificare/   quello che non si sa ancora cosa sia
```

Due regole, e nient'altro: **la cartella decide la categoria, il nome del file
decide l'id.** Un PNG lasciato cadere in `blocks/` diventa un blocco vero, in
palette e piazzabile, senza toccare codice. Le cartelle che iniziano con `_`
restano fuori dall'indice.

Il motivo tecnico per cui stanno in `src/` e non in `public/`: una pagina web
non puo' elencare una cartella. Da `public/` servirebbe un elenco scritto a
mano — cioe' il lavoro che questa struttura elimina. Da `src/` lo genera Vite
in build (`assets/registry.ts`). Prezzo: serve una build, il tempo del deploy.

Cosa e' cambiato nel codice:

- `assets/registry.ts` indicizza tutto con `import.meta.glob`; la chiave Phaser
  e' `categoria/nome`, unica per costruzione
- `assets/blocks.ts` ne ricava il catalogo dei blocchi. Sta in un file a parte
  perche' `import.meta.glob` e' roba di Vite: tenerlo fuori da `config.ts`
  lascia quel file importabile da Node puro, che e' cio' che permette di
  provare griglia e collisioni senza schermo
- `BlockType` non e' piu' un'unione chiusa ma `string`: l'elenco vive nella
  cartella, il compilatore non puo' conoscerlo
- `level.json` migrato: `block_0` -> `basic`, `block_1` -> `stack`

**18 file su 56 erano duplicati esatti** pixel-per-pixel: tutte le 16 coppie
`X`/`X2` del pack joystick, piu' `Menu`/`Menu2` e `NewSprite8`/`NewSprite9`.
Eliminati; git ne conserva la storia. Restano 38 file, 28 indicizzati.

## 7. Prossimi passi

1. ~~Ristrutturazione cartelle + rinomina~~ — **fatta** (sezione 6)
2. **Arte del blocco isometrico** — e' il collo di bottiglia: finche' i blocchi
   sono segnaposto wireframe, il gioco ha l'aspetto di uno scheletro. Lavoro
   di grafica, non di codice
3. **Personaggio leggibile**: `characters/warrior.png` e' 317x788, altissimo e
   scuro, quasi invisibile in scena. `characters/mage.png` (229x316) ha
   proporzioni migliori. Basta cambiare `PLAYER.texture`
4. Classificare i 10 file in `_da-classificare/`
5. Quando GitHub rientra: verificare deploy web e produrre il primo APK

---

## 8. Rischi aperti

| Rischio | Note |
|---|---|
| **L'arte non e' isometrica** | **Confermato guardandolo** l'8 agosto: `Block_0` e' una cassa frontale, su griglia a rombi le facce non combaciano e una fila si legge come quadrati staccati. Va ridisegnata: e' lavoro di grafica |
| **Il personaggio non si legge** | Visto sullo schermo: 26x64px scuri su fondo scuro, quasi invisibile accanto ai blocchi. Scala o sprite, da decidere |
| Joystick e dimensione blocchi a tavolino | Visti a 1100x700 e plausibili, ma mai provati sul telefono vero |
| Le Actions non hanno mai completato | La build passa, la pubblicazione no. Da riverificare a guasto risolto |
| L'editor risulta troppo spartano | Cresce a richiesta |
| Ciclo commit -> gioco live ~1 minuto | Accettato: e' il prezzo del vincolo "zero installazioni" |
