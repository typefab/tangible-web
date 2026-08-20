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
| Sprite dei blocchi | `src/assets/blocks/<categoria>/*.png` | **Fabrizio** |
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
  commit, compare". La **sottocartella e' la categoria** del cassetto, ed e'
  facoltativa: un PNG lasciato in `blocks/` finisce in "Generale" e compare
  lo stesso.
- **La taglia sta nel nome del file, non nell'id.** `albero@2.png` e'
  `albero` largo due celle: il suffisso non entra nell'id, come non ci entra la
  sottocartella. E' quello che permette di cambiare idea sulla taglia senza
  invalidare i `level.json` che nominano quel blocco. Un `@` senza un numero
  buono dopo resta nell'id, cosi' un file chiamato davvero cosi' non sparisce.
- **La scala di un blocco moltiplica la taglia del suo tipo, non la sostituisce.**
  `"scale": 0.5` vuol dire "meta' di un albero", non "mezza cella": e' quello che
  permette di ripensare `albero@2.png` senza rimisurare i blocchi gia' piazzati.
  Il campo **non compare quando vale 1**, come `rotation` sui fondali, e viaggia
  col blocco — spostamento, appunti, contagocce: una proprieta' che si perde
  toccando le cose e' peggio che non averla.
- **Uno sprite fatto nell'editor d'immagine non e' nel repository.**
  `registerRuntimeBlock()` lo rende piazzabile subito e l'autosave lo conserva
  in questo browser, ma resta un elenco separato dai `BLOCKS` di build apposta:
  su un altro browser, e nel gioco pubblicato, non esiste finche' il PNG non
  viene committato. L'interfaccia lo deve dire — la differenza non si vede.
- **Un blocco che non si sa disegnare non si butta.** `GridPlacement` tiene da
  parte gli id che il catalogo non conosce e li riscrive nel salvataggio: il
  salvataggio si rilegge dalla scena, quindi senza questo un PNG cancellato dal
  repository cancellerebbe **per sempre** i blocchi che lo usavano, in silenzio.
- **Il tasto indietro chiude, non esce.** `BackGuard` tiene una voce di
  cronologia come sentinella: il primo indietro chiude il pannello piu' in alto,
  e solo con niente aperto chiede se chiudere la scheda. Chi aggiunge un
  pannello modale lo aggiunge anche a `closeTopmost()`, altrimenti l'indietro
  scavalca il suo e chiude quello sotto.
- **La striscia in basso e' i recenti, non il catalogo.** Il catalogo intero sta
  nel cassetto 🎨: con molti sprite una striscia che li elenca tutti diventa
  illeggibile, ed e' il motivo per cui e' stata divisa.
- **`BlockType` e' `string`.** L'elenco esiste solo dopo la build, quindi valida
  a runtime con `resolveBlock()` e scarta gli id sconosciuti.
- **I blocchi sono indicizzati per id di layer, non per indice.** Con l'indice,
  riordinare un layer rimescolerebbe i blocchi di tutti gli altri.
- **La quota di un layer non entra nella profondita' di disegno**: resta
  `col + row` piu' uno scarto minimo. A dire chi sta davanti e' la distanza da
  chi guarda, non l'altezza.
- **La selezione dell'editor e' un'area di celle**, vuote comprese — non un
  insieme di blocchi. E' cio' che permette a pennello e gomma di agire sull'area.
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

- **`N passed` non vuol dire "verde".** Playwright stampa quella riga *sotto*
  l'elenco dei falliti, e con `tail` si vede solo lei. Confronta il numero col
  totale (`npx playwright test --list` lo dice) o guarda `Exit code`: e' cosi'
  che tredici test rossi sono stati riportati come verdi e sono finiti in due PR
  mergiate.
- **una classe CSS che un test usa come indirizzo e' un'interfaccia.**
  `#level-tabs .elenco` voleva dire "il catalogo dei livelli": dandola anche al
  cassetto degli sprite, i test hanno cominciato ad aprire il pannello sbagliato.
  Prima di riusare una classe, cerca chi la seleziona.
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

## Guardare il gioco girare

Vale la pena farlo: due difetti reali sono emersi solo guardando, e nessun test
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
apposta per le cose non provate, e ci e' gia' successo di lasciarci dentro
un'affermazione scaduta per due giorni.
