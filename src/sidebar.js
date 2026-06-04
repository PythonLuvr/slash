const $ = (id) => document.getElementById(id);

$('logo').addEventListener('click', () => window.rail.home());
$('new').addEventListener('click', () => window.rail.newTab());
$('ai').addEventListener('click', () => window.rail.toggleAI());

window.rail.onAiOpen((open) => {
  $('ai').classList.toggle('active', !!open);
});
