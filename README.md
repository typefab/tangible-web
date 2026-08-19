# Tangible Cushion — prototipo web

Prototipo per validare un workflow di sviluppo **interamente online**, dove il
repository GitHub e' il ponte tra chi cura grafica e livelli (tu) e chi scrive
le meccaniche (l'LLM).

## Perche' non un engine con editor visuale

Il vincolo "zero installazioni + GitHub come ponte" esclude gli engine con
editor nel browser: microStudio, Construct 3 e l'editor web di GDevelop
salvano i progetti nel proprio cloud e non sanno leggere o scrivere su un
repository GitHub. L'unica integrazione git documentata per GDevelop passa da
GitHub Desktop, cioe' da un'installazione locale.

La soluzione e' rovesciare l'assunto: **il repository non e' la copia del
progetto, e' il progetto.** L'engine (Phaser) e' una libreria dentro il repo,
non un'applicazione da cui esportare. Cosi' non esiste nessun silo da cui
sincronizzare.

## Il ciclo di lavoro

```
 TU (browser)                        GITHUB                    IO
 ─────────────                       ──────                    ──
 sprite: piskelapp.com      ┐
 livelli: spritefusion.com  ├──> upload drag&drop ──> repo <── Claude Code
 (esporta Tiled JSON)       ┘                          │        (codice)
                                                       │
                                    GitHub Actions <───┘
                                     ├── Pages ──> giochi al link, anche da telefono
                                     └── APK ────> lo installi sul telefono
```

Nessuno dei due tocca il lavoro dell'altro: tu i file in `public/`, io i file
in `src/`.

## Come ci giochi

**Sul web.** Ogni push su `main` fa partire `deploy-web.yml`, che pubblica su
GitHub Pages. Il gioco diventa raggiungibile a
`https://<utente>.github.io/<repo>/` — apribile anche dal telefono.
Da abilitare una volta sola: *Settings → Pages → Source: GitHub Actions*.

**Come APK.** Vai nella tab *Actions* → *Build APK* → *Run workflow*. A fine
build l'APK e' negli *Artifacts* della run. Sul telefono va autorizzata
l'installazione da origini sconosciute (e' un APK debug, non firmato).

## L'editor di scene

Aggiungi **`?editor=1`** all'URL del gioco:

```
https://<utente>.github.io/<repo>/?editor=1
```

Gira sulla stessa pagina, senza installare niente e senza servizi esterni.

**Muoversi nella scena**

- **due dita**: trascina per spostarti, allarga o stringi per ingrandire.
  Funziona sempre, qualunque strumento sia attivo
- **un dito** fa quello che dice lo strumento. Per spostarti con un dito solo
  c'e' **✋ Sposta** (`H`)
- appoggiando il secondo dito, il tratto appena iniziato dal primo viene
  annullato: non resti con un blocco piazzato dove hai poggiato la mano
- **⤢** riporta la vista al centro della griglia
- **il tasto indietro del telefono chiude, non esce**: chiude il pannello che
  hai aperto — matita, importa sprite, cassetto, catalogo dei livelli, il foglio
  ⋯ — e solo quando non c'e' piu' niente da chiudere ti chiede se vuoi chiudere
  la scheda

**Disegnare**

- la fila in alto nella barra sono gli **sprite usati di recente**: il piu'
  recente per primo, cosi' quelli su cui torni di continuo sono a un tocco
- il catalogo intero sta nel **cassetto 🎨**, in alto a sinistra: gli sprite
  divisi per categoria, piu' quelli gia' usati in questo livello. Da li' si
  importa anche uno sprite nuovo — vedi "Fare uno sprite da un'immagine"
- **🖌 Pennello** (`B`) piazza, anche trascinando; **🧽 Gomma** (`E`) cancella.
  Con un'area selezionata questi due agiscono sull'area — vedi sotto
- **tieni premuto su un blocco** per riprendere il suo tipo, senza cercarlo nel
  cassetto: mezzo secondo e diventa quello scelto, va in cima ai recenti e il
  suo pulsante lampeggia per dirtelo. Se stavi dipingendo, quella pennellata viene disfatta — stavi
  indicando quel blocco, non coprendolo. Da computer c'e' anche **Alt+clic**
- **↶ / ↷** annullano e rifanno (`Ctrl+Z`, `Ctrl+Shift+Z`); un trascinamento
  intero conta come un solo passo
