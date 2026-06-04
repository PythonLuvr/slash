// Search engines. Google is the default. AI is NOT here, it lives on the
// search bar as its own mode.
const SOURCES = [
  { id: 'google', label: 'Google', domain: 'google.com' },
  { id: 'duckduckgo', label: 'DuckDuckGo', domain: 'duckduckgo.com' },
  { id: 'wikipedia', label: 'Wikipedia', domain: 'wikipedia.org' },
];

// AI model pills. Filled from the configured providers (providers:get) so
// the set expands/changes with the user's setup; falls back to these.
let HERO_MODELS = [
  { id: 'claude', label: 'Claude', domain: 'claude.ai' },
  { id: 'gemini', label: 'Gemini', domain: 'gemini.google.com' },
  { id: 'openai', label: 'ChatGPT', domain: 'chatgpt.com' },
];

const $ = (id) => document.getElementById(id);
const input = $('input');
const enginesEl = $('engines');
const modelsEl = $('models');
const suggestEl = $('suggest');
const tilesEl = $('tiles');
const sicon = document.querySelector('#box .sicon');

let source = SOURCES[0]; // Google
let aiModel = 'claude';
let mode = 'search';

// --- Engine selector (one-click row) ---
function renderEngines() {
  enginesEl.innerHTML = '';
  for (const s of SOURCES) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'echip' + (s.id === source.id ? ' active' : '');
    chip.setAttribute('role', 'tab');
    chip.setAttribute('aria-selected', s.id === source.id ? 'true' : 'false');
    const img = document.createElement('img');
    img.src = `https://icons.duckduckgo.com/ip3/${s.domain}.ico`;
    img.alt = '';
    img.className = 'efav';
    chip.appendChild(img);
    const label = document.createElement('span');
    label.textContent = s.label;
    chip.appendChild(label);
    chip.addEventListener('click', () => {
      source = s;
      input.placeholder = 'Search ' + s.label + ' or enter an address';
      renderEngines();
      input.focus();
    });
    enginesEl.appendChild(chip);
  }
}

// --- AI model pills ---
function renderModels() {
  modelsEl.innerHTML = '';
  for (const m of HERO_MODELS) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'echip' + (m.id === aiModel ? ' active' : '');
    chip.setAttribute('role', 'tab');
    chip.setAttribute('aria-selected', m.id === aiModel ? 'true' : 'false');
    if (m.domain) {
      const img = document.createElement('img');
      img.src = `https://icons.duckduckgo.com/ip3/${m.domain}.ico`;
      img.alt = '';
      img.className = 'efav';
      img.addEventListener('error', () => {
        const sp = document.createElement('span');
        sp.className = 'spark';
        sp.textContent = '✦';
        img.replaceWith(sp);
      });
      chip.appendChild(img);
    } else {
      const sp = document.createElement('span');
      sp.className = 'spark';
      sp.textContent = '✦';
      chip.appendChild(sp);
    }
    const label = document.createElement('span');
    label.textContent = m.label;
    chip.appendChild(label);
    chip.addEventListener('click', () => {
      aiModel = m.id;
      renderModels();
      input.focus();
    });
    modelsEl.appendChild(chip);
  }
}

// --- Search / Ask AI mode ---
function setMode(m) {
  mode = m;
  const aiOn = m === 'ai';
  $('mode-search').classList.toggle('active', !aiOn);
  $('mode-search').setAttribute('aria-selected', String(!aiOn));
  $('mode-ai').classList.toggle('active', aiOn);
  $('mode-ai').setAttribute('aria-selected', String(aiOn));
  $('box').classList.toggle('ai', aiOn);
  enginesEl.classList.toggle('hidden', aiOn);
  modelsEl.classList.toggle('hidden', !aiOn);
  sicon.innerHTML = aiOn ? '&#10022;' : '&#128269;';
  input.placeholder = aiOn ? 'Ask Slash AI…' : 'Search ' + source.label + ' or enter an address';
  hideSuggest();
  input.focus();
}
$('mode-search').addEventListener('click', () => setMode('search'));
$('mode-ai').addEventListener('click', () => setMode('ai'));

// --- Search suggestions ---
let sgItems = [];
let sgActive = -1;
let sgTimer;

function setSgActive(i) {
  sgActive = i;
  [...suggestEl.children].forEach((c, idx) => c.classList.toggle('active', idx === i));
}
function hideSuggest() {
  suggestEl.classList.add('hidden');
  suggestEl.innerHTML = '';
  sgItems = [];
  sgActive = -1;
}
function showSuggest(list) {
  sgItems = Array.isArray(list) ? list : [];
  sgActive = -1;
  if (!sgItems.length || mode !== 'search') {
    hideSuggest();
    return;
  }
  suggestEl.innerHTML = '';
  sgItems.forEach((s, i) => {
    const row = document.createElement('div');
    row.className = 'sg';
    const ic = document.createElement('span');
    ic.className = 'sgi';
    ic.textContent = '🔍';
    const tx = document.createElement('span');
    tx.textContent = s;
    row.appendChild(ic);
    row.appendChild(tx);
    row.addEventListener('mouseenter', () => setSgActive(i));
    row.addEventListener('mousedown', (e) => {
      e.preventDefault();
      window.hero.search(source.id, s);
    });
    suggestEl.appendChild(row);
  });
  suggestEl.classList.remove('hidden');
}

