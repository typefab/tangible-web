# Istruzioni per Claude Code

Leggi questo file prima di toccare il codice. `PIANO.md` ha il ragionamento
dietro ogni scelta; qui c'e' solo quello che serve per non fare danni.

## Cos'e' questo progetto

Un gioco a blocchi su griglia isometrica, con dentro il suo editor di livelli.
Phaser 3 + TypeScript + Vite, pubblicato su GitHub Pages.

**Il repository non e' la copia del progetto: e' il progetto.** Phaser e' una
libreria dentro il repo, non un'applicazione da cui esportare.

### I cinque vincoli, non negoziabili

1. **Zero installazioni locali.** Fabrizio lavora solo dal browser, spesso da
   telefono.
2. **GitHub e' il ponte.** L'LLM lavora sul repository, non su file passati a mano.
3. **Editor online, sempre apribile.** Vive dentro il gioco, su `?editor=1`.
4. **Output**: giocabile a un link **e** APK installabile.
5. Solo servizi **HTTPS e gratuiti**.

Prima di proporre un servizio, uno strumento desktop o un passaggio manuale in
piu', controlla che non violi uno di questi.

## Chi tocca cosa

| | File | Chi |
|---|---|---|
| Sprite dei blocchi | `src/assets/blocks/*.png` | **Fabrizio** |
| Fondali | `src/assets/backgrounds/*` | **Fabrizio** |
| Personaggio, interfaccia | `src/assets/characters/`, `src/assets/ui/` | **Fabrizio** |
| Livelli | `public/level.json` | **Fabrizio**, dall'editor |
| Editor | `src/editor/`, `src/level/` | codice |
| Gioco | `src/mechanics/`, `src/scenes/`, `src/ui/` | codice |
| Condiviso | `src/config.ts`, `src/grid/`, `src/assets/catalog.ts` | codice, con attenzione |

Puo' esserci **piu' di una sessione aperta** sullo stesso repo: una sul gioco,
una sull'editor. I file condivisi sono i tre dell'ultima riga: se li tocchi,
aspettati che qualcun altro li stia guardando.

`public/assets/` e' l'archivio del vecchio progetto GDevelop, 51 PNG che non usa
nessuno. Non aggiungerci niente e non cancellarli senza chiedere.

## Invarianti da non rompere

Sono le decisioni che reggono il resto. Se una ti sembra da cambiare, e' una
conversazione, non una modifica.

- **L'editor disegna attraverso `GameScene`.** Non ha un renderer proprio, e non
  deve averlo: e' il motivo per cui quello che si vede costruendo e' quello che
  si vedra' giocando, per costruzione e non per diligenza. Un secondo canvas
  significherebbe due implementazioni della stessa geometria da tenere allineate
  a mano.
- **`src/grid/projection.ts` e' l'unico posto che sa che forma abbia una cella.**
  Nessun altro file deve calcolare coordinate isometriche. Cambiare proiezione
  deve restare una riga.
- **Un `SerializedLevel` non si modifica mai sul posto: si sostituisce.** E'
  quello che rende gli snapshot dell'undo indipendenti dal numero di livelli —
  i livelli fermi ci finiscono per riferimento invece che ricopiati. Scrivere
  un campo addosso a un livello cambia anche il passato che sta nella
  cronologia.
- **Un fondale non e' un blocco.** I blocchi stanno in una cella e tutti gli
  strumenti girano per celle; i fondali hanno posizione e scala libere e vivono
  in un elenco separato del livello. Se un giorno sembrasse comodo metterli fra
  i blocchi, il prezzo lo pagano pennello, gomma, selezione e appunti.
- **I tipi di blocco vengono dalle cartelle**, via `src/assets/catalog.ts`. Non
  reintrodurre un elenco scritto a mano: la promessa e' "carichi un PNG, fai
  commit, compare".
- **`BlockType` e' `string`.** L'elenco esiste solo dopo la build, quindi valida
  a runtime con `resolveBlock()` e scarta gli id sconosciuti.
- **I blocchi sono indicizzati per id di layer, non per indice.** Con l'indice,
  riordinare un layer rimescolerebbe i blocchi di tutti gli altri.
- **La quota di un layer non entra nella profondita' di disegno**: resta
  `col + row` piu' uno scarto minimo. A dire chi sta davanti e' la distanza da
  chi guarda, non l'altezza.
- **La selezione dell'editor e' un'area di celle**, vuote comprese — non un
  insieme di blocchi. E' cio' che permette a pennello e gomma di agire sull'area.
- **Le schede in alto sono i livelli *aperti*, non tutti.** Il catalogo sta
  dietro 📚. Con cento livelli una striscia di cento schede non e' navigabile, e
  chiudere una scheda non elimina niente.
- **Nessun pareggio di profondita'.** A parita' di `depth` Phaser disegna in
  ordine di creazione, che e' un ordine per finta. Le bande stanno in `Z`:
  fondali da -2000, griglia -1000, blocchi e player da 0. Ci siamo gia' cascati
  due volte — il player sulla propria cella, e i fondali sopra la griglia.
