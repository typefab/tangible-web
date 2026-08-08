/**
 * Finestrella di scelta.
 *
 * `window.confirm` basterebbe per un si/no, ma qui le scelte sono tre e vanno
 * spiegate: su telefono un testo lungo dentro un confirm nativo diventa
 * illeggibile, e non c'e' modo di distinguere l'opzione che butta via lavoro.
 */
export interface DialogOption<T extends string> {
  id: T;
  label: string;
  detail?: string;
  /** Colora il pulsante come azione distruttiva. */
  danger?: boolean;
}

const STYLE = `
  #editor-dialog {
    position: fixed; inset: 0; z-index: 100;
    display: flex; align-items: center; justify-content: center;
    padding: 16px; background: #12121acc;
    font: 14px/1.5 system-ui, sans-serif; color: #e8e8ef;
  }
  #editor-dialog .box {
    width: 100%; max-width: 380px; padding: 18px;
    border-radius: 12px; border: 1px solid #3a3a48; background: #24242e;
    display: flex; flex-direction: column; gap: 12px;
  }
  #editor-dialog h2 { margin: 0; font-size: 16px; }
  #editor-dialog p { margin: 0; opacity: .8; }
  #editor-dialog button {
    display: block; width: 100%; min-height: 46px; padding: 8px 14px;
    border-radius: 8px; border: 1px solid #3a3a48; background: #2f2f3d;
    color: #e8e8ef; font: inherit; text-align: left; cursor: pointer;
  }
  #editor-dialog button:hover { background: #3a3a48; }
  #editor-dialog button.danger { border-color: #6b3a3a; }
  #editor-dialog button strong { display: block; font-weight: 600; }
  #editor-dialog button span { display: block; font-size: 12px; opacity: .7; }
`;

/**
 * Mostra la finestrella e risolve con l'opzione scelta.
 *
 * Non si chiude in nessun altro modo: non c'e' una X e non si chiude cliccando
 * fuori. Le domande che pone decidono se tenere o buttare del lavoro, e una
 * chiusura accidentale non deve poter scegliere al posto di chi legge.
 */
export function chooseDialog<T extends string>(
  title: string,
  message: string,
  options: readonly DialogOption<T>[],
): Promise<T> {
  return new Promise((resolve) => {
    const root = document.createElement('div');
    root.id = 'editor-dialog';
    root.innerHTML = `<style>${STYLE}</style>`;

    const box = document.createElement('div');
    box.className = 'box';
    root.appendChild(box);

    const heading = document.createElement('h2');
    heading.textContent = title;
    box.appendChild(heading);

    const text = document.createElement('p');
    text.textContent = message;
    box.appendChild(text);

    for (const option of options) {
      const button = document.createElement('button');
      if (option.danger) button.className = 'danger';
      const label = document.createElement('strong');
      label.textContent = option.label;
      button.appendChild(label);
      if (option.detail) {
        const detail = document.createElement('span');
        detail.textContent = option.detail;
        button.appendChild(detail);
      }
      button.onclick = () => {
        root.remove();
        resolve(option.id);
      };
      box.appendChild(button);
    }

    document.body.appendChild(root);
  });
}
