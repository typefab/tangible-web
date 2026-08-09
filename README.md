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

**Disegnare**

- la fila in alto nella barra e' la **palette**: scegli il blocco da piazzare
- **🖌 Pennello** (`B`) piazza, anche trascinando; **🧽 Gomma** (`E`) cancella
- **🪣 Riempi** (`G`) riempie l'area contigua
- **↶ / ↷** annullano e rifanno (`Ctrl+Z`, `Ctrl+Shift+Z`); un trascinamento
  intero conta come un solo passo
- **Griglia: on/off** nasconde le linee per guardare la scena pulita; lo snap
  resta comunque attivo
- **▶ Gioca** esce dall'editor

**Selezionare** — **⬚ Seleziona** (`S`)

Trascini dal punto dove appoggi il dito, il rettangolo si allarga seguendoti, e
al rilascio resta selezionato tutto quello che ci e' finito dentro. Come in
GDevelop.

- **trascina dentro la selezione** per spostarla, di cella in cella
- **🗑 Cancella** o il tasto `Canc` elimina i blocchi selezionati
- `Esc` annulla la selezione

Vale sul layer attivo e solo su quello, come il pennello. Il rettangolo e' una
figura sullo schermo: su griglia isometrica copre un rombo di celle, quindi
prende quello che ci vedi dentro, non un blocco di righe e colonne.

**I layer**

Il pannello in alto a destra elenca i piani, come i layer di GDevelop. Il layer
in cima all'elenco e' quello disegnato davanti.

- **tocca il nome** per renderlo attivo: si disegna **solo** sul layer attivo
- `[` e `]` cambiano piano da tastiera
- **👁** accende e spegne un layer. Quello attivo resta sempre acceso, altrimenti
  dipingeresti alla cieca
- **↑n** e' la **quota**: `↑0` e' un piano piatto, sovrapposto in loco — cioe' il
  layer di GDevelop. Da `↑1` in su il piano si alza di una cella, e ci costruisci
  **sopra** al piano di sotto
- **+** aggiunge un piano (max 8), **▲ ▼** lo riordinano, **✎** lo rinomina,
  **🗑** lo elimina con i suoi blocchi

**Le schede dei livelli**

La barra in cima elenca i livelli. Un solo `level.json` li contiene tutti.

- **tocca una scheda** per aprire quel livello
- **+** ne crea uno, **⧉** duplica quello aperto, **✎** lo rinomina, **🗑** lo
  elimina (si recupera con `Ctrl+Z`)
- in gioco si sceglie con l'URL: `?level=2` oppure `?level=Caverna`. Senza, si
  gioca il primo

**Salvare**

Due cose diverse, e conviene tenerle distinte:

| | Cosa fa | Quando |
|---|---|---|
| **💾 Salva** (`Ctrl+S`) | salva **in questo browser** | mentre lavori |
| **⬇ Scarica** | scarica `level.json` | quando vuoi portarlo nel gioco |

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
| `src/assets/blocks/*.png` | I blocchi piazzabili. **Il nome del file e' l'id**: `dirt.png` diventa il blocco "Dirt". |
| `src/assets/characters/`, `src/assets/ui/` | Personaggio e pezzi di interfaccia. Qui i nomi contano: li cerca il codice. |
| `public/level.json` | Tutti i livelli, coi loro layer e blocchi. Prodotto dall'editor. |
| `public/assets/*.png` | Archivio degli sprite del progetto GDevelop. Non lo usa nessuno: e' li' perche' non si buttano via i disegni. |

### Aggiungere un blocco nuovo

Carichi il PNG in **`src/assets/blocks/`** dalla UI web di GitHub e fai commit.
Fine: compare nella palette dell'editor con la sua anteprima, e' piazzabile, ed
entra nell'inventario del gioco. Nessuna riga di codice da toccare — l'elenco
degli sprite lo genera Vite leggendo la cartella durante la build.

Il prezzo e' che serve una build, cioe' il minuto del deploy: fino ad allora il
blocco non c'e'. E' anche il motivo per cui gli sprite stanno in `src/` e non in
`public/`: una pagina web non puo' elencare il contenuto di una cartella remota,
quindi da `public/` servirebbe un elenco scritto a mano.

## Cosa tocco io

| File | Cosa contiene |
|---|---|
| `src/config.ts` | Le costanti di gioco, portate 1:1 dalla tabella di `CLAUDE.md`. |
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
  `src/assets/blocks/` compare da solo nella palette e nell'inventario
- **Layer** con nome, visibilita' e quota: si costruisce anche in verticale, e
  in gioco il tocco prende sempre il blocco piu' in alto
- **Piu' livelli in un file solo**, con le schede nell'editor e `?level=` in gioco
- **Salvataggio locale con conferma**: l'editor ricorda, ma chiede sempre prima
  di ripristinare
- **Selezione a rettangolo**, con spostamento ed eliminazione
- **Due dita** per spostarsi e ingrandire, in qualsiasi strumento

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