input.addEventListener('input', () => {
  if (mode !== 'search') {
    hideSuggest();
    return;
  }
  const v = input.value.trim();
  clearTimeout(sgTimer);
  if (!v) {
    hideSuggest();
    return;
  }
  sgTimer = setTimeout(async () => {
    if (mode !== 'search') return;
    const list = await window.hero.suggest(v);
    if (input.value.trim() === v) showSuggest(list);
  }, 130);
});
input.addEventListener('blur', () => setTimeout(hideSuggest, 120));

input.addEventListener('keydown', (e) => {
  // Slash command: empty box + "/" flips to Ask AI (the brand key).
  if (e.key === '/' && input.value === '' && mode === 'search') {
    e.preventDefault();
    setMode('ai');
    return;
  }
  if (mode === 'search' && !suggestEl.classList.contains('hidden') && sgItems.length) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSgActive(Math.min(sgActive + 1, sgItems.length - 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSgActive(Math.max(sgActive - 1, -1));
      return;
    }
    if (e.key === 'Escape') {
      hideSuggest();
      return;
    }
  }
  if (e.key !== 'Enter') return;
  const value = input.value.trim();
  if (mode === 'ai') {
    if (!value) return;
    window.hero.askAI(value, aiModel);
    input.value = '';
    return;
  }
  const chosen = sgActive >= 0 && sgItems[sgActive] ? sgItems[sgActive] : value;
  if (!chosen) return;
  hideSuggest();
  window.hero.search(source.id, chosen);
});

// --- Speed dial ---
const DIALS_KEY = 'slash.dials';

function loadDials() {
  try {
    return JSON.parse(localStorage.getItem(DIALS_KEY)) || [];
  } catch {
    return [];
  }
}
function saveDials(dials) {
  localStorage.setItem(DIALS_KEY, JSON.stringify(dials));
}
function domainOf(url) {
  try {
    return new URL(/^[a-z]+:\/\//i.test(url) ? url : 'https://' + url).hostname;
  } catch {
    return '';
  }
}

function renderTiles() {
  const dials = loadDials();
  tilesEl.innerHTML = '';
  for (let i = 0; i < dials.length; i++) {
    const d = dials[i];
    const tile = document.createElement('div');
    tile.className = 'tile';
    tile.title = d.url;
    tile.addEventListener('click', () => window.hero.open(d.url));
    const ico = document.createElement('span');
    ico.className = 'ico';
    const letter = (d.name || domainOf(d.url) || '?').trim().charAt(0);
    const dom = domainOf(d.url);
    if (dom) {
      const img = document.createElement('img');
      img.src = `https://icons.duckduckgo.com/ip3/${dom}.ico`;
      img.alt = '';
      img.style.cssText = 'width:100%;height:100%;border-radius:7px;object-fit:cover';
      img.addEventListener('error', () => {
        img.remove();
        ico.textContent = letter;
      });
      ico.appendChild(img);
    } else {
      ico.textContent = letter;
    }
    tile.appendChild(ico);
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = d.name || dom;
    tile.appendChild(name);
    const remove = document.createElement('button');
    remove.className = 'remove';
    remove.type = 'button';
    remove.setAttribute('aria-label', 'Remove shortcut');
    remove.innerHTML = '&#10005;';
    remove.addEventListener('click', (e) => {
      e.stopPropagation();
      const next = loadDials();
      next.splice(i, 1);
      saveDials(next);
      renderTiles();
    });
    tile.appendChild(remove);
    tilesEl.appendChild(tile);
  }
  const add = document.createElement('div');
  add.className = 'tile add';
  add.setAttribute('role', 'button');
  add.setAttribute('aria-label', 'Add shortcut');
  add.innerHTML = '<span class="plus">+</span>';
  add.addEventListener('click', openAddForm);
  tilesEl.appendChild(add);
}

function openAddForm() {
  $('add-name').value = '';
  $('add-url').value = '';
  $('addform').classList.remove('hidden');
  $('add-name').focus();
}
function closeAddForm() {
  $('addform').classList.add('hidden');
}
function commitAdd() {
  const name = $('add-name').value.trim();
  const url = $('add-url').value.trim();
  if (!url) return;
  const dials = loadDials();
  dials.push({ name: name || domainOf(url), url });
  saveDials(dials);
  closeAddForm();
  renderTiles();
}
$('add-cancel').addEventListener('click', closeAddForm);
$('add-save').addEventListener('click', commitAdd);
$('add-url').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') commitAdd();
});
$('addform').addEventListener('click', (e) => {
  if (e.target === $('addform')) closeAddForm();
});

// --- Init ---
window.hero
  .getProviders()
  .then((list) => {
    if (Array.isArray(list) && list.length) {
      HERO_MODELS = list;
      if (!HERO_MODELS.find((m) => m.id === aiModel)) aiModel = HERO_MODELS[0].id;
      renderModels();
    }
  })
  .catch(() => {});

renderEngines();
renderModels();
renderTiles();
input.focus();
