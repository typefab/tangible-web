# Migrazione: gli sprite sul box, il gioco su invito

**Questo file muore quando la migrazione finisce.** Non e' documentazione: e'
una procedura, e una procedura finita che resta scritta diventa una bugia. Alla
fine gli invarianti che restano veri passano in `CLAUDE.md`, il perche' e' gia'
in [`PIANO.md`](PIANO.md) §3, e questo file si cancella.

Il **perche'** di tutto questo non e' qui: sta in [`PIANO.md`](PIANO.md), nella
sezione "Lo storage fuori dal repository, e il gioco su invito". Qui c'e' solo
cosa fare, in che ordine, chi lo fa e come si capisce se e' andato.

## A che punto siamo

| # | Passo | Chi | Stato |
|---|---|---|---|
| 1 | Il Worker serve il gioco | io + pannello Cloudflare | **fatto il 22 agosto 2026** — resta da guardarlo |
| 2 | La porta sul box | io + sotto-account Hetzner | da fare |
| 3 | Access davanti al Worker | solo tu, dal pannello | da fare |
| 4 | La repo diventa privata, Pages si spegne | solo tu | da fare |
| 5 | L'APK prende gli sprite dal box | io + un segreto | da fare |
| 6 | Salva scrive i livelli sul box | io | da fare |

**Aggiorna questa tabella a ogni passo.** Il container di una sessione sparisce
e sul repository puo' essercene piu' di una aperta: senza lo stato scritto, la
prossima ricomincia a indovinare.

## L'indirizzo di prova

Il gioco vero resta su Pages fino al passo 4. Nel frattempo il Worker vive a un
**secondo indirizzo** — `tangible-web.<sottodominio>.workers.dev` — e i passi 1,
2 e 3 si provano li' sopra senza che niente di vivo si rompa. Il passo 4 diventa
solo "spegni il vecchio".

L'indirizzo, da quando il primo deploy e' andato:
**https://tangible-web.fabriziod-marsico.workers.dev**

**Il Worker si chiama `tangible-web`, non `tangible-prova`.** Rinominare un
Worker ne cambia l'URL, e un indirizzo che cambia e' un segnalibro che si
rompe: se lo chiamassimo "prova" oggi, al passo 4 dovremmo o rinominarlo — e
perdere l'indirizzo — o tenerci per sempre un nome che mente. A renderlo una
prova e' il fatto che Pages sia ancora vivo accanto, non come si chiama.

E' questo il modo di "provare prima di mergiare", non un branch lungo: **meta'
di questi passi non e' codice**, sono operazioni in un pannello, e un branch
git non le contiene ne' le annulla. I cambi di codice, quelli, continuano a
passare da un branch `claude/...` e una PR come sempre.

## I quattro vincoli che tengono Claude capace di lavorare

Non sono robustezza, sono la condizione perche' io possa ancora fare il mio
lavoro. Dalla sessione in cui gira Claude, **la rete uscente e' chiusa**: solo
i registri dei pacchetti e GitHub. Verificato il 21 agosto 2026 — `403` da
`typefab.github.io`, da `your-storagebox.de` e da `api.cloudflare.com`. Quindi:

1. **`src/assets/blocks/` non si svuota mai.** Se il repository resta senza
   sprite, `BLOCKS.length === 0`, i test vanno rossi, e non posso ripararli
   perche' al box non arrivo.
2. **`public/level.json` resta il livello di prova nel repository**, e il box
   tiene quello vivo. I test mantengono la loro fixture, e io un livello da
   guardare.
3. **Il deploy resta dentro GitHub Actions**, con `wrangler` — non la build
   automatica di Cloudflare. E' l'unica differenza che mi farebbe perdere i log
   di un deploy fallito, e con quelli la possibilita' di ripararlo.
4. **Una Action manuale elenca il box e committa l'elenco** in
   `sprites-sul-box.txt`. Non vedo i PNG, ma vedo i nomi — e nei nomi ci sono
   taglia e categoria, che sono meta' del catalogo.

## I passi

### 1. Il Worker serve il gioco

**Chi**: io scrivo la configurazione `wrangler` e il workflow; tu fai l'account
Cloudflare e metti i segreti.

**Il codice c'e' gia'**: `wrangler.toml` e `.github/workflows/deploy-worker.yml`.
Manca solo di dargli le chiavi.

**Prima serve**, tutto dal browser:

1. un account Cloudflare;
2. **un sottodominio `workers.dev` registrato sull'account.** Si vede in
   *Workers & Pages*, riquadro *Account details* a destra. Senza, `wrangler`
   lo chiede in modo interattivo — e in una Action non c'e' nessuno che
   risponde, quindi si ferma con un errore che parla di rotte. **Ci siamo
   sbattuti**: e' stato il primo deploy fallito;
3. un API token con permesso di scrivere i Worker;
4. `CLOUDFLARE_API_TOKEN` e `CLOUDFLARE_ACCOUNT_ID` in *Settings → Secrets and
   variables → Actions → **Secrets***;
5. **poi**, quando il primo avvio a mano e' andato bene, la variabile
   `DEPLOY_WORKER` a `true` in *… → **Variables***. Finche' non c'e', il
   workflow si salta invece di fallire: un push su `main` non deve diventare
   rosso per una cosa non ancora configurata.

