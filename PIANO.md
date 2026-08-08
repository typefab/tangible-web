# Piano di lavoro — Tangible Cushion

Documento di riferimento su scelte di architettura, stato e prossimi passi.
Ultimo aggiornamento: 8 agosto 2026.

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
  microStudio, non con repository esterni. **Aggiornamento 8 agosto 2026**: il
  progetto e' stato rilasciato open source (MIT) ed e' self-hostable. Resta
  escluso, ma per un motivo diverso da quello scritto sopra: ospitarlo richiede
  un server, cioe' viola il vincolo 1. Non e' piu' vero che sia un silo chiuso.
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

**Riesaminato l'8 agosto 2026**, cercando editor open source che girino nel
browser. Il risultato ha confermato la scelta, ma per una ragione piu' precisa
di prima:

| Candidato | Licenza | Isometrico | Perche' no |
|---|---|:---:|---|
| [blurymind/tilemap-editor](https://github.com/blurymind/tilemap-editor) | MIT | no | solo ortogonale; incorporabile, ma andrebbe convertito |
| [less-xx/tile-map-editor](https://github.com/less-xx/tile-map-editor) | open source | si | progetto minimo e fermo |
| [Pixelorama](https://orama-interactive.github.io/Pixelorama/) | MIT | si | e' un editor d'arte, non di livelli |
| [Sprite Fusion](https://www.spritefusion.com/editor) | gratuito, **non** open source | incerto | non ispezionabile |

Il candidato migliore, blurymind, e' stato copiato in `src/editor/vendor/` con
l'intenzione di convertirlo. Leggendone il codice la decisione e' stata
invertita: la proiezione cella→pixel non e' una funzione, e' scritta a mano in
**35 punti** del motore di disegno, e soprattutto adottarlo avrebbe lasciato
**due implementazioni della stessa geometria** da tenere allineate a mano.

Il nostro editor invece disegna attraverso `GameScene`: stessi sprite, stessa
`projection.ts`, stesso ordinamento in profondita'. Quello che si vede mentre
si costruisce e' il gioco vero, per costruzione e non per diligenza. Sono state
quindi portate le funzionalita' mancanti, non il codice. Il ragionamento
completo e' in `src/editor/vendor/tilemap-editor/MODIFICHE.md`.

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
| Editor di scene | `editor/LevelEditor.ts` | `?editor=1`, esporta `level.json`; palette con anteprime, quattro strumenti, annulla/rifai, trascinamento, zoom e spostamento della vista |

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
5. **Profondita' del player su scala sbagliata**: i blocchi usano
   `depthFor() = col + row` (valori 8-20), il player usava `this.sprite.y`
   (pixel, ~300). In piu' `setDepth` stava dopo l'early return di `update()`,
   quindi da fermo il player restava a depth 0 e spariva dietro ai blocchi fino
   al primo passo. Risolto con `depthForWorld()` sull'interfaccia della
   proiezione, cosi' chi non e' agganciato alla griglia entra nello stesso
   ordinamento senza duplicare la geometria.
6. **Anteprime della palette rotte**: si leggeva la `src` dell'immagine
   caricata, ma Phaser carica da un blob URL e lo **revoca** appena la texture
   e' pronta. Le immagini risultavano a `naturalWidth: 0`. Risolto con
   `textures.getBase64()`. Trovato solo guardando lo schermo: il typecheck non
   poteva vederlo.

### Verificato l'8 agosto 2026

Le tre voci che stavano qui sotto come "non verificato" sono state chiuse:

- **L'aspetto visivo e' stato visto.** Gioco ed editor sono stati pilotati in
  Chromium e guardati a schermo. Cio' che era stato scelto a tavolino e' stato
  confermato o corretto: il piazzamento, la portata, la rottura, l'inventario e
  la profondita' si comportano come previsto.
- **Le GitHub Actions completano.** L'avaria del 6 agosto e' rientrata; le run
  #4 e #5 di `deploy-web.yml` si sono concluse con `success` e il sito e'
  pubblicato. La sezione sull'avaria e' stata rimossa: non descrive piu' nulla
  di attuale.
- **La banda bianca in cima all'editor non esiste.** Compariva negli screenshot
  presi in Chromium headless; su browser reale non si vede. Era un artefatto di
  cattura, probabilmente legato al compositing dell'elemento `position: fixed`.
  Nessun codice e' stato modificato: canvas, renderer, viewport GL e camera
  misuravano gia' tutti la dimensione giusta.

### Non verificato

- **L'APK non e' mai stato prodotto.** Il workflow `build-apk.yml` non e' mai
  stato eseguito fino in fondo.
- **Nessuna prova su telefono vero.** Il joystick, le aree di tocco e la
  toolbar dell'editor sono stati verificati solo ridimensionando la finestra.

---

## 6. Struttura dei file, prossima

Oggi `public/assets/` e' un mucchio piatto di 54 file con nomi come
`NewSprite10.png`. Struttura proposta:

```
src/assets/
  blocks/        dirt.png, stone.png…
  characters/    player.png
  ui/            joystick-border.png, inventory-slot.png
  props/
public/data/
  level.json     <- prodotto dall'editor
```

Due regole: **la cartella decide la categoria, il nome del file decide l'id.**

Motivo tecnico per cui va in `src/` e non in `public/`: una pagina web non puo'
elencare il contenuto di una cartella. Da `public/` l'editor non saprebbe cosa
c'e' dentro e servirebbe un elenco scritto a mano; da `src/` Vite genera
l'elenco al momento della build. Cosi' **si carica un PNG, si fa commit, e
compare nell'editor** senza modifiche al codice. Prezzo: serve una build, cioe'
il tempo del deploy.

---

## 7. Prossimi passi

1. **Ristrutturazione cartelle + rinomina dei 54 file** — sblocca il resto, ed
   e' ora il vero collo di bottiglia: finche' gli sprite si chiamano
   `NewSprite10.png`, la palette non puo' crescere oltre i due blocchi attuali
2. **Produrre il primo APK** — il deploy web e' verificato, l'APK no
3. **Arte dei blocchi ridisegnata a rombo** (vedi rischi)
4. **Prova su telefono vero** — joystick, aree di tocco, toolbar dell'editor
5. **Selezione e spostamento di gruppi di blocchi nell'editor** — la
   cancellazione c'e' gia' (gomma), manca lo spostare un pezzo di scena

Fatti, non piu' in lista: pannello sprite con miniature e pennello (la palette
mostra le anteprime e il pennello dipinge trascinando); verifica del deploy web.

---

## 8. Rischi aperti

| Rischio | Note |
|---|---|
| **L'arte non e' isometrica** | `Block_0` e' una cassa frontale. Su griglia a rombi le facce non combaciano: va ridisegnata. E' lavoro di grafica, ed e' il rischio aperto piu' grosso |
| **Lo sprite del player e' un fuscello** | `PLAYER.width` deriva dal rapporto della sorgente (`317/788`), quindi il personaggio e' 26x64 px: a schermo e' sottile e quasi invisibile. Si risolve con uno sprite meno allungato o slegando `width` dal rapporto — e' una scelta estetica |
| L'APK non e' mai stato prodotto | Il deploy web e' verificato, la catena Capacitor no |
| Nessuna prova su telefono vero | Tutto verificato ridimensionando la finestra del desktop |
| 92 KB di codice altrui inutilizzato in `src/` | La copia di blurymind serve solo da consultazione. Se passeranno alcune iterazioni senza aprirla, va tolta: un sorgente che non gira fa credere che serva |
| Ciclo commit -> gioco live ~1 minuto | Accettato: e' il prezzo del vincolo "zero installazioni" |

Chiusi: *aspetto visivo mai visto* (gioco ed editor guardati a schermo l'8
agosto), *le Actions non hanno mai completato* (run #4 e #5 verdi), *l'editor e'
troppo spartano* (strumenti, annulla, trascinamento e zoom).
