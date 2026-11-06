let nextDialog = 0;

export function dialog(title, build) {
  const opener = document.activeElement;
  const el = document.createElement('dialog');
  const heading = document.createElement('h2');
  heading.id = `dynamic-dialog-title-${++nextDialog}`;
  heading.textContent = title;
  el.setAttribute('aria-labelledby', heading.id);
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = 'Fermer';
  close.onclick = () => el.close();
  const header = document.createElement('div');
  header.className = 'dialog-header';
  header.append(heading, close);
  el.append(header);
  build(el);
  el.addEventListener('close', () => { el.remove(); if (opener?.isConnected && opener !== document.body) opener.focus(); else if (document.activeElement === document.body) (document.getElementById('dashboard-title') || document.getElementById('board-title'))?.focus(); });
  document.body.append(el);
  el.showModal();
  return el;
}
export function ask(title, value, submit, confirmation = false) {
  return dialog(title, el => {
    const form = document.createElement('form');
    const input = document.createElement('input');
    input.value = value;
    input.required = true;
    input.autocomplete = 'off';
    if (!confirmation) { const label = document.createElement('label'); label.className = 'library-field'; label.append('Nom', input); form.append(label); }
    const button = document.createElement('button');
    button.textContent = confirmation ? 'Confirmer la suppression' : 'Enregistrer';
    form.append(button);
    form.onsubmit = e => { e.preventDefault(); if (!confirmation && !input.value.trim()) return; el.close(); submit(input.value.trim()); };
    el.append(form);
  });
}