**La prima prova**: *Actions → Deploy Worker → Run workflow*. L'avvio a mano
gira anche senza la variabile.

**Fatto quando**: l'indirizzo del Worker mostra il gioco identico a Pages —
compresi gli sprite e un livello caricato — e Pages continua a girare come
prima.

**Dove siamo**: il deploy e' passato il 22 agosto 2026, 42 file caricati su 60,
e Cloudflare ha risposto l'indirizzo. **Che il gioco si veda davvero non e'
ancora verificato**: da questa sessione l'indirizzo non si apre, e la policy di
rete risponde 403. Lo guarda Fabrizio.

**Si torna indietro**: si cancella il Worker dal pannello e si toglie la
variabile. `deploy-web.yml` non e' stato toccato, e il gioco vero non se n'e'
accorto.

**Cosa guardare per primo se qualcosa non va**: gli sprite. `vite.config.ts` ha
`base: ''`, cioe' percorsi relativi, scelti per la sottocartella di Pages e per
il `file://` dell'APK; un Worker serve dalla radice, dove i relativi funzionano
lo stesso — ma e' li' che un errore si vedrebbe, e si vedrebbe come blocchi che
non compaiono, non come una pagina bianca.

### 2. La porta sul box

**Chi**: io il codice; tu il sotto-account Hetzner e la sua password come
segreto del Worker.

**Prima serve**: un **sotto-account** dello Storage Box limitato alla cartella
del gioco, con permesso di scrittura — non le credenziali principali: se
sfuggono, non devono toccare il resto del box. Piu' il nome host
(`uXXXXXX.your-storagebox.de`) e una cartella `blocks/` con dentro almeno un
PNG che nel repository **non** c'e'.

**Fatto quando**: quel PNG compare nel cassetto dell'editor sull'indirizzo di
prova, e `npm test` resta verde in locale senza rete.

**Si torna indietro**: si toglie la sorgente "box" dal catalogo. Gli sprite del
repository bastano da soli — e' il vincolo 1.

**Attenzione**: e' l'unico passo con vero rischio di codice. Va su un branch con
la sua PR, non dritto su `main`.

### 3. Access davanti al Worker

**Chi**: solo tu, dal pannello. Nessun codice.

**Prima serve**: la lista degli indirizzi email autorizzati.

**Fatto quando**: da una finestra anonima l'indirizzo di prova chiede il codice
via email; con un indirizzo della lista si entra; con uno fuori, no.

**Si torna indietro**: si spegne dal pannello.

**Nota**: da qui in poi io non posso aprire l'indirizzo di prova — ma non potevo
neanche prima, per la policy di rete. Questa verifica la fai tu.

### 4. La repo diventa privata, Pages si spegne — **senza ritorno**

**Chi**: solo tu.

**Prima serve**: che 1, 2 e 3 siano fatti **e provati**.

**Fatto quando**: la repository e' privata, `deploy-web.yml` e' rimosso, e il
gioco si apre solo dall'indirizzo del Worker.

**Da controllare subito dopo**, prima di considerarlo chiuso:

- che io riesca ancora a leggere il repository e a fare un push — chiedimelo,
  dura un minuto;
- che io riesca ancora a leggere i log delle Actions;
- che `test.yml` giri.

**Si torna indietro**: la repository si puo' rimettere pubblica, ma Pages va
riconfigurato e l'indirizzo vecchio potrebbe non tornare identico. E da qui in
poi **i minuti di Actions contano**: 2000 al mese sul piano gratuito, mentre su
una repo pubblica erano illimitati. Il conto va guardato dopo qualche giorno.

### 5. L'APK prende gli sprite dal box

**Chi**: io il codice; tu la password del sotto-account nei Secrets del
repository.

**Fatto quando**: un APK costruito contiene uno sprite che sta solo sul box, e
si gioca senza rete.

**Si torna indietro**: si toglie il passo dalla Action. L'APK torna a contenere
i soli sprite del repository.

**Sappilo**: da qui l'APK e' la fotografia degli sprite di quel giorno. Chi lo
ha installato non vede quelli aggiunti dopo, e non ha modo di accorgersene.

### 6. Salva scrive i livelli sul box

**Chi**: io.

**Fatto quando**: salvi dall'editor, apri il gioco da un altro browser, e il
livello c'e' — senza aver scaricato o committato niente.

**Si torna indietro**: Salva torna a scrivere solo in `localStorage`, come oggi.

E' il passo che fa cadere il rischio numero uno del progetto: *Salva non porta
il lavoro nel gioco*. Non e' il motivo per cui questa migrazione e' nata, ma e'
la cosa che la ripaga.

## Cosa non e' stato verificato

Tutto quello che riguarda i pannelli di Cloudflare e Hetzner e' preso dalla loro
documentazione, **non provato**: da questa sessione quei domini non si
raggiungono. Le prime volte che un passo tocca un pannello, il verdetto e' tuo.

## Quando e' finita

1. I quattro vincoli qui sopra diventano invarianti in `CLAUDE.md`.
2. Il diagramma del ciclo di lavoro in `PIANO.md` §3 si aggiorna a quello vero.
3. `README.md` racconta il giro nuovo di uno sprite: niente piu' scarica e
   commit.
4. **Questo file si cancella.**
