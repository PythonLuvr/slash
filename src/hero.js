// Search engines. DuckDuckGo is the private default. AI is NOT here, it lives
// on the search bar as its own mode.
// Full engine set, filled from search:get (kept in sync with the omnibox picker
// and settings). `favorites` is the ordered subset shown as quick-pick chips.
let SOURCES = [
  { id: 'duckduckgo', label: 'DuckDuckGo', domain: 'duckduckgo.com' },
  { id: 'startpage', label: 'Startpage', domain: 'startpage.com' },
  { id: 'brave', label: 'Brave Search', domain: 'brave.com' },
  { id: 'google', label: 'Google', domain: 'google.com' },
  { id: 'bing', label: 'Bing', domain: 'bing.com' },
  { id: 'ecosia', label: 'Ecosia', domain: 'ecosia.org' },
  { id: 'wikipedia', label: 'Wikipedia', domain: 'wikipedia.org' },
];
let favorites = ['duckduckgo', 'startpage', 'brave']; // start-page quick picks
let dragId = null;

// AI model pills. Filled from the configured providers (providers:get) so
// the set expands/changes with the user's setup; falls back to these.
let HERO_MODELS = [
  { id: 'claude', label: 'Claude', domain: 'claude.ai' },
  { id: 'gemini', label: 'Gemini', domain: 'gemini.google.com' },
  { id: 'openai', label: 'ChatGPT', domain: 'chatgpt.com' },
];

const $ = (id) => document.getElementById(id);

// Favicons come from Slash's local cache when available; on a cold cache we
// load the site's OWN favicon (first-party), never a third-party aggregator
// that would see every domain at once. onMissing() draws the monogram.
function firstPartyIcon(host) {
  return 'https://' + String(host || '').replace(/^www\./, '') + '/favicon.ico';
}
function applyFavicon(img, host, onMissing) {
  img.addEventListener('error', onMissing, { once: true });
  window.hero
    .favicon(host)
    .then((d) => {
      img.src = d || firstPartyIcon(host);
    })
    .catch(() => {
      img.src = firstPartyIcon(host);
    });
}

const input = $('input');
const enginesEl = $('engines');
const modelsEl = $('models');
const suggestEl = $('suggest');
const tilesEl = $('tiles');
const sicon = document.querySelector('#box .sicon');

let source = SOURCES[0]; // DuckDuckGo
let aiModel = 'claude';
let mode = 'search';

// --- Engine selector: customizable quick-pick chips ---
function metaOf(id) {
  return SOURCES.find((s) => s.id === id);
}
function persistFavorites() {
  window.hero.setHeroEngines(favorites);
}

function renderEngines() {
  enginesEl.innerHTML = '';
  for (const id of favorites) {
    const s = metaOf(id);
    if (!s) continue;
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'echip' + (s.id === source.id ? ' active' : '');
    chip.setAttribute('role', 'tab');
    chip.setAttribute('aria-selected', s.id === source.id ? 'true' : 'false');
    chip.title = s.label + '  (right-click to remove, drag to reorder)';
    chip.draggable = true;

    const img = document.createElement('img');
    img.alt = '';
    img.className = 'efav';
    chip.appendChild(img);
    applyFavicon(img, s.domain, () => {
      const sp = document.createElement('span');
      sp.className = 'spark';
      sp.textContent = (s.label || '?').charAt(0);
      img.replaceWith(sp);
    });
    const label = document.createElement('span');
    label.textContent = s.label;
    chip.appendChild(label);

    chip.addEventListener('click', () => {
      source = s;
      window.hero.setSearchEngine(s.id); // persist as the one default everywhere
      input.placeholder = 'Search ' + s.label + ' or enter an address';
      renderEngines();
      input.focus();
    });
    // Right-click opens a small menu (set default / remove / delete) instead of
    // deleting immediately.
    chip.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      openChipMenu(s, e.clientX, e.clientY);
    });
    // Drag to reorder.
    chip.addEventListener('dragstart', () => {
      dragId = id;
      chip.classList.add('dragging');
    });
    chip.addEventListener('dragend', () => {
      dragId = null;
      chip.classList.remove('dragging');
    });
    chip.addEventListener('dragover', (e) => e.preventDefault());
    chip.addEventListener('drop', (e) => {
      e.preventDefault();
      if (!dragId || dragId === id) return;
      const from = favorites.indexOf(dragId);
      const to = favorites.indexOf(id);
      if (from < 0 || to < 0) return;
      favorites.splice(from, 1);
      favorites.splice(to, 0, dragId);
      persistFavorites();
      renderEngines();
    });
    enginesEl.appendChild(chip);
  }

  // "+" chip: add an engine that is not already a quick pick.
  const remaining = SOURCES.filter((s) => !favorites.includes(s.id));
  if (remaining.length) {
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'echip echip-add';
    add.title = 'Add a search engine';
    add.setAttribute('aria-label', 'Add a search engine');
    add.textContent = '+';
    add.addEventListener('click', (e) => {
      e.stopPropagation();
      openEngineAdd(add, remaining);
    });
    enginesEl.appendChild(add);
  }
}