- **Griglia: on/off** nasconde le linee per guardare la scena pulita; lo snap
  resta comunque attivo
- **▶ Gioca** esce dall'editor

Il tocco lungo vale con **pennello e gomma**. Con ✋ e con la selezione no: li'
tenere fermo il dito vuol gia' dire "sto per trascinare".

**Selezionare un'area** — **⬚ Seleziona** (`S`)

Trascini dal punto dove appoggi il dito, il rettangolo si allarga seguendoti, e
al rilascio resta selezionata l'area che ci e' finita dentro. Come in GDevelop.

**La selezione e' un'area di celle, non un insieme di blocchi**: prende anche le
celle vuote, ed e' quello che ti permette di riempirle.

Con un'area selezionata i due strumenti cambiano mestiere, e te lo dicono:

| Pulsante | Cosa fa |
|---|---|
| **🖌 Riempi area** | mette il blocco scelto in **tutte** le celle dell'area, coprendo quello che c'era |
| **🧽 Svuota area** | toglie tutto quello che c'e' nell'area |

Poi:

- **trascina dentro la selezione** per spostare i blocchi, di cella in cella
- **⧉ Copia** (`Ctrl+C`), **✂ Taglia** (`Ctrl+X`), **📥 Incolla** (`Ctrl+V`)
- **🗑** o `Canc` svuota l'area, che pero' **resta selezionata**: dopo aver
  svuotato quasi sempre vuoi riempire con altro
- `Esc` libera la selezione, e i pulsanti tornano a essere strumenti

L'incolla atterra **sotto il puntatore**, sul layer attivo, e quello che arriva
resta selezionato: puoi trascinarlo subito dove vuoi. Gli appunti sopravvivono al
cambio di scheda, quindi si copia un pezzo di livello dentro un altro — ma non a
una ricarica della pagina.

Vale sul layer attivo e solo su quello, come il pennello. Il rettangolo e' una
figura sullo schermo: su griglia isometrica copre un rombo di celle, quindi
prende quello che ci vedi dentro, non un blocco di righe e colonne.

**I layer**

Il pannello in alto a destra elenca i piani, come i layer di GDevelop. Il layer
in cima all'elenco e' quello disegnato davanti.

- **tocca il nome** per renderlo attivo: si disegna **solo** sul layer attivo
- `[` e `]` cambiano piano da tastiera
- **👁** accende e spegne un layer, e la scelta **tiene**: un layer nascosto
  resta nascosto anche se lo selezioni. L'unico modo di rivederlo e' l'occhio
- **↑n** e' la **quota**: `↑0` e' un piano piatto, sovrapposto in loco — cioe' il
  layer di GDevelop. Da `↑1` in su il piano si alza di una cella, e ci costruisci
  **sopra** al piano di sotto
- **+** aggiunge un piano (max 8), **▲ ▼** lo riordinano, **✎** lo rinomina,
  **🗑** lo elimina con i suoi blocchi

**Mettere un'immagine di sfondo** — **🖼 Fondale** (`F`)

- la palette cambia e mostra le **immagini** invece dei blocchi
- **tocca la scena** per metterne una li'. Toccarne una gia' messa la prende,
  invece di metterne un'altra sopra
- **trascina** per spostarla

Il resto sta nel **pannello in alto a destra**, che si apre da solo quando
scegli lo strumento: sotto ai layer c'e' la sezione **Fondali**, con l'elenco di
quelli del livello. Tocca un nome per scegliere su quale lavorare, poi:

| | |
|---|---|
| **－ ＋** | rimpicciolisce e ingrandisce |
| **↺ ↻** | ruota di 15 gradi per volta |
| **⤓ ⤒** | ordine fra due immagini che si sovrappongono |
| **🗑** | la toglie (`Canc` uguale, `Esc` la molla) |

**Per metterne un secondo usa il + della sezione**: un fondale grande copre
quasi tutto lo schermo, e da li' in poi toccare la scena prende quello invece di
aggiungerne un altro. Il **+** lo mette al centro di quello che stai guardando.

I fondali stanno **dietro a tutto**, anche dietro alla griglia, e appartengono
al livello: ogni livello ha i suoi. Non sono blocchi, quindi pennello, gomma e
selezione non li toccano.

