const $ = (id) => document.getElementById(id);
const memNow = $('mem-now');
const fill = $('gauge-fill');
const gaugeCap = $('gauge-cap');
const tabCount = $('tab-count');
const sleepCount = $('sleep-count');
const limiterOn = $('limiter-on');
const capSlider = $('cap-slider');
const capText = $('cap-text');
const capBlock = $('cap-block');

let dragging = false;
let lastCap = 500; // remembered cap so toggling off then on restores it

const fmtCap = (mb) => (mb >= 1000 ? mb / 1000 + ' GB' : mb + ' MB');

// Reflect the current cap into the toggle + slider, unless the user is mid-edit.
function applyControls(cap) {
  const on = cap > 0;
  if (on) lastCap = cap;
  if (document.activeElement !== limiterOn) limiterOn.checked = on;
  capBlock.classList.toggle('off', !on);
  if (!dragging) {
    const v = Math.min(4000, Math.max(500, on ? cap : lastCap));
    capSlider.value = String(v);
    capText.textContent = fmtCap(v);
  }
}

function render(s) {
  const mem = s.memMB || 0;
  const cap = s.ramLimitMB || 0;
  memNow.textContent = mem + ' MB';
  tabCount.textContent = s.tabs + ' tab' + (s.tabs === 1 ? '' : 's');
  sleepCount.textContent = s.asleep ? s.asleep + ' asleep' : '';
  // Put the cap line at ~68% of the track so fill reads meaningfully against it.
  const scaleMax = cap ? cap / 0.68 : Math.max(mem * 1.25, 1200);
  fill.style.width = Math.min(100, (mem / scaleMax) * 100) + '%';
  fill.classList.toggle('over', !!cap && mem > cap);
  if (cap) {
    gaugeCap.classList.remove('hidden');
    gaugeCap.style.left = Math.min(100, (cap / scaleMax) * 100) + '%';
  } else {
    gaugeCap.classList.add('hidden');
  }
  applyControls(cap);
}

async function poll() {
  try {
    const s = await window.perf.stats();
    if (s) render(s);
  } catch {
    /* ignore */
  }
}

limiterOn.addEventListener('change', () => {
  window.perf.setRamLimit(limiterOn.checked ? parseInt(capSlider.value, 10) || 500 : 0);
  capBlock.classList.toggle('off', !limiterOn.checked);
  poll();
});
capSlider.addEventListener('input', () => {
  dragging = true;
  capText.textContent = fmtCap(parseInt(capSlider.value, 10));
});
capSlider.addEventListener('change', () => {
  dragging = false;
  if (limiterOn.checked) window.perf.setRamLimit(parseInt(capSlider.value, 10) || 500);
  poll();
});

poll();
setInterval(poll, 1500);
