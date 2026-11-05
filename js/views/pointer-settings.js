import { POINTER_MODES, getPref, setPref } from '../preferences.js';
import { announce } from '../a11y/announcer.js';

let dialog = null;

function build() {
  dialog = document.getElementById('dialog-pointer');
  const group = dialog.querySelector('.pointer-modes');
  for (const [id, mode] of Object.entries(POINTER_MODES)) {
    const row = document.createElement('div');
    row.className = 'pointer-mode';
    const label = document.createElement('label');
    const input = document.createElement('input');
    Object.assign(input, { type: 'radio', name: 'pointer-mode', value: id });
    input.setAttribute('aria-describedby', `pointer-mode-${id}`);
    label.append(input, mode.name);
    const hint = document.createElement('p');
    hint.id = `pointer-mode-${id}`;
    hint.textContent = mode.description;
    row.append(label, hint);
    group.append(row);
  }
  group.addEventListener('change', e => {
    setPref('pointerMode', e.target.value);
    announce(`Mode de navigation : ${POINTER_MODES[e.target.value].name}`);
  });
}

export function open() {
  if (!dialog) build();
  const current = dialog.querySelector(`input[value="${getPref('pointerMode')}"]`);
  current.checked = true;
  dialog.showModal();
  current.focus();
}
