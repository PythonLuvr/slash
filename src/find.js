const fi = document.getElementById('fi');
const count = document.getElementById('count');
let debounce;

fi.addEventListener('focus', () => fi.select());

fi.addEventListener('input', () => {
  clearTimeout(debounce);
  const v = fi.value;
  debounce = setTimeout(() => window.find.query(v, true), 110);
});

fi.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    window.find.next(!e.shiftKey);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    window.find.close();
  }
});

document.getElementById('next').addEventListener('click', () => window.find.next(true));
document.getElementById('prev').addEventListener('click', () => window.find.next(false));
document.getElementById('close').addEventListener('click', () => window.find.close());

window.find.onResult((r) => {
  count.textContent = r.total ? r.active + '/' + r.total : '0/0';
});

fi.focus();
