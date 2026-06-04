const $ = (id) => document.getElementById(id);

const ENGINES = [
  { id: 'duckduckgo', label: 'DuckDuckGo', domain: 'duckduckgo.com' },
  { id: 'google', label: 'Google', domain: 'google.com' },
  { id: 'wikipedia', label: 'Wikipedia', domain: 'wikipedia.org' },
];

// Accent presets, all light enough to carry the dark --on-accent text.
const ACCENTS = ['#f1cb53', '#f0976c', '#8fd98a', '#6cc2f0', '#b79bf0', '#f08aa8'];

let current = null;

async function load() {
  current = await window.settings.get();
  renderEngines();
  renderToggles();
  renderAccents();
  renderDefault();
  renderImport();
}

async function renderDefault() {
  let isDef = false;
  try {
    isDef = await window.settings.defaultStatus();
  } catch {
    /* ignore */
  }
  $('default-desc').textContent = isDef
    ? 'Slash is registered to handle web links on this device.'
    : 'Open web links in Slash. Windows will ask you to confirm in Default Apps.';
  $('set-default').textContent = isDef ? 'Set again' : 'Set as default';
}
$('set-default').addEventListener('click', async () => {
  $('set-default').textContent = 'Opening Default Apps…';
  await window.settings.setDefault();
  setTimeout(renderDefault, 500);
});

async function renderImport() {
  const wrap = $('import-list');
  wrap.innerHTML = '';
  let sources = [];
  try {
    sources = await window.settings.importList();
  } catch {
    /* ignore */
  }
  if (!sources.length) {
    wrap.innerHTML = '<div class="import-empty">No other browsers found.</div>';
    return;
  }
  for (const s of sources) {
    const btn = document.createElement('button');
    btn.className = 'btn import-btn';
    btn.type = 'button';
    btn.textContent = `${s.name} (${s.count})`;
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = `${s.name} · importing…`;
      const r = await window.settings.importRun(s.id);
      btn.textContent = `${s.name} · ${r.imported} added`;
    });
    wrap.appendChild(btn);
  }
}

function renderEngines() {
  const wrap = $('engines');
  wrap.innerHTML = '';
  for (const e of ENGINES) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip' + (e.id === current.searchEngine ? ' active' : '');
    const img = document.createElement('img');
    img.src = `https://icons.duckduckgo.com/ip3/${e.domain}.ico`;
    img.alt = '';
    chip.appendChild(img);
    const label = document.createElement('span');
    label.textContent = e.label;
    chip.appendChild(label);
    chip.addEventListener('click', async () => {
      current = await window.settings.set({ searchEngine: e.id });
      renderEngines();
    });
    wrap.appendChild(chip);
  }
}

function renderToggles() {
  for (const row of document.querySelectorAll('.toggle-row')) {
    const key = row.dataset.key;
    row.classList.toggle('on', !!current[key]);
    const sw = row.querySelector('.sw');
    sw.setAttribute('aria-checked', current[key] ? 'true' : 'false');
    const flip = async () => {
      current = await window.settings.set({ [key]: !current[key] });
      row.classList.toggle('on', !!current[key]);
      sw.setAttribute('aria-checked', current[key] ? 'true' : 'false');
    };
    sw.onclick = flip;
    sw.onkeydown = (e) => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        flip();
      }
    };
  }
}

function renderAccents() {
  const wrap = $('accents');
  wrap.innerHTML = '';
  const cur = (current.accent || '').toLowerCase();
  for (const hex of ACCENTS) {
    const sw = document.createElement('button');
    sw.type = 'button';
    sw.className = 'swatch' + (hex.toLowerCase() === cur ? ' active' : '');
    sw.style.background = hex;
    sw.setAttribute('aria-label', 'Accent ' + hex);
    sw.addEventListener('click', async () => {
      current = await window.settings.set({ accent: hex });
      renderAccents();
    });
    wrap.appendChild(sw);
  }
  // Custom color picker.
  const custom = document.createElement('label');
  custom.className = 'swatch custom' + (ACCENTS.includes(cur) ? '' : ' active');
  custom.title = 'Custom color';
  const input = document.createElement('input');
  input.type = 'color';
  input.value = current.accent || '#f1cb53';
  input.addEventListener('input', async (e) => {
    current = await window.settings.set({ accent: e.target.value });
    renderAccents();
  });
  custom.appendChild(input);
  wrap.appendChild(custom);
}

$('close').addEventListener('click', () => window.settings.close());
$('open-ai').addEventListener('click', () => window.settings.openAI());
window.settings.onShow(load);

load();