Per aggiungerne di nuovi: carica un'immagine in **`src/assets/backgrounds/`** e
fai commit — stessa promessa dei blocchi, compare da sola nella palette. Vanno
bene `png`, `jpg` e `webp`.

**Il formato conta piu' della dimensione.** Il PNG e' senza perdita: comprime
benissimo le tinte piatte e malissimo il dettaglio fine. Misurato, stessa
immagine 1920x1080:

| Contenuto | In PNG |
|---|---|
| disegno piatto, poche tinte | **9 kB** |
| immagine fotografica | **2193 kB** |

Per confronto, tutto il gioco pubblicato oggi pesa 4504 kB, Phaser compreso.
Quindi: **pixel art e tinte piatte, o serve la trasparenza → PNG. Dipinti, foto,
cieli sfumati → JPG o WebP**, che stanno in una frazione. Ogni persona che apre
il link scarica quello che carichi, e finisce anche nell'APK.

**I livelli**

Un solo `level.json` li contiene tutti, anche cento. Due cose diverse:

| | Cos'e' | Dove |
|---|---|---|
| **Catalogo** | tutti i livelli del progetto | **📚** in alto a sinistra |
| **Schede** | quelli aperti adesso | la barra in cima |

- **📚** apre l'elenco: cerchi per nome, tocchi un livello e si apre in una
  scheda. Da li' anche **+ Nuovo livello**, e per ogni riga **✎** rinomina,
  **⧉** duplica, **🗑** elimina (si recupera con `Ctrl+Z`)
- **✕ su una scheda la chiude, e non elimina niente**: il livello resta
  nell'elenco. Le schede sono i due o tre fra cui stai andando avanti e
  indietro, non tutto quello che hai costruito
- una scheda resta sempre aperta: la scena disegna sempre un livello
- in gioco si sceglie con l'URL: `?level=2` oppure `?level=Caverna`. Senza, si
  gioca il primo

**Salvare**

Due cose diverse, e conviene tenerle distinte:

| | Cosa fa | Quando |
|---|---|---|
| **💾 Salva** (`Ctrl+S`) | salva **in questo browser** | mentre lavori |
| **⬇ Scarica** | scarica `level.json` | quando vuoi portarlo nel gioco |

Su telefono questi due, insieme a **📂 Apri**, **📋 Copia**, **Griglia** e
**▶ Gioca**, stanno dietro **⋯**: sono comandi da una volta a serata, e tenerli
sempre in vista costava un terzo dello schermo. Se **⋯** ha un pallino giallo,
c'e' lavoro non salvato la' dentro. Su schermo largo sono tutti in barra.

L'editor salva da solo mentre costruisci, ma **non decide mai da solo cosa
tenere**. Se chiudi senza salvare e riapri, ti chiede: *riprendi* il lavoro
locale, oppure *ricomincia* dal `level.json` pubblicato. Finche' non rispondi
non tocca niente.

**📂 Apri** legge un `level.json` che hai gia' sul telefono e lo mette al posto
del progetto aperto — utile per riprendere il lavoro di qualcun altro senza
aspettare un deploy. Si annulla con `Ctrl+Z` come tutto il resto.

Il file scaricato va caricato in `public/level.json` dalla UI web di GitHub
(`Add file` -> `Upload files`, e **ricordati il pulsante verde `Commit changes`**
in fondo alla pagina). Finche' non fai questo, il lavoro sta solo sul tuo
telefono: **💾 Salva non basta a farlo vedere nel gioco.**

In editor non c'e' il personaggio: si costruisce ovunque, senza il vincolo di
portata.

## Cosa tocchi tu

| File | Cosa contiene |
|---|---|
| `src/assets/blocks/**/*.png` | I blocchi piazzabili. **Il nome del file e' l'id**: `dirt.png` diventa il blocco "Dirt"; la sottocartella e' la sua categoria nel cassetto. |
| `src/assets/characters/`, `src/assets/ui/` | Personaggio e pezzi di interfaccia. Qui i nomi contano: li cerca il codice. |
| `public/level.json` | Tutti i livelli, coi loro layer e blocchi. Prodotto dall'editor. |
| `public/assets/*.png` | Archivio degli sprite del progetto GDevelop. Non lo usa nessuno: e' li' perche' non si buttano via i disegni. |

### Aggiungere un blocco nuovo

