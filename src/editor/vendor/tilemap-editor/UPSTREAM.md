# Provenienza

Questa cartella e' una **copia** (vendored fork) di un progetto esterno. Non e'
codice nostro: e' codice di qualcun altro che abbiamo deciso di adottare e poi
modificare.

| | |
|---|---|
| Progetto | [blurymind/tilemap-editor](https://github.com/blurymind/tilemap-editor) |
| Autore | Todor Imreorov |
| Licenza | MIT (vedi `LICENSE`, va mantenuto) |
| Versione | 0.7.8 |
| Commit copiato | `758cdbb308e611da85efefa5cf1c89b5d38b6584` |
| Data di quel commit | 2022-12-07 |
| Copiato il | 2026-08-07 |

## Cosa abbiamo copiato

| File qui | File originale |
|---|---|
| `tilemap-editor.js` | `src/tilemap-editor.js` |
| `styles.css` | `src/styles.css` |
| `importer-tiled.js` | `importers/tiled.js` |
| `LICENSE` | `LICENSE` |

Non abbiamo copiato: screenshot (4 MB), `index.html` demo, service worker, PWA
manifest, configurazione Travis. Non servono: noi non serviamo l'editor come
sito a se', lo montiamo dentro la nostra pagina.

## Obbligo di licenza

MIT permette di copiare, modificare e ridistribuire, **a patto di mantenere la
nota di copyright**. Il file `LICENSE` deve restare in questa cartella anche
dopo che avremo riscritto meta' del codice. Non e' una formalita': e' la
condizione a cui ci e' permesso usarlo.

## Perche' una copia e non una dipendenza npm

Il pacchetto esiste su npm, ma:

1. **Dobbiamo modificarne il cuore.** Il passaggio a griglia isometrica tocca
   la funzione di disegno, non la configurazione. Una dipendenza si configura,
   non si opera a cuore aperto.
2. **L'upstream e' fermo dal dicembre 2022.** Quasi quattro anni. Non ci sono
   aggiornamenti da perdere restando indietro, e quindi il costo tipico del
   fork — divergere da un progetto che si evolve — qui non esiste.
3. **Zero dipendenze.** E' un singolo file JS senza librerie esterne: copiarlo
   non trascina dentro nulla.

Il punto 2 e' quello che rende ragionevole la scelta. Se l'upstream fosse
attivo, forkarlo significherebbe rinunciare alle sue correzioni.

## Se un giorno l'upstream riprendesse vita

Confronta con il commit di partenza:

```bash
git clone https://github.com/blurymind/tilemap-editor /tmp/tme
git -C /tmp/tme diff 758cdbb --stat -- src/tilemap-editor.js
```

Le nostre modifiche sono elencate in `MODIFICHE.md`, tutte marcate nel codice
con `// TANGIBLE:`. Cerca quel prefisso per sapere cosa e' nostro.