// Small popup listing engines that can be added to the quick picks.
function openEngineAdd(anchor, remaining) {
  closeEngineAdd();
  const menu = document.createElement('div');
  menu.id = 'engine-add';
  menu.className = 'engine-add';
  for (const s of remaining) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'ea-row';
    const img = document.createElement('img');
    img.alt = '';
    img.className = 'ea-fav';
    row.appendChild(img);
    applyFavicon(img, s.domain, () => {
      const sp = document.createElement('span');
      sp.className = 'spark';
      sp.textContent = (s.label || '?').charAt(0);
      img.replaceWith(sp);
    });
    const label = document.createElement('span');
    label.textContent = s.label;
    row.appendChild(label);
    row.addEventListener('click', () => {
      favorites.push(s.id);
      persistFavorites();
      closeEngineAdd();
      renderEngines();
    });
    menu.appendChild(row);
  }
  document.body.appendChild(menu);
  const r = anchor.getBoundingClientRect();
  menu.style.left = Math.round(r.left) + 'px';
  menu.style.top = Math.round(r.bottom + 6) + 'px';
  setTimeout(() => document.addEventListener('mousedown', onAddOutside, true), 0);
}
function onAddOutside(e) {
  const menu = document.getElementById('engine-add');
  if (menu && !menu.contains(e.target)) closeEngineAdd();
}
function closeEngineAdd() {
  const menu = document.getElementById('engine-add');
  if (menu) menu.remove();
  document.removeEventListener('mousedown', onAddOutside, true);
}

// Right-click menu for a quick-pick chip.
function openChipMenu(s, x, y) {
  closeEngineAdd();
  closeChipMenu();
  const menu = document.createElement('div');
  menu.id = 'chip-menu';
  menu.className = 'engine-add chip-menu';
  const item = (label, fn, danger) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ea-row' + (danger ? ' danger' : '');
    b.textContent = label;
    b.addEventListener('click', () => {
      closeChipMenu();
      fn();
    });
    menu.appendChild(b);
  };
  item('Set as default', () => {
    source = s;
    window.hero.setSearchEngine(s.id);
    input.placeholder = 'Search ' + s.label + ' or enter an address';
    renderEngines();
  });
  if (favorites.length > 1) {
    item('Remove from start page', () => {
      favorites = favorites.filter((x) => x !== s.id);
      persistFavorites();
      renderEngines();
    });
  }
  // Built-in engines cannot be deleted; custom engines (later) can.
  if (s.custom) {
    item('Delete engine', () => {
      favorites = favorites.filter((x) => x !== s.id);
      persistFavorites();
      renderEngines();
    }, true);
  }
  document.body.appendChild(menu);
  menu.style.left = Math.min(x, window.innerWidth - 190) + 'px';
  menu.style.top = y + 'px';
  setTimeout(() => document.addEventListener('mousedown', onChipOutside, true), 0);
}
function onChipOutside(e) {
  const menu = document.getElementById('chip-menu');
  if (menu && !menu.contains(e.target)) closeChipMenu();
}
function closeChipMenu() {
  const menu = document.getElementById('chip-menu');
  if (menu) menu.remove();
  document.removeEventListener('mousedown', onChipOutside, true);
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
      img.alt = '';
      img.className = 'efav';
      chip.appendChild(img);
      applyFavicon(img, m.domain, () => {
        const sp = document.createElement('span');
        sp.className = 'spark';
        sp.textContent = '✦';
        img.replaceWith(sp);
      });
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
      img.alt = '';
      img.style.cssText = 'width:100%;height:100%;border-radius:7px;object-fit:cover';
      ico.appendChild(img);
      applyFavicon(img, dom, () => {
        img.remove();
        ico.textContent = letter;
      });
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

// Engine list + current default, shared with the omnibox picker and settings.
function syncEngine(id) {
  const found = SOURCES.find((s) => s.id === id);
  if (found) source = found;
  renderEngines();
  if (mode !== 'ai') input.placeholder = 'Search ' + source.label + ' or enter an address';
}
window.hero
  .searchGet()
  .then(({ current, list, favorites: fav }) => {
    if (Array.isArray(list) && list.length) SOURCES = list;
    const valid = (ids) => (ids || []).filter((id) => SOURCES.find((s) => s.id === id));
    const v = valid(fav);
    favorites = v.length ? v : SOURCES.slice(0, 3).map((s) => s.id);
    syncEngine(current);
  })
  .catch(() => {});
window.hero.onSearchEngine(syncEngine);
// Quick-pick chips changed elsewhere (e.g. the settings engine manager).
window.hero.onHeroEngines((ids) => {
  if (!Array.isArray(ids)) return;
  const v = ids.filter((id) => metaOf(id));
  if (v.length) {
    favorites = v;
    renderEngines();
  }
});

// Brand cursor: alternate / and _ in a fixed-width slot so "slash" never moves.
const slEl = document.querySelector('#brand .sl');
if (slEl) {
  let slOn = true;
  setInterval(() => {
    slOn = !slOn;
    slEl.textContent = slOn ? '/' : '_';
  }, 550);
}

renderEngines();
renderModels();
renderTiles();
input.placeholder = 'Search ' + source.label + ' or enter an address';
input.focus();

// The AI's add_to_homepage tool drops a shortcut tile here.
window.hero.onAddDial(({ name, url }) => {
  if (!url) return;
  const dials = loadDials();
  if (!dials.some((d) => d.url === url)) {
    dials.push({ name: name || domainOf(url), url });
    saveDials(dials);
  }
  renderTiles();
});
