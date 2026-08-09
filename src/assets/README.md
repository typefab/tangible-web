# Gli sprite

Due regole, e non c'e' altro da sapere.

> **La cartella decide la categoria. Il nome del file decide l'id.**

Lasci cadere `dirt.png` in `blocks/` e fai commit: `dirt` diventa un blocco
vero, compare nella palette dell'editor con l'etichetta "Dirt" e si puo'
piazzare. Nessuno deve scrivere codice. Rinominare il file rinomina il blocco
ovunque; spostarlo in un'altra cartella ne cambia la categoria.

## Le cartelle

| Cartella | Cosa ci va | Effetto |
|---|---|---|
| `blocks/` | I blocchi piazzabili | Il nome del file e' il `type` in `level.json` |
| `characters/` | Personaggi | Si sceglie quale in `config.ts` (`PLAYER.texture`) |
| `props/` | Oggetti di scena, edifici | Disponibili, non ancora usati dal gioco |
| `backgrounds/` | Sfondi e materiali | Disponibili, non ancora usati dal gioco |
| `ui/buttons/` | Bottoni | |
| `ui/joystick/` | Il pack del joystick, `stile-tinta-pezzo` | La variante attiva sta in `config.ts` |
| `_da-classificare/` | Quello che non si sa ancora cosa sia | **Fuori dall'indice**: non entra nel gioco |

Le cartelle che iniziano con `_` non vengono indicizzate. Servono a
parcheggiare senza sporcare il gioco: quando decidi cos'e' un file, lo sposti
nella cartella giusta e da quel momento esiste.

## Come si nominano i file

Minuscolo, parole separate da trattino: `flat-dark-border.png`, non
`Flat dark joystick border2.png`. Il nome diventa un id, e gli id con spazi e
maiuscole si rompono prima o poi.

Per i blocchi il nome e' anche quello che finisce scritto in `level.json`:
`basic.png` produce `"type": "basic"`. Se rinomini un blocco gia' usato in un
livello, il gioco non esplode — salta quei blocchi e avvisa in console dicendo
quale file manca — ma quei blocchi spariscono dalla scena.

## Perche' qui e non in `public/`

Una pagina web non puo' elencare il contenuto di una cartella. Da `public/`
servirebbe un elenco scritto a mano, da aggiornare a ogni file aggiunto: cioe'
esattamente il lavoro che questa struttura esiste per eliminare. Da `src/` e'
Vite a generare l'elenco quando compila (`assets/registry.ts`).

Il prezzo e' che serve una build perche' un file nuovo compaia: il tempo del
deploy, circa un minuto. Non serve installare niente.

## Rimasto da fare

I due blocchi `basic.png` e `stack.png` **non sono arte, sono segnaposto**:
quadrati wireframe che su una griglia a rombi non combaciano tra loro. Il
gioco avra' l'aspetto di uno scheletro finche' non esiste un blocco disegnato
davvero isometrico, con la faccia superiore a rombo 64x32.
