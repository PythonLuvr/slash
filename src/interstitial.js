const $ = (id) => document.getElementById(id);

window.interstitial.onShow((data) => {
  $('host').textContent = data.host || data.url || '';
  setTimeout(() => $('back').focus(), 0);
});

$('back').addEventListener('click', () => window.interstitial.back());
$('proceed').addEventListener('click', () => window.interstitial.proceed());
