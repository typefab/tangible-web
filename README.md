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

- **tocca una cella vuota** -> piazza un blocco del tipo selezionato
- **tocca un blocco** -> lo toglie
- i pulsanti in basso scelgono il tipo di blocco
- **Griglia: on/off** nasconde le linee per guardare la scena pulita; lo snap
  resta comunque attivo
- **Scarica level.json** salva il file; **Copia JSON** lo mette negli appunti

Poi carichi il file in `public/level.json` dalla UI web di GitHub
(`Add file` -> `Upload files`, e **ricordati il pulsante verde `Commit changes`**
in fondo alla pagina).

In editor non c'e' il personaggio: si costruisce ovunque, senza il vincolo di
portata. Per tornare a giocare basta togliere `?editor=1`.

## Cosa tocchi tu

| File | Cosa contiene |
|---|---|
| `public/assets/*.png` | Gli sprite. Trascinali nella UI web di GitHub. |
| `public/level.json` | La disposizione dei blocchi. A mano, o esportato da un editor di tilemap. |

## Cosa tocco io

| File | Cosa contiene |
|---|---|
| `src/config.ts` | Le costanti di gioco, portate 1:1 dalla tabella di `CLAUDE.md`. |
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

Dettagli, verifiche e rischi aperti stanno in [PIANO.md](PIANO.md).

## Sviluppo locale (facoltativo — non serve per il workflow online)

```bash
npm install && npm run dev
```
