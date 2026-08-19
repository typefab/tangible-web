/**
 * Il tasto indietro del telefono, addomesticato.
 *
 * Sul telefono indietro e' il gesto che si fa per chiudere qualcosa: un
 * pannello, una finestra, un pentimento. Nell'editor pero' chiudeva la scheda —
 * e con la scheda se ne andava il lavoro non ancora scaricato. Peggio: succedeva
 * proprio mentre si cercava di chiudere un pannello, cioe' nel momento in cui
 * nessuno se lo aspetta.
 *
 * Il rimedio e' una **sentinella nella cronologia**: una voce in piu' spinta con
 * `pushState`, che non cambia l'indirizzo ma da' qualcosa da consumare al primo
 * indietro. Cosi' il tasto non lascia la pagina: manda un `popstate`, che qui
 * diventa una domanda.
 *
 * L'ordine e' quello che uno si aspetta:
 *
 * 1. c'e' un pannello aperto -> si chiude quello, e la sentinella si rimette
 * 2. non c'e' niente da chiudere -> "vuoi chiudere la scheda?"
 * 3. si conferma -> si fa l'indietro vero, quello che il telefono avrebbe fatto
 *
 * Una nota su cosa **non** si puo' fare: una pagina non puo' chiudere una scheda
 * che non ha aperto lei, quindi il passo 3 non e' `window.close()` ma un
 * `history.back()`. Se l'editor e' la prima pagina della scheda il browser la
 * chiude da se', che e' esattamente il comportamento di partenza; se prima c'era
 * altro, si torna li'.
 */
export interface BackGuardDeps {
  /**
   * Chiude il pannello piu' in alto, se ce n'e' uno. `true` se ha chiuso
   * qualcosa: allora l'indietro e' gia' servito a qualcosa e non si chiede altro.
   */
  closeTopmost: () => boolean;
  /** La domanda. `true` per uscire davvero. */
  confirmLeave: () => Promise<boolean>;
}

/** Marca le voci spinte da qui, per non reagire a cronologia di qualcun altro. */
const SENTINEL = { tangibleBackGuard: true } as const;

export class BackGuard {
  private started = false;
  /** Vero mentre la domanda e' aperta: un secondo indietro non la ripete. */
  private asking = false;

  constructor(private readonly deps: BackGuardDeps) {}

  start(): void {
    if (this.started) return;
    this.started = true;
    this.arm();
    window.addEventListener('popstate', this.onPop);
  }

  /** Rimette la sentinella davanti alla pagina. */
  private arm(): void {
    history.pushState(SENTINEL, '', location.href);
  }

  /**
   * La sentinella non si rimette subito: dopo il `popstate` siamo tornati sulla
   * voce vera della pagina, ed e' li' che vogliamo stare mentre si decide —
   * cosi' l'uscita, se confermata, e' un solo `history.back()` invece di un
   * salto a ritroso che il browser puo' rifiutare quando davanti non c'e' niente.
   */
  private readonly onPop = (): void => {
    if (this.asking) return;

    if (this.deps.closeTopmost()) {
      this.arm();
      return;
    }

    void this.ask();
  };

  private async ask(): Promise<void> {
    this.asking = true;
    let leave = false;
    try {
      leave = await this.deps.confirmLeave();
    } finally {
      this.asking = false;
    }

    if (leave) {
      // Niente sentinella davanti: questo indietro e' quello vero.
      window.removeEventListener('popstate', this.onPop);
      history.back();
      return;
    }
    this.arm();
  }
}