Carichi il PNG in **`src/assets/blocks/`** dalla UI web di GitHub e fai commit.
Fine: compare nel cassetto dell'editor con la sua anteprima, e' piazzabile, ed
entra nell'inventario del gioco. Nessuna riga di codice da toccare — l'elenco
degli sprite lo genera Vite leggendo la cartella durante la build.

**Il nome del file può dire quanto è largo.** `albero@2.png` è largo **due
celle**; senza suffisso è largo una. Il `@2` **non fa parte del nome del blocco**:
se domani lo rifai `albero@3.png` è sempre lo stesso `albero`, e i livelli che lo
usano continuano a funzionare — cambia solo quanto è grande. Serve perché il
gioco riporta ogni blocco alla larghezza della cella: è questa la leva per avere
oggetti di dimensioni diverse, non un PNG più grande.

**Le sottocartelle sono le categorie del cassetto.** Un PNG in
`src/assets/blocks/natura/` finisce sotto "natura"; uno lasciato direttamente in
`blocks/` finisce in "Generale" e funziona come prima. Non sei obbligato a
ordinare niente: le cartelle servono quando gli sprite diventano tanti.

Il prezzo e' che serve una build, cioe' il minuto del deploy: fino ad allora il
blocco non c'e'. E' anche il motivo per cui gli sprite stanno in `src/` e non in
`public/`: una pagina web non puo' elencare il contenuto di una cartella remota,
quindi da `public/` servirebbe un elenco scritto a mano.

### Fare uno sprite da un'immagine

Nel cassetto **🎨 → Aggiungi sprite**. Si apre un editor d'immagine che gira
dentro la pagina, quindi funziona anche dal telefono:

1. **Carica un'immagine** — galleria, fotocamera o file, quello che ti offre il
   telefono.
2. **Togli lo sfondo.** Guarda i quattro angoli, li considera sfondo, e cancella
   tutto quello che gli somiglia partendo dai bordi. La **tolleranza** dice
   quanto "somigliante" basta: se resta un alone alzala, se sparisce un pezzo
   della figura abbassala. La scacchiera dietro l'anteprima ti fa vedere dov'e'
   diventato trasparente.
3. **💧 Indica lo sfondo**, quando gli angoli non bastano. Se la figura tocca un
   angolo, l'automatico scambia il suo colore per sfondo e te la mangia: premi
   il pulsante e **tocca l'anteprima dove c'e' lo sfondo**. Da quel momento il
   riferimento e' quel colore soltanto, e il punto che hai toccato viene tolto
   anche se e' chiuso dentro la figura — il vuoto nel manico di una tazza. Il
   quadratino accanto mostra il colore preso; **↺** torna agli angoli.
4. **Scegli il lato in pixel** — a mano o con le frecce **−** e **+**. E' solo
   la **nitidezza**: il gioco riporta comunque ogni blocco alla larghezza della
   cella, quindi un PNG piu' grande non fa un oggetto piu' grande.
5. **Largo (celle)** e **Appoggio sulla cella** decidono quanto sara' grande
   davvero e dove poggia. L'anteprima **"come starà sulla griglia"** te lo
   mostra sul rombo mentre lo regoli.
6. **✏️ Ritaglia a mano**, se serve:
   - **🩹 Gomma** cancella dove passi, **↩ Ripristina** riporta indietro;
   - **✂ Lazo** traccia un contorno e tiene **solo quello che ci sta dentro**: e'
     la via rapida per una sagoma complicata;
   - **✋ Sposta** trascina l'immagine, **− +** ingrandiscono e **⤢** rimette
     tutto nel riquadro. Da telefono funziona anche il **pizzico a due dita**;
   - **↶ Annulla** toglie l'ultimo tratto.

   Il ritaglio **resta** anche se dopo cambi tolleranza o lato in pixel: non e'
   un'immagine congelata, e' una maschera che l'editor riapplica ogni volta.

Poi due pulsanti, e **fanno due cose diverse**:

| | Cosa fa | Quanto dura |
|---|---|---|
| **Aggiungi al livello** | lo puoi piazzare subito | **fino alla ricarica**, e solo su questo browser |
| **Scarica PNG** | ti da' il file da caricare su GitHub | per sempre, e per tutti |

