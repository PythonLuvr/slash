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
const cpuFill = $('cpu-fill');
const cpuVal = $('cpu-val');
const netFill = $('net-fill');
const netVal = $('net-val');
const sparkLine = $('spark-line');
const sparkArea = $('spark-area');
const sparkCap = $('spark-cap');
const tabListEl = $('tab-list');

let dragging = false;
let lastCap = 500;
const hist = [];
const HMAX = 60;

const fmtCap = (mb) => (mb >= 1000 ? mb / 1000 + ' GB' : mb + ' MB');
function fmtRate(bps) {
  if (bps >= 1048576) return (bps / 1048576).toFixed(1) + ' MB/s';
  if (bps >= 1024) return Math.round(bps / 1024) + ' KB/s';
  return bps + ' B/s';
}
const MOON = '<svg viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 0 1 9.5 4 7 7 0 1 0 20 14.5z" /></svg>';

function drawSpark(cap) {
  if (hist.length < 2) {
    sparkLine.setAttribute('d', '');
    sparkArea.setAttribute('d', '');
    return;
  }
  const capScale = cap ? cap / 0.68 : 0;
  const max = Math.max(capScale, ...hist, 1) * 1.05;
  const n = hist.length;
  const pts = hist.map((m, i) => [(i / (n - 1)) * 100, 34 - (m / max) * 34]);
  const d = pts.map(([x, y], i) => (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1)).join(' ');
  sparkLine.setAttribute('d', d);
  sparkArea.setAttribute('d', d + ' L 100 34 L 0 34 Z');
  if (cap) {
    const y = (34 - (cap / max) * 34).toFixed(1);
    sparkCap.setAttribute('y1', y);
    sparkCap.setAttribute('y2', y);
    sparkCap.style.display = '';
  } else {
    sparkCap.style.display = 'none';
  }
}

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

function renderTabs(list) {
  const top = (list || []).slice(0, 6);
  tabListEl.innerHTML = '';
  for (const t of top) {
    const row = document.createElement('div');
    row.className = 'tab-row' + (t.active ? ' active' : '') + (t.suspended ? ' asleep' : '');
    row.title = t.title || t.host;

    const host = document.createElement('span');
    host.className = 't-host';
    host.textContent = t.host || t.title || 'Tab';

    const mb = document.createElement('span');
    mb.className = 't-mb';
    mb.textContent = t.suspended ? 'asleep' : t.mb ? t.mb + ' MB' : '·';

    const btn = document.createElement('button');
    btn.className = 't-sleep';
    btn.type = 'button';
    btn.innerHTML = MOON;
    btn.title = t.suspended ? 'Already asleep' : t.active ? 'Active tab' : 'Sleep this tab';
    btn.disabled = t.active || t.suspended;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      window.perf.sleepTab(t.id);
      setTimeout(poll, 120);
    });

    row.addEventListener('click', () => window.perf.activateTab(t.id));
    row.append(host, mb, btn);
    tabListEl.appendChild(row);
  }
}

function render(s) {
  const mem = s.memMB || 0;
  const cap = s.ramLimitMB || 0;
  memNow.textContent = mem + ' MB';
  tabCount.textContent = s.tabs + ' tab' + (s.tabs === 1 ? '' : 's');
  sleepCount.textContent = s.asleep ? s.asleep + ' asleep' : '';

  hist.push(mem);
  if (hist.length > HMAX) hist.shift();
  drawSpark(cap);

  const scaleMax = cap ? cap / 0.68 : Math.max(mem * 1.25, 1200);
  fill.style.width = Math.min(100, (mem / scaleMax) * 100) + '%';
  fill.classList.toggle('over', !!cap && mem > cap);
  if (cap) {
    gaugeCap.classList.remove('hidden');
    gaugeCap.style.left = Math.min(100, (cap / scaleMax) * 100) + '%';
  } else {
    gaugeCap.classList.add('hidden');
  }

  const cpu = Math.max(0, s.cpu || 0);
  cpuVal.textContent = cpu + '%';
  cpuFill.style.width = Math.min(100, cpu) + '%';
  cpuFill.classList.toggle('hot', cpu > 70);

  const net = s.net || 0;
  netVal.textContent = fmtRate(net);
  netFill.style.width = Math.min(100, (net / (2 * 1048576)) * 100) + '%'; // 2 MB/s reads as full

  applyControls(cap);
  renderTabs(s.tabList);
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
$('free-now').addEventListener('click', () => {
  window.perf.freeNow();
  setTimeout(poll, 150);
});

poll();
setInterval(poll, 1500);
