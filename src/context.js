const menu = document.getElementById('menu');

// Render the item list main sends us. Item shapes:
//   { sep: true }                      -> a divider
//   { id, label, kbd?, disabled? }     -> a clickable row
window.ctx.onItems((items) => {
  menu.innerHTML = '';
  for (const it of items || []) {
    if (it.sep) {
      const sep = document.createElement('div');
      sep.className = 'pop-sep';
      menu.appendChild(sep);
      continue;
    }
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pop-item';
    btn.setAttribute('role', 'menuitem');
    if (it.disabled) btn.disabled = true;

    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = it.label;
    btn.appendChild(label);

    if (it.kbd) {
      const kbd = document.createElement('kbd');
      kbd.textContent = it.kbd;
      btn.appendChild(kbd);
    }
    if (!it.disabled) {
      btn.addEventListener('click', () => window.ctx.invoke(it.id));
    }
    menu.appendChild(btn);
  }
  // Focus the first enabled item so the menu is keyboard-operable.
  const first = menu.querySelector('.pop-item:not([disabled])');
  if (first) setTimeout(() => first.focus(), 0);
});

// Keyboard: arrows move, Enter activates (native button click), Esc closes.
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') return window.ctx.close();
  const rows = [...menu.querySelectorAll('.pop-item:not([disabled])')];
  if (!rows.length) return;
  const i = rows.indexOf(document.activeElement);
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    rows[(i + 1 + rows.length) % rows.length].focus();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    rows[(i - 1 + rows.length) % rows.length].focus();
  }
});