- **`normalizeProject()` non deve mai lanciare.** Accetta tre generazioni di
  `level.json` e qualunque schifezza diventa un progetto vuoto: l'editor deve
  aprirsi comunque, altrimenti non c'e' modo di rimediare a un file rotto.
- **`assetsInlineLimit: 0` in `vite.config.ts` resta.** Vite inlinerebbe i
  blocchi da 300 byte come data URI, e il loader di Phaser usa XHR: si romperebbe
  solo in produzione.
- **`window.game` e' esposto solo in DEV** (`src/main.ts`). I test ci passano.

## Comandi

```bash
npm run dev      # server di sviluppo
npm run build    # tsc --noEmit && vite build
npm test         # Playwright, richiede: npx playwright install chromium
```

`npm run build` fa anche il typecheck: se non compila, non commettere.

## Test

`test/`, Playwright, **nessun unit test ed e' una scelta**. Le parti
interessanti qui sono la proiezione isometrica, l'ordine di disegno dei layer, i
gesti a due dita e un salvataggio che deve sopravvivere a una ricarica: un mock
di `Phaser.Scene` direbbe solo che il mock funziona. Un errore vero — l'inversa
isometrica sbagliata al 74% — era passato esattamente cosi'.

Regole imparate a spese nostre:

- **aspetta un oggetto, mai un tempo fisso.** `page.waitForFunction`, non
  `waitForTimeout`: un timeout tarato sulla macchina di sviluppo diventa un test
  rosso su CI.
- **due celle non fanno un rettangolo.** In isometrica le celle sulla stessa
  diagonale hanno la stessa `x`: un rettangolo costruito con due celle come
  angoli puo' venire largo zero. Usa uno scarto in pixel attorno a una cella.
- il multitouch passa da CDP (`Input.dispatchTouchEvent`), non da
  `page.touchscreen`, che fa solo tap.
- se l'ambiente ha gia' un Chromium di una build diversa da quella attesa da
  Playwright: `CHROMIUM_PATH=/percorso/al/chrome npm test`.

## Trappole gia' pagate

Cose che sembrano andare e non vanno. Costano mezz'ora ogni volta.

- **Il CSS dell'editor vive dentro un template literal** (`LevelEditor.style()`).
  Un backtick dentro un commento CSS chiude la stringa e la build muore con un
  errore di sintassi che punta da un'altra parte. Niente backtick li' dentro.
- **`display: flex` batte l'attributo `hidden`.** Un elemento con `display` nel
  CSS resta visibile anche con `hidden` addosso: serve la regola esplicita
  `[hidden] { display: none; }`. Successo tre volte — gruppo della selezione,
  palette, comandi dei fondali.
- **In sviluppo l'app sta su `/`, non su `/tangible-web/`.** `base: ''` serve al
  build; il server di sviluppo risponde sulla radice, e Vite serve `index.html`
  a qualunque percorso. Sbagliare URL da' una pagina che si apre ma con
  `level.json` che arriva come HTML.
- **La soglia dell'editor compatto guarda l'altezza, non solo la larghezza**
  (`COMPATTO`). Un telefono girato e' largo 780 e alto 390: chi guarda solo la
  larghezza lo tratta come un desktop.

## Guardare il gioco girare

Vale la pena farlo: piu' di un difetto e' emerso solo guardando, e nessun test
li avrebbe presi. Con Playwright, **usa il rendering software**:

```
chromium.launch({ args: ['--use-angle=swiftshader', '--use-gl=angle'] })
```

Senza, lo screenshot headless di un canvas WebGL coperto da elementi `fixed`
produce una fascia bianca che **non c'e' davvero**: e' un artefatto di
compositing GPU della cattura. Ci abbiamo perso tempo una volta.

## GitHub

- **`test.yml`** gira a ogni push e PR. **Non blocca il deploy**, di proposito:
  pubblicare una scena nuova deve restare un'operazione da un minuto.
- **`deploy-web.yml`** pubblica su Pages a ogni push su `main`.
- **`build-apk.yml`** e' manuale.
- Le action stanno alle major correnti: i runner hanno dismesso Node 20.

## Come si gioca e si costruisce

- gioco: `https://typefab.github.io/tangible-web/`
- editor: aggiungi `?editor=1`
- un livello preciso: `?level=2` oppure `?level=Nome`

## Tono

Fabrizio non scrive il codice ma lo legge. I commenti spiegano **perche'**, non
cosa: il cosa si vede dal codice. Codice e commenti in italiano senza accenti
(`e'`, `perche'`), come il resto del repo.

Quando qualcosa non e' stato verificato, dillo. `PIANO.md` tiene una sezione
apposta per le cose non provate, e ci e' gia' successo **due volte** di
lasciarci dentro un'affermazione scaduta: prima "le Actions non hanno mai
completato una run" dopo due deploy riusciti, poi "il tocco non e' mai stato
provato su un telefono vero" dopo che Fabrizio ci aveva trovato due difetti.
Prima di ripetere una riga su cosa non e' mai successo, rileggila.
