const $ = (id) => document.getElementById(id);

window.perm.onShow((req) => {
  $('origin').textContent = req.origin;
  $('action').textContent = 'wants to ' + req.action;
  // Default focus to Block, the safe choice.
  setTimeout(() => $('block').focus(), 0);
});

$('allow').addEventListener('click', () => window.perm.decide(true));
$('block').addEventListener('click', () => window.perm.decide(false));

// Esc denies.
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.perm.decide(false);
});