Per tenere davvero uno sprite devi **scaricarlo e committarlo** in
`src/assets/blocks/<categoria>/`: il pannello ti scrive il percorso esatto. E'
lo stesso motivo di sempre — l'editor gira su una pagina statica e non puo'
scrivere nel repository. Finche' non fai commit, un livello che usa quello
sprite mostra un buco a chiunque altro lo apra.

## Cosa tocco io

| File | Cosa contiene |
|---|---|
| `CLAUDE.md` | Le istruzioni per chi scrive il codice: confini, invarianti, comandi. |
| `src/config.ts` | Le costanti di gioco. |
| `src/assets/catalog.ts` | L'elenco degli sprite, generato dal contenuto delle cartelle. |
| `src/grid/` | La geometria della griglia, isolata dietro un'interfaccia. |
| `src/mechanics/` | Le meccaniche. Una classe per meccanica, autonoma e testabile. |
| `src/ui/` | Barra dell'inventario e altri elementi di interfaccia. |
| `src/scenes/` | Montaggio della scena e input. |

## Cosa e' gia' implementato e verificato

- **Griglia isometrica a rombi** 2:1 (64x32), con la geometria isolata in
  `src/grid/projection.ts`: cambiarla significa cambiare una riga
- Piazzamento su cella libera, con cooldown di 100 ms
- Rottura tenendo premuto 1,5 s, con oscillazione `sin(t * 18) * 10` gradi
- **Player** con movimento da joystick virtuale (multitouch) o WASD
- **Portata di piazzamento** 224px: la cella diventa rossa se troppo lontana
- **Inventario a 8 slot**: rompere restituisce il blocco, piazzare lo consuma
- Caricamento della disposizione iniziale da `level.json`
- Profondita' `col + row`, corretta per l'isometrica
- **Catalogo degli sprite generato dalle cartelle**: un PNG caricato in
  `src/assets/blocks/` compare da solo nel cassetto e nell'inventario, e la
  sottocartella in cui lo metti diventa la sua categoria
- **Cassetto degli sprite** diviso per categoria, con quelli gia' usati nel
  livello a portata; in basso restano gli **usati di recente**
- **Sprite fatti da un'immagine, dentro il browser**: togli sfondo, riduci a
  pixel-art, ritaglia a mano i bordi. Usabile subito nella sessione, permanente
  quando committi il PNG
- **Layer** con nome, visibilita' e quota: si costruisce anche in verticale, e
  in gioco il tocco prende sempre il blocco piu' in alto
- **Piu' livelli in un file solo**, con `?level=` in gioco. Nell'editor un
  catalogo con ricerca, e le schede solo per quelli aperti: regge a cento livelli
- **Salvataggio locale con conferma**: l'editor ricorda, ma chiede sempre prima
  di ripristinare
- **Selezione a rettangolo** come area: riempimento, svuotamento, spostamento,
  copia/taglia/incolla anche fra schede
- **Due dita** per spostarsi e ingrandire, in qualsiasi strumento
- **Contagocce**: tieni premuto un blocco e il suo tipo torna in mano
- **Fondali**: immagini dietro la scena, una per livello o quante ne vuoi,
  spostabili e ridimensionabili
- **Il tasto indietro non chiude la scheda per sbaglio**: prima chiude il
  pannello aperto, poi chiede conferma — e se hai lavoro non salvato te lo dice
- **Barra pensata per il telefono**: i comandi rari stanno dietro **⋯**, e alla
  scena resta piu' di due terzi dello schermo

Dettagli, verifiche e rischi aperti stanno in [PIANO.md](PIANO.md).

## Sviluppo locale (facoltativo — non serve per il workflow online)

```bash
npm install && npm run dev
```

### Test

```bash
npx playwright install chromium   # una volta sola
npm test
```

I test aprono il gioco vero in un browser vero e ci lavorano dentro: dipingono,
cambiano layer, trascinano selezioni, fanno il pinch a due dita, ricaricano la
pagina per controllare il salvataggio. Non ci sono unit test perche' le parti
interessanti — la proiezione isometrica, l'ordine di disegno, i gesti — o si
verificano su una pagina che gira o non si verificano affatto.

Girano da soli a ogni push (`.github/workflows/test.yml`). **Non bloccano la
pubblicazione**: caricare un livello nuovo deve restare un'operazione da un
minuto, anche se un test e' rosso per una ragione che non c'entra.
