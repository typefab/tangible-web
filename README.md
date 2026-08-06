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

## Cosa tocchi tu

| File | Cosa contiene |
|---|---|
| `public/assets/*.png` | Gli sprite. Trascinali nella UI web di GitHub. |
| `public/level.json` | La disposizione dei blocchi. A mano, o esportato da un editor di tilemap. |

## Cosa tocco io

| File | Cosa contiene |
|---|---|
| `src/config.ts` | Le costanti di gioco, portate 1:1 dalla tabella di `CLAUDE.md`. |
| `src/mechanics/` | Le meccaniche. Una classe per meccanica, autonoma e testabile. |
| `src/scenes/` | Montaggio della scena e input. |

## Cosa e' gia' implementato e verificato

- Griglia 32x32 con offset (16,16), identica al progetto GDevelop
- Piazzamento su cella libera, con cooldown di 100 ms
- Rottura tenendo premuto 1,5 s, con oscillazione `sin(t * 18) * 10` gradi
- Due tipi di blocco (`block_0`, `block_1`), tasti `1` e `2` per cambiare slot
- Caricamento della disposizione iniziale da `level.json`
- Profondita' per riga (piu' in basso = davanti)

## Sviluppo locale (facoltativo — non serve per il workflow online)

```bash
npm install && npm run dev
```
