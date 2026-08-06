# Piano di lavoro — Tangible Cushion

Documento di riferimento sulle scelte di architettura e sui prossimi passi.
Ultimo aggiornamento: 6 agosto 2026.

---

## 1. Obiettivo

Sostituire la pipeline attuale (progetto GDevelop monolitico, modificato con
script Python) con un flusso in cui **GitHub e' il ponte** tra chi cura grafica
e livelli e chi scrive le meccaniche.

### Divisione dei ruoli

| Chi | Fa cosa | Tocca |
|---|---|---|
| **Fabrizio** | Sprite, creazione scene, disposizione, test | `public/` |
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
| **Repo + editor nostro** | da costruire | si | si / si | **scelto** |

Note di verifica:

- **GDevelop**: alla richiesta esplicita di un'opzione "salva su GitHub", il
  manutentore ha risposto che non arrivera', perche' git e' gia' usabile con
  GDevelop — cioe' dal desktop.
  ([discussione #7542](https://github.com/4ian/GDevelop/discussions/7542))
- **microStudio**: nessuna integrazione git nella documentazione ufficiale. Il
  tab "Sync" sincronizza un progetto microStudio con un altro progetto
  microStudio, non con repository esterni.
- **PlayCanvas**: alternativa reale e verificata. Ha integrazione GitHub
  ufficiale e il tool `pcsync` e' bidirezionale (`push` e `pull`), gli basta
  una API key da variabile d'ambiente, quindi puo' girare in una GitHub Action.
  Scartato perche' e' un engine 3D/WebGL usato per un gioco 2D, perche' il
  `push` sovrascrive il remoto (rischio di perdere lavoro se si modifica da
  entrambi i lati), e perche' il piano gratuito rende i progetti pubblici.
  ([pcsync](https://github.com/playcanvas/playcanvas-sync))

**La scelta**: il repository non e' la copia del progetto, **e' il progetto**.
Phaser e' una libreria dentro il repo, non un'applicazione da cui esportare.
Cosi' non esiste nessun silo da sincronizzare.

### L'editor di scene

Il vincolo 3 non e' soddisfatto da questa scelta, quindi l'editor lo
costruiamo: una **modalita' editor dentro il gioco stesso**, servita dallo
stesso URL di GitHub Pages.

Perche' regge:

- e' online e sempre apribile — e' una pagina web
- scrive **esattamente** i file che l'LLM legge, per costruzione
- gira sul dominio `github.io` gia' in uso: nessun servizio nuovo di cui fidarsi
- riusa `GridPlacement`, gia' scritto e testato

Perche' costa poco: il gioco e' **a griglia**. Niente rotazioni libere, forme di
collisione o layer arbitrari — solo celle 32x32 e un tipo di blocco per cella.
Stima: 300-400 righe.

L'obiezione standard ("non reinventarlo, usa Tiled o LDtk") non si applica:
sono entrambi desktop, quindi esclusi dal vincolo 1. L'unico editor browser
equivalente e' Sprite Fusion, che pero' e' solo tilemap generico e richiede un
ponte manuale (esporta JSON, ricarica su GitHub a mano).

---

## 3. Il ciclo di lavoro

```
 FABRIZIO (browser)                  GITHUB                   CLAUDE CODE
 ──────────────────                  ──────                   ───────────
 sprite: piskelapp.com  ┐
                        ├──> upload drag&drop ──> repo <────── codice (src/)
 scene: editor del      ┘                          │
        gioco stesso                               │
        (GitHub Pages)                             │
                                  GitHub Actions <─┘
                                   ├── Pages ──> si gioca al link, anche da telefono
                                   └── APK ────> si installa sul telefono
```

---

## 4. Stato attuale

### Fatto e verificato

Prototipo funzionante, build pulita (TypeScript + Vite + Phaser 3).
Logica testata pilotando lo stato nel browser:

| Test | Esito |
|---|---|
| `cellToWorld(2,6)` -> `(96, 224)` | offset (16,16) esatto |
| Caricamento `level.json` | 10/10 blocchi |
| Piazzamento su cella occupata | rifiutato |
| Cooldown 100 ms | 99 ms rifiutato, 101 ms accettato |
| Rottura a 750 ms | progresso 0.5, oscillazione 8.04 gradi (dentro +/-10) |
| Rottura a 1500 ms | blocco distrutto, stato ripulito |
| Global di debug nel build di produzione | 0 occorrenze |

Bug trovato e corretto: dentro `create()` Phaser ha `time.now === 0`, quindi il
cooldown scartava anche il primo piazzamento (il livello caricava 0 blocchi).
Risolto separando il caricamento batch (`spawn`) dall'input del giocatore
(`place`).

Costanti portate 1:1 da `gdevelop_repository/CLAUDE.md` in `src/config.ts`.

### Non ancora verificato

- **Le due GitHub Actions non sono mai state eseguite.** Girano solo su GitHub.
  Sono costruite su pattern standard (Capacitor + `gradlew assembleDebug`), ma
  la prima run potrebbe richiedere aggiustamenti.
- **Il rendering visivo non e' stato visto.** Il game loop non gira nel
  pannello browser dell'ambiente di sviluppo (`frames: 0`): la logica e'
  verificata, l'aspetto no.

---

## 5. Prossimi passi

1. **Push del repo su GitHub** — serve l'account di Fabrizio.
2. **Abilitare Pages**: *Settings -> Pages -> Source: GitHub Actions*.
   Il gioco diventa raggiungibile a `https://<utente>.github.io/<repo>/`.
3. **Prima run delle Actions**: verificare che il deploy web funzioni e che
   *Actions -> Build APK -> Run workflow* produca un APK installabile.
4. **Costruire la modalita' editor** — toggle, palette dei blocchi, esporta
   `level.json`. Salvataggio v1: scarichi il JSON e lo carichi su GitHub.
5. **Riportare le meccaniche** una alla volta: inventario a 8 slot, joystick
   touch, raccolta dei blocchi caduti.

Salvataggio v2 (piu' avanti): il pulsante *Salva* dell'editor committa da solo
via API GitHub, eliminando il passaggio manuale.

---

## 6. Cosa si porta dietro dal vecchio progetto

Riutilizzabile integralmente:

- gli asset in `gdevelop_repository/assets/`
- `architecture.md`, `decisions.md`, `patterns.md` e la tabella delle costanti

Il gioco attuale e' considerato **sacrificabile**: la struttura e' documentata e
le meccaniche si riscrivono. Non si tenta nessuna conversione automatica del
JSON GDevelop.

---

## 7. Rischi aperti

| Rischio | Mitigazione |
|---|---|
| Le Actions non funzionano alla prima | Iterare sui log; i pattern sono standard |
| L'editor risulta troppo spartano | Cresce a richiesta; si valuta Sprite Fusion come ripiego |
| Phaser 3 vs Phaser 4 | Il prototipo gira su Phaser 3.90, stabile. Nessuna fretta di migrare |
| Il ciclo commit -> gioco live e' ~1 minuto | Accettato: e' il prezzo del vincolo "zero installazioni" |
